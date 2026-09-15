import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { buildFigmaClipboardHTML, buildOpenPencilClipboardHTML } from '#core/clipboard'
import type { EditorContext } from '#core/editor/types'

import { captureClipboardSnapshot, type ClipboardSnapshot } from './snapshot'

export type { ClipboardSnapshot } from './snapshot'

export interface ClipboardPayload {
  snapshot?: ClipboardSnapshot
  html: string
  plainText: string
}

function graphForSnapshot(ctx: EditorContext, snapshot: ClipboardSnapshot): SceneGraph {
  const graph = new SceneGraph()
  graph.documentColorSpace = ctx.graph.documentColorSpace
  graph.images = snapshot.images
  function index(node: SceneNode & { children?: SceneNode[] }) {
    graph.nodes.set(node.id, node)
    for (const child of node.children ?? []) index(child)
  }
  for (const node of [...snapshot.componentDependencies, ...snapshot.nodes]) index(node)
  return graph
}

export function createClipboardCopyActions(ctx: EditorContext) {
  async function prepareCopy(selectedNodes: SceneNode[]): Promise<ClipboardPayload> {
    if (selectedNodes.length === 0) return { html: '', plainText: '' }
    const snapshot = captureClipboardSnapshot(ctx.graph, selectedNodes)
    const plainText = snapshot.nodes.map((node) => node.name).join('\n')
    const graph = graphForSnapshot(ctx, snapshot)
    const openPencilHTML = buildOpenPencilClipboardHTML(snapshot.nodes, graph)
    const figmaHTML = await buildFigmaClipboardHTML(snapshot.nodes, graph)
    // Keep the lossless carrier for another process; the memory snapshot is session-local.
    const html = figmaHTML ? `${openPencilHTML}${figmaHTML}` : openPencilHTML
    return { html, plainText, snapshot }
  }
  return { prepareCopy }
}
