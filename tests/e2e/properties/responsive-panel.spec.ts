import type { Page } from '@playwright/test'

import type { SceneGraph } from '@open-pencil/scene-graph'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

test.use({ viewport: { width: 2200, height: 1100 }, deviceScaleFactor: 1 })
test.setTimeout(120_000)

function panel(page: Page) {
  return page.getByTestId('lowcode-responsive')
}
function row(page: Page, key: string) {
  return panel(page).locator(`[data-property="${key}"]`)
}
async function breakpoint(page: Page, value: string) {
  await panel(page).scrollIntoViewIfNeeded()
  await page.getByTestId('lowcode-responsive-breakpoint').click()
  await page.getByRole('option', { name: new RegExp(`^${value} ·`) }).click()
}
async function editNumber(page: Page, key: string, value: string, commit = true) {
  await row(page, key).getByRole('spinbutton').focus()
  const input = row(page, key).locator('input[data-slot="input"]')
  await input.fill(value)
  if (commit) await input.press('Enter')
  return input
}
async function overrides(page: Page, id: string) {
  return page.evaluate(
    (id) => window.openPencil?.getStore?.().graph.getNode(id)?.responsiveOverrides,
    id
  )
}
async function prepare(page: Page) {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const id = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Missing editor')
    const id = store.createShape('FRAME', 120, 120, 320, 220)
    store.graph.updateNode(id, {
      name: 'Responsive editing',
      responsiveOverrides: { sm: { itemSpacing: 12 }, md: { width: 640 } }
    })
    store.select([id])
    return id
  })
  await panel(page).scrollIntoViewIfNeeded()
  await expect(panel(page)).toBeVisible()
  return { canvas, id }
}

test('responsive branch editing restores inheritance, null limits and one-step undo without changing base geometry', async ({
  page
}) => {
  const { canvas, id } = await prepare(page)
  await breakpoint(page, 'lg')
  await expect(row(page, 'width')).toHaveAttribute('data-source', 'md')
  await expect(row(page, 'width').getByRole('spinbutton')).toHaveAttribute('aria-valuenow', '640')
  // Pin explicitly authors an inherited same-value; unchanged input remains read-only.
  await row(page, 'width').locator('[data-command="author-responsive-field"]').click()
  expect((await overrides(page, id))?.lg).toEqual({ width: 640 })
  await page.evaluate(() => window.openPencil?.getStore?.().undo.undo())
  expect((await overrides(page, id))?.lg).toBeUndefined()
  await page.evaluate(() => window.openPencil?.getStore?.().undo.redo())
  await expect(row(page, 'width')).toHaveAttribute('data-overridden', 'true')
  await editNumber(page, 'height', '330')
  expect((await overrides(page, id))?.lg?.height).toBe(330)
  await row(page, 'height').locator('[data-command="restore-responsive-field"]').click()
  await row(page, 'visible').getByRole('combobox').click()
  await page.getByRole('option', { name: 'Hide', exact: true }).click()
  await row(page, 'visible').getByRole('combobox').click()
  await expect(page.getByRole('option', { name: 'Inherit · Show', exact: true })).toBeVisible()
  await page.getByRole('option', { name: 'Inherit · Show', exact: true }).click()
  await row(page, 'maxWidth').locator('[data-command="clear-responsive-limit"]').click()
  expect((await overrides(page, id))?.lg).toEqual({ width: 640, maxWidth: null })
  await row(page, 'width').locator('[data-command="restore-responsive-field"]').click()
  expect((await overrides(page, id))?.lg).toEqual({ maxWidth: null })
  await expect(row(page, 'width')).toHaveAttribute('data-source', 'md')
  await panel(page).locator('[data-command="clear-responsive-breakpoint"]').click()
  expect((await overrides(page, id))?.lg).toBeUndefined()
  await page.evaluate(() => window.openPencil?.getStore?.().undo.undo())
  expect((await overrides(page, id))?.lg).toEqual({ maxWidth: null })
  await page.evaluate(() => window.openPencil?.getStore?.().undo.redo())
  expect(await overrides(page, id)).toEqual({ sm: { itemSpacing: 12 }, md: { width: 640 } })
  expect(
    await page.evaluate((id) => {
      const node = window.openPencil?.getStore?.().graph.getNode(id)
      return node && { x: node.x, y: node.y, width: node.width, height: node.height }
    }, id)
  ).toEqual({ x: 120, y: 120, width: 320, height: 220 })
  canvas.assertNoErrors()
})

test('responsive numeric drafts cancel on breakpoint, source, selection, protection and same-ID document changes', async ({
  page
}) => {
  const { canvas, id } = await prepare(page)
  await editNumber(page, 'width', '999', false)
  await breakpoint(page, 'md')
  expect((await overrides(page, id))?.compact).toBeUndefined()
  await editNumber(page, 'width', '998', false)
  await page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Missing editor')
    store.graph.updateNode(id, {
      responsiveOverrides: { sm: { itemSpacing: 12 }, md: { width: 700 } }
    })
  }, id)
  await expect(row(page, 'width').locator('input')).toHaveCount(0)
  await expect(row(page, 'width').getByRole('spinbutton')).toHaveAttribute('aria-valuenow', '700')
  await editNumber(page, 'width', '997', false)
  const oldClear = await panel(page)
    .locator('[data-command="clear-responsive-breakpoint"]')
    .elementHandle()
  if (!oldClear) throw new Error('Missing branch Clear button')
  const second = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Missing editor')
    const second = store.createShape('FRAME', 480, 120, 200, 200)
    store.select([second])
    return second
  })
  expect(await overrides(page, second)).toBeUndefined()
  expect((await overrides(page, id))?.md?.width).toBe(700)
  // A delayed click from an old selection's Clear button must not clear the new node.
  await page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Missing editor')
    store.graph.updateNode(id, { responsiveOverrides: { md: { width: 480 } } })
    store.select([id])
  }, second)
  await oldClear.evaluate((button) =>
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  )
  expect((await overrides(page, second))?.md?.width).toBe(480)
  expect((await overrides(page, id))?.md?.width).toBe(700)
  await page.evaluate((id) => window.openPencil?.getStore?.().select([id]), id)
  await editNumber(page, 'width', '996', false)
  await page.evaluate(
    (id) => window.openPencil?.getStore?.().graph.updateNode(id, { locked: true }),
    id
  )
  await expect(row(page, 'width').locator('input')).toHaveCount(0)
  expect((await overrides(page, id))?.md?.width).toBe(700)
  await page.evaluate(
    (id) => window.openPencil?.getStore?.().graph.updateNode(id, { locked: false }),
    id
  )
  await editNumber(page, 'width', '995', false)
  await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Missing editor')
    const original = store.graph
    const Graph = original.constructor as typeof SceneGraph
    const replacement = new Graph()
    replacement.rootId = original.rootId
    replacement.nodes.clear()
    for (const [id, node] of original.nodes) replacement.nodes.set(id, structuredClone(node))
    store.replaceGraph(replacement)
  })
  await page.evaluate((id) => window.openPencil?.getStore?.().select([id]), id)
  await expect(row(page, 'width').locator('input')).toHaveCount(0)
  expect((await overrides(page, id))?.md?.width).toBe(700)
  canvas.assertNoErrors()
})

test('branch width preview retains the Web frame, route, height and draft, and opens a collapsed preview', async ({
  page
}, info) => {
  test.setTimeout(120_000)
  const { canvas, id } = await prepare(page)
  const ids = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Missing editor')
    const parent = store.graph.createNode('FRAME', store.state.currentPageId, {
      name: 'Overlapping branches',
      x: 0,
      y: 420,
      width: 600,
      height: 200,
      layoutMode: 'HORIZONTAL',
      itemSpacing: 8,
      responsiveOverrides: { compact: { itemSpacing: 8 }, md: { itemSpacing: 24 } }
    })
    store.graph.createNode('RECTANGLE', parent.id, { width: 40, height: 40 })
    store.graph.createNode('RECTANGLE', parent.id, { width: 40, height: 40 })
    const input = store.graph.createNode('INPUT', store.state.currentPageId, {
      x: 24,
      y: 24,
      width: 240,
      height: 44,
      interactiveProps: { placeholder: 'Responsive branch draft' }
    })
    return { parent: parent.id, input: input.id }
  })
  const pane = page.getByTestId('lowcode-preview-pane')
  await expect(pane).toHaveAttribute('data-preview-status', 'ready', { timeout: 60_000 })
  const iframe = page.locator('iframe[aria-label="lowcode preview"]')
  const view = page.frameLocator('iframe[aria-label="lowcode preview"]')
  const input = view.getByPlaceholder('Responsive branch draft')
  await expect(input).toBeVisible({ timeout: 60_000 })
  await input.fill('Keep the unsaved responsive draft')
  const element = await iframe.elementHandle()
  const frame = await element?.contentFrame()
  if (!element || !frame) throw new Error('Missing generated preview frame')
  await frame.evaluate(() => {
    history.replaceState({}, '', `${location.href}#branch-draft`)
    document.documentElement.dataset.branchContinuity = 'same-frame'
  })
  const originalURL = await iframe.getAttribute('src')
  const originalRoute = frame.url()
  await page.getByTestId('lowcode-preview-height').fill('700')
  await page.getByTestId('lowcode-preview-height').press('Enter')
  const generated = view.locator(`[data-node-id="${ids.parent}"]`).first()
  for (const [bp, width, gap] of [
    ['compact', 390, 8],
    ['md', 768, 8],
    ['xl', 1280, 24],
    ['md', 768, 8]
  ] as const) {
    await breakpoint(page, bp)
    await panel(page).locator('[data-command="preview-responsive-width"]').click()
    await expect(iframe).toHaveCSS('width', `${width}px`)
    await expect(iframe).toHaveCSS('height', '700px')
    await expect(input).toHaveValue('Keep the unsaved responsive draft')
    await expect(generated).toHaveCSS('column-gap', `${gap}px`)
    expect(await iframe.getAttribute('src')).toBe(originalURL)
    expect(frame.url()).toBe(originalRoute)
    expect(
      await element.evaluate(
        (node) =>
          node.isConnected &&
          node === document.querySelector('iframe[aria-label="lowcode preview"]')
      )
    ).toBe(true)
    expect(await frame.locator('html').getAttribute('data-branch-continuity')).toBe('same-frame')
  }
  expect(await overrides(page, id)).toEqual({ sm: { itemSpacing: 12 }, md: { width: 640 } })
  await page.screenshot({ path: info.outputPath('responsive-editor-preview.png') })
  await pane.getByTestId('lowcode-preview-close').click()
  await expect(page.getByTestId('lowcode-preview-open')).toBeVisible()
  await panel(page).locator('[data-command="preview-responsive-width"]').click()
  await expect(pane).toBeVisible({ timeout: 60_000 })
  await expect(pane).toHaveAttribute('data-preview-status', 'ready', { timeout: 60_000 })
  await expect(iframe).toHaveCSS('width', '768px')
  canvas.assertNoErrors()
})
