import {
  type MotionEasing,
  type MotionKeyframe,
  type MotionSpec,
  type MotionTrack,
  validateMotionSpec
} from '@open-pencil/scene-graph'

export type FigmaNativeMotionFieldName =
  | 'OPACITY'
  | 'TRANSLATION_X'
  | 'TRANSLATION_Y'
  | 'ROTATION'
  | 'SCALE_X'
  | 'SCALE_Y'

export interface FigmaNativeMotionEasing {
  type: 'LINEAR' | 'EASE_IN' | 'EASE_OUT' | 'EASE_IN_AND_OUT' | 'CUSTOM_CUBIC_BEZIER'
  easingFunctionCubicBezier?: {
    x1: number
    y1: number
    x2: number
    y2: number
  }
}

export interface FigmaNativeMotionKeyframe {
  timelinePosition: number
  value: { type: 'FLOAT'; value: number }
  easing?: FigmaNativeMotionEasing
}

export interface FigmaNativeMotionOperation {
  field: { type: 'PROPERTY'; name: FigmaNativeMotionFieldName }
  track: {
    baseValue: { type: 'FLOAT'; value: number }
    keyframes: FigmaNativeMotionKeyframe[]
  }
}

export interface FigmaNativeMotionIssue {
  code:
    | 'invalid-motion'
    | 'track-count'
    | 'trigger'
    | 'delay'
    | 'iterations'
    | 'direction'
    | 'fill'
    | 'exit'
    | 'empty-channels'
  message: string
}

export interface FigmaNativeMotionWarning {
  code: 'reduced-motion-plugin-data' | 'preset-provenance-plugin-data'
  message: string
}

export interface FigmaNativeMotionPlan {
  /** True only when every authored behavior can be represented by the public Figma Motion API. */
  supported: boolean
  durationSeconds?: number
  operations: FigmaNativeMotionOperation[]
  issues: FigmaNativeMotionIssue[]
  warnings: FigmaNativeMotionWarning[]
}

export interface FigmaNativeMotionOptions {
  /** Authored node opacity. MotionSpec opacity values are multipliers. */
  nodeOpacity?: number
}

interface MotionChannel {
  field: FigmaNativeMotionFieldName
  key: 'opacity' | 'x' | 'y' | 'rotate' | 'scaleX' | 'scaleY'
  baseValue: number
  defaultValue: number
}

const MOTION_CHANNELS: readonly Omit<MotionChannel, 'baseValue'>[] = [
  { field: 'OPACITY', key: 'opacity', defaultValue: 1 },
  { field: 'TRANSLATION_X', key: 'x', defaultValue: 0 },
  { field: 'TRANSLATION_Y', key: 'y', defaultValue: 0 },
  { field: 'ROTATION', key: 'rotate', defaultValue: 0 },
  { field: 'SCALE_X', key: 'scaleX', defaultValue: 1 },
  { field: 'SCALE_Y', key: 'scaleY', defaultValue: 1 }
]

/**
 * Lower the deliberately small MotionSpec v1 intersection supported by Figma's
 * public beta Motion Plugin API. Unsupported semantics stay in OpenPencil's
 * canonical pluginData and are never approximated silently.
 */
export function createFigmaNativeMotionPlan(
  value: unknown,
  options: FigmaNativeMotionOptions = {}
): FigmaNativeMotionPlan {
  const issues: FigmaNativeMotionIssue[] = []
  const warnings: FigmaNativeMotionWarning[] = []
  const validated = validateSafely(value)
  if (!validated.success) {
    return {
      supported: false,
      operations: [],
      issues: [
        {
          code: 'invalid-motion',
          message: validated.message
        }
      ],
      warnings
    }
  }

  const spec = validated.value
  if (spec.tracks.length !== 1) {
    issues.push({
      code: 'track-count',
      message: 'Figma native export currently requires exactly one Motion track'
    })
  }
  const track = spec.tracks[0]
  checkTrackCompatibility(track, issues)

  if (spec.reducedMotion !== undefined) {
    warnings.push({
      code: 'reduced-motion-plugin-data',
      message: 'Figma Motion has no reduced-motion policy field; OpenPencil keeps it in pluginData'
    })
  }
  if (spec.preset !== undefined) {
    warnings.push({
      code: 'preset-provenance-plugin-data',
      message: 'Preset provenance is OpenPencil metadata and is retained in pluginData'
    })
  }
  if (issues.length > 0) return unsupported(issues, warnings)

  const nodeOpacity = clampOpacity(options.nodeOpacity ?? 1)
  const durationSeconds = roundSeconds(track.timing.durationMs / 1_000)
  const operations = activeChannels(track, nodeOpacity).map((channel) =>
    operationForChannel(track, channel, durationSeconds, nodeOpacity)
  )
  if (operations.length === 0) {
    issues.push({
      code: 'empty-channels',
      message: 'The Motion track does not animate a Figma-native property'
    })
    return unsupported(issues, warnings)
  }

  return { supported: true, durationSeconds, operations, issues, warnings }
}

/**
 * Generate a copyable Figma Plugin API script for the selected node (or a
 * stable node id). The script intentionally uses only the official beta APIs:
 * manual keyframe track apply/remove, animation style removal, timelines, and
 * setTimelineDuration().
 */
export function buildFigmaMotionPluginScript(
  plan: FigmaNativeMotionPlan,
  options: { nodeId?: string } = {}
): string {
  if (!plan.supported || plan.durationSeconds === undefined) {
    throw new Error('Cannot build a Figma Motion script for an unsupported plan')
  }
  const nodeLookup = options.nodeId
    ? `const node = await figma.getNodeByIdAsync(${JSON.stringify(options.nodeId)})`
    : `const selection = figma.currentPage.selection
if (selection.length !== 1) {
  throw new Error('Select exactly one target node before applying Motion')
}
const node = selection[0]`
  const operations = JSON.stringify(plan.operations, null, 2)
  const supportedFields = JSON.stringify(
    MOTION_CHANNELS.map(({ field }) => ({ type: 'PROPERTY', name: field })),
    null,
    2
  )
  return `;(async () => {
${indent(nodeLookup, 2)}
  if (!node) throw new Error('The target node was not found')
  if (typeof node.applyManualKeyframeTrack !== 'function') {
    throw new Error('The selected node does not support the Figma Motion API')
  }
  if (typeof node.removeManualKeyframeTrack !== 'function') {
    throw new Error('The selected node cannot replace existing Figma Motion tracks safely')
  }
  if (typeof node.setTimelineDuration !== 'function') {
    throw new Error('The selected node does not support Figma Motion timelines')
  }
  const animationStyles = Array.isArray(node.animationStyles) ? [...node.animationStyles] : []
  if (animationStyles.length > 0 && typeof node.removeAnimationStyle !== 'function') {
    throw new Error('The selected node cannot remove conflicting Figma Motion styles safely')
  }
  const supportedFields = ${indent(supportedFields, 2).trimStart()}
  // Applied animation styles do not expose a documented per-style field map.
  // Remove them before installing the canonical OpenPencil manual tracks.
  for (const animationStyle of animationStyles) {
    node.removeAnimationStyle(animationStyle.id)
  }
  for (const field of supportedFields) {
    node.removeManualKeyframeTrack(field)
  }
  const operations = ${indent(operations, 2).trimStart()}
  for (const operation of operations) {
    node.applyManualKeyframeTrack(operation.field, operation.track)
  }
  const timeline = Array.isArray(node.timelines) ? node.timelines[0] : undefined
  if (timeline && timeline.duration < ${plan.durationSeconds}) {
    node.setTimelineDuration(timeline.id, ${plan.durationSeconds})
  }
  return { mutatedNodeIds: [node.id], timelineId: timeline?.id ?? null }
})()
`
}

function validateSafely(
  value: unknown
): { success: true; value: MotionSpec } | { success: false; message: string } {
  try {
    const result = validateMotionSpec(value)
    return result.success
      ? result
      : {
          success: false,
          message: result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
        }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) }
  }
}

function checkTrackCompatibility(track: MotionTrack, issues: FigmaNativeMotionIssue[]): void {
  if (track.trigger !== 'mount') {
    issues.push({
      code: 'trigger',
      message: `Figma native export cannot preserve the ${track.trigger} trigger; only mount is supported`
    })
  }
  if ((track.timing.delayMs ?? 0) !== 0) {
    issues.push({
      code: 'delay',
      message: 'Figma native export does not yet map MotionSpec delay semantics'
    })
  }
  if ((track.timing.iterations ?? 1) !== 1) {
    issues.push({
      code: 'iterations',
      message: 'Figma native export does not expose a verified finite/loop playback setter'
    })
  }
  if ((track.timing.direction ?? 'normal') !== 'normal') {
    issues.push({
      code: 'direction',
      message: 'Figma native export currently supports only normal playback direction'
    })
  }
  const fill = track.timing.fill ?? 'both'
  if (fill !== 'both') {
    issues.push({
      code: 'fill',
      message: 'Figma native export currently supports only fill="both"'
    })
  }
  if (track.exit !== undefined && track.exit !== 'none') {
    issues.push({
      code: 'exit',
      message: `Figma native export cannot preserve exit="${track.exit}"`
    })
  }
}

function unsupported(
  issues: FigmaNativeMotionIssue[],
  warnings: FigmaNativeMotionWarning[]
): FigmaNativeMotionPlan {
  return { supported: false, operations: [], issues, warnings }
}

function activeChannels(track: MotionTrack, nodeOpacity: number): MotionChannel[] {
  return MOTION_CHANNELS.flatMap((channel) => {
    const active = track.keyframes.some((keyframe) => keyframe[channel.key] !== undefined)
    if (!active) return []
    const baseValue = channel.key === 'opacity' ? nodeOpacity : channel.defaultValue
    return [{ ...channel, baseValue }]
  })
}

function operationForChannel(
  track: MotionTrack,
  channel: MotionChannel,
  durationSeconds: number,
  nodeOpacity: number
): FigmaNativeMotionOperation {
  return {
    field: { type: 'PROPERTY', name: channel.field },
    track: {
      baseValue: { type: 'FLOAT', value: channel.baseValue },
      keyframes: track.keyframes.map((keyframe, index) => ({
        timelinePosition: roundSeconds(keyframe.offset * durationSeconds),
        value: {
          type: 'FLOAT',
          value: channelValue(keyframe, channel, nodeOpacity)
        },
        ...(index === 0
          ? {}
          : {
              // Figma stores easing on the arriving keyframe. MotionSpec/WAAPI
              // stores segment easing on the departing keyframe, so shift it.
              easing: figmaEasing(
                track.keyframes[index - 1]?.easing ?? track.timing.easing ?? 'ease'
              )
            })
      }))
    }
  }
}

function channelValue(
  keyframe: MotionKeyframe,
  channel: MotionChannel,
  nodeOpacity: number
): number {
  const value = keyframe[channel.key] ?? channel.defaultValue
  return channel.key === 'opacity' ? clampOpacity(nodeOpacity * value) : value
}

function figmaEasing(easing: MotionEasing): FigmaNativeMotionEasing {
  if (typeof easing === 'object') {
    return {
      type: 'CUSTOM_CUBIC_BEZIER',
      easingFunctionCubicBezier: {
        x1: easing.x1,
        y1: easing.y1,
        x2: easing.x2,
        y2: easing.y2
      }
    }
  }
  switch (easing) {
    case 'linear':
      return { type: 'LINEAR' }
    case 'ease-in':
      return { type: 'EASE_IN' }
    case 'ease-out':
      return { type: 'EASE_OUT' }
    case 'ease-in-out':
      return { type: 'EASE_IN_AND_OUT' }
    case 'ease':
      return {
        type: 'CUSTOM_CUBIC_BEZIER',
        easingFunctionCubicBezier: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 }
      }
  }
  return assertNever(easing)
}

function clampOpacity(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1))
}

function roundSeconds(value: number): number {
  return Number(value.toFixed(6))
}

function indent(value: string, spaces: number): string {
  const prefix = ' '.repeat(spaces)
  return value
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n')
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Motion easing: ${String(value)}`)
}
