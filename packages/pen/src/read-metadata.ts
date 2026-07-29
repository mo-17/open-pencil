import {
  cloneGeneratedEffectSpec,
  cloneMotionDriverSpec,
  cloneMotionSceneSpec,
  cloneMotionSpec,
  clonePrototypeSpec,
  type SceneNode
} from '@open-pencil/scene-graph'

import {
  extractPenMetadata,
  inspectPenOpenPencilMetadata,
  PEN_MOTION_CONTRACT_FIELDS,
  replacePreservedPenMetadata,
  type PenMotionContractField,
  type PenOpenPencilValues
} from './metadata'

function unreachableContractField(field: never): never {
  throw new Error(`Unsupported Pen Motion contract field: ${String(field)}`)
}

function cloneContractValue(
  field: PenMotionContractField,
  value: NonNullable<PenOpenPencilValues[PenMotionContractField]>
): NonNullable<PenOpenPencilValues[PenMotionContractField]> {
  switch (field) {
    case 'motion':
      return cloneMotionSpec(value as NonNullable<SceneNode['motion']>)
    case 'motionScene':
      return cloneMotionSceneSpec(value as NonNullable<SceneNode['motionScene']>)
    case 'motionDrivers':
      return cloneMotionDriverSpec(value as NonNullable<SceneNode['motionDrivers']>)
    case 'prototype':
      return clonePrototypeSpec(value as NonNullable<SceneNode['prototype']>)
    case 'transitionKey':
      return value
    case 'generatedEffect':
      return cloneGeneratedEffectSpec(value as NonNullable<SceneNode['generatedEffect']>)
  }
  return unreachableContractField(field)
}

function clearContractValue(node: SceneNode, field: PenMotionContractField): void {
  Reflect.deleteProperty(node, field)
}

function assignContractValue(
  node: SceneNode,
  field: PenMotionContractField,
  value: NonNullable<PenOpenPencilValues[PenMotionContractField]>
): void {
  Object.assign(node, { [field]: cloneContractValue(field, value) })
}

function suppressAllContracts(node: SceneNode): void {
  for (const field of PEN_MOTION_CONTRACT_FIELDS) clearContractValue(node, field)
}

export function applyPenMetadata(node: SceneNode, metadata: unknown): void {
  const extracted = extractPenMetadata(metadata)
  if (extracted.hasInertOpenPencilPayload) {
    suppressAllContracts(node)
  } else {
    for (const field of PEN_MOTION_CONTRACT_FIELDS) {
      const hasField =
        extracted[`has${field[0].toUpperCase()}${field.slice(1)}` as keyof typeof extracted]
      if (hasField !== true) continue
      const value = extracted[field]
      if (value == null) clearContractValue(node, field)
      else assignContractValue(node, field, value)
    }
  }
  node.pluginData = replacePreservedPenMetadata(node.pluginData, metadata)
}

function inheritContractField(
  node: SceneNode,
  component: SceneNode,
  field: PenMotionContractField,
  values: PenOpenPencilValues | null,
  inert: boolean
): void {
  if (inert) {
    clearContractValue(node, field)
    node.overrides[field] = null
    return
  }
  if (values && Object.hasOwn(values, field)) {
    const value = values[field]
    if (value === null || value === undefined) {
      clearContractValue(node, field)
      node.overrides[field] = null
      return
    }
    const cloned = cloneContractValue(field, value)
    Object.assign(node, { [field]: cloned })
    node.overrides[field] = cloneContractValue(field, value)
    return
  }
  const inherited = component[field]
  if (inherited !== undefined) assignContractValue(node, field, inherited)
}

/** Retained name for source compatibility; now inherits every bounded Motion
 * contract field, not just node-local MotionSpec. */
export function inheritPenMotion(node: SceneNode, component: SceneNode, metadata: unknown): void {
  const state = inspectPenOpenPencilMetadata(metadata)
  const values = state.kind === 'valid' ? state.values : null
  for (const field of PEN_MOTION_CONTRACT_FIELDS) {
    inheritContractField(node, component, field, values, state.kind === 'inert')
  }
}

export function applyPenOverrideMetadata(
  target: SceneNode,
  metadata: unknown,
  instanceNode: SceneNode
): void {
  applyPenMetadata(target, metadata)
  const state = inspectPenOpenPencilMetadata(metadata)
  if (state.kind === 'valid') {
    for (const field of PEN_MOTION_CONTRACT_FIELDS) {
      if (!Object.hasOwn(state.values, field)) continue
      const value = state.values[field]
      instanceNode.overrides[`${target.id}:${field}`] =
        value === null || value === undefined ? null : cloneContractValue(field, value)
    }
  } else if (state.kind === 'inert') {
    for (const field of PEN_MOTION_CONTRACT_FIELDS) {
      instanceNode.overrides[`${target.id}:${field}`] = null
    }
  }
}
