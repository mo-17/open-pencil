import {
  cloneMotionDriverSpec,
  cloneMotionSceneSpec,
  cloneMotionSpec,
  clonePrototypeSpec,
  MOTION_PRESET_IDS,
  MOTION_PRESET_REGISTRY,
  type MotionDriverSpecV1,
  type MotionPresetDefinition,
  type MotionSceneSpec,
  type MotionSpec,
  type MotionTransitionKey,
  type PrototypeSpecV1
} from '@open-pencil/scene-graph'

import {
  inspectMotionAdvancedChannels,
  motionAdvancedChannelTemplates,
  type MotionAdvancedCapabilityIssue,
  type MotionAdvancedChannelTemplate
} from '#core/motion'
import { defineTool } from '#core/tools/schema'

export interface MotionSummary {
  version: MotionSpec['version']
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
  advanced: {
    templates: MotionAdvancedChannelTemplate[]
    diagnostics: Array<MotionAdvancedCapabilityIssue & { trackId: string; keyframeIndex: number }>
  }
}

export interface MotionSceneRead {
  id: string
  name: string
  type: string
  scene: MotionSceneSpec | null
  sequenceCount: number
  cueCount: number
}

export interface MotionDriversRead {
  id: string
  name: string
  type: string
  spec: MotionDriverSpecV1 | null
  driverCount: number
}

export interface PrototypeRead {
  id: string
  name: string
  type: string
  spec: PrototypeSpecV1 | null
  connectionCount: number
}

export interface MotionTransitionKeyRead {
  id: string
  name: string
  type: string
  transitionKey: MotionTransitionKey | null
}

type ReadResult<T> = { ok: true; data: T } | { ok: false; error: string }

export function summarizeMotion(spec: MotionSpec): MotionSummary {
  const summary: MotionSummary = {
    version: spec.version,
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
    category: definition.category,
    keywords: [...definition.keywords],
    parameters: Object.fromEntries(
      Object.entries(definition.parameters).map(([name, parameter]) => [name, { ...parameter }])
    )
  }
}

export const readMotion = defineTool({
  name: 'read_motion',
  description:
    "Read one node's declarative MotionSpec v1/v2/v3. Returns the compact summary, complete bounded spec, node-derived v3 structured-channel templates, and node-aware diagnostics. Templates come from the same validator used by Canvas and compiler projection. MotionSpec contains JSON data only and never arbitrary JavaScript or CSS.",
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
        spec,
        advanced: {
          templates: motionAdvancedChannelTemplates(node),
          diagnostics: (spec?.tracks ?? []).flatMap((track) =>
            track.keyframes.flatMap((keyframe, keyframeIndex) =>
              inspectMotionAdvancedChannels(node, keyframe).map((diagnostic) => ({
                ...diagnostic,
                trackId: track.id,
                keyframeIndex
              }))
            )
          )
        }
      }
    }
  }
})

export const readMotionScene = defineTool({
  name: 'read_motion_scene',
  description:
    "Read one page/frame's bounded MotionSceneSpec choreography. The scene references node-local track ids and never duplicates keyframes. Returns null when no scene timeline is configured.",
  params: {
    nodeId: { type: 'string', description: 'Page or frame Scene node id', required: true }
  },
  execute: (figma, { nodeId }): ReadResult<MotionSceneRead> => {
    const node = figma.graph.getNode(nodeId)
    if (!node) return { ok: false, error: `Node "${nodeId}" not found` }
    const scene = node.motionScene ? cloneMotionSceneSpec(node.motionScene) : null
    return {
      ok: true,
      data: {
        id: node.id,
        name: node.name,
        type: node.type,
        scene,
        sequenceCount: scene?.sequences.length ?? 0,
        cueCount: scene?.sequences.reduce((total, sequence) => total + sequence.cues.length, 0) ?? 0
      }
    }
  }
})

export const readMotionDrivers = defineTool({
  name: 'read_motion_drivers',
  description:
    "Read one page/frame's bounded continuous MotionDriverSpec. Drivers map scroll, pointer, drag, visibility, state, or variable inputs to descendant node-local tracks without mutating authored node properties.",
  params: {
    nodeId: { type: 'string', description: 'Page or frame Scene node id', required: true }
  },
  execute: (figma, { nodeId }): ReadResult<MotionDriversRead> => {
    const node = figma.graph.getNode(nodeId)
    if (!node) return { ok: false, error: `Node "${nodeId}" not found` }
    const spec = node.motionDrivers ? cloneMotionDriverSpec(node.motionDrivers) : null
    return {
      ok: true,
      data: {
        id: node.id,
        name: node.name,
        type: node.type,
        spec,
        driverCount: spec?.drivers.length ?? 0
      }
    }
  }
})

export const readPrototype = defineTool({
  name: 'read_prototype',
  description:
    "Read one node's bounded OpenPencil Prototype connections, including navigation, back, overlays, after-delay, interruption, reverse playback, and Smart Match transition choices.",
  params: {
    nodeId: { type: 'string', description: 'Prototype source node id', required: true }
  },
  execute: (figma, { nodeId }): ReadResult<PrototypeRead> => {
    const node = figma.graph.getNode(nodeId)
    if (!node) return { ok: false, error: `Node "${nodeId}" not found` }
    const spec = node.prototype ? clonePrototypeSpec(node.prototype) : null
    return {
      ok: true,
      data: {
        id: node.id,
        name: node.name,
        type: node.type,
        spec,
        connectionCount: spec?.connections.length ?? 0
      }
    }
  }
})

export const readMotionTransitionKey = defineTool({
  name: 'read_motion_transition_key',
  description:
    "Read a node's explicit OpenPencil Smart Match identity. Matching never falls back to mutable node names.",
  params: {
    nodeId: { type: 'string', description: 'Scene node id', required: true }
  },
  execute: (figma, { nodeId }): ReadResult<MotionTransitionKeyRead> => {
    const node = figma.graph.getNode(nodeId)
    if (!node) return { ok: false, error: `Node "${nodeId}" not found` }
    return {
      ok: true,
      data: {
        id: node.id,
        name: node.name,
        type: node.type,
        transitionKey: node.transitionKey ?? null
      }
    }
  }
})

export const listMotionPresets = defineTool({
  name: 'list_motion_presets',
  description:
    'List every safe built-in MotionSpec preset with its category, search keywords, and supported numeric parameters, defaults, and bounds. Use a returned id with apply_motion_preset.',
  params: {},
  execute: (): ReadResult<MotionPresetDefinition[]> => ({
    ok: true,
    data: MOTION_PRESET_IDS.map((id) => clonePresetDefinition(MOTION_PRESET_REGISTRY[id]))
  })
})
