import { writeFile } from 'node:fs/promises'

import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

test.describe.configure({ timeout: 30_000 })

test.beforeEach(async ({ page }) => {
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
})

const layoutPanel = (page: Page) => page.getByRole('region', { name: 'Auto layout', exact: true })

async function createLayout(page: Page, type: 'FRAME' | 'FORM' = 'FRAME') {
  return page.evaluate((type) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Editor unavailable')
    editor.state.zoom = 1
    editor.state.panX = 0
    editor.state.panY = 0
    editor.state.snappingPreferences = { geometry: false, objects: false, pixelGrid: false }
    const parent = editor.graph.createNode(type, editor.state.currentPageId, {
      name: 'Authored vertical layout',
      x: 50,
      y: 60,
      width: 340,
      height: 280,
      layoutMode: 'VERTICAL',
      itemSpacing: 18,
      paddingTop: 11,
      paddingRight: 13,
      paddingBottom: 17,
      paddingLeft: 19,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      primaryAxisAlign: 'CENTER',
      counterAxisAlign: 'MAX'
    })
    const children = [
      editor.graph.createNode('RECTANGLE', parent.id, { width: 80, height: 36 }),
      editor.graph.createNode('RECTANGLE', parent.id, { width: 100, height: 48 })
    ]
    editor.runLayoutForNode(parent.id)
    editor.select([parent.id])
    editor.requestRender()
    return { parentId: parent.id, childIds: children.map((child) => child.id) }
  }, type)
}

async function layoutState(page: Page, id: string) {
  return page.evaluate((id) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const editor = window.openPencil?.getStore?.()
    const node = editor?.graph.getNode(id)
    if (!editor || !node) throw new Error('Layout unavailable')
    const geometry = (node: typeof editor.selectedNode.value) => {
      if (!node) throw new Error('Node unavailable')
      return { id: node.id, x: node.x, y: node.y, width: node.width, height: node.height }
    }
    return {
      ...geometry(node),
      layoutMode: node.layoutMode,
      itemSpacing: node.itemSpacing,
      paddingTop: node.paddingTop,
      paddingRight: node.paddingRight,
      paddingBottom: node.paddingBottom,
      paddingLeft: node.paddingLeft,
      primaryAxisSizing: node.primaryAxisSizing,
      counterAxisSizing: node.counterAxisSizing,
      primaryAxisAlign: node.primaryAxisAlign,
      counterAxisAlign: node.counterAxisAlign,
      children: editor.graph.getChildren(id).map(geometry)
    }
  }, id)
}

for (const control of ['switch', 'flow'] as const) {
  test(`${control} preserves authored settings through repeated vertical and freeform cycles`, async ({
    page
  }, testInfo) => {
    const { parentId } = await createLayout(page, control === 'switch' ? 'FORM' : 'FRAME')
    const before = await layoutState(page, parentId)
    const panel = layoutPanel(page)
    const toggle = panel.getByRole('switch', { name: 'Auto layout', exact: true })
    const flow = panel.getByRole('group', { name: 'Flow', exact: true })
    await expect(toggle).toBeChecked()
    for (let cycle = 1; cycle <= 3; cycle++) {
      if (control === 'switch') await toggle.click()
      else await flow.getByRole('button', { name: 'Freeform', exact: true }).click()
      await expect(toggle).not.toBeChecked()
      expect(await layoutState(page, parentId)).toEqual({ ...before, layoutMode: 'NONE' })
      if (control === 'switch') await toggle.click()
      else await flow.getByRole('button', { name: 'Vertical layout', exact: true }).click()
      await expect(toggle).toBeChecked()
      const after = await layoutState(page, parentId)
      await writeFile(
        testInfo.outputPath(`cycle-${cycle}.json`),
        JSON.stringify({ before, after }, null, 2)
      )
      expect(after).toEqual(before)
      await expect(panel.getByRole('combobox', { name: 'Width', exact: true })).toHaveText('Fixed')
      await expect(panel.getByRole('combobox', { name: 'Height', exact: true })).toHaveText('Fixed')
    }
    await panel.screenshot({ path: testInfo.outputPath('preserved-layout-panel.png') })
  })
}

test('undo after enabling auto layout restores a child moved in freeform', async ({
  page
}, testInfo) => {
  const { parentId, childIds } = await createLayout(page)
  const panel = layoutPanel(page)
  await panel.getByRole('switch', { name: 'Auto layout', exact: true }).click()
  const beforeMove = await layoutState(page, parentId)
  const start = await page.evaluate((id) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const editor = window.openPencil?.getStore?.()
    const node = editor?.graph.getNode(id)
    if (!editor || !node) throw new Error('Child unavailable')
    editor.select([id])
    const absolute = editor.graph.getAbsolutePosition(id)
    return { x: absolute.x + node.width / 2, y: absolute.y + node.height / 2 }
  }, childIds[0])
  const canvas = new CanvasHelper(page)
  await canvas.waitForRender()
  await canvas.drag(start.x, start.y, start.x - 43, start.y + 27, 8)
  const freeform = await layoutState(page, parentId)
  expect(freeform.children[0]).toEqual({
    ...beforeMove.children[0],
    x: beforeMove.children[0].x - 43,
    y: beforeMove.children[0].y + 27
  })
  expect(freeform.children[1]).toEqual(beforeMove.children[1])
  await page.evaluate((id) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().select([id])
  }, parentId)
  await panel.getByRole('switch', { name: 'Auto layout', exact: true }).click()
  const enabled = await layoutState(page, parentId)
  expect(enabled.layoutMode).toBe('VERTICAL')
  expect(enabled.children[0]).not.toEqual(freeform.children[0])
  await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().undoAction()
  })
  const undone = await layoutState(page, parentId)
  await writeFile(
    testInfo.outputPath('freeform-undo.json'),
    JSON.stringify({ beforeMove, freeform, enabled, undone }, null, 2)
  )
  expect(undone).toEqual(freeform)
  await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().redoAction()
  })
  expect(await layoutState(page, parentId)).toEqual(enabled)
})
