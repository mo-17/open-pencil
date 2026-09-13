import { describe, expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'

function fixture() {
  const store = createEditorStore()
  const node = store.graph.createNode('FRAME', store.state.currentPageId, {
    width: 1000,
    height: 1000
  })
  return { store, node }
}

function expectContentFits(
  { store, node }: ReturnType<typeof fixture>,
  viewportWidth: number,
  viewportHeight: number
): void {
  const { panX, panY, zoom } = store.state
  const left = node.x * zoom + panX
  const top = node.y * zoom + panY
  const right = left + node.width * zoom
  const bottom = top + node.height * zoom
  expect(left).toBeGreaterThanOrEqual(0)
  expect(top).toBeGreaterThanOrEqual(0)
  expect(right).toBeLessThanOrEqual(viewportWidth)
  expect(bottom).toBeLessThanOrEqual(viewportHeight)
  expect((left + right) / 2).toBeCloseTo(viewportWidth / 2)
  expect((top + bottom) / 2).toBeCloseTo(viewportHeight / 2)
}

describe('editor active pane viewport', () => {
  test('fits content inside the canvas resize dimensions instead of the surrounding window', () => {
    const current = fixture()
    current.store.resizePane(current.store.activePaneId.value, 655, 764)
    current.store.zoomToFit()
    expectContentFits(current, 655, 764)
  })

  test('uses the latest active pane dimensions after background resize, activation, and close', () => {
    const current = fixture()
    const { store } = current
    const firstId = store.activePaneId.value
    store.resizePane(firstId, 655, 764)
    const second = store.splitPane(firstId, 'horizontal')
    if (!second) throw new Error('Expected a split pane')
    store.resizePane(second.id, 280, 764)
    store.zoomToFit()
    expectContentFits(current, 280, 764)

    store.resizePane(firstId, 900, 600)
    store.zoomToFit()
    expectContentFits(current, 280, 764)

    store.setActivePane(firstId)
    store.zoomToFit()
    expectContentFits(current, 900, 600)

    store.closePane(firstId)
    store.zoomToFit()
    expectContentFits(current, 280, 764)
  })

  test('preserves the explicit viewport fallback before a pane has been measured', () => {
    const current = fixture()
    current.store.setViewportSize(800, 600)
    current.store.zoomToFit()
    expectContentFits(current, 800, 600)
    current.store.resizePane(current.store.activePaneId.value, 655, 764)
    current.store.zoomToFit()
    expectContentFits(current, 655, 764)
  })
})
