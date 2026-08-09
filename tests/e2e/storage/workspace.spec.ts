import { readFileSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

const fixture = readFileSync('tests/fixtures/gold-preview.fig')

const remoteObjectPaths = [
  '/designs/open_pencil_storage/canvases/remote-1.fig',
  '/designs/open_pencil_storage/canvases/remote-1.meta.json',
  '/designs/open_pencil_storage/canvases/remote-1.thumb.jpg'
] as const

async function routeS3Workspace(page: Page, deletedPaths?: Set<string>): Promise<void> {
  await page.route('https://s3.example.com/**', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'DELETE') {
      deletedPaths?.add(url.pathname)
      await route.fulfill({ status: 204 })
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
    if (url.pathname.endsWith('/remote-1.fig')) {
      await route.fulfill({ contentType: 'application/octet-stream', body: fixture })
      return
    }
    await route.fulfill({ status: 404 })
  })
}

async function configureS3Workspace(page: Page): Promise<void> {
  await page.goto('/storage?test')
  await page.getByRole('button', { name: 'Settings' }).last().click()
  await page.getByTestId('settings-storage-provider-s3-compatible').click()
  await page.getByLabel('Endpoint').fill('https://s3.example.com')
  await page.getByLabel('Bucket').fill('designs')

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

test('configured storage lists and opens a remote document', async ({ page }) => {
  await routeS3Workspace(page)
  await configureS3Workspace(page)
  const canvas = new CanvasHelper(page)

  await page.locator('[data-document-id="remote-1"]').click()
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 })
  await canvas.waitForInit()
  await expect(page.getByText('Remote design').first()).toBeVisible()
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

test('blocks deletion while the same remote document is open', async ({ page }) => {
  test.slow()
  await routeS3Workspace(page)
  await configureS3Workspace(page)

  await page.locator('[data-document-id="remote-1"]').click()
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 })
  await page.evaluate(async () => {
    const { default: router } = await import('/src/router.ts')
    await router.push('/storage?test')
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
  await expect(page.getByTestId('settings-storage-panel')).toBeVisible()
})
