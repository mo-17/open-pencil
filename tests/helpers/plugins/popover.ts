import type { CanvasHelper } from '#tests/helpers/canvas'

/** Observe the active content bounds; all insertion goes through the ordinary drawing tool. */
export async function drawPopoverContentRectangle(canvas: CanvasHelper) {
  const point = await canvas.page.evaluate(() => {
    const initializedEditorBridge = window.openPencil
    if (!initializedEditorBridge?.getStore) throw new Error('OpenPencil store not initialized')

    const editor = initializedEditorBridge.getStore()
    const rootId = editor.state.contentEdit?.rootId
    const root = rootId ? editor.graph.getNode(rootId) : undefined
    if (!root) throw new Error('Popover content editing has not started')
    const origin = editor.graph.getAbsolutePosition(root.id)
    return {
      x: (origin.x + 24) * editor.state.zoom + editor.state.panX,
      y: (origin.y + 120) * editor.state.zoom + editor.state.panY,
      width: 72 * editor.state.zoom,
      height: 36 * editor.state.zoom
    }
  })
  await canvas.drawRect(point.x, point.y, point.width, point.height)
}
