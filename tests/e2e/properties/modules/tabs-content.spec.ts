import { readFileSync } from 'node:fs'

import type { Page, TestInfo } from '@playwright/test'

import { expect, test } from '#tests/e2e/fixtures'
import { openComponentGallery } from '#tests/helpers/compiler/components/templates/editor'

test.use({ viewport: { width: 1600, height: 1100 } })

async function prepare(page: Page, info: TestInfo, renderer: 'retained' | 'tiled') {
  const fixture = await openComponentGallery(page, info, renderer)
  const ids = await page.evaluate(async () => {
    const editor = window.openPencil.getStore()
    const card = editor.graph
      .getChildren(editor.state.currentPageId)
      .find((node) => node.name === '分栏详情与表单')
    const tabs =
      card &&
      editor.graph
        .getChildren(card.id)
        .find((node) => node.interactiveProps?.module?.pluginId === 'open-pencil.tabs')
    const details = tabs && editor.graph.getChildren(tabs.id).find((node) => node.type === 'FORM')
    const overview =
      tabs && editor.graph.getChildren(tabs.id).find((node) => node.name === '概览内容')
    if (!card || !tabs || !details || !overview) throw new Error('Tabs gallery unavailable')
    await editor.loadFontsForNodes([card.id])
    editor.select([tabs.id])
    editor.zoomToBounds(card.x, card.y, card.x + card.width, card.y + card.height)
    return {
      host: tabs.id,
      details: details.id,
      overview: overview.id,
      config: JSON.stringify(tabs.interactiveProps?.module),
      canUndo: editor.undo.canUndo
    }
  })
  await expect(page.getByTestId('tabs-item-row')).toHaveCount(2)
  return { ...fixture, ids }
}

async function paint(page: Page) {
  // Preview and isolated content are live scene overlays, not tiled-page settlement.
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()))
      })
  )
}

async function editorScreenshot(page: Page, info: TestInfo, name: string) {
  const viewport = page.viewportSize()
  const preview = await page.getByTestId('lowcode-preview-pane').boundingBox()
  // Capture the editor and inspector; runtime previews have their own browser coverage.
  await page.screenshot({
    path: info.outputPath(name),
    ...(viewport && preview && preview.x > 0
      ? { clip: { x: 0, y: 0, width: preview.x, height: viewport.height } }
      : {})
  })
}

for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: each saved Tabs item previews and edits its own child without changing the initial tab`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    const { canvas, path, bytes, ids } = await prepare(page, info, renderer)
    const rows = page.getByTestId('tabs-item-row')
    await expect(rows.nth(0).getByTestId('tabs-item-content')).toHaveCount(0)
    await expect(rows.nth(1).getByTestId('tabs-item-content')).toHaveCount(0)
    await expect(rows.nth(0).getByTestId('tabs-content-status')).toContainText('概览内容')
    await expect(rows.nth(1).getByTestId('tabs-content-status')).toContainText('详情表单内容')
    await expect(rows.nth(0).getByTestId('tabs-view-content')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await rows.nth(0).getByTestId('tabs-view-content').click()
    await paint(page)
    await editorScreenshot(page, info, 'overview-editor.png')
    await rows.nth(1).getByTestId('tabs-view-content').click()
    await expect
      .poll(() =>
        page.evaluate((host) => window.openPencil.getStore().getTabsTabPreview(host), ids.host)
      )
      .toBe('details')
    await expect(rows.nth(1).getByTestId('tabs-view-content')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(rows.nth(0).getByTestId('tabs-view-content')).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    await paint(page)
    await editorScreenshot(page, info, 'details-editor.png')
    await canvas.canvas.screenshot({ path: info.outputPath('details-canvas.png') })
    const result = await page.evaluate(({ host, details }) => {
      const editor = window.openPencil.getStore()
      const children = [...editor.graph.getAllNodes()].filter((node) => {
        if (node.type !== 'INPUT') return false
        let parent = node.parentId ? editor.graph.getNode(node.parentId) : undefined
        while (parent) {
          if (parent.id === details) return true
          parent = parent.parentId ? editor.graph.getNode(parent.parentId) : undefined
        }
        return false
      })
      const first = children[0]
      if (!first) throw new Error('Detail inputs unavailable')
      const pos = editor.graph.getAbsolutePosition(first.id)
      return {
        widths: children.map((node) => node.width),
        hit: editor.hitTestPageAtPoint(pos.x + 8, pos.y + 8)?.id,
        first: first.id,
        config: JSON.stringify(editor.graph.getNode(host)?.interactiveProps?.module),
        canUndo: editor.undo.canUndo
      }
    }, ids)
    expect(result.widths).toHaveLength(2)
    expect(result.widths.every((width) => width > 200)).toBe(true)
    expect(result.hit).toBe(result.first)
    expect(result.config).toBe(ids.config)
    expect(result.canUndo).toBe(ids.canUndo)
    await rows.nth(1).getByTestId('tabs-edit-content').click()
    await expect(page.getByTestId('content-edit-banner')).toContainText('详情表单内容')
    expect(await page.evaluate(() => window.openPencil.getStore().state.contentEdit?.rootId)).toBe(
      ids.details
    )
    await paint(page)
    await editorScreenshot(page, info, 'editing-details.png')
    await page.getByTestId('modal-finish-content').click()
    await expect(page.getByTestId('content-edit-banner')).toHaveCount(0)
    await page.getByTestId('tabs-reset-preview').click()
    expect(
      await page.evaluate((host) => window.openPencil.getStore().getTabsTabPreview(host), ids.host)
    ).toBeUndefined()
    expect(
      await page.evaluate(
        (host) =>
          JSON.stringify(
            window.openPencil.getStore().graph.getNode(host)?.interactiveProps?.module
          ),
        ids.host
      )
    ).toBe(ids.config)
    expect(readFileSync(path)).toEqual(bytes)
    canvas.assertNoErrors()
  })
}

test('Tabs text mode and broken child mappings cannot silently edit a different body', async ({
  page
}, info) => {
  test.setTimeout(90_000)
  const { canvas, ids } = await prepare(page, info, 'retained')
  const row = page.getByTestId('tabs-item-row').nth(1)
  await row.getByTestId('module-content-child-select').getByRole('combobox').click()
  await page.getByRole('option', { name: 'Use text content', exact: true }).click()
  const content = row.getByTestId('tabs-item-content')
  await expect(content).toBeVisible()
  await content.fill('Only this text panel')
  await content.blur()
  await row.getByTestId('tabs-view-content').click()
  await expect
    .poll(() =>
      page.evaluate((host) => window.openPencil.getStore().getTabsTabPreview(host), ids.host)
    )
    .toBe('details')
  await expect(row.getByTestId('tabs-edit-content')).toHaveCount(0)
  await row.getByTestId('module-content-child-select').getByRole('combobox').click()
  await page.getByRole('option', { name: '详情表单内容', exact: true }).click()
  await expect(content).toHaveCount(0)
  await page.evaluate(
    ({ details }) =>
      window.openPencil.getStore().updateNodeWithUndo(details, { name: 'Moved detail name' }),
    ids
  )
  await expect(row.getByTestId('tabs-content-status')).toContainText('missing')
  await expect(row.getByTestId('tabs-edit-content')).toBeDisabled()
  await expect(content).toHaveCount(0)
  await canvas.undo()
  await expect(row.getByTestId('tabs-edit-content')).toBeEnabled()
  await page.evaluate(
    ({ overview }) =>
      window.openPencil.getStore().updateNodeWithUndo(overview, { name: '详情表单内容' }),
    ids
  )
  await expect(row.getByTestId('tabs-content-status')).toContainText('unique')
  await expect(row.getByTestId('tabs-edit-content')).toBeDisabled()
  canvas.assertNoErrors()
})
