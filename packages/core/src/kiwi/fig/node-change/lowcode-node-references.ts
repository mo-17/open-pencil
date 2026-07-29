import { guidToString, OPEN_PENCIL_PLUGIN_ID } from '@open-pencil/fig/node-change'
import {
  motionDriverNodeReferences,
  prototypeNodeReferences,
  remapLowcodeMotionActionTargets,
  remapMotionDriverNodeReferences,
  remapMotionSceneNodeReferences,
  remapNodeLowcodeMotionActionTargets,
  remapPrototypeNodeReferences,
  validateMotionDriverSpec,
  validateMotionSceneSpec,
  validatePrototypeSpec,
  type LowcodeNodeIdResolver,
  type SceneGraph
} from '@open-pencil/scene-graph'
import type { GUID } from '@open-pencil/scene-graph/primitives'

import {
  LOWCODE_EVENTS_KEY,
  LOWCODE_MOTION_DRIVERS_KEY,
  LOWCODE_MOTION_SCENE_KEY,
  LOWCODE_OVERRIDES_KEY,
  LOWCODE_PROTOTYPE_KEY,
  LOWCODE_WORKFLOWS_KEY
} from './lowcode-plugin-data'

export { remapLowcodeMotionActionTargets }
export type { LowcodeNodeIdResolver }

interface SerializedLowcodeNode {
  pluginData?: Array<{ pluginID?: string; key: string; value: string }>
}

const SERIALIZED_REFERENCE_KEYS = new Set([
  LOWCODE_EVENTS_KEY,
  LOWCODE_WORKFLOWS_KEY,
  LOWCODE_MOTION_SCENE_KEY,
  LOWCODE_MOTION_DRIVERS_KEY,
  LOWCODE_PROTOTYPE_KEY,
  LOWCODE_OVERRIDES_KEY
])

type SerializedRemapResult = { changed: false } | { changed: true; value: unknown }

interface SerializedOverrideTable {
  [key: string]: unknown
}

function isSerializedOverrideTable(value: unknown): value is SerializedOverrideTable {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Resolve a graph node to its exported GUID. Generated instance descendants are
 * not emitted as independent Figma nodes, so they fall back through componentId
 * lineage to the exported master node. */
export function resolveSerializedGraphNodeReference(
  graph: SceneGraph,
  nodeIdToGuid: ReadonlyMap<string, GUID>,
  nodeId: string
): string | undefined {
  const visited = new Set<string>()
  let candidateId: string | null = nodeId
  while (candidateId && !visited.has(candidateId)) {
    visited.add(candidateId)
    const guid = nodeIdToGuid.get(candidateId)
    if (guid) return guidToString(guid)
    candidateId = graph.getNode(candidateId)?.componentId ?? null
  }
  return undefined
}

function remapSerializedMotionContract(
  key: string,
  value: unknown,
  resolveNodeId: LowcodeNodeIdResolver
): SerializedRemapResult {
  if (key === LOWCODE_MOTION_SCENE_KEY || key === 'motionScene') {
    const validated = validateMotionSceneSpec(value)
    if (!validated.success) return { changed: false }
    const changed = validated.value.sequences.some((sequence) =>
      sequence.cues.some((cue) => resolveNodeId(cue.targetNodeId) !== undefined)
    )
    return changed
      ? { changed: true, value: remapMotionSceneNodeReferences(validated.value, resolveNodeId) }
      : { changed: false }
  }
  if (key === LOWCODE_MOTION_DRIVERS_KEY || key === 'motionDrivers') {
    const validated = validateMotionDriverSpec(value)
    if (!validated.success) return { changed: false }
    const changed = motionDriverNodeReferences(validated.value).some(
      (nodeId) => resolveNodeId(nodeId) !== undefined
    )
    return changed
      ? { changed: true, value: remapMotionDriverNodeReferences(validated.value, resolveNodeId) }
      : { changed: false }
  }
  if (key === LOWCODE_PROTOTYPE_KEY || key === 'prototype') {
    const validated = validatePrototypeSpec(value)
    if (!validated.success) return { changed: false }
    const changed = prototypeNodeReferences(validated.value).some(
      (nodeId) => resolveNodeId(nodeId) !== undefined
    )
    return changed
      ? { changed: true, value: remapPrototypeNodeReferences(validated.value, resolveNodeId) }
      : { changed: false }
  }
  return { changed: false }
}

function remapSerializedInstanceOverrides(
  value: unknown,
  resolveNodeId: LowcodeNodeIdResolver
): SerializedRemapResult {
  if (!isSerializedOverrideTable(value)) return { changed: false }
  const overrides = { ...value }
  let changed = false
  for (const [key, override] of Object.entries(overrides)) {
    const field = key.slice(key.lastIndexOf(':') + 1)
    const remapped = remapSerializedMotionContract(field, override, resolveNodeId)
    if (!remapped.changed) continue
    overrides[key] = remapped.value
    changed = true
  }
  return changed ? { changed: true, value: overrides } : { changed: false }
}

function remapSerializedPluginValue(
  key: string,
  value: unknown,
  resolveNodeId: LowcodeNodeIdResolver
): SerializedRemapResult {
  if (key === LOWCODE_EVENTS_KEY || key === LOWCODE_WORKFLOWS_KEY) {
    return remapLowcodeMotionActionTargets(value, resolveNodeId)
      ? { changed: true, value }
      : { changed: false }
  }
  if (key === LOWCODE_OVERRIDES_KEY) {
    return remapSerializedInstanceOverrides(value, resolveNodeId)
  }
  return remapSerializedMotionContract(key, value, resolveNodeId)
}

/** Rewrite every supported node reference inside serialized OpenPencil plugin data. */
export function remapSerializedLowcodeMotionActionReferences(
  nodes: Iterable<SerializedLowcodeNode>,
  resolveNodeId: LowcodeNodeIdResolver
): void {
  for (const node of nodes) {
    for (const entry of node.pluginData ?? []) {
      if (entry.pluginID !== OPEN_PENCIL_PLUGIN_ID || !SERIALIZED_REFERENCE_KEYS.has(entry.key)) {
        continue
      }
      try {
        const value = JSON.parse(entry.value) as unknown
        const remapped = remapSerializedPluginValue(entry.key, value, resolveNodeId)
        if (remapped.changed) entry.value = JSON.stringify(remapped.value)
      } catch (error) {
        console.warn('[FIG] Preserving malformed lowcode plugin data without remapping', error)
      }
    }
  }
}

/** Convert exported/source GUID strings in lowcode pluginData back to the new
 * SceneGraph node ids assigned by the importer. Unknown references remain
 * intact so editor/compiler validation can report them instead of silently
 * retargeting an action. */
export function remapImportedLowcodeMotionActionReferences(
  graph: SceneGraph,
  guidToNodeId: ReadonlyMap<string, string>,
  nodeIds?: Iterable<string>
): void {
  const resolve = (nodeId: string) => guidToNodeId.get(nodeId)
  const nodes = nodeIds
    ? [...nodeIds].flatMap((nodeId) => {
        const node = graph.getNode(nodeId)
        return node ? [node] : []
      })
    : graph.getAllNodes()
  for (const node of nodes) {
    const updates = remapNodeLowcodeMotionActionTargets(node, resolve)
    if (updates) graph.updateNode(node.id, updates)
  }
}
