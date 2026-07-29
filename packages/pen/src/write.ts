import {
  parseGeneratedEffectSpec,
  parseMotionDriverSpec,
  parseMotionSceneSpec,
  parseMotionSpec,
  parseMotionTransitionKey,
  parsePrototypeSpec,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

import type { PenDocument, PenNode } from './convert'
import {
  inspectPenOpenPencilMetadata,
  PEN_MOTION_CONTRACT_FIELDS,
  PEN_OPEN_PENCIL_METADATA_KEY,
  PEN_OPEN_PENCIL_SCHEMA_VERSION,
  PEN_OPEN_PENCIL_SCHEMA_VERSION_V2,
  PEN_OPEN_PENCIL_SCHEMA_VERSION_V3,
  type PenMetadata,
  type PenMotionContractField,
  type PenOpenPencilMetadataState,
  type PenOpenPencilValues
} from './metadata'
import { isPlainPenRecord, type PenRecord } from './record'
import {
  assertPenMotionWriteSafe,
  clonePenSourceDocument,
  stringifyPenSource,
  type PenSourceContext
} from './source'

function isOnlyOpenPencilType(metadata: PenRecord): boolean {
  return metadata.type === 'open-pencil' && Object.keys(metadata).length === 1
}

function validOuterMetadata(metadata: unknown): metadata is PenMetadata {
  return isPlainPenRecord(metadata) && typeof metadata.type === 'string' && metadata.type.length > 0
}

function unreachableContractField(field: never): never {
  throw new Error(`Unsupported Pen Motion contract field: ${String(field)}`)
}

function canonicalContractValue(node: SceneNode, field: PenMotionContractField): unknown {
  switch (field) {
    case 'motion':
      return node.motion ? parseMotionSpec(node.motion) : undefined
    case 'motionScene':
      return node.motionScene ? parseMotionSceneSpec(node.motionScene) : undefined
    case 'motionDrivers':
      return node.motionDrivers ? parseMotionDriverSpec(node.motionDrivers) : undefined
    case 'prototype':
      return node.prototype ? parsePrototypeSpec(node.prototype) : undefined
    case 'transitionKey':
      return node.transitionKey ? parseMotionTransitionKey(node.transitionKey) : undefined
    case 'generatedEffect':
      return node.generatedEffect ? parseGeneratedEffectSpec(node.generatedEffect) : undefined
  }
  return unreachableContractField(field)
}

function cloneValues(state: PenOpenPencilMetadataState): PenOpenPencilValues {
  return state.kind === 'valid' ? structuredClone(state.values) : {}
}

function hasV2Field(values: PenOpenPencilValues): boolean {
  return PEN_MOTION_CONTRACT_FIELDS.some(
    (field) => field !== 'motion' && Object.hasOwn(values, field)
  )
}

function hasV3Field(values: PenOpenPencilValues): boolean {
  return Object.hasOwn(values, 'generatedEffect')
}

function buildPayload(
  state: PenOpenPencilMetadataState,
  values: PenOpenPencilValues
): PenRecord | undefined {
  const fields = PEN_MOTION_CONTRACT_FIELDS.filter((field) => Object.hasOwn(values, field))
  if (fields.length === 0) return undefined
  const useV2 =
    (state.kind === 'valid' && state.schemaVersion === PEN_OPEN_PENCIL_SCHEMA_VERSION_V2) ||
    hasV2Field(values)
  const useV3 =
    (state.kind === 'valid' && state.schemaVersion === PEN_OPEN_PENCIL_SCHEMA_VERSION_V3) ||
    hasV3Field(values)
  if (useV3) {
    const payload: PenRecord = { schemaVersion: PEN_OPEN_PENCIL_SCHEMA_VERSION_V3 }
    for (const field of fields) payload[field] = values[field]
    return payload
  }
  if (!useV2) {
    if (!Object.hasOwn(values, 'motion')) return undefined
    return { schemaVersion: PEN_OPEN_PENCIL_SCHEMA_VERSION, motion: values.motion }
  }
  const payload: PenRecord = { schemaVersion: PEN_OPEN_PENCIL_SCHEMA_VERSION_V2 }
  for (const field of fields) payload[field] = values[field]
  return payload
}

function mergeEditedContracts(
  metadata: unknown,
  rawNode: PenNode,
  sceneNode: SceneNode,
  editedFields: readonly PenMotionContractField[]
): PenMetadata | undefined {
  const state = inspectPenOpenPencilMetadata(metadata)
  if (state.kind === 'inert') {
    throw new Error(
      `Cannot edit Motion on .pen node ${rawNode.id}: metadata.openPencil uses an unsupported or malformed schema`
    )
  }
  if (metadata !== undefined && !validOuterMetadata(metadata)) {
    throw new Error(
      `Cannot edit Motion on .pen node ${rawNode.id}: metadata must be an object with a non-empty string type`
    )
  }

  const values = cloneValues(state)
  for (const field of editedFields) {
    const value = canonicalContractValue(sceneNode, field)
    if (value === undefined) {
      if (rawNode.type === 'ref') Object.assign(values, { [field]: null })
      else Reflect.deleteProperty(values, field)
    } else {
      Object.assign(values, { [field]: value })
    }
  }
  const payload = buildPayload(state, values)
  if (metadata === undefined) {
    return payload ? { type: 'open-pencil', [PEN_OPEN_PENCIL_METADATA_KEY]: payload } : undefined
  }

  const next = structuredClone(metadata)
  if (payload) next[PEN_OPEN_PENCIL_METADATA_KEY] = payload
  else Reflect.deleteProperty(next, PEN_OPEN_PENCIL_METADATA_KEY)
  return isOnlyOpenPencilType(next) ? undefined : next
}

function nextMetadata(rawNode: PenNode, sceneNode: SceneNode): PenMetadata | undefined {
  const editedFields = PEN_MOTION_CONTRACT_FIELDS.filter((field) =>
    sceneNode.source.editedFields.includes(field)
  )
  if (editedFields.length === 0) return rawNode.metadata
  return mergeEditedContracts(rawNode.metadata, rawNode, sceneNode, editedFields)
}

function patchNodeContracts(nodes: PenNode[], graph: SceneGraph, context: PenSourceContext): void {
  for (const rawNode of nodes) {
    if (context.mappedEntityIds.has(rawNode.id)) {
      const sceneNode = graph.getNode(rawNode.id)
      if (!sceneNode) throw new Error(`The .pen source node ${rawNode.id} is unavailable`)
      const metadata = nextMetadata(rawNode, sceneNode)
      if (metadata === undefined) Reflect.deleteProperty(rawNode, 'metadata')
      else rawNode.metadata = metadata
    }
    if (rawNode.children) patchNodeContracts(rawNode.children, graph, context)
  }
}

/**
 * Serialize bounded OpenPencil Motion contract edits back into the original `.pen` document.
 *
 * This writer is intentionally source-preserving and fail-closed: it accepts
 * only graphs produced by `parsePenFile()` and rejects structural, visual,
 * variable, or document-metadata edits. Use `.fig` for those edits until a
 * complete SceneGraph-to-Pencil projection exists.
 */
export function serializePenFile(graph: SceneGraph): string {
  const context = assertPenMotionWriteSafe(graph)
  const document: PenDocument = clonePenSourceDocument(context)
  patchNodeContracts(document.children, graph, context)
  return stringifyPenSource(document, context)
}

export const writePenFile = serializePenFile
