import { imageAliasesPluginData, isImageAliasesEntry } from '@open-pencil/fig'
import {
  guidToString,
  isFigmaNodeExtensionField,
  materializeFigmaPayload,
  mergePluginData,
  remapFigmaMessageObjectAnimations,
  remapFigmaNodeReferences
} from '@open-pencil/fig/node-change'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import type { Schema } from '@open-pencil/kiwi/schema-runtime'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import type { GUID } from '@open-pencil/scene-graph/primitives'

import { applyEnabledLibrariesPluginData } from '#core/io/formats/fig/library-metadata'
import { serializeLowcodeFields } from '#core/kiwi/fig/node-change/lowcode-plugin-data'
import { makeDocumentNodeChange } from '#core/kiwi/fig/node-change/serialize'
import { FIGMA_DOCUMENT_METADATA_FIELD_KEYS } from '#core/kiwi/fig/root-metadata'

import type { KiwiNodeChange } from './setup'

export function applyPreservedRootMetadata(
  rawNodeFields: Record<string, unknown>,
  nodeChange: KiwiNodeChange,
  fields: readonly (keyof NodeChange)[],
  blobs: Uint8Array[],
  blobIndexByHex: Map<string, number>
): void {
  const preservedFields = new Set([
    ...fields,
    ...Object.keys(rawNodeFields).filter(isFigmaNodeExtensionField)
  ])
  for (const field of preservedFields) {
    const value = rawNodeFields[field]
    if (value === undefined) continue
    nodeChange[field] = materializeFigmaPayload(value, blobs, {
      blobIndexByHex,
      includePaintVariables: true,
      includeVariableMaps: true
    })
  }
}

export function makeExportDocumentNodeChange(
  graph: SceneGraph,
  docGuid: GUID,
  blobs: Uint8Array[],
  blobIndexByHex: Map<string, number>
): KiwiNodeChange {
  const documentNc = makeDocumentNodeChange(docGuid, graph.documentColorSpace)
  const rootNode = graph.getNode(graph.rootId)
  if (!rootNode) return documentNc

  applyPreservedRootMetadata(
    rootNode.source.fig.rawNodeFields,
    documentNc,
    FIGMA_DOCUMENT_METADATA_FIELD_KEYS,
    blobs,
    blobIndexByHex
  )
  applyEnabledLibrariesPluginData(documentNc, graph)
  const rootLowcode = serializeLowcodeFields(rootNode)
  const rootPluginData = (documentNc.pluginData ?? []).map((entry) => ({
    pluginId: entry.pluginID,
    key: entry.key,
    value: entry.value
  }))
  const aliases = imageAliasesPluginData(graph.images, graph.getAllNodes())
  const entries = [...rootPluginData.filter((entry) => !isImageAliasesEntry(entry)), ...rootLowcode]
  if (aliases) entries.push(aliases)
  if (entries.length > 0) documentNc.pluginData = mergePluginData(entries)
  else delete documentNc.pluginData
  return documentNc
}

/** Pages have records of their own, so their plugin data bypasses layer serialization. */
export function applyCanvasPluginData(page: SceneNode, canvasNc: KiwiNodeChange): void {
  // The reader absorbs known fields into the node and retains opaque or future entries in
  // pluginData. Serialize that live state rather than the source record's stale payloads.
  const entries = [...page.pluginData, ...serializeLowcodeFields(page)]
  if (entries.length > 0) canvasNc.pluginData = mergePluginData(entries)
  else delete canvasNc.pluginData
}

function owningCanvasId(graph: SceneGraph, nodeId: string): string | null {
  let current = graph.getNode(nodeId)
  while (current) {
    if (current.type === 'CANVAS') return current.id
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return null
}

export function remapExportedFigmaNodeReferences(
  graph: SceneGraph,
  nodeChanges: KiwiNodeChange[],
  nodeIdToGuid: ReadonlyMap<string, GUID>,
  documentGuid: GUID,
  schema: Schema
): unknown {
  const emittedGuidToNodeId = new Map<string, string>()
  for (const [nodeId, guid] of nodeIdToGuid) emittedGuidToNodeId.set(guidToString(guid), nodeId)
  emittedGuidToNodeId.set(guidToString(documentGuid), graph.rootId)

  const sourceGuidToNodeIds = new Map<string, string[]>()
  for (const node of graph.getAllNodes()) {
    const sourceGuid = node.source.id
    if (!sourceGuid || !nodeIdToGuid.has(node.id)) continue
    const candidates = sourceGuidToNodeIds.get(sourceGuid)
    if (candidates) candidates.push(node.id)
    else sourceGuidToNodeIds.set(sourceGuid, [node.id])
  }

  const canvasIdByNodeId = new Map<string, string | null>()
  const getCanvasId = (nodeId: string): string | null => {
    if (canvasIdByNodeId.has(nodeId)) return canvasIdByNodeId.get(nodeId) ?? null
    const canvasId = owningCanvasId(graph, nodeId)
    canvasIdByNodeId.set(nodeId, canvasId)
    return canvasId
  }

  for (const nodeChange of nodeChanges) {
    if (!nodeChange.guid) continue
    const ownerNodeId = emittedGuidToNodeId.get(guidToString(nodeChange.guid))
    if (!ownerNodeId) continue

    remapFigmaNodeReferences(
      nodeChange,
      (sourceGuid, path) => {
        if (path === 'paint.sourceNodeId') {
          const runtimeGuid = nodeIdToGuid.get(guidToString(sourceGuid))
          if (runtimeGuid) return runtimeGuid
        }
        const candidates = sourceGuidToNodeIds.get(guidToString(sourceGuid)) ?? []
        if (candidates.length === 0) return null
        if (candidates.length === 1) return nodeIdToGuid.get(candidates[0]) ?? null
        if (candidates.includes(ownerNodeId)) return nodeIdToGuid.get(ownerNodeId) ?? null

        const ownerCanvasId = getCanvasId(ownerNodeId)
        const scopedCandidates = candidates.filter(
          (candidateId) => getCanvasId(candidateId) === ownerCanvasId
        )
        return scopedCandidates.length === 1
          ? (nodeIdToGuid.get(scopedCandidates[0]) ?? null)
          : null
      },
      schema
    )
  }

  if (graph.figMessageObjectAnimations === null) return null
  return remapFigmaMessageObjectAnimations(
    structuredClone(graph.figMessageObjectAnimations),
    (sourceGuid) => {
      const candidates = sourceGuidToNodeIds.get(guidToString(sourceGuid)) ?? []
      if (candidates.length === 1) return nodeIdToGuid.get(candidates[0]) ?? null
      if (candidates.length > 1) return null
      return guidToString(sourceGuid) === guidToString(documentGuid) ? documentGuid : null
    }
  )
}
