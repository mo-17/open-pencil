import {
  assertMotionStaggerBatch,
  cloneMotionDriverSpec,
  cloneMotionSceneSpec,
  cloneMotionSpec,
  clonePrototypeSpec,
  createMotionPreset,
  instantiateMotionRecipe,
  isMotionPresetId,
  MOTION_PRESET_IDS,
  MOTION_STAGGER_DIRECTIONS,
  MOTION_STAGGER_RHYTHMS,
  MotionValidationError,
  MotionSceneValidationError,
  parseMotionDriverSpec,
  parseMotionSceneSpec,
  parseMotionTransitionKey,
  parsePrototypeSpec,
  parseMotionRecipe,
  parseMotionSpec,
  type MotionDriverSpecV1,
  type MotionPresetParameters,
  type MotionRecipe,
  type MotionRecipeInstantiationInput,
  type MotionSceneSpec,
  type MotionSpec,
  type MotionStaggerDirection,
  type MotionStaggerOptions,
  type MotionStaggerRhythm,
  type MotionTransitionKey,
  type PrototypeSpecV1,
  type SceneNode,
  withMotionStagger
} from '@open-pencil/scene-graph'

import type { FigmaAPI } from '#core/figma-api'
import { inspectMotionDriverSourceBindings, inspectMotionNodeCapabilities } from '#core/motion'
import { defineTool, type ParamDef, type ToolCtx } from '#core/tools/schema'

type ModifyResult<T> = { ok: true; data: T } | { ok: false; error: string }

interface TargetArgs {
  nodeId?: string
  nodeIds?: string[]
}

interface StaggerArgs {
  staggerMs?: number
  direction?: string
  rhythm?: string
}

export interface MotionTarget {
  nodeId: string
  motion: MotionSpec | undefined
}

const MAX_MOTION_SPEC_JSON_BYTES = 1024 * 1024

function fail<T = never>(error: string): ModifyResult<T> {
  return { ok: false, error }
}

function validationError(error: unknown): string {
  if (error instanceof MotionValidationError || error instanceof MotionSceneValidationError) {
    return error.message
  }
  return error instanceof Error ? error.message : String(error)
}

function resolveTargetIds(figma: FigmaAPI, args: TargetArgs): ModifyResult<string[]> {
  const requested = [
    ...(typeof args.nodeId === 'string' && args.nodeId.length > 0 ? [args.nodeId] : []),
    ...(Array.isArray(args.nodeIds) ? args.nodeIds : [])
  ]
  const ids = [...new Set(requested)]
  if (ids.length === 0) return fail('Provide nodeId and/or at least one nodeIds entry')
  const emptyId = ids.find((id) => typeof id !== 'string' || id.length === 0)
  if (emptyId !== undefined) return fail('Motion target ids must be non-empty strings')
  const missing = ids.filter((id) => !figma.graph.getNode(id))
  if (missing.length > 0) return fail(`Motion target node(s) not found: ${missing.join(', ')}`)
  return { ok: true, data: ids }
}

function nodeMotionChanges(node: SceneNode, motion: MotionSpec | undefined): Partial<SceneNode> {
  const authored = motion ? cloneMotionSpec(motion) : undefined
  if (node.type !== 'INSTANCE') return { motion: authored }
  return {
    motion: authored,
    overrides: {
      ...node.overrides,
      motion: authored ? cloneMotionSpec(authored) : null
    }
  }
}

function applyGraphMotion(figma: FigmaAPI, node: SceneNode, motion: MotionSpec | undefined): void {
  const changes = nodeMotionChanges(node, motion)
  if (motion) {
    figma.graph.updateNode(node.id, changes)
    return
  }
  if (node.type === 'INSTANCE') figma.graph.updateNode(node.id, { overrides: changes.overrides })
  figma.graph.clearNodeFields(node.id, ['motion'])
}

export function applyMotionToTargets(
  figma: FigmaAPI,
  targets: readonly MotionTarget[],
  label: string,
  ctx?: ToolCtx
): void {
  const editor = ctx?.editor
  if (editor) {
    const apply = () => {
      for (const target of targets) {
        const node = editor.graph.getNode(target.nodeId)
        if (!node) continue
        editor.updateNodeWithUndo(target.nodeId, nodeMotionChanges(node, target.motion), label)
      }
    }
    if (targets.length > 1) editor.undo.runBatch(label, apply)
    else apply()
    return
  }

  for (const target of targets) {
    const node = figma.graph.getNode(target.nodeId)
    if (node) applyGraphMotion(figma, node, target.motion)
  }
}

function staggerOptions(args: StaggerArgs): ModifyResult<MotionStaggerOptions | null> {
  if (args.staggerMs === undefined) {
    if (args.direction !== undefined || args.rhythm !== undefined) {
      return fail('direction and rhythm require staggerMs')
    }
    return { ok: true, data: null }
  }
  if (!Number.isFinite(args.staggerMs) || args.staggerMs < 0) {
    return fail('staggerMs must be a finite non-negative number')
  }
  if (
    args.direction !== undefined &&
    !(MOTION_STAGGER_DIRECTIONS as readonly string[]).includes(args.direction)
  ) {
    return fail(`Unknown stagger direction: ${args.direction}`)
  }
  if (
    args.rhythm !== undefined &&
    !(MOTION_STAGGER_RHYTHMS as readonly string[]).includes(args.rhythm)
  ) {
    return fail(`Unknown stagger rhythm: ${args.rhythm}`)
  }
  return {
    ok: true,
    data: {
      stepMs: args.staggerMs,
      ...(args.direction ? { direction: args.direction as MotionStaggerDirection } : {}),
      ...(args.rhythm ? { rhythm: args.rhythm as MotionStaggerRhythm } : {})
    }
  }
}

function compareNodeIds(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function spatialTargetOrder(figma: FigmaAPI, nodeIds: readonly string[]): string[] {
  return nodeIds
    .map((nodeId) => ({ nodeId, position: figma.graph.getAbsolutePosition(nodeId) }))
    .sort(
      (left, right) =>
        left.position.y - right.position.y ||
        left.position.x - right.position.x ||
        compareNodeIds(left.nodeId, right.nodeId)
    )
    .map(({ nodeId }) => nodeId)
}

function buildMotionTargets(
  figma: FigmaAPI,
  nodeIds: readonly string[],
  motion: MotionSpec,
  args: StaggerArgs
): ModifyResult<MotionTarget[]> {
  const stagger = staggerOptions(args)
  if (!stagger.ok) return stagger
  const options = stagger.data
  if (!options) {
    return {
      ok: true,
      data: nodeIds.map((nodeId) => ({ nodeId, motion: cloneMotionSpec(motion) }))
    }
  }

  const ordered = spatialTargetOrder(figma, nodeIds)
  try {
    assertMotionStaggerBatch(motion, ordered.length, options)
    return {
      ok: true,
      data: ordered.map((nodeId, index) => ({
        nodeId,
        motion: withMotionStagger(motion, index, ordered.length, options)
      }))
    }
  } catch (error) {
    return fail(`Invalid motion stagger: ${validationError(error)}`)
  }
}

function parseBoundedJson<T>(
  value: string,
  fieldName: string,
  label: string,
  parse: (input: unknown) => T
): ModifyResult<T> {
  if (
    value.length > MAX_MOTION_SPEC_JSON_BYTES ||
    new TextEncoder().encode(value).byteLength > MAX_MOTION_SPEC_JSON_BYTES
  ) {
    return fail(`${fieldName} must not exceed ${MAX_MOTION_SPEC_JSON_BYTES} UTF-8 bytes`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    return fail(`${fieldName} must be valid JSON: ${validationError(error)}`)
  }
  try {
    return { ok: true, data: parse(parsed) }
  } catch (error) {
    return fail(`Invalid ${label}: ${validationError(error)}`)
  }
}

function parseSpecJson(specJson: string): ModifyResult<MotionSpec> {
  return parseBoundedJson(specJson, 'specJson', 'MotionSpec', parseMotionSpec)
}

export function validateMotionNodeCapabilities(
  node: SceneNode,
  spec: MotionSpec
): ModifyResult<undefined> {
  const diagnostics = inspectMotionNodeCapabilities(node, spec).map(
    ({ path, message }) => `${path}: ${message}`
  )
  return diagnostics.length > 0
    ? fail(`MotionSpec is incompatible with node ${node.id}: ${diagnostics.join('; ')}`)
    : { ok: true, data: undefined }
}

function parseSceneSpecJson(specJson: string): ModifyResult<MotionSceneSpec> {
  return parseBoundedJson(specJson, 'specJson', 'MotionSceneSpec', parseMotionSceneSpec)
}

function parseDriverSpecJson(specJson: string): ModifyResult<MotionDriverSpecV1> {
  return parseBoundedJson(specJson, 'specJson', 'MotionDriverSpec', parseMotionDriverSpec)
}

function parsePrototypeSpecJson(specJson: string): ModifyResult<PrototypeSpecV1> {
  return parseBoundedJson(specJson, 'specJson', 'PrototypeSpec', parsePrototypeSpec)
}

function parseRecipeJson(recipeJson: string): ModifyResult<MotionRecipe> {
  return parseBoundedJson(recipeJson, 'recipeJson', 'Motion Recipe', parseMotionRecipe)
}

function parseRecipeInputJson(
  roleMappingJson: string,
  parametersJson: string | undefined
): ModifyResult<MotionRecipeInstantiationInput> {
  const parsedRoleMapping = parseBoundedJson(
    roleMappingJson,
    'roleMappingJson',
    'Motion Recipe role mapping',
    (value) => value
  )
  if (!parsedRoleMapping.ok) return parsedRoleMapping
  const parsedParameters =
    parametersJson === undefined
      ? ({ ok: true, data: undefined } as const)
      : parseBoundedJson(
          parametersJson,
          'parametersJson',
          'Motion Recipe parameters',
          (value) => value
        )
  if (!parsedParameters.ok) return parsedParameters
  const roleMapping = parsedRoleMapping.data
  const parameters = parsedParameters.data
  if (typeof roleMapping !== 'object' || roleMapping === null || Array.isArray(roleMapping)) {
    return fail('roleMappingJson must encode an object of role ids to node id arrays')
  }
  if (
    parameters !== undefined &&
    (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters))
  ) {
    return fail('parametersJson must encode an object of numeric parameter overrides')
  }
  return {
    ok: true,
    data: {
      roleMapping: roleMapping as Record<string, readonly string[]>,
      ...(parameters === undefined ? {} : { parameters: parameters as Record<string, number> })
    }
  }
}

function validateSceneTargets(
  figma: FigmaAPI,
  owner: SceneNode,
  scene: MotionSceneSpec
): ModifyResult<undefined> {
  if (owner.type !== 'CANVAS' && owner.type !== 'FRAME') {
    return fail('Motion scenes may only be attached to a page or frame')
  }
  for (const sequence of scene.sequences) {
    const seen = new Set<string>()
    for (const cue of sequence.cues) {
      if (cue.enabled === false) continue
      const target = figma.graph.getNode(cue.targetNodeId)
      if (!target || (target.id !== owner.id && !figma.graph.isDescendant(target.id, owner.id))) {
        return fail(
          `Motion scene cue ${cue.id} target must be the owner or one of its descendants: ${cue.targetNodeId}`
        )
      }
      if (!target.motion?.tracks.some((track) => track.id === cue.trackId)) {
        return fail(
          `Motion scene cue ${cue.id} references missing track ${cue.trackId} on ${target.id}`
        )
      }
      const key = `${target.id}\u0000${cue.trackId}`
      if (seen.has(key)) {
        return fail(
          `Motion scene sequence ${sequence.id} targets ${target.id}/${cue.trackId} more than once`
        )
      }
      seen.add(key)
    }
  }
  return { ok: true, data: undefined }
}

function isOwnerOrDescendant(figma: FigmaAPI, ownerId: string, nodeId: string): boolean {
  return nodeId === ownerId || figma.graph.isDescendant(nodeId, ownerId)
}

function driverSourceNodeIds(spec: MotionDriverSpecV1): string[] {
  const nodeIds: string[] = []
  for (const { source } of spec.drivers) {
    switch (source.kind) {
      case 'drag':
        nodeIds.push(source.handleNodeId)
        break
      case 'visibility':
        nodeIds.push(source.sourceNodeId)
        break
      case 'scroll':
      case 'pointer':
        if (source.sourceNodeId) nodeIds.push(source.sourceNodeId)
        break
    }
  }
  return nodeIds
}

function validateDriverTargets(
  figma: FigmaAPI,
  owner: SceneNode,
  spec: MotionDriverSpecV1
): ModifyResult<undefined> {
  if (owner.type !== 'CANVAS' && owner.type !== 'FRAME') {
    return fail('Motion drivers may only be attached to a page or frame')
  }
  const sourceIssues = inspectMotionDriverSourceBindings(figma.graph, owner, spec)
  if (sourceIssues.length > 0) return fail(sourceIssues.map(({ message }) => message).join('; '))
  for (const nodeId of driverSourceNodeIds(spec)) {
    if (!figma.graph.getNode(nodeId) || !isOwnerOrDescendant(figma, owner.id, nodeId)) {
      return fail(`Motion driver source must belong to the owner subtree: ${nodeId}`)
    }
  }
  for (const driver of spec.drivers) {
    const target = figma.graph.getNode(driver.target.targetNodeId)
    if (!target || !isOwnerOrDescendant(figma, owner.id, target.id)) {
      return fail(
        `Motion driver ${driver.id} target must belong to the owner subtree: ${driver.target.targetNodeId}`
      )
    }
    if (!target.motion?.tracks.some((track) => track.id === driver.target.trackId)) {
      return fail(
        `Motion driver ${driver.id} references missing track ${driver.target.trackId} on ${target.id}`
      )
    }
  }
  return { ok: true, data: undefined }
}

function validatePrototypeTargets(
  figma: FigmaAPI,
  owner: SceneNode,
  spec: PrototypeSpecV1
): ModifyResult<undefined> {
  if (
    spec.connections.some((connection) => connection.trigger.kind === 'click') &&
    (owner.events?.onClick?.length ?? 0) > 0
  ) {
    return fail(
      'Prototype click connections conflict with existing lowcode onClick actions; remove or remap one interaction explicitly'
    )
  }
  for (const connection of spec.connections) {
    const action = connection.action
    if (action.kind !== 'navigate' && action.kind !== 'openOverlay') continue
    const target = figma.graph.getNode(action.targetNodeId)
    if (!target) {
      return fail(`Prototype connection ${connection.id} target not found: ${action.targetNodeId}`)
    }
    if (target.type !== 'CANVAS' && target.type !== 'FRAME') {
      return fail(`Prototype connection ${connection.id} target must be a page or frame`)
    }
  }
  return { ok: true, data: undefined }
}

function updateContractField(
  figma: FigmaAPI,
  nodeId: string,
  changes: Partial<SceneNode>,
  label: string,
  ctx?: ToolCtx
): void {
  if (ctx?.editor) ctx.editor.updateNodeWithUndo(nodeId, changes, label)
  else figma.graph.updateNode(nodeId, changes)
}

function clearContractField(
  figma: FigmaAPI,
  nodeId: string,
  field: 'motionScene' | 'motionDrivers' | 'prototype' | 'transitionKey',
  label: string,
  ctx?: ToolCtx
): void {
  if (ctx?.editor) ctx.editor.updateNodeWithUndo(nodeId, { [field]: undefined }, label)
  else figma.graph.clearNodeFields(nodeId, [field])
}

function clearPresentContractField(
  figma: FigmaAPI,
  nodeId: string,
  field: 'motionScene' | 'motionDrivers',
  ownerKind: string,
  label: string,
  ctx?: ToolCtx
): ModifyResult<{ nodeId: string; cleared: boolean }> {
  const owner = figma.graph.getNode(nodeId)
  if (!owner) return fail(`${ownerKind} owner not found: ${nodeId}`)
  if (!owner[field]) return { ok: true, data: { nodeId, cleared: false } }
  clearContractField(figma, nodeId, field, label, ctx)
  return { ok: true, data: { nodeId, cleared: true } }
}

const staggerParams = {
  staggerMs: {
    type: 'number',
    description: 'Optional non-negative delay step between spatially sorted targets'
  },
  direction: {
    type: 'string',
    description: 'Optional stagger direction; requires staggerMs',
    enum: [...MOTION_STAGGER_DIRECTIONS]
  },
  rhythm: {
    type: 'string',
    description: 'Optional stagger rhythm; requires staggerMs',
    enum: [...MOTION_STAGGER_RHYTHMS]
  }
} satisfies Record<string, ParamDef>

function presetParameters(args: {
  durationMs?: number
  delayMs?: number
  distance?: number
  intensity?: number
}): MotionPresetParameters {
  const parameters: MotionPresetParameters = {}
  if (args.durationMs !== undefined) parameters.durationMs = args.durationMs
  if (args.delayMs !== undefined) parameters.delayMs = args.delayMs
  if (args.distance !== undefined) parameters.distance = args.distance
  if (args.intensity !== undefined) parameters.intensity = args.intensity
  return parameters
}

export const applyMotionPreset = defineTool({
  name: 'apply_motion_preset',
  mutates: true,
  description:
    'Apply one safe built-in MotionSpec preset to one or many nodes atomically. Supply nodeId, nodeIds, or both. Optional numeric parameters are validated by the selected preset; optional stagger settings sort targets by absolute y, x, then id. Unsupported input returns an error without changing any target. No JavaScript or CSS is accepted.',
  params: {
    nodeId: { type: 'string', description: 'Single Scene node id' },
    nodeIds: { type: 'string[]', description: 'Additional Scene node ids' },
    preset: {
      type: 'string',
      description: 'Built-in preset id from list_motion_presets',
      required: true,
      enum: [...MOTION_PRESET_IDS]
    },
    durationMs: { type: 'number', description: 'Optional duration override in milliseconds' },
    delayMs: { type: 'number', description: 'Optional delay override in milliseconds' },
    distance: { type: 'number', description: 'Optional translation-distance override' },
    intensity: { type: 'number', description: 'Optional scale/intensity override' },
    ...staggerParams
  },
  execute: (figma, args, ctx): ModifyResult<{ nodeIds: string[]; preset: string }> => {
    const targets = resolveTargetIds(figma, args)
    if (!targets.ok) return targets
    if (!isMotionPresetId(args.preset)) return fail(`Unknown motion preset: ${args.preset}`)

    let motion: MotionSpec
    try {
      motion = createMotionPreset(args.preset, presetParameters(args))
    } catch (error) {
      return fail(`Invalid motion preset parameters: ${validationError(error)}`)
    }
    const staggered = buildMotionTargets(figma, targets.data, motion, args)
    if (!staggered.ok) return staggered
    applyMotionToTargets(figma, staggered.data, 'AI: apply_motion_preset', ctx)
    return {
      ok: true,
      data: { nodeIds: staggered.data.map((target) => target.nodeId), preset: args.preset }
    }
  }
})

export const applyMotionSpec = defineTool({
  name: 'apply_motion_spec',
  mutates: true,
  description:
    'Apply one strictly validated MotionSpec v1/v2/v3 JSON value of at most 1 MiB to one or many nodes atomically. Optional stagger settings add bounded per-target delays after sorting targets by absolute y, x, then id. Instance targets retain an explicit motion override. No JavaScript or CSS is accepted.',
  params: {
    nodeId: { type: 'string', description: 'Single Scene node id' },
    nodeIds: { type: 'string[]', description: 'Additional Scene node ids' },
    specJson: {
      type: 'string',
      description: 'Strict JSON-encoded MotionSpec v1/v2/v3 object',
      required: true
    },
    ...staggerParams
  },
  execute: (figma, args, ctx): ModifyResult<{ nodeIds: string[]; trackCount: number }> => {
    const targets = resolveTargetIds(figma, args)
    if (!targets.ok) return targets
    const motion = parseSpecJson(args.specJson)
    if (!motion.ok) return motion
    for (const nodeId of targets.data) {
      const node = figma.graph.getNode(nodeId)
      if (!node) continue
      const compatible = validateMotionNodeCapabilities(node, motion.data)
      if (!compatible.ok) return compatible
    }
    const staggered = buildMotionTargets(figma, targets.data, motion.data, args)
    if (!staggered.ok) return staggered
    applyMotionToTargets(figma, staggered.data, 'AI: apply_motion_spec', ctx)
    return {
      ok: true,
      data: {
        nodeIds: staggered.data.map((target) => target.nodeId),
        trackCount: motion.data.tracks.length
      }
    }
  }
})

export const updateMotion = defineTool({
  name: 'update_motion',
  mutates: true,
  description:
    "Replace one node's MotionSpec with strictly validated JSON of at most 1 MiB. specJson must be a MotionSpec v1/v2/v3 object; unknown fields, future versions, arbitrary JavaScript, CSS, non-finite numbers, unsafe ids, and out-of-range values are rejected before mutation.",
  params: {
    nodeId: { type: 'string', description: 'Scene node id', required: true },
    specJson: {
      type: 'string',
      description: 'Strict JSON-encoded MotionSpec v1/v2/v3 object',
      required: true
    }
  },
  execute: (figma, args, ctx): ModifyResult<{ nodeId: string; trackCount: number }> => {
    const targets = resolveTargetIds(figma, { nodeId: args.nodeId })
    if (!targets.ok) return targets
    const motion = parseSpecJson(args.specJson)
    if (!motion.ok) return motion
    const node = figma.graph.getNode(args.nodeId)
    if (!node) return fail(`Node "${args.nodeId}" not found`)
    const compatible = validateMotionNodeCapabilities(node, motion.data)
    if (!compatible.ok) return compatible
    applyMotionToTargets(
      figma,
      [{ nodeId: args.nodeId, motion: motion.data }],
      'AI: update_motion',
      ctx
    )
    return { ok: true, data: { nodeId: args.nodeId, trackCount: motion.data.tracks.length } }
  }
})

export const clearMotion = defineTool({
  name: 'clear_motion',
  mutates: true,
  description:
    'Remove MotionSpec from one or many nodes atomically. Supply nodeId, nodeIds, or both. Missing targets are reported before any node changes.',
  params: {
    nodeId: { type: 'string', description: 'Single Scene node id' },
    nodeIds: { type: 'string[]', description: 'Additional Scene node ids' }
  },
  execute: (figma, args, ctx): ModifyResult<{ nodeIds: string[]; cleared: number }> => {
    const targets = resolveTargetIds(figma, args)
    if (!targets.ok) return targets
    const withMotion = targets.data.filter((nodeId) => figma.graph.getNode(nodeId)?.motion)
    if (withMotion.length > 0) {
      applyMotionToTargets(
        figma,
        withMotion.map((nodeId) => ({ nodeId, motion: undefined })),
        'AI: clear_motion',
        ctx
      )
    }
    return {
      ok: true,
      data: { nodeIds: targets.data, cleared: withMotion.length }
    }
  }
})

export const applyMotionRecipe = defineTool({
  name: 'apply_motion_recipe',
  mutates: true,
  description:
    'Expand one strictly validated parameterized Motion Recipe into complete node-local MotionSpec snapshots and apply every role assignment atomically. Role mapping is explicit; no runtime library dependency or arbitrary code is introduced.',
  params: {
    recipeJson: {
      type: 'string',
      description: 'Strict JSON-encoded openpencil-motion-recipe v1 object',
      required: true
    },
    roleMappingJson: {
      type: 'string',
      description: 'JSON object mapping every recipe role id to one or more Scene node ids',
      required: true
    },
    parametersJson: {
      type: 'string',
      description: 'Optional JSON object of bounded numeric parameter overrides'
    }
  },
  execute: (
    figma,
    { recipeJson, roleMappingJson, parametersJson },
    ctx
  ): ModifyResult<{ recipeId: string; nodeIds: string[]; assignmentCount: number }> => {
    const recipe = parseRecipeJson(recipeJson)
    if (!recipe.ok) return recipe
    const input = parseRecipeInputJson(roleMappingJson, parametersJson)
    if (!input.ok) return input
    let instantiated
    try {
      instantiated = instantiateMotionRecipe(recipe.data, input.data)
    } catch (error) {
      return fail(`Invalid Motion Recipe mapping or parameters: ${validationError(error)}`)
    }
    const nodeIds = instantiated.assignments.map(({ nodeId }) => nodeId)
    const missing = nodeIds.filter((nodeId) => !figma.graph.getNode(nodeId))
    if (missing.length > 0) {
      return fail(`Motion Recipe target node(s) not found: ${missing.join(', ')}`)
    }
    for (const { nodeId, motion } of instantiated.assignments) {
      const node = figma.graph.getNode(nodeId)
      if (!node) continue
      const compatible = validateMotionNodeCapabilities(node, motion)
      if (!compatible.ok) return compatible
    }
    applyMotionToTargets(
      figma,
      instantiated.assignments.map(({ nodeId, motion }) => ({ nodeId, motion })),
      'AI: apply_motion_recipe',
      ctx
    )
    return {
      ok: true,
      data: {
        recipeId: instantiated.recipeId,
        nodeIds,
        assignmentCount: instantiated.assignments.length
      }
    }
  }
})

export const updateMotionScene = defineTool({
  name: 'update_motion_scene',
  mutates: true,
  description:
    "Replace one page/frame's bounded MotionSceneSpec v1 atomically. Every enabled cue must reference a node in the owner subtree and an existing node-local track. Keyframes remain authoritative on target nodes; arbitrary JavaScript and CSS are rejected.",
  params: {
    nodeId: { type: 'string', description: 'Page or frame Scene node id', required: true },
    specJson: {
      type: 'string',
      description: 'Strict JSON-encoded MotionSceneSpec v1 object',
      required: true
    }
  },
  execute: (
    figma,
    { nodeId, specJson },
    ctx
  ): ModifyResult<{ nodeId: string; sequenceCount: number; cueCount: number }> => {
    const owner = figma.graph.getNode(nodeId)
    if (!owner) return fail(`Motion scene owner not found: ${nodeId}`)
    const parsed = parseSceneSpecJson(specJson)
    if (!parsed.ok) return parsed
    const targetValidation = validateSceneTargets(figma, owner, parsed.data)
    if (!targetValidation.ok) return targetValidation
    const scene = cloneMotionSceneSpec(parsed.data)
    if (ctx?.editor) {
      ctx.editor.updateNodeWithUndo(nodeId, { motionScene: scene }, 'AI: update_motion_scene')
    } else {
      figma.graph.updateNode(nodeId, { motionScene: scene })
    }
    return {
      ok: true,
      data: {
        nodeId,
        sequenceCount: scene.sequences.length,
        cueCount: scene.sequences.reduce((total, sequence) => total + sequence.cues.length, 0)
      }
    }
  }
})

export const clearMotionScene = defineTool({
  name: 'clear_motion_scene',
  mutates: true,
  description: 'Remove bounded scene choreography from one page or frame.',
  params: {
    nodeId: { type: 'string', description: 'Page or frame Scene node id', required: true }
  },
  execute: (figma, { nodeId }, ctx) =>
    clearPresentContractField(
      figma,
      nodeId,
      'motionScene',
      'Motion scene',
      'AI: clear_motion_scene',
      ctx
    )
})

export const updateMotionDrivers = defineTool({
  name: 'update_motion_drivers',
  mutates: true,
  description:
    "Replace one page/frame's bounded MotionDriverSpec v1. Every node source and target must belong to the owner subtree, every target track must exist, and variable sources must resolve before the atomic mutation.",
  params: {
    nodeId: { type: 'string', description: 'Page or frame Scene node id', required: true },
    specJson: {
      type: 'string',
      description: 'Strict JSON-encoded MotionDriverSpec v1 object',
      required: true
    }
  },
  execute: (
    figma,
    { nodeId, specJson },
    ctx
  ): ModifyResult<{ nodeId: string; driverCount: number }> => {
    const owner = figma.graph.getNode(nodeId)
    if (!owner) return fail(`Motion driver owner not found: ${nodeId}`)
    const parsed = parseDriverSpecJson(specJson)
    if (!parsed.ok) return parsed
    const targetValidation = validateDriverTargets(figma, owner, parsed.data)
    if (!targetValidation.ok) return targetValidation
    const spec = cloneMotionDriverSpec(parsed.data)
    updateContractField(figma, nodeId, { motionDrivers: spec }, 'AI: update_motion_drivers', ctx)
    return { ok: true, data: { nodeId, driverCount: spec.drivers.length } }
  }
})

export const clearMotionDrivers = defineTool({
  name: 'clear_motion_drivers',
  mutates: true,
  description: 'Remove bounded continuous Motion drivers from one page or frame.',
  params: {
    nodeId: { type: 'string', description: 'Page or frame Scene node id', required: true }
  },
  execute: (figma, { nodeId }, ctx) =>
    clearPresentContractField(
      figma,
      nodeId,
      'motionDrivers',
      'Motion driver',
      'AI: clear_motion_drivers',
      ctx
    )
})

export const updatePrototype = defineTool({
  name: 'update_prototype',
  mutates: true,
  description:
    "Replace one node's bounded OpenPencil PrototypeSpec v1. Destination pages/frames must exist. A click connection is rejected when the same source already has lowcode onClick actions, so routing precedence is never implicit.",
  params: {
    nodeId: { type: 'string', description: 'Prototype source node id', required: true },
    specJson: {
      type: 'string',
      description: 'Strict JSON-encoded PrototypeSpec v1 object',
      required: true
    }
  },
  execute: (
    figma,
    { nodeId, specJson },
    ctx
  ): ModifyResult<{ nodeId: string; connectionCount: number }> => {
    const owner = figma.graph.getNode(nodeId)
    if (!owner) return fail(`Prototype source not found: ${nodeId}`)
    const parsed = parsePrototypeSpecJson(specJson)
    if (!parsed.ok) return parsed
    const targetValidation = validatePrototypeTargets(figma, owner, parsed.data)
    if (!targetValidation.ok) return targetValidation
    const spec = clonePrototypeSpec(parsed.data)
    updateContractField(figma, nodeId, { prototype: spec }, 'AI: update_prototype', ctx)
    return { ok: true, data: { nodeId, connectionCount: spec.connections.length } }
  }
})

export const clearPrototype = defineTool({
  name: 'clear_prototype',
  mutates: true,
  description: 'Remove bounded OpenPencil Prototype connections from one source node.',
  params: {
    nodeId: { type: 'string', description: 'Prototype source node id', required: true }
  },
  execute: (figma, { nodeId }, ctx): ModifyResult<{ nodeId: string; cleared: boolean }> => {
    const owner = figma.graph.getNode(nodeId)
    if (!owner) return fail(`Prototype source not found: ${nodeId}`)
    if (!owner.prototype) return { ok: true, data: { nodeId, cleared: false } }
    clearContractField(figma, nodeId, 'prototype', 'AI: clear_prototype', ctx)
    return { ok: true, data: { nodeId, cleared: true } }
  }
})

export const setMotionTransitionKey = defineTool({
  name: 'set_motion_transition_key',
  mutates: true,
  description:
    'Set one explicit, stable OpenPencil Smart Match identity. Values are safe bounded identifiers; mutable node names are never used as a fallback.',
  params: {
    nodeId: { type: 'string', description: 'Scene node id', required: true },
    transitionKey: { type: 'string', description: 'Safe Smart Match identity', required: true }
  },
  execute: (
    figma,
    { nodeId, transitionKey },
    ctx
  ): ModifyResult<{ nodeId: string; transitionKey: MotionTransitionKey }> => {
    if (!figma.graph.getNode(nodeId)) return fail(`Scene node not found: ${nodeId}`)
    let parsed: MotionTransitionKey
    try {
      parsed = parseMotionTransitionKey(transitionKey)
    } catch (error) {
      return fail(`Invalid Motion transition key: ${validationError(error)}`)
    }
    updateContractField(
      figma,
      nodeId,
      { transitionKey: parsed },
      'AI: set_motion_transition_key',
      ctx
    )
    return { ok: true, data: { nodeId, transitionKey: parsed } }
  }
})

export const clearMotionTransitionKey = defineTool({
  name: 'clear_motion_transition_key',
  mutates: true,
  description: "Remove one node's explicit OpenPencil Smart Match identity.",
  params: {
    nodeId: { type: 'string', description: 'Scene node id', required: true }
  },
  execute: (figma, { nodeId }, ctx): ModifyResult<{ nodeId: string; cleared: boolean }> => {
    const node = figma.graph.getNode(nodeId)
    if (!node) return fail(`Scene node not found: ${nodeId}`)
    if (!node.transitionKey) return { ok: true, data: { nodeId, cleared: false } }
    clearContractField(figma, nodeId, 'transitionKey', 'AI: clear_motion_transition_key', ctx)
    return { ok: true, data: { nodeId, cleared: true } }
  }
})
