import type { Editor } from '@open-pencil/core/editor'
import {
  contentShader,
  readShaderPaints,
  shaderContentKey,
  shaderOfPaint,
  shaderPresetKey,
  type ShaderPreset,
  type SceneGraph
} from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

export interface PlaybackSource {
  preset: ShaderPreset
  key: string
  input?: { id: string; key: string; width: number; height: number }
  nodeIds: Set<string>
  bounds: Rect[]
}

/** Only the active, supported content paint can replace a subtree in preview. */
export function shadersOnPage(editor: Pick<Editor, 'graph'>, pageId: string) {
  const found = new Map<string, PlaybackSource>()
  for (const node of editor.graph.getAllNodes()) {
    if (readShaderPaints(node).length === 0 || !editor.graph.isDescendant(node.id, pageId)) continue
    for (const paint of [...node.fills, ...node.strokes]) {
      const shader = paint.visible && shaderOfPaint(node, paint)
      if (!shader) continue
      const content = shader.input && contentShader(editor.graph, node)
      if (shader.input && (!content || content.paint !== paint)) continue
      // The compositor projects content paints only once a saved fallback exists.
      if (shader.input && !editor.graph.images.get(shader.image)?.length) continue
      const input = content
        ? {
            id: node.id,
            key: shaderContentKey(editor.graph, node),
            width: node.width,
            height: node.height
          }
        : undefined
      const entry = found.get(shader.image) ?? {
        preset: shader.preset,
        key: JSON.stringify([shaderPresetKey(shader.preset), input?.key]),
        input,
        nodeIds: new Set<string>(),
        bounds: []
      }
      entry.nodeIds.add(node.id)
      entry.bounds.push(editor.graph.getAbsoluteBounds(node.id))
      found.set(shader.image, entry)
    }
  }
  return found
}

/** Async preparation must still belong to the same source, including copied image identities. */
export function isCurrentInput(graph: SceneGraph, image: string, source: PlaybackSource) {
  if (!source.input) return true
  const node = graph.getNode(source.input.id)
  const content = node && contentShader(graph, node)
  return Boolean(
    node &&
    content &&
    content.shader.image === image &&
    shaderPresetKey(content.shader.preset) === shaderPresetKey(source.preset) &&
    shaderContentKey(graph, node) === source.input.key
  )
}
