import type { SceneNode } from '@open-pencil/scene-graph'

import { buildFigmaClipboardHTML, buildOpenPencilClipboardHTML } from '#core/clipboard'
import type { EditorContext } from '#core/editor/types'

export function createClipboardCopyActions(ctx: EditorContext) {
  async function writeCopyData(clipboardData: DataTransfer, selectedNodes: SceneNode[]) {
    if (selectedNodes.length === 0) return

    const names = selectedNodes.map((n) => n.name).join('\n')
    clipboardData.setData('text/plain', names)

    const openPencilHtml = buildOpenPencilClipboardHTML(selectedNodes, ctx.graph)
    const figmaHtml = await buildFigmaClipboardHTML(selectedNodes, ctx.graph)
    // Keep both payloads in one HTML value: OpenPencil prefers its lossless
    // tree, while Figma can still discover its figmeta/figma markers.
    clipboardData.setData('text/html', figmaHtml ? `${openPencilHtml}${figmaHtml}` : openPencilHtml)
  }

  return { writeCopyData }
}
