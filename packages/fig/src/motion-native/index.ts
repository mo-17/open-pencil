import {
  type MotionEasing,
  type MotionKeyframe,
  type MotionSpec,
  type MotionTrack,
  validateMotionSpec
} from '@open-pencil/scene-graph'

import { FIGMA_MOTION_API_REVISION } from './applicator'

export type FigmaNativeMotionFieldName =
  | 'OPACITY'
  | 'TRANSLATION_X'
  | 'TRANSLATION_Y'
  | 'ROTATION'
  | 'SCALE_X'
  | 'SCALE_Y'

export const FIGMA_MOTION_SHARED_NAMESPACE = 'openpencil'
export const FIGMA_MOTION_SHARED_KEY = 'motion-v1'

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
    | 'spec-version'
    | 'track-count'
    | 'trigger'
    | 'delay'
    | 'iterations'
    | 'direction'
    | 'fill'
    | 'exit'
    | 'duplicate-offset'
    | 'easing'
    | 'empty-channels'
  message: string
}

export interface FigmaNativeMotionWarning {
  code: 'reduced-motion-plugin-data' | 'preset-provenance-plugin-data'
  message: string
}

export interface FigmaNativeMotionPlan {
  version: 1
  apiRevision: typeof FIGMA_MOTION_API_REVISION
  /** True only when every authored behavior can be represented by the public Figma Motion API. */
  supported: boolean
  durationSeconds?: number
  /** Native timelines may be extended, but never shortened because the top-level frame owns them. */
  durationPolicy: 'grow-only'
  managedFields: Array<{ type: 'PROPERTY'; name: FigmaNativeMotionFieldName }>
  /** Canonical adapter payload used to recognize idempotent, OpenPencil-owned native writes. */
  sourceSignature?: string
  operations: FigmaNativeMotionOperation[]
  issues: FigmaNativeMotionIssue[]
  warnings: FigmaNativeMotionWarning[]
}

export interface FigmaNativeMotionOptions {
  /** Authored node opacity. MotionSpec opacity values are multipliers. */
  nodeOpacity?: number
}

export interface FigmaMotionSharedEnvelope {
  schema: 'openpencil.motion'
  version: 1
  motion: MotionSpec
}

export interface FigmaMotionSharedClearEnvelope {
  schema: 'openpencil.motion'
  version: 1
  cleared: true
}

export type FigmaMotionSharedPayload =
  | { kind: 'motion'; value: FigmaMotionSharedEnvelope }
  | { kind: 'cleared'; value: FigmaMotionSharedClearEnvelope }

export type FigmaMotionSharedEnvelopeResult =
  | { ok: true; value: FigmaMotionSharedEnvelope }
  | { ok: false; error: string }

export type FigmaMotionSharedPayloadResult =
  | { ok: true; value: FigmaMotionSharedPayload }
  | { ok: false; error: string }

/** Encode a cross-plugin MotionSpec mirror for Figma shared plugin data. */
export function encodeFigmaMotionSharedEnvelope(value: unknown): string {
  const validated = validateMotionSpec(value)
  if (!validated.success) {
    throw new Error(validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
  }
  return JSON.stringify({
    schema: 'openpencil.motion',
    version: 1,
    motion: validated.value
  } satisfies FigmaMotionSharedEnvelope)
}

/** Encode a shared marker that tells the Figma adapter not to apply stale Motion. */
export function encodeFigmaMotionSharedClearEnvelope(): string {
  return JSON.stringify({
    schema: 'openpencil.motion',
    version: 1,
    cleared: true
  } satisfies FigmaMotionSharedClearEnvelope)
}

/** Strictly decode either an actionable Motion mirror or an explicit clear marker. */
export function decodeFigmaMotionSharedPayload(raw: string): FigmaMotionSharedPayloadResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  if (!isPlainRecord(parsed)) return { ok: false, error: 'Expected an object envelope' }
  if (parsed.schema !== 'openpencil.motion' || parsed.version !== 1) {
    return { ok: false, error: 'Unsupported shared Motion envelope version' }
  }
  const keys = Object.keys(parsed).sort().join(',')
  if (keys === 'cleared,schema,version' && parsed.cleared === true) {
    return {
      ok: true,
      value: {
        kind: 'cleared',
        value: { schema: 'openpencil.motion', version: 1, cleared: true }
      }
    }
  }
  if (keys !== 'motion,schema,version') {
    return { ok: false, error: 'Unexpected shared Motion envelope fields' }
  }
  const validated = validateMotionSpec(parsed.motion)
  if (!validated.success) {
    return {
      ok: false,
      error: validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
    }
  }
  return {
    ok: true,
    value: {
      kind: 'motion',
      value: { schema: 'openpencil.motion', version: 1, motion: validated.value }
    }
  }
}

/** Strictly decode the shared mirror without accepting future or extra fields. */
export function decodeFigmaMotionSharedEnvelope(raw: string): FigmaMotionSharedEnvelopeResult {
  const decoded = decodeFigmaMotionSharedPayload(raw)
  return decoded.ok && decoded.value.kind === 'motion'
    ? { ok: true, value: decoded.value.value }
    : {
        ok: false,
        error: decoded.ok ? 'Shared Motion was explicitly cleared' : decoded.error
      }
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
      version: 1,
      apiRevision: FIGMA_MOTION_API_REVISION,
      supported: false,
      durationPolicy: 'grow-only',
      managedFields: [],
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
  if (spec.version !== 1) {
    issues.push({
      code: 'spec-version',
      message: 'Figma native export currently supports only MotionSpec v1 visual channels'
    })
  }
  if (spec.tracks.length !== 1) {
    issues.push({
      code: 'track-count',
      message: 'Figma native export currently requires exactly one Motion track'
    })
  }
  const track = spec.tracks[0]
  checkTrackCompatibility(track, issues)
  const durationSeconds = roundSeconds(track.timing.durationMs / 1_000)
  checkLoweredKeyframePositions(track, durationSeconds, issues)

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

  const managedFields = operations.map((operation) => ({ ...operation.field }))
  const sourceSignature = JSON.stringify({
    version: 1,
    apiRevision: FIGMA_MOTION_API_REVISION,
    durationSeconds,
    operations
  })
  return {
    version: 1,
    apiRevision: FIGMA_MOTION_API_REVISION,
    supported: true,
    durationSeconds,
    durationPolicy: 'grow-only',
    managedFields,
    sourceSignature,
    operations,
    issues,
    warnings
  }
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
  const easings = [track.timing.easing, ...track.keyframes.map((keyframe) => keyframe.easing)]
  if (easings.some((easing) => typeof easing === 'object' && easing.type !== 'cubicBezier')) {
    issues.push({
      code: 'easing',
      message: 'Figma native export supports only named and cubic-bezier easing'
    })
  }
}

function checkLoweredKeyframePositions(
  track: MotionTrack,
  durationSeconds: number,
  issues: FigmaNativeMotionIssue[]
): void {
  const positions = track.keyframes.map((keyframe) =>
    roundSeconds(keyframe.offset * durationSeconds)
  )
  if (positions.some((position, index) => index > 0 && position <= (positions[index - 1] ?? -1))) {
    issues.push({
      code: 'duplicate-offset',
      message: 'Figma native export cannot safely preserve keyframes that lower to the same time'
    })
  }
}

function unsupported(
  issues: FigmaNativeMotionIssue[],
  warnings: FigmaNativeMotionWarning[]
): FigmaNativeMotionPlan {
  return {
    version: 1,
    apiRevision: FIGMA_MOTION_API_REVISION,
    supported: false,
    durationPolicy: 'grow-only',
    managedFields: [],
    operations: [],
    issues,
    warnings
  }
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
    if (easing.type !== 'cubicBezier') {
      throw new Error(`Unsupported Figma native easing: ${easing.type}`)
    }
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

function assertNever(value: never): never {
  throw new Error(`Unsupported Motion easing: ${String(value)}`)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export { buildFigmaMotionPluginScript, type FigmaNativeMotionScriptOptions } from './script'
export {
  FIGMA_MOTION_API_REVISION,
  FIGMA_NATIVE_MOTION_APPLICATOR_SCHEMA,
  FIGMA_NATIVE_MOTION_FIELDS,
  FIGMA_NATIVE_MOTION_OWNERSHIP_KEY,
  FIGMA_NATIVE_MOTION_OWNERSHIP_NAMESPACE,
  applyFigmaNativeMotionTransaction,
  createFigmaNativeMotionApplyRequest,
  getFigmaNativeMotionTransactionSource,
  type FigmaNativeMotionApplyOptions,
  type FigmaNativeMotionApplyRequest,
  type FigmaNativeMotionConflictPolicy,
  type FigmaNativeMotionOwnershipRecord,
  type FigmaNativeMotionTransactionHost,
  type FigmaNativeMotionTransactionResult,
  type FigmaNativeMotionTransactionStatus,
  type FigmaNativeMotionTransactionTarget
} from './applicator'
export {
  diffFigmaNativeMotion,
  importFigmaNativeMotion,
  inspectFigmaNativeMotion,
  type FigmaNativeMotionDiagnostic,
  type FigmaNativeMotionDiagnosticCode,
  type FigmaNativeMotionDiagnosticSeverity,
  type FigmaNativeMotionDiff,
  type FigmaNativeMotionImportResult,
  type FigmaNativeMotionImportSource,
  type FigmaNativeMotionInspection,
  type FigmaNativeMotionOwnershipChange,
  type FigmaNativeMotionOwnershipStatus,
  type FigmaNativeMotionSharedMirrorStatus,
  type FigmaNativeMotionSnapshot,
  type FigmaNativeMotionTimelineChange,
  type FigmaNativeMotionTimelineGrowth,
  type FigmaNativeMotionTimelineInspection
} from './inspect'
