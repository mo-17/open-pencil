import { readFileSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

const fixture = readFileSync('tests/fixtures/gold-preview.fig')

const remoteObjectPaths = [
  '/designs/open_pencil_storage/canvases/remote-1.fig',
  '/designs/open_pencil_storage/canvases/remote-1.meta.json',
  '/designs/open_pencil_storage/canvases/remote-1.thumb.jpg'
] as const

type S3WorkspaceRouteStats = {
  fullDocumentGets: number
  rangeGets: number
}

function fixtureByteRange(range: string | undefined): { start: number; end: number } | null {
  const explicit = range?.match(/^bytes=(\d+)-(\d+)$/)
  if (explicit) {
    return {
      start: Number(explicit[1]),
      end: Math.min(Number(explicit[2]), fixture.byteLength - 1)
    }
  }
  const suffix = range?.match(/^bytes=-(\d+)$/)
  if (!suffix) return null
  const length = Math.min(Number(suffix[1]), fixture.byteLength)
  return { start: fixture.byteLength - length, end: fixture.byteLength - 1 }
}

async function routeS3Workspace(
  page: Page,
  deletedPaths?: Set<string>
): Promise<S3WorkspaceRouteStats> {
  const stats = { fullDocumentGets: 0, rangeGets: 0 }
  await page.route('https://s3.example.com/**', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'DELETE') {
      deletedPaths?.add(url.pathname)
      await route.fulfill({ status: 204 })
      return
    }
    if (route.request().method() === 'PUT') {
      await route.fulfill({
        status: 200,
        headers: { ETag: '"storage-fixture"', 'Access-Control-Expose-Headers': 'ETag' },
        body: ''
      })
      return
    }
    if (url.searchParams.get('list-type') === '2') {
      const documentDeleted = deletedPaths?.has(remoteObjectPaths[0]) ?? false
      await route.fulfill({
        contentType: 'application/xml',
        body: `<ListBucketResult>
          <IsTruncated>false</IsTruncated>
          ${
            documentDeleted
              ? ''
              : `<Contents>
            <Key>open_pencil_storage/canvases/remote-1.fig</Key>
            <LastModified>2026-01-02T03:04:05.000Z</LastModified>
            <Size>${fixture.byteLength}</Size>
          </Contents>`
          }
        </ListBucketResult>`
      })
      return
    }
    if (url.pathname.endsWith('/remote-1.meta.json')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ name: 'Remote design', updatedAt: '2026-01-02T03:04:05.000Z' })
      })
      return
    }
    if (url.pathname.endsWith('/remote-1.fig') && route.request().headers().range) {
      const range = route.request().headers().range
      const requestedRange = fixtureByteRange(range)
      if (!requestedRange) {
        await route.fulfill({ status: 416 })
        return
      }
      const { start, end } = requestedRange
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
        await route.fulfill({ status: 416 })
        return
      }
      await route.fulfill({
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fixture.byteLength}`,
          'Access-Control-Expose-Headers': 'Content-Range, Content-Length'
        },
        contentType: 'application/octet-stream',
        body: fixture.subarray(start, end + 1)
      })
      stats.rangeGets++
      return
    }
    if (url.pathname.endsWith('/remote-1.fig') && route.request().method() === 'HEAD') {
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Length': String(fixture.byteLength),
          'Access-Control-Expose-Headers': 'Content-Range, Content-Length'
        }
      })
      return
    }
    if (url.pathname.endsWith('/remote-1.fig')) {
      stats.fullDocumentGets++
      await route.fulfill({ contentType: 'application/octet-stream', body: fixture })
      return
    }
    await route.fulfill({ status: 404 })
  })
  return stats
}

async function configureS3Workspace(page: Page, fromEditor = false): Promise<void> {
  if (fromEditor) {
    await page.getByTestId('app-settings-trigger').click()
  } else {
    await page.goto('/storage?test')
    await page.getByRole('button', { name: 'Settings' }).last().click()
  }
  await page.getByTestId('settings-section-storage').click()
  await page.getByTestId('settings-storage-provider-s3-compatible').click()
  await page.getByLabel('Endpoint', { exact: true }).fill('https://s3.example.com')
  await page.getByLabel('Bucket', { exact: true }).fill('designs')

  for (const [field, value] of [
    ['access-key-id', 'access-key'],
    ['secret-access-key', 'secret-key']
  ] as const) {
    const container = page.locator(`[data-credential="${field}"]`)
    await container.locator('input').fill(value)
    await container.getByRole('button', { name: 'Save' }).click()
  }

  await page.getByTestId('settings-storage-open-workspace').click()
  await expect(page.getByTestId('storage-workspace')).toBeVisible()
  await expect(page.getByText('Remote design')).toBeVisible()
}

test('configured storage lists a range-loaded preview before opening the document', async ({
  page
}) => {
  // This exercises a complete Figma decode and the first presented canvas frame.
  test.slow()
  const stats = await routeS3Workspace(page)
  await configureS3Workspace(page)
  const canvas = new CanvasHelper(page)

  const preview = page.locator('[data-document-id="remote-1"] > div').first()
  await expect(preview).toBeVisible()
  await expect(preview).toHaveCSS('background-image', /^url\("blob:/)
  expect(stats.rangeGets).toBe(3)
  expect(stats.fullDocumentGets).toBe(0)

  await page.locator('[data-document-id="remote-1"]').click()
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 })
  await canvas.waitForInit()
  await expect(page.getByText('Remote design').first()).toBeVisible()
  expect(
    await page.evaluate(() => window.openPencil?.getStore?.().getStorageBinding()?.documentId)
  ).toBe('remote-1')
  expect(await page.evaluate(() => window.openPencil?.getStore?.().state.preparation)).toBeNull()
  expect(stats.rangeGets).toBeGreaterThan(3)
  expect(stats.fullDocumentGets).toBe(0)
})

async function preparePreviousDesign(page: Page): Promise<string> {
  await page.goto('/?test')
  await new CanvasHelper(page).waitForInit()
  const nodeId = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Editor not initialized')
    store.state.documentName = 'Previous design'
    const id = store.createShape('RECTANGLE', 50, 50, 120, 80)
    store.updateNode(id, { name: 'Preserved rectangle' })
    return id
  })
  // Keep another tab to distinguish restoring the previous document from
  // merely selecting the nearest tab after the provisional one closes.
  await page.getByTestId('tabbar-new').click()
  await page.getByTestId('tabbar-tab').filter({ hasText: 'Previous design' }).click()
  await configureS3Workspace(page, true)
  return nodeId
}

async function expectPreviousDesign(page: Page, nodeId: string): Promise<void> {
  await expect(
    page.getByTestId('tabbar-tab').filter({ hasText: 'Previous design' })
  ).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('tabbar-tab').filter({ hasText: 'Remote design' })).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate((id) => window.openPencil?.getStore?.().graph.getNode(id)?.name, nodeId)
    )
    .toBe('Preserved rectangle')
  await expect(page.getByTestId('canvas-loading')).not.toBeVisible()
}

test('failed cloud download restores the previous document after editor handoff', async ({
  page
}) => {
  await routeS3Workspace(page)
  const previousNodeId = await preparePreviousDesign(page)
  await page.route(
    'https://s3.example.com/designs/open_pencil_storage/canvases/remote-1.fig',
    async (route) => {
      if (route.request().headers().range === 'bytes=0-8388607') {
        await route.fulfill({ status: 503, body: 'Unavailable storage fixture' })
      } else {
        await route.fallback()
      }
    }
  )

  await page.locator('[data-document-id="remote-1"]').click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('toast-item')).toContainText(
    'Could not open “Remote design”: Unavailable storage fixture'
  )
  await expectPreviousDesign(page, previousNodeId)
})

test('closing a loading cloud tab cancels its request and restores the previous document', async ({
  page
}) => {
  await routeS3Workspace(page)
  const previousNodeId = await preparePreviousDesign(page)
  const requested = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const finished = Promise.withResolvers<undefined>()
  await page.route(
    'https://s3.example.com/designs/open_pencil_storage/canvases/remote-1.fig',
    async (route) => {
      if (route.request().headers().range !== 'bytes=0-8388607') {
        await route.fallback()
        return
      }
      requested.resolve(undefined)
      try {
        await release.promise
        await route.abort('failed')
      } finally {
        finished.resolve(undefined)
      }
    }
  )

  try {
    await page.locator('[data-document-id="remote-1"]').click()
    await requested.promise
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByTestId('canvas-loading')).toBeVisible()
    await page.getByRole('button', { name: 'Close Remote design', exact: true }).click()
    release.resolve(undefined)
    await finished.promise
    await expectPreviousDesign(page, previousNodeId)
    await expect(
      page.getByTestId('toast-item').filter({ hasText: /Could not open “Remote design”:/ })
    ).toHaveCount(0)
  } finally {
    release.resolve(undefined)
  }
})

test('deletes local-first and completes the remote removal in the background', async ({ page }) => {
  const deletedPaths = new Set<string>()
  await routeS3Workspace(page, deletedPaths)
  await configureS3Workspace(page)

  const openButton = page.locator('[data-document-id="remote-1"]')
  await openButton.locator('..').getByTestId('storage-delete-document').click()
  await expect(page.getByTestId('storage-delete-document-dialog')).toContainText(
    'permanently delete it from S3 compatible'
  )
  await page.getByTestId('storage-delete-document-confirm').click()

  await expect(openButton).toHaveCount(0)
  await expect(page.getByText('Deletion queued. It will finish in the background.')).toBeVisible()
  await expect.poll(() => [...deletedPaths].sort()).toEqual([...remoteObjectPaths].sort())

  await page.reload()
  await expect(page.getByTestId('storage-workspace')).toBeVisible()
  await expect(page.locator('[data-document-id="remote-1"]')).toHaveCount(0)
})

test('blocks deletion during a cloud download and releases the guard after cancellation', async ({
  page
}) => {
  await routeS3Workspace(page)
  await configureS3Workspace(page)
  const requested = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const finished = Promise.withResolvers<undefined>()
  await page.route(
    'https://s3.example.com/designs/open_pencil_storage/canvases/remote-1.fig',
    async (route) => {
      if (route.request().headers().range !== 'bytes=0-8388607') {
        await route.fallback()
        return
      }
      requested.resolve(undefined)
      try {
        await release.promise
        await route.abort('failed')
      } finally {
        finished.resolve(undefined)
      }
    }
  )
  const navigate = (path: string) =>
    page.evaluate((url) => {
      window.history.pushState({}, '', url)
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
    }, path)

  try {
    await page.locator('[data-document-id="remote-1"]').click()
    await requested.promise
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByTestId('canvas-loading')).toBeVisible()
    await navigate('/storage?test')
    const openButton = page.locator('[data-document-id="remote-1"]')
    await expect(openButton).toBeVisible()
    await openButton.locator('..').getByTestId('storage-delete-document').click()
    const dialog = page.getByTestId('storage-delete-document-dialog')
    await expect(dialog).toContainText('Close this document’s editor tab before deleting it')
    await expect(page.getByTestId('storage-delete-document-confirm')).toBeDisabled()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()

    await navigate('/')
    await page.getByRole('button', { name: 'Close Remote design', exact: true }).click()
    release.resolve(undefined)
    await finished.promise
    await expect(page.getByTestId('tabbar-tab').filter({ hasText: 'Remote design' })).toHaveCount(0)
    await navigate('/storage?test')
    await expect(openButton).toBeVisible()
    await openButton.locator('..').getByTestId('storage-delete-document').click()
    await expect(dialog).toContainText('permanently delete it from S3 compatible')
    await expect(page.getByTestId('storage-delete-document-confirm')).toBeEnabled()
  } finally {
    release.resolve(undefined)
  }
})

test('blocks deletion while the same remote document is open', async ({ page }) => {
  test.slow()
  await routeS3Workspace(page)
  await configureS3Workspace(page)

  await page.locator('[data-document-id="remote-1"]').click()
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 })
  await new CanvasHelper(page).waitForInit()
  expect(
    await page.evaluate(() => window.openPencil?.getStore?.().getStorageBinding()?.documentId)
  ).toBe('remote-1')
  await page.evaluate(() => {
    window.history.pushState({}, '', '/storage?test')
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
  })

  const openButton = page.locator('[data-document-id="remote-1"]')
  await expect(openButton).toBeVisible()
  await openButton.locator('..').getByTestId('storage-delete-document').click()
  await expect(page.getByTestId('storage-delete-document-dialog')).toContainText(
    'Close this document’s editor tab before deleting it'
  )
  await expect(page.getByTestId('storage-delete-document-confirm')).toBeDisabled()
})

test('storage workspace directs unconfigured users to Settings', async ({ page }) => {
  await page.goto('/storage?test')

  await expect(page.getByTestId('storage-workspace')).toBeVisible()
  await expect(
    page
      .getByTestId('storage-workspace')
      .getByText('Configure storage before using this workspace.')
  ).toBeVisible()
  await expect(page.getByTestId('storage-new-document')).toBeDisabled()

  await page.getByRole('button', { name: 'Settings' }).last().click()
  await page.getByTestId('settings-section-storage').click()
  await expect(page.getByTestId('settings-storage-panel')).toBeVisible()
})
