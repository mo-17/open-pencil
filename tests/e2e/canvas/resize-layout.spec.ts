import { writeFile } from 'node:fs/promises'

import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

test.describe.configure({ timeout: 30_000 })

test.beforeEach(async ({ page }) => {
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Editor unavailable')
    editor.state.zoom = 1
    editor.state.panX = 0
    editor.state.panY = 0
    editor.state.snappingPreferences = { geometry: false, objects: false, pixelGrid: false }
  })
})

test.afterEach(async ({ page }, testInfo) => {
  await page.mouse.up()
  const state = await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Editor unavailable')
    return {
      pageId: editor.state.currentPageId,
      selection: [...editor.state.selectedIds],
      historyRevision: editor.undo.revision,
      nodes: [...editor.graph.getAllNodes()].map((node) => ({
        id: node.id,
        type: node.type,
        width: node.width,
        height: node.height,
        layoutMode: node.layoutMode,
        primaryAxisSizing: node.primaryAxisSizing,
        counterAxisSizing: node.counterAxisSizing,
        layoutGrow: node.layoutGrow,
        layoutAlignSelf: node.layoutAlignSelf
      }))
    }
  })
  await writeFile(testInfo.outputPath('released-state.json'), JSON.stringify(state, null, 2))
})

async function createStretchedInput(
  page: Page,
  variant: 'stretch' | 'grow' | 'limits' | 'horizontal' = 'stretch'
) {
  return page.evaluate((variant) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Editor unavailable')
    const parent = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      name: variant === 'horizontal' ? 'Horizontal auto layout' : 'Vertical auto layout',
      x: 80,
      y: 100,
      width: variant === 'limits' ? 210 : 300,
      height: 260,
      layoutMode: variant === 'horizontal' ? 'HORIZONTAL' : 'VERTICAL',
      counterAxisAlign: 'STRETCH'
    })
    const field = editor.graph.createNode('INPUT', parent.id, {
      name: 'Stretched input',
      width: variant === 'limits' ? 210 : 300,
      height: 44,
      primaryAxisSizing: variant === 'grow' || variant === 'horizontal' ? 'FILL' : 'FIXED',
      counterAxisSizing: 'FILL',
      layoutGrow: variant === 'grow' || variant === 'horizontal' ? 1 : 0,
      minWidth: variant === 'limits' ? 180 : null,
      maxWidth: variant === 'limits' ? 240 : null,
      interactiveProps: { placeholder: 'Resize this input' }
    })
    editor.runLayoutForNode(parent.id)
    editor.select([field.id])
    editor.requestRender()
    return { parentId: parent.id, nodeId: field.id }
  }, variant)
}

async function nodeState(page: Page, id: string) {
  return page.evaluate((id) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const node = window.openPencil?.getStore?.().graph.getNode(id)
    if (!node) throw new Error('Node unavailable')
    return {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      layoutMode: node.layoutMode,
      primaryAxisSizing: node.primaryAxisSizing,
      counterAxisSizing: node.counterAxisSizing,
      layoutGrow: node.layoutGrow,
      layoutAlignSelf: node.layoutAlignSelf,
      minWidth: node.minWidth,
      maxWidth: node.maxWidth,
      minHeight: node.minHeight,
      maxHeight: node.maxHeight
    }
  }, id)
}

async function holdResize(page: Page, id: string, axis: 'width' | 'height', delta: number) {
  await new CanvasHelper(page).waitForRender()
  const handle = await page.evaluate(
    ({ id, axis }) => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const editor = window.openPencil?.getStore?.()
      const node = editor?.graph.getNode(id)
      if (!editor || !node) throw new Error('Node unavailable')
      const position = editor.graph.getAbsolutePosition(id)
      return {
        x:
          (position.x + node.width * (axis === 'width' ? 1 : 0.5)) * editor.state.zoom +
          editor.state.panX,
        y:
          (position.y + node.height * (axis === 'height' ? 1 : 0.5)) * editor.state.zoom +
          editor.state.panY,
        zoom: editor.state.zoom
      }
    },
    { id, axis }
  )
  const canvas = await page
    .locator('[data-active-pane="true"]')
    .getByTestId('canvas-element')
    .boundingBox()
  if (!canvas) throw new Error('Canvas unavailable')
  const x = canvas.x + handle.x
  const y = canvas.y + handle.y
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(
    x + (axis === 'width' ? delta * handle.zoom : 0),
    y + (axis === 'height' ? delta * handle.zoom : 0),
    { steps: 8 }
  )
  await new CanvasHelper(page).waitForRender()
  await writeFile(
    test.info().outputPath('held-state.json'),
    JSON.stringify(await nodeState(page, id), null, 2)
  )
  return { x, y, zoom: handle.zoom }
}

test('stretched INPUT keeps its dragged width after release', async ({ page }, testInfo) => {
  const { nodeId } = await createStretchedInput(page)
  const before = await nodeState(page, nodeId)
  expect(before.width).toBe(300)
  const layout = page.getByRole('region', { name: 'Layout', exact: true })
  const widthMode = layout.getByRole('combobox', { name: 'Width', exact: true })
  await expect(widthMode).toHaveText('Fill')
  await page.getByTestId('canvas-element').screenshot({ path: testInfo.outputPath('before.png') })
  await holdResize(page, nodeId, 'width', -100)
  const held = await nodeState(page, nodeId)
  await page.getByTestId('canvas-element').screenshot({ path: testInfo.outputPath('held.png') })
  await page.mouse.up()
  await new CanvasHelper(page).waitForRender()
  const after = await nodeState(page, nodeId)
  await page.getByTestId('canvas-element').screenshot({ path: testInfo.outputPath('after.png') })
  await writeFile(
    testInfo.outputPath('resize-states.json'),
    JSON.stringify({ before, held, after }, null, 2)
  )
  await testInfo.attach('resize-states', {
    body: JSON.stringify({ before, held, after }, null, 2),
    contentType: 'application/json'
  })
  expect(held.width).toBe(200)
  expect(after.width).toBe(200)
  expect(after.height).toBe(before.height)
  await expect(widthMode).toHaveText('Fixed')
  await layout.screenshot({ path: testInfo.outputPath('after-layout-panel.png') })
  await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().undoAction()
  })
  expect(await nodeState(page, nodeId)).toEqual(before)
  await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().redoAction()
  })
  expect(await nodeState(page, nodeId)).toEqual(after)
})

test('vertical grow child keeps its dragged height and unchanged filled width', async ({
  page
}) => {
  const { nodeId } = await createStretchedInput(page, 'grow')
  const before = await nodeState(page, nodeId)
  expect(before).toMatchObject({ width: 300, height: 260, layoutGrow: 1 })
  await holdResize(page, nodeId, 'height', -100)
  expect(await nodeState(page, nodeId)).toMatchObject({ width: 300, height: 160 })
  await page.mouse.up()
  const after = await nodeState(page, nodeId)
  expect(after).toMatchObject({ width: 300, height: 160, layoutGrow: 0 })
  expect(after.counterAxisSizing).toBe(before.counterAxisSizing)
  await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().undoAction()
  })
  expect(await nodeState(page, nodeId)).toEqual(before)
  await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().redoAction()
  })
  expect(await nodeState(page, nodeId)).toEqual(after)
})

test('horizontal stretch height can resize without disabling its width growth', async ({
  page
}) => {
  const { nodeId } = await createStretchedInput(page, 'horizontal')
  const before = await nodeState(page, nodeId)
  expect(before).toMatchObject({ width: 300, height: 260, layoutGrow: 1 })
  await holdResize(page, nodeId, 'height', -100)
  expect(await nodeState(page, nodeId)).toMatchObject({ width: 300, height: 160 })
  await page.mouse.up()
  const after = await nodeState(page, nodeId)
  expect(after).toMatchObject({ width: 300, height: 160, layoutGrow: 1 })
  expect(after.counterAxisSizing).toBe(before.counterAxisSizing)
  await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().undoAction()
  })
  expect(await nodeState(page, nodeId)).toEqual(before)
  await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().redoAction()
  })
  expect(await nodeState(page, nodeId)).toEqual(after)
})

test('horizontal edge resize fixes only the width of a Hug frame', async ({ page }, testInfo) => {
  const id = await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Editor unavailable')
    const frame = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      name: 'Hug frame',
      x: 80,
      y: 100,
      width: 100,
      height: 40,
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG'
    })
    editor.graph.createNode('RECTANGLE', frame.id, { width: 100, height: 40 })
    editor.runLayoutForNode(frame.id)
    editor.select([frame.id])
    return frame.id
  })
  const before = await nodeState(page, id)
  await holdResize(page, id, 'width', 80)
  const held = await nodeState(page, id)
  await page.mouse.up()
  const after = await nodeState(page, id)
  await testInfo.attach('hug-resize-states', {
    body: JSON.stringify({ before, held, after }, null, 2),
    contentType: 'application/json'
  })
  expect(held).toMatchObject({ width: 180, height: 40 })
  expect(after).toMatchObject({
    width: 180,
    height: 40,
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED'
  })
  await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().undoAction()
  })
  expect(await nodeState(page, id)).toEqual(before)
  await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().redoAction()
  })
  expect(await nodeState(page, id)).toEqual(after)
})

test('minimum and maximum width clamp both the held preview and committed size', async ({
  page
}) => {
  const { nodeId } = await createStretchedInput(page, 'limits')
  expect(await nodeState(page, nodeId)).toMatchObject({ width: 210, minWidth: 180, maxWidth: 240 })
  await holdResize(page, nodeId, 'width', 100)
  expect((await nodeState(page, nodeId)).width).toBe(240)
  await page.mouse.up()
  const maximum = await nodeState(page, nodeId)
  expect(maximum.width).toBe(240)
  await holdResize(page, nodeId, 'width', -200)
  expect((await nodeState(page, nodeId)).width).toBe(180)
  await page.mouse.up()
  const minimum = await nodeState(page, nodeId)
  expect(minimum).toMatchObject({ width: 180, minWidth: 180, maxWidth: 240 })
  await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().undoAction()
  })
  expect(await nodeState(page, nodeId)).toEqual(maximum)
  await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().redoAction()
  })
  expect(await nodeState(page, nodeId)).toEqual(minimum)
})

test('Escape restores geometry and sizing without adding a resize history entry', async ({
  page
}) => {
  const { nodeId } = await createStretchedInput(page)
  const before = await nodeState(page, nodeId)
  const revision = await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().undo.revision
  })
  await holdResize(page, nodeId, 'width', -100)
  expect((await nodeState(page, nodeId)).width).toBe(200)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect(await nodeState(page, nodeId)).toEqual(before)
  expect(
    await page.evaluate(() => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
      return window.openPencil?.getStore?.().undo.revision
    })
  ).toBe(revision)
})

test('clicking a resize edge without moving preserves Fill and history', async ({ page }) => {
  const { nodeId } = await createStretchedInput(page)
  const before = await nodeState(page, nodeId)
  const revision = await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().undo.revision
  })
  await holdResize(page, nodeId, 'width', 0)
  await page.mouse.up()
  expect(await nodeState(page, nodeId)).toEqual(before)
  expect(
    await page.evaluate(() => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
      return window.openPencil?.getStore?.().undo.revision
    })
  ).toBe(revision)
})

for (const event of ['pointercancel', 'lostpointercapture', 'blur'] as const) {
  test(`synthetic ${event} cancels a real mouse resize without committing`, async ({ page }) => {
    const { nodeId } = await createStretchedInput(page)
    const before = await nodeState(page, nodeId)
    const revision = await page.evaluate(() => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
      return window.openPencil?.getStore?.().undo.revision
    })
    await holdResize(page, nodeId, 'width', -100)
    expect((await nodeState(page, nodeId)).width).toBe(200)
    await page.getByTestId('canvas-element').evaluate((element, event) => {
      if (event === 'blur') window.dispatchEvent(new Event('blur'))
      else element.dispatchEvent(new PointerEvent(event, { pointerType: 'mouse', pointerId: 1 }))
    }, event)
    await page.mouse.up()
    expect(await nodeState(page, nodeId)).toEqual(before)
    expect(
      await page.evaluate(() => {
        if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
        return window.openPencil?.getStore?.().undo.revision
      })
    ).toBe(revision)
  })
}

test('deactivating a split canvas cancels its mouse resize before release', async ({ page }) => {
  await page.getByRole('menuitem', { name: 'View', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Split right', exact: true }).click()
  await expect(page.locator('[data-active-pane]')).toHaveCount(2)
  const nextPane = await page.locator('[data-active-pane="false"]').getAttribute('data-pane-id')
  if (!nextPane) throw new Error('Other canvas pane unavailable')
  const { nodeId } = await createStretchedInput(page)
  await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Editor unavailable')
    editor.state.zoom = 0.5
    editor.state.panX = 0
    editor.state.panY = 0
    editor.requestRender()
  })
  const before = await nodeState(page, nodeId)
  const revision = await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().undo.revision
  })
  await holdResize(page, nodeId, 'width', -100)
  expect((await nodeState(page, nodeId)).width).toBe(200)
  await page.evaluate((id) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().setActivePane(id)
  }, nextPane)
  await page.mouse.up()
  expect(await nodeState(page, nodeId)).toEqual(before)
  expect(
    await page.evaluate(() => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
      return window.openPencil?.getStore?.().undo.revision
    })
  ).toBe(revision)
  expect(
    await page.evaluate(() => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
      return window.openPencil?.getStore?.().activePaneId.value
    })
  ).toBe(nextPane)
})

test('selection changes cancel the old resize before a late pointerup', async ({ page }) => {
  const { nodeId } = await createStretchedInput(page)
  const nextId = await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Editor unavailable')
    return editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
      x: 100,
      y: 400,
      width: 90,
      height: 60
    }).id
  })
  const before = await nodeState(page, nodeId)
  const nextBefore = await nodeState(page, nextId)
  const revision = await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().undo.revision
  })
  await holdResize(page, nodeId, 'width', -100)
  expect((await nodeState(page, nodeId)).width).toBe(200)
  await page.evaluate((id) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().select([id])
  }, nextId)
  await page.mouse.up()
  expect(await nodeState(page, nodeId)).toEqual(before)
  expect(await nodeState(page, nextId)).toEqual(nextBefore)
  expect(
    await page.evaluate(() => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
      return window.openPencil?.getStore?.().undo.revision
    })
  ).toBe(revision)
  expect(
    await page.evaluate(() => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
      return [...(window.openPencil?.getStore?.().state.selectedIds ?? [])]
    })
  ).toEqual([nextId])
})

test('page changes cancel the old resize and preserve the newly selected page', async ({
  page
}) => {
  const { nodeId } = await createStretchedInput(page)
  const next = await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Editor unavailable')
    const page = editor.graph.addPage('Other page')
    const node = editor.graph.createNode('RECTANGLE', page.id, { width: 180, height: 80 })
    return { pageId: page.id, nodeId: node.id }
  })
  const before = await nodeState(page, nodeId)
  const nextBefore = await nodeState(page, next.nodeId)
  await holdResize(page, nodeId, 'width', -100)
  expect((await nodeState(page, nodeId)).width).toBe(200)
  await page.evaluate(async ({ pageId, nodeId }) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Editor unavailable')
    await editor.switchPage(pageId)
    editor.select([nodeId])
  }, next)
  await page.mouse.up()
  expect(await nodeState(page, nodeId)).toEqual(before)
  expect(await nodeState(page, next.nodeId)).toEqual(nextBefore)
  expect(
    await page.evaluate(() => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
      return window.openPencil?.getStore?.().state.currentPageId
    })
  ).toBe(next.pageId)
  expect(
    await page.evaluate(() => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
      return [...(window.openPencil?.getStore?.().state.selectedIds ?? [])]
    })
  ).toEqual([next.nodeId])
})

test('document replacement does not commit a late resize into reused node identifiers', async ({
  page
}) => {
  const { nodeId } = await createStretchedInput(page)
  const before = await nodeState(page, nodeId)
  const originalNode = await page.evaluateHandle((id) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().graph.getNode(id)
  }, nodeId)
  try {
    await holdResize(page, nodeId, 'width', -100)
    expect((await nodeState(page, nodeId)).width).toBe(200)
    const nextId = await page.evaluate((reusedId) => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const editor = window.openPencil?.getStore?.()
      if (!editor) throw new Error('Editor unavailable')
      const Graph = editor.graph.constructor as new () => typeof editor.graph
      const graph = new Graph()
      const parent = graph.createNode('FRAME', graph.getPages()[0].id, { width: 400, height: 240 })
      const node = graph.createNodeWithId(reusedId, 'INPUT', parent.id, { width: 180, height: 44 })
      editor.replaceGraph(graph)
      editor.select([node.id])
      return node.id
    }, nodeId)
    expect(nextId).toBe(nodeId)
    const replacement = await nodeState(page, nextId)
    await page.mouse.up()
    expect(await nodeState(page, nextId)).toEqual(replacement)
    expect(
      await originalNode.evaluate((node) => ({
        width: node?.width,
        height: node?.height,
        primaryAxisSizing: node?.primaryAxisSizing,
        counterAxisSizing: node?.counterAxisSizing,
        layoutGrow: node?.layoutGrow,
        layoutAlignSelf: node?.layoutAlignSelf
      }))
    ).toEqual({
      width: before.width,
      height: before.height,
      primaryAxisSizing: before.primaryAxisSizing,
      counterAxisSizing: before.counterAxisSizing,
      layoutGrow: before.layoutGrow,
      layoutAlignSelf: before.layoutAlignSelf
    })
  } finally {
    await originalNode.dispose()
    await page.mouse.up()
  }
})
