import type { PluginRuntimeCapabilityV1 } from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'

import { getActiveEditorStoreOrNull, type EditorStore } from '@/app/editor/active-store'

export const PLUGIN_RUNTIME_CONTEXT_LIMITS = Object.freeze({
  maxNodes: 64,
  maxSelection: 16,
  maxChildIdsPerNode: 8,
  maxIdBytes: 128,
  maxNameBytes: 128,
  maxTextBytes: 512
})

type RuntimeNodeSnapshot = Readonly<{
  id: string
  parentId: string | null
  type: string
  name: string
  childIds: readonly string[]
  x: number
  y: number
  width: number
  height: number
  rotation: number
  visible: boolean
  locked: boolean
  text: string | null
}>

const UTF8_ENCODER = new TextEncoder()

function boundedUtf8Text(value: string, maximumBytes: number): string {
  let byteLength = 0
  let bounded = ''
  for (const character of value) {
    const nextLength = UTF8_ENCODER.encode(character).byteLength
    if (byteLength + nextLength > maximumBytes) break
    bounded += character
    byteLength += nextLength
  }
  return bounded
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function nodeSnapshot(node: SceneNode): RuntimeNodeSnapshot {
  return Object.freeze({
    id: boundedUtf8Text(node.id, PLUGIN_RUNTIME_CONTEXT_LIMITS.maxIdBytes),
    parentId:
      node.parentId === null
        ? null
        : boundedUtf8Text(node.parentId, PLUGIN_RUNTIME_CONTEXT_LIMITS.maxIdBytes),
    type: node.type,
    name: boundedUtf8Text(node.name, PLUGIN_RUNTIME_CONTEXT_LIMITS.maxNameBytes),
    childIds: Object.freeze(
      node.childIds
        .slice(0, PLUGIN_RUNTIME_CONTEXT_LIMITS.maxChildIdsPerNode)
        .map((id) => boundedUtf8Text(id, PLUGIN_RUNTIME_CONTEXT_LIMITS.maxIdBytes))
    ),
    x: finite(node.x),
    y: finite(node.y),
    width: finite(node.width),
    height: finite(node.height),
    rotation: finite(node.rotation),
    visible: node.visible,
    locked: node.locked,
    text:
      node.type === 'TEXT'
        ? boundedUtf8Text(node.text, PLUGIN_RUNTIME_CONTEXT_LIMITS.maxTextBytes)
        : null
  })
}

function documentContext(editor: EditorStore) {
  const nodes: RuntimeNodeSnapshot[] = []
  for (const node of editor.graph.getAllNodes()) {
    if (nodes.length >= PLUGIN_RUNTIME_CONTEXT_LIMITS.maxNodes) break
    nodes.push(nodeSnapshot(node))
  }
  const totalNodeCount = editor.graph.getNodeCount()
  return Object.freeze({
    currentPageId: boundedUtf8Text(
      editor.state.currentPageId,
      PLUGIN_RUNTIME_CONTEXT_LIMITS.maxIdBytes
    ),
    totalNodeCount,
    truncated: totalNodeCount > nodes.length,
    nodes: Object.freeze(nodes)
  })
}

function selectionContext(editor: EditorStore) {
  const selectedSourceIds = [...editor.state.selectedIds].slice(
    0,
    PLUGIN_RUNTIME_CONTEXT_LIMITS.maxSelection
  )
  const selectedIds = selectedSourceIds.map((id) =>
    boundedUtf8Text(id, PLUGIN_RUNTIME_CONTEXT_LIMITS.maxIdBytes)
  )
  return Object.freeze({
    totalSelectedCount: editor.state.selectedIds.size,
    truncated: editor.state.selectedIds.size > selectedIds.length,
    nodeIds: Object.freeze(selectedIds),
    nodes: Object.freeze(
      selectedSourceIds.flatMap((id) => {
        const node = editor.graph.getNode(id)
        return node ? [nodeSnapshot(node)] : []
      })
    )
  })
}

/**
 * Builds a bounded, read-only host envelope. The signed capability list controls which snapshots
 * are present; raw SceneGraph objects, design assets, credentials, and host functions never cross
 * the worker boundary.
 */
export async function preparePluginRuntimeInput(
  capabilities: readonly PluginRuntimeCapabilityV1[],
  userInput: JSONValue,
  editor: EditorStore | null = getActiveEditorStoreOrNull()
): Promise<JSONValue> {
  if (capabilities.length === 0) return userInput
  if (!editor) throw new Error('No active document is available for plugin runtime capabilities')

  const context: Record<string, JSONValue> = {}
  if (capabilities.includes('document.nodes.read')) {
    context.documentNodes = documentContext(editor) as JSONValue
  }
  if (capabilities.includes('document.selection.read')) {
    context.documentSelection = selectionContext(editor) as JSONValue
  }
  return { input: userInput, capabilities: context }
}
