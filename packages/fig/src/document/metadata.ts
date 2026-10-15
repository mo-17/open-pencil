import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { OPEN_PENCIL_PLUGIN_DATA, type SceneGraph } from '@open-pencil/scene-graph'

import { preserveFigmaPayloadBlobs } from '../node-change/convert'
import { figmaNodeExtensionEntries } from '../node-change/extension-fields'
import { readNodeChangePluginData } from '../node-change/plugin-data'

export function applyDocumentMetadata(
  graph: SceneGraph,
  document: NodeChange | undefined,
  blobs: Uint8Array[] = []
): void {
  const root = graph.getNode(graph.rootId)
  if (!root || !document) return
  root.source.format = 'fig'
  graph.documentColorSpace = document.documentColorProfile === 'DISPLAY_P3' ? 'display-p3' : 'srgb'
  root.pluginData =
    document.pluginData?.map((entry) => ({
      pluginId: entry.pluginID,
      key: entry.key,
      value: entry.value
    })) ?? []
  root.source.fig.rawNodeFields.strokeJoin = document.strokeJoin
  root.source.fig.rawNodeFields.strokeWeight = document.strokeWeight
  for (const [field, value] of figmaNodeExtensionEntries(document)) {
    root.source.fig.rawNodeFields[field] = preserveFigmaPayloadBlobs(value, blobs)
  }
  const bindings = readNodeChangePluginData(document, OPEN_PENCIL_PLUGIN_DATA.enabledLibraries)
  for (const binding of bindings ?? []) graph.enabledLibraries.set(binding.libraryId, binding)
}
