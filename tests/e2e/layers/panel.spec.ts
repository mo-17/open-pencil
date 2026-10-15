import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/demo')

function layerRows() {
  return editor.page.getByTestId('layers-tree').locator('[data-node-id]')
}

async function getLayerNames(): Promise<string[]> {
  const names = await layerRows()
    .locator('[data-slot="label"] > span:not([data-slot])')
    .allTextContents()
  return names.map((name) => name.trim())
}

interface SceneTreeNode {
  id: string
  name: string
  type: string
  children: SceneTreeNode[]
}

async function getSceneTree(): Promise<SceneTreeNode> {
  return editor.page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')

    const nodeTree = (id: string): SceneTreeNode | null => {
      const node = store.graph.getNode(id)
      if (!node) return null
      return {
        id: node.id,
        name: node.name,
        type: node.type,
        children: node.childIds
          .map((cid: string) => nodeTree(cid))
          .filter((child): child is SceneTreeNode => child !== null)
      }
    }
    const tree = nodeTree(store.state.currentPageId)
    if (!tree) throw new Error('Missing current page tree')
    return tree
  })
}

async function getSelectedCount(): Promise<number> {
  return editor.page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.state.selectedIds.size
  })
}

const NUMBERED_GROUP = /^Group \d+$/

function sceneNodes(tree: SceneTreeNode): SceneTreeNode[] {
  return [tree, ...tree.children.flatMap(sceneNodes)]
}

async function drawRectanglesInsideCanvas(
  rectangles: ReadonlyArray<Parameters<typeof editor.canvas.drawRect>>
) {
  const bounds = await editor.canvas.canvas.boundingBox()
  if (!bounds) throw new Error('The layer fixture canvas has no visible bounds')
  expect(rectangles.length).toBeGreaterThan(0)
  const inset = 16
  const minX = Math.min(...rectangles.map(([x]) => x))
  const minY = Math.min(...rectangles.map(([, y]) => y))
  const maxX = Math.max(...rectangles.map(([x, , width]) => x + width))
  const maxY = Math.max(...rectangles.map(([, y, , height]) => y + height))
  expect(bounds.width).toBeGreaterThanOrEqual(maxX - minX + inset * 2)
  expect(bounds.height).toBeGreaterThanOrEqual(maxY - minY + inset * 2)
  const offsetX = Math.min(0, bounds.width - maxX - inset)
  const offsetY = Math.min(0, bounds.height - maxY - inset)
  const beforeIds = new Set(sceneNodes(await getSceneTree()).map(({ id }) => id))

  for (const [x, y, width, height] of rectangles) {
    await editor.canvas.drawRect(x + offsetX, y + offsetY, width, height)
  }

  const created = sceneNodes(await getSceneTree()).filter(({ id }) => !beforeIds.has(id))
  expect(created).toHaveLength(rectangles.length)
  for (const node of created) {
    expect(node.type).toBe('RECTANGLE')
    expect(node.name).toMatch(/^Rectangle \d+$/)
  }
  await test.info().attach('layer-rectangle-fixture-input', {
    body: JSON.stringify({ bounds, rectangles, offsetX, offsetY, created }),
    contentType: 'application/json'
  })
}

test('demo layers visible in panel', async () => {
  const original = await getSceneTree()
  expect(original.children.length).toBeGreaterThan(0)
  expect(await getLayerNames()).toEqual(original.children.map(({ name }) => name))
  for (const root of original.children) {
    const row = editor.page.getByTestId('layers-tree').locator(`[data-node-id="${root.id}"]`)
    await expect(row).toBeVisible()
    await expect(row).toHaveAttribute('aria-level', '1')
    await expect(row.locator('[data-slot="label"] > span:not([data-slot])')).toHaveText(root.name)
  }
  const root = original.children.find((node) => node.children.length > 0)
  const child = root?.children[0]
  if (!root || !child) throw new Error('The demo has no expandable layer hierarchy')
  const rootRow = editor.page.getByTestId('layers-tree').locator(`[data-node-id="${root.id}"]`)
  const disclosure = rootRow.locator('[data-slot="disclosure"]')
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
  await disclosure.click()
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
  const childRow = editor.page.getByTestId('layers-tree').locator(`[data-node-id="${child.id}"]`)
  await expect(childRow).toBeVisible()
  await expect(childRow).toHaveAttribute('aria-level', '2')
  await expect(childRow.locator('[data-slot="label"] > span:not([data-slot])')).toHaveText(
    child.name
  )
  await disclosure.click()
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
  await expect(childRow).toHaveCount(0)
  expect(await getLayerNames()).toEqual(original.children.map(({ name }) => name))
  expect(await getSceneTree()).toEqual(original)
  editor.canvas.assertNoErrors()
})

test('clicking a node inside a frame does not reparent it', async () => {
  const target = await editor.page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const candidate = store.graph
      .getChildren(store.state.currentPageId)
      .flatMap((root) => store.graph.getChildren(root.id).map((nested) => ({ root, nested })))
      .find(
        ({ root, nested }) =>
          root.type === 'SECTION' &&
          nested.type === 'FRAME' &&
          nested.width > 0 &&
          nested.height > 0
      )
    if (!candidate?.nested.parentId) throw new Error('The demo has no nested frame')
    const { root, nested } = candidate
    const origin = store.graph.getAbsolutePosition(nested.id)
    store.zoomToBounds(origin.x, origin.y, origin.x + nested.width, origin.y + nested.height)
    store.requestRender()
    return {
      id: nested.id,
      parentId: nested.parentId,
      rootId: root.id,
      x: (origin.x + nested.width / 2) * store.state.zoom + store.state.panX,
      y: (origin.y + nested.height / 2) * store.state.zoom + store.state.panY
    }
  })

  // Fit the independent scene target before clicking inside its frame hierarchy.
  await editor.canvas.waitForRender()
  await editor.canvas.click(target.x, target.y)
  await editor.canvas.waitForRender()

  const after = await editor.page.evaluate(
    ({ id, rootId }) => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('OpenPencil store not initialized')
      return {
        parentId: store.graph.getNode(id)?.parentId ?? null,
        rootParentId: store.graph.getNode(rootId)?.parentId ?? null,
        pageId: store.state.currentPageId
      }
    },
    { id: target.id, rootId: target.rootId }
  )

  // The clicked node and its section must keep their place in the hierarchy.
  expect(after.parentId).toBe(target.parentId)
  expect(after.rootParentId).toBe(after.pageId)

  editor.canvas.assertNoErrors()
})

test('creating a shape updates layers', async () => {
  const before = await getLayerNames()
  await drawRectanglesInsideCanvas([[600, 500, 50, 50]])
  const names = await getLayerNames()
  expect(names).toContain('Rectangle 1')
  expect(names.length).toBe(before.length + 1)

  await editor.canvas.undo()
  const after = await getLayerNames()
  expect(after.length).toBe(before.length)
  expect(after).not.toContain('Rectangle 1')
})

test('Shift+A wraps selection in auto-layout frame', async () => {
  // Draw two loose rectangles for this test
  await drawRectanglesInsideCanvas([
    [700, 600, 60, 60],
    [800, 600, 60, 60]
  ])
  await editor.canvas.selectAll()
  const count = await getSelectedCount()
  expect(count).toBeGreaterThanOrEqual(2)

  const before = await getLayerNames()

  await editor.page.keyboard.press('Shift+A')
  await editor.canvas.waitForRender()

  const tree = await getSceneTree()
  const autoFrame = tree.children.find((c) => c.name === 'Frame' && c.type === 'FRAME')
  expect(autoFrame).toBeTruthy()

  const after = await getLayerNames()
  expect(after).not.toEqual(before)
  expect(after).toContain('Frame')

  editor.canvas.assertNoErrors()
})

test('grouping updates layers', async () => {
  // Undo the auto-layout to restore flat structure
  await editor.canvas.undo()
  await editor.canvas.undo()
  await editor.canvas.waitForRender()

  // Draw two rects and group them
  await drawRectanglesInsideCanvas([
    [700, 600, 60, 60],
    [800, 600, 60, 60]
  ])
  await editor.canvas.selectAll()

  await editor.page.keyboard.press('Meta+g')
  await editor.canvas.waitForRender()

  // The canvas numbers a group past the highest "Group" number on the page, as Figma does.
  const tree = await getSceneTree()
  const group = tree.children.find((c) => NUMBERED_GROUP.test(c.name) && c.type === 'GROUP')
  expect(group).toBeTruthy()

  const names = await getLayerNames()
  expect(names.some((name) => NUMBERED_GROUP.test(name))).toBe(true)

  editor.canvas.assertNoErrors()
})

test('ungrouping updates layers', async () => {
  await editor.page.keyboard.press('Shift+Meta+g')
  await editor.canvas.waitForRender()

  const names = await getLayerNames()
  expect(names.some((name) => NUMBERED_GROUP.test(name))).toBe(false)
  expect(names.some((name) => /^Rectangle \d+$/.test(name))).toBe(true)

  editor.canvas.assertNoErrors()
})

test('double-click layer to rename', async () => {
  await drawRectanglesInsideCanvas([[900, 600, 50, 50]])
  await editor.canvas.waitForRender()

  const row = layerRows().filter({ hasText: 'Rectangle' }).first()
  await row.dblclick()

  const input = editor.page.getByTestId('layers-item-input')
  await expect(input).toBeVisible()
  await input.fill('Renamed Layer')
  await input.press('Enter')

  await editor.canvas.waitForRender()
  const names = await getLayerNames()
  expect(names).toContain('Renamed Layer')

  editor.canvas.assertNoErrors()
})

test('clicking outside rename input commits', async () => {
  const row = layerRows().filter({ hasText: 'Renamed Layer' }).first()
  await row.dblclick()

  const input = editor.page.getByTestId('layers-item-input')
  await expect(input).toBeVisible()
  await input.fill('After Outside Click')

  await editor.page.mouse.click(500, 400)
  await editor.canvas.waitForRender()

  await expect(input).not.toBeVisible()
  const names = await getLayerNames()
  expect(names).toContain('After Outside Click')

  editor.canvas.assertNoErrors()
})

test('clearing a layer name keeps the name it had', async () => {
  await drawRectanglesInsideCanvas([[980, 600, 50, 50]])
  await editor.canvas.waitForRender()

  const drawn = await editor.page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const store = window.openPencil?.getStore?.()
    const id = store ? [...store.state.selectedIds][0] : undefined
    return id ? (store?.graph.getNode(id)?.name ?? '') : ''
  })
  const row = layerRows().filter({ hasText: drawn }).last()
  const countBefore = await layerRows().count()

  await row.dblclick()

  const input = editor.page.getByTestId('layers-item-input')
  await expect(input).toBeVisible()
  await input.clear()
  await input.press('Enter')

  await editor.canvas.waitForRender()

  const countAfter = await layerRows().count()
  expect(countAfter).toBe(countBefore)

  const names = await getLayerNames()
  expect(drawn).toMatch(/^Rectangle \d+$/)
  expect(names).toContain(drawn)

  editor.canvas.assertNoErrors()
})

test('double-click does not toggle tree expand', async () => {
  const tree = await getSceneTree()
  const container = tree.children.find((node) => node.children.length > 0)
  if (!container) throw new Error('The current page has no layer container')
  await editor.page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.select([id])
    store.requestRender()
  }, container.id)
  await editor.canvas.waitForRender()
  const rowCountBefore = await layerRows().count()
  const containerRow = editor.page
    .getByTestId('layers-tree')
    .locator(`[data-node-id="${container.id}"]`)
  await containerRow.dblclick()
  await editor.canvas.waitForRender()

  const input = editor.page.getByTestId('layers-item-input')
  await expect(input).toBeVisible()
  await input.press('Escape')

  const rowCountAfter = await layerRows().count()
  expect(rowCountAfter).toBe(rowCountBefore)

  editor.canvas.assertNoErrors()
})
