import {
  cloneMotionSpec,
  createMotionPreset,
  isMotionPresetId,
  MOTION_PRESET_IDS,
  MotionValidationError,
  parseMotionSpec,
  type MotionPresetParameters,
  type MotionSpec
} from '@open-pencil/scene-graph'

import type { FigmaAPI } from '#core/figma-api'
import { defineTool, type ToolCtx } from '#core/tools/schema'

type ModifyResult<T> = { ok: true; data: T } | { ok: false; error: string }

interface TargetArgs {
  nodeId?: string
  nodeIds?: string[]
}

function fail<T = never>(error: string): ModifyResult<T> {
  return { ok: false, error }
}

function validationError(error: unknown): string {
  if (error instanceof MotionValidationError) return error.message
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

function applyMotionToTargets(
  figma: FigmaAPI,
  nodeIds: string[],
  motion: MotionSpec | undefined,
  label: string,
  ctx?: ToolCtx
): void {
  const editor = ctx?.editor
  if (editor) {
    const apply = () => {
      for (const nodeId of nodeIds) {
        const nextMotion = motion ? cloneMotionSpec(motion) : undefined
        editor.updateNodeWithUndo(nodeId, { motion: nextMotion }, label)
      }
    }
    if (nodeIds.length > 1) editor.undo.runBatch(label, apply)
    else apply()
    return
  }

  for (const nodeId of nodeIds) {
    if (motion) figma.graph.updateNode(nodeId, { motion: cloneMotionSpec(motion) })
    else figma.graph.clearNodeFields(nodeId, ['motion'])
  }
}

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
    'Apply one safe built-in MotionSpec preset to one or many nodes atomically. Supply nodeId, nodeIds, or both. Optional numeric parameters are validated by the selected preset; unsupported parameters return an error without changing any target. No JavaScript or CSS is accepted.',
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
    intensity: { type: 'number', description: 'Optional scale/intensity override' }
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
    applyMotionToTargets(figma, targets.data, motion, 'AI: apply_motion_preset', ctx)
    return { ok: true, data: { nodeIds: targets.data, preset: args.preset } }
  }
})

export const updateMotion = defineTool({
  name: 'update_motion',
  mutates: true,
  description:
    "Replace one node's MotionSpec with strictly validated JSON. specJson must be a MotionSpec v1 object; unknown fields, future versions, arbitrary JavaScript, CSS, non-finite numbers, unsafe ids, and out-of-range values are rejected before mutation.",
  params: {
    nodeId: { type: 'string', description: 'Scene node id', required: true },
    specJson: {
      type: 'string',
      description: 'Strict JSON-encoded MotionSpec v1 object',
      required: true
    }
  },
  execute: (figma, args, ctx): ModifyResult<{ nodeId: string; trackCount: number }> => {
    const targets = resolveTargetIds(figma, { nodeId: args.nodeId })
    if (!targets.ok) return targets
    let parsed: unknown
    try {
      parsed = JSON.parse(args.specJson)
    } catch (error) {
      return fail(`specJson must be valid JSON: ${validationError(error)}`)
    }
    let motion: MotionSpec
    try {
      motion = parseMotionSpec(parsed)
    } catch (error) {
      return fail(`Invalid MotionSpec: ${validationError(error)}`)
    }
    applyMotionToTargets(figma, targets.data, motion, 'AI: update_motion', ctx)
    return { ok: true, data: { nodeId: args.nodeId, trackCount: motion.tracks.length } }
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
      applyMotionToTargets(figma, withMotion, undefined, 'AI: clear_motion', ctx)
    }
    return {
      ok: true,
      data: { nodeIds: targets.data, cleared: withMotion.length }
    }
  }
})
