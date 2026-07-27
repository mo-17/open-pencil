import {
  cloneMotionSpec,
  MOTION_PRESET_IDS,
  MOTION_PRESET_REGISTRY,
  type MotionPresetDefinition,
  type MotionSpec
} from '@open-pencil/scene-graph'

import { defineTool } from '#core/tools/schema'

export interface MotionSummary {
  version: 1
  trackCount: number
  keyframeCount: number
  triggers: string[]
  reducedMotion?: MotionSpec['reducedMotion']
  preset?: string
}

export interface MotionRead {
  id: string
  name: string
  type: string
  summary: MotionSummary | null
  spec: MotionSpec | null
}

type ReadResult<T> = { ok: true; data: T } | { ok: false; error: string }

export function summarizeMotion(spec: MotionSpec): MotionSummary {
  const summary: MotionSummary = {
    version: 1,
    trackCount: spec.tracks.length,
    keyframeCount: spec.tracks.reduce((total, track) => total + track.keyframes.length, 0),
    triggers: [...new Set(spec.tracks.map((track) => track.trigger))]
  }
  if (spec.reducedMotion !== undefined) summary.reducedMotion = spec.reducedMotion
  if (spec.preset?.id) summary.preset = spec.preset.id
  return summary
}

function clonePresetDefinition(definition: MotionPresetDefinition): MotionPresetDefinition {
  return {
    id: definition.id,
    version: definition.version,
    parameters: Object.fromEntries(
      Object.entries(definition.parameters).map(([name, parameter]) => [name, { ...parameter }])
    )
  }
}

export const readMotion = defineTool({
  name: 'read_motion',
  description:
    "Read one node's declarative MotionSpec v1. Returns both a compact summary and the complete bounded spec; returns null for both when no motion is configured. MotionSpec contains JSON data only and never arbitrary JavaScript or CSS.",
  params: {
    nodeId: { type: 'string', description: 'Scene node id', required: true }
  },
  execute: (figma, { nodeId }): ReadResult<MotionRead> => {
    const node = figma.graph.getNode(nodeId)
    if (!node) return { ok: false, error: `Node "${nodeId}" not found` }
    const spec = node.motion ? cloneMotionSpec(node.motion) : null
    return {
      ok: true,
      data: {
        id: node.id,
        name: node.name,
        type: node.type,
        summary: spec ? summarizeMotion(spec) : null,
        spec
      }
    }
  }
})

export const listMotionPresets = defineTool({
  name: 'list_motion_presets',
  description:
    'List every safe built-in MotionSpec preset and its supported numeric parameters, defaults, and bounds. Use a returned id with apply_motion_preset.',
  params: {},
  execute: (): ReadResult<MotionPresetDefinition[]> => ({
    ok: true,
    data: MOTION_PRESET_IDS.map((id) => clonePresetDefinition(MOTION_PRESET_REGISTRY[id]))
  })
})
