import type { Vector } from '@open-pencil/scene-graph'

import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'
import { propertySection } from '#tests/helpers/properties'

const editor = useEditorSetupWithClear()

interface PathNodeSnapshot {
  geometry: {
    x: number
    y: number
    width: number
    height: number
    rotation: number
  }
  control1: Vector
}

async function createNestedCubicPathNode(): Promise<string> {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const page = store.graph.getNode(store.state.currentPageId)
    if (!page) throw new Error('Current page not found')
    const frame = store.graph.createNode('FRAME', page.id, {
      name: 'Rotated path frame',
      x: 220,
      y: 160,
      width: 360,
      height: 260,
      rotation: 18
    })
    const node = store.graph.createNode('RECTANGLE', frame.id, {
      name: 'Cubic path target',
      x: 80,
      y: 70,
      width: 100,
      height: 70,
      rotation: -12,
      motion: {
        version: 3,
        reducedMotion: 'reduce',
        tracks: [
          {
            id: 'curve',
            trigger: 'mount',
            keyframes: [
              { id: 'start', offset: 0, pathProgress: 0 },
              { id: 'end', offset: 1, pathProgress: 1 }
            ],
            timing: { durationMs: 400, easing: 'linear' },
            path: {
              version: 2,
              start: { x: 0, y: 0 },
              segments: [
                {
                  control1: { x: 35, y: -25 },
                  control2: { x: 115, y: 85 },
                  end: { x: 160, y: 35 }
                }
              ],
              autoRotate: true
            }
          }
        ]
      }
    })
    store.select([node.id])
    store.zoomToSelection()
    store.requestRender()
    return node.id
  })
}

async function createSiblingNode(): Promise<string> {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const page = store.graph.getNode(store.state.currentPageId)
    if (!page) throw new Error('Current page not found')
    const node = store.graph.createNode('RECTANGLE', page.id, {
      name: 'Other pane selection',
      x: 640,
      y: 180,
      width: 100,
      height: 70
    })
    store.requestRender()
    return node.id
  })
}

async function nodeSnapshot(nodeId: string): Promise<PathNodeSnapshot> {
  return editor.page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    const node = store?.graph.getNode(id)
    if (!node) throw new Error('Motion path node not found')
    const path = node.motion?.tracks[0]?.path
    if (!path || path.version !== 2) throw new Error('Expected cubic path')
    const control1 = path.segments[0]?.control1
    if (!control1) throw new Error('Expected first cubic control')
    return {
      geometry: {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        rotation: node.rotation
      },
      control1: { ...control1 }
    }
  }, nodeId)
}

test.beforeEach(async () => {
  await editor.page.evaluate(() => {
    const storageName = 'localStorage'
    window[storageName].removeItem('open-pencil:inspector-section:motion')
  })
  await editor.page.reload()
  await editor.canvas.waitForInit()
})

test('drags a cubic control on the canvas with one undo, Escape cancel, and keyboard nudge', async () => {
  test.setTimeout(30_000)
  const nodeId = await createNestedCubicPathNode()
  await editor.canvas.waitForRender()
  const before = await nodeSnapshot(nodeId)

  const motion = propertySection(editor.page, 'Motion')
  await motion.scrollIntoViewIfNeeded()
  const edit = motion.getByTestId('motion-path-edit-canvas')
  await edit.scrollIntoViewIfNeeded()
  await edit.click()

  const overlay = editor.page.getByTestId('motion-path-overlay')
  const control = editor.page.getByTestId('motion-path-handle-segment-0-control1')
  await expect(overlay).toBeVisible()
  await expect(control).toBeVisible()
  const controlBox = await control.boundingBox()
  if (!controlBox) throw new Error('Expected motion path control geometry')
  const centerX = controlBox.x + controlBox.width / 2
  const centerY = controlBox.y + controlBox.height / 2

  await editor.page.mouse.move(centerX, centerY)
  await editor.page.mouse.down()
  await editor.page.mouse.move(centerX + 42, centerY + 27, { steps: 5 })
  await editor.page.mouse.up()
  const dragged = await nodeSnapshot(nodeId)
  expect(dragged.control1).not.toEqual(before.control1)
  expect(dragged.geometry).toEqual(before.geometry)

  await editor.canvas.undo()
  expect((await nodeSnapshot(nodeId)).control1).toEqual(before.control1)
  await editor.canvas.redo()
  expect((await nodeSnapshot(nodeId)).control1).toEqual(dragged.control1)

  const currentControl = editor.page.getByTestId('motion-path-handle-segment-0-control1')
  const currentBox = await currentControl.boundingBox()
  if (!currentBox) throw new Error('Expected updated motion path control geometry')
  const currentX = currentBox.x + currentBox.width / 2
  const currentY = currentBox.y + currentBox.height / 2
  await editor.page.mouse.move(currentX, currentY)
  await editor.page.mouse.down()
  await editor.page.mouse.move(currentX - 30, currentY + 18, { steps: 3 })
  await editor.page.keyboard.press('Escape')
  await editor.page.mouse.up()
  expect((await nodeSnapshot(nodeId)).control1).toEqual(dragged.control1)

  await currentControl.focus()
  await currentControl.press('ArrowRight')
  const nudged = await nodeSnapshot(nodeId)
  expect(nudged.control1.x).toBe(dragged.control1.x + 1)
  expect(nudged.control1.y).toBe(dragged.control1.y)
  expect(nudged.geometry).toEqual(before.geometry)
  await editor.canvas.undo()
  expect((await nodeSnapshot(nodeId)).control1).toEqual(dragged.control1)

  await editor.page.evaluate(() => window.openPencil?.getStore?.().clearSelection())
  await expect(editor.page.getByTestId('motion-path-handle-segment-0-control1')).toHaveCount(0)
  expect(
    await editor.page.evaluate(() => window.openPencil?.getStore?.().state.motionPathEdit ?? null)
  ).toBeNull()
})

test('clears path editing when activating a same-page pane with another selection', async () => {
  test.setTimeout(30_000)
  const pathNodeId = await createNestedCubicPathNode()
  const siblingNodeId = await createSiblingNode()
  await editor.canvas.waitForRender()

  await editor.page.getByRole('menuitem', { name: 'View', exact: true }).click()
  await editor.page.getByRole('menuitem', { name: 'Split right' }).click()

  const headers = editor.page.locator('[data-slot="canvas-pane-header"]')
  const panes = editor.page.locator('[data-active-pane]')
  await expect(headers).toHaveCount(2)
  await expect(panes.nth(1)).toHaveAttribute('data-active-pane', 'true')

  await editor.page.evaluate((nodeId) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.select([nodeId])
  }, siblingNodeId)

  await headers.nth(0).click({ position: { x: 20, y: 15 } })
  await expect(panes.nth(0)).toHaveAttribute('data-active-pane', 'true')
  expect(
    await editor.page.evaluate(() => [...(window.openPencil?.getStore?.().state.selectedIds ?? [])])
  ).toEqual([pathNodeId])

  const motion = propertySection(editor.page, 'Motion')
  await motion.scrollIntoViewIfNeeded()
  const edit = motion.getByTestId('motion-path-edit-canvas')
  await edit.scrollIntoViewIfNeeded()
  await edit.click()
  await expect(editor.page.getByTestId('motion-path-handle-segment-0-control1')).toBeVisible()

  await headers.nth(1).click({ position: { x: 20, y: 15 } })
  await expect(panes.nth(1)).toHaveAttribute('data-active-pane', 'true')
  expect(
    await editor.page.evaluate(() => [...(window.openPencil?.getStore?.().state.selectedIds ?? [])])
  ).toEqual([siblingNodeId])
  await expect(editor.page.getByTestId('motion-path-handle-segment-0-control1')).toHaveCount(0)
  expect(
    await editor.page.evaluate(() => window.openPencil?.getStore?.().state.motionPathEdit ?? null)
  ).toBeNull()
})
