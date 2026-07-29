/* oxlint-disable eslint/max-lines -- The bounded native codec stays cohesive so inspection, import, ownership verification, and diff share one fail-closed schema. */
import {
  type MotionEasing,
  type MotionKeyframe,
  type MotionSpec,
  validateMotionSpec
} from '@open-pencil/scene-graph'

import {
  FIGMA_MOTION_API_REVISION,
  FIGMA_NATIVE_MOTION_FIELDS,
  createFigmaNativeMotionApplyRequest,
  type FigmaNativeMotionOwnershipRecord
} from './applicator'
import type {
  FigmaNativeMotionEasing,
  FigmaNativeMotionFieldName,
  FigmaNativeMotionOperation,
  FigmaNativeMotionPlan
} from './index'

const EPSILON = 0.000001
const MAX_RAW_DATA_LENGTH = 100_000
const MAX_TIMELINES = 1
const MAX_ANIMATION_STYLES = 64
const MAX_TRACK_FIELDS = 32
const MAX_KEYFRAMES = 32
const MAX_DURATION_SECONDS = 120
const MAX_RUNTIME_ID_LENGTH = 256
const INDEXED_TRACK_COLLECTIONS = ['fills', 'strokes', 'effects'] as const

const OFFICIAL_PROPERTY_FIELDS = new Set([
  'CORNER_RADIUS',
  'STROKE_WEIGHT',
  'STACK_SPACING',
  'STACK_PADDING_LEFT',
  'STACK_PADDING_TOP',
  'STACK_PADDING_RIGHT',
  'STACK_PADDING_BOTTOM',
  'WIDTH',
  'HEIGHT',
  'RECTANGLE_TOP_LEFT_CORNER_RADIUS',
  'RECTANGLE_TOP_RIGHT_CORNER_RADIUS',
  'RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS',
  'RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS',
  'BORDER_TOP_WEIGHT',
  'BORDER_BOTTOM_WEIGHT',
  'BORDER_LEFT_WEIGHT',
  'BORDER_RIGHT_WEIGHT',
  'STACK_COUNTER_SPACING',
  'OPACITY',
  'GRID_ROW_GAP',
  'GRID_COLUMN_GAP',
  'TRANSLATION_X',
  'TRANSLATION_Y',
  'TRANSLATION_XY',
  'ROTATION',
  'SCALE_X',
  'SCALE_Y',
  'SCALE_XY',
  'PATH_TRIM_START',
  'PATH_TRIM_END'
])

export interface FigmaNativeMotionSnapshot {
  /** Raw official Figma Motion style bindings from MotionNodeMixin.animationStyles. */
  animationStyles: unknown
  /** Raw official Figma Motion tracks from MotionNodeMixin.manualKeyframeTracks. */
  manualKeyframeTracks: unknown
  /** Raw official Figma timelines from MotionNodeMixin.timelines. */
  timelines: unknown
  /** Raw openpencil/nativeMotionAdapterV1 shared plugin data, or an empty string. */
  ownershipRaw: string
  /** Raw openpencil/motion-v1 shared plugin data, or an empty string. */
  sharedMotionRaw: string
}

export type FigmaNativeMotionDiagnosticSeverity = 'warning' | 'error'

export type FigmaNativeMotionDiagnosticCode =
  | 'invalid-snapshot'
  | 'invalid-shared-mirror'
  | 'shared-mirror-cleared'
  | 'native-state-ignored'
  | 'invalid-ownership'
  | 'owned-native-edited'
  | 'animation-styles'
  | 'indexed-track'
  | 'unsupported-property'
  | 'unknown-property'
  | 'ambiguous-timeline'
  | 'invalid-timeline'
  | 'missing-timeline'
  | 'invalid-track'
  | 'inconsistent-keyframes'
  | 'inconsistent-easing'
  | 'unsupported-base-value'
  | 'opacity-base-zero'
  | 'defaulted-semantics'
  | 'timeline-slack'
  | 'foreign-native'
  | 'invalid-desired-motion'
  | 'timeline-preserved'

export interface FigmaNativeMotionDiagnostic {
  severity: FigmaNativeMotionDiagnosticSeverity
  code: FigmaNativeMotionDiagnosticCode
  message: string
  path?: string
}

export type FigmaNativeMotionImportSource =
  | 'shared-mirror'
  | 'owned-native'
  | 'foreign-native'
  | 'none'

export type FigmaNativeMotionSharedMirrorStatus = 'none' | 'motion' | 'cleared' | 'invalid'
export type FigmaNativeMotionOwnershipStatus = 'none' | 'valid' | 'invalid' | 'edited'

export interface FigmaNativeMotionTimelineInspection {
  id: string
  durationSeconds: number
}

export interface FigmaNativeMotionInspection {
  version: 1
  supported: boolean
  source: FigmaNativeMotionImportSource
  sharedMirror: FigmaNativeMotionSharedMirrorStatus
  ownership: FigmaNativeMotionOwnershipStatus
  fields: FigmaNativeMotionFieldName[]
  operations: FigmaNativeMotionOperation[]
  timeline: FigmaNativeMotionTimelineInspection | null
  /** Authored opacity recovered from an OPACITY binding base value, when available. */
  nodeOpacity: number | null
  diagnostics: FigmaNativeMotionDiagnostic[]
}

export interface FigmaNativeMotionImportResult extends FigmaNativeMotionInspection {
  motion: MotionSpec | null
}

export type FigmaNativeMotionOwnershipChange = 'none' | 'create' | 'update' | 'remove'
export type FigmaNativeMotionTimelineChange = 'none' | 'create' | 'grow'

export interface FigmaNativeMotionTimelineGrowth {
  change: FigmaNativeMotionTimelineChange
  currentDurationSeconds: number | null
  targetDurationSeconds: number | null
  deltaSeconds: number
}

export interface FigmaNativeMotionDiff {
  version: 1
  /** This API never mutates Figma state. */
  compareOnly: true
  supported: boolean
  addFields: FigmaNativeMotionFieldName[]
  updateFields: FigmaNativeMotionFieldName[]
  removeFields: FigmaNativeMotionFieldName[]
  timelineGrowth: FigmaNativeMotionTimelineGrowth
  ownershipChange: FigmaNativeMotionOwnershipChange
  diagnostics: FigmaNativeMotionDiagnostic[]
}

interface DecodedSnapshot {
  animationStyles: unknown[]
  manualKeyframeTracks: Record<string, unknown>
  timelines: unknown[]
  ownershipRaw: string
  sharedMotionRaw: string
}

interface NativeState {
  supported: boolean
  operations: FigmaNativeMotionOperation[]
  timeline: FigmaNativeMotionTimelineInspection | null
  diagnostics: FigmaNativeMotionDiagnostic[]
}

type SharedMirrorState =
  | { status: 'none' }
  | { status: 'motion'; motion: MotionSpec }
  | { status: 'cleared' }
  | { status: 'invalid'; diagnostic: FigmaNativeMotionDiagnostic }

type OwnershipState =
  | { status: 'none' }
  | { status: 'valid'; record: FigmaNativeMotionOwnershipRecord }
  | { status: 'invalid'; diagnostic: FigmaNativeMotionDiagnostic }

interface SnapshotAnalysis {
  inspection: FigmaNativeMotionInspection
  motion: MotionSpec | null
  native: NativeState
  shared: SharedMirrorState
  ownershipState: OwnershipState
}

/**
 * Inspect a detached, plain-data Figma Motion snapshot.
 *
 * The function is intentionally read-only and bounded. It does not accept live
 * Figma nodes, invoke Plugin API methods, or mutate the supplied values.
 */
export function inspectFigmaNativeMotion(value: unknown): FigmaNativeMotionInspection {
  return analyzeSnapshot(value).inspection
}

/**
 * Recover a canonical MotionSpec from detached Figma Motion data.
 *
 * A valid OpenPencil shared mirror wins and is returned losslessly. Without a
 * mirror, only the verified FLOAT-property intersection is imported and every
 * semantic default or loss is reported.
 */
export function importFigmaNativeMotion(value: unknown): FigmaNativeMotionImportResult {
  const analysis = analyzeSnapshot(value)
  return {
    ...analysis.inspection,
    motion: analysis.motion
  }
}

/**
 * Compare native readback with a validated outbound plan without mutating it.
 *
 * Passing null describes a clear operation. The diff reports only the native
 * field, grow-only timeline, and ownership changes that the current applicator
 * can reason about safely.
 */
// oxlint-disable-next-line eslint/complexity -- The public diff keeps validation, ownership, field, and grow-only timeline outcomes in one deterministic result.
export function diffFigmaNativeMotion(
  value: unknown,
  desiredPlan: FigmaNativeMotionPlan | null
): FigmaNativeMotionDiff {
  const analysis = analyzeSnapshot(value)
  const currentDuration = analysis.native.timeline?.durationSeconds ?? null
  const unsupported = (diagnostics: FigmaNativeMotionDiagnostic[]): FigmaNativeMotionDiff => ({
    version: 1,
    compareOnly: true,
    supported: false,
    addFields: [],
    updateFields: [],
    removeFields: [],
    timelineGrowth: {
      change: 'none',
      currentDurationSeconds: currentDuration,
      targetDurationSeconds: null,
      deltaSeconds: 0
    },
    ownershipChange: 'none',
    diagnostics
  })

  const diagnostics = diffInputDiagnostics(analysis)
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return unsupported(diagnostics)
  }

  let desiredOwnership: FigmaNativeMotionOwnershipRecord | null = null
  if (desiredPlan !== null) {
    try {
      desiredOwnership = createFigmaNativeMotionApplyRequest(desiredPlan).ownership
    } catch (error) {
      diagnostics.push(
        diagnostic(
          'error',
          'invalid-desired-motion',
          'Desired native Motion plan is unsupported or malformed: ' + messageOf(error)
        )
      )
      return unsupported(diagnostics)
    }
  }

  const currentByField = operationMap(analysis.native.operations)
  const desiredByField = operationMap(desiredOwnership?.operations ?? [])
  const addFields: FigmaNativeMotionFieldName[] = []
  const updateFields: FigmaNativeMotionFieldName[] = []
  const removeFields: FigmaNativeMotionFieldName[] = []
  for (const field of FIGMA_NATIVE_MOTION_FIELDS) {
    const current = currentByField.get(field)
    const desired = desiredByField.get(field)
    if (!current && desired) addFields.push(field)
    else if (current && !desired) removeFields.push(field)
    else if (current && desired && !sameOperation(current, desired)) updateFields.push(field)
  }

  if (
    analysis.ownershipState.status === 'none' &&
    analysis.native.operations.length > 0 &&
    (updateFields.length > 0 || removeFields.length > 0)
  ) {
    diagnostics.push(
      diagnostic(
        'warning',
        'foreign-native',
        'Updating or removing foreign native Motion requires an explicit destructive policy'
      )
    )
  }

  const targetDuration = desiredOwnership?.durationSeconds ?? null
  const timelineGrowth = compareTimeline(currentDuration, targetDuration, diagnostics)
  const ownershipChange = compareOwnership(analysis.ownershipState, desiredOwnership)
  return {
    version: 1,
    compareOnly: true,
    supported: true,
    addFields,
    updateFields,
    removeFields,
    timelineGrowth,
    ownershipChange,
    diagnostics
  }
}

function analyzeSnapshot(value: unknown): SnapshotAnalysis {
  const decoded = decodeSnapshot(value)
  if (!decoded.ok) return invalidAnalysis(decoded.diagnostic)

  const snapshot = decoded.value
  const shared = decodeSharedMirror(snapshot.sharedMotionRaw)
  const ownershipState = decodeOwnership(snapshot.ownershipRaw)
  const native = inspectNativeState(snapshot)
  const nodeOpacity =
    native.operations.find((operation) => operation.field.name === 'OPACITY')?.track.baseValue
      .value ?? null
  const ownership = ownershipStatus(ownershipState, native)

  if (shared.status === 'invalid') {
    return assembleAnalysis({
      supported: false,
      source: 'none',
      shared,
      ownershipState,
      ownership,
      native,
      nodeOpacity,
      motion: null,
      diagnostics: [shared.diagnostic]
    })
  }

  if (shared.status === 'motion') {
    const diagnostics = ignoredNativeDiagnostics(native, ownershipState, ownership, false)
    return assembleAnalysis({
      supported: true,
      source: 'shared-mirror',
      shared,
      ownershipState,
      ownership,
      native,
      nodeOpacity,
      motion: shared.motion,
      diagnostics
    })
  }

  if (shared.status === 'cleared') {
    const diagnostics: FigmaNativeMotionDiagnostic[] = [
      diagnostic(
        'warning',
        'shared-mirror-cleared',
        'The shared Motion mirror explicitly clears Motion; stale native tracks were not imported'
      ),
      ...ignoredNativeDiagnostics(native, ownershipState, ownership, true)
    ]
    return assembleAnalysis({
      supported: true,
      source: 'none',
      shared,
      ownershipState,
      ownership,
      native,
      nodeOpacity,
      motion: null,
      diagnostics
    })
  }

  const diagnostics = [...native.diagnostics]
  if (ownershipState.status === 'invalid') diagnostics.push(ownershipState.diagnostic)
  if (ownership === 'edited') {
    diagnostics.push(
      diagnostic(
        'error',
        'owned-native-edited',
        'Native Motion no longer matches its OpenPencil ownership record'
      )
    )
  }
  if (diagnostics.some((entry) => entry.severity === 'error')) {
    return assembleAnalysis({
      supported: false,
      source: 'none',
      shared,
      ownershipState,
      ownership,
      native,
      nodeOpacity,
      motion: null,
      diagnostics
    })
  }
  if (native.operations.length === 0) {
    return assembleAnalysis({
      supported: true,
      source: 'none',
      shared,
      ownershipState,
      ownership,
      native,
      nodeOpacity,
      motion: null,
      diagnostics
    })
  }

  const imported = motionFromNative(native)
  diagnostics.push(...imported.diagnostics)
  const supported =
    imported.motion !== null && !diagnostics.some((entry) => entry.severity === 'error')
  const source: FigmaNativeMotionImportSource =
    ownership === 'valid' ? 'owned-native' : 'foreign-native'
  if (source === 'foreign-native') {
    diagnostics.push(
      diagnostic(
        'warning',
        'foreign-native',
        'Imported native Motion has no verified OpenPencil ownership record'
      )
    )
  }
  return assembleAnalysis({
    supported,
    source: supported ? source : 'none',
    shared,
    ownershipState,
    ownership,
    native,
    nodeOpacity,
    motion: supported ? imported.motion : null,
    diagnostics
  })
}

function assembleAnalysis(input: {
  supported: boolean
  source: FigmaNativeMotionImportSource
  shared: SharedMirrorState
  ownershipState: OwnershipState
  ownership: FigmaNativeMotionOwnershipStatus
  native: NativeState
  nodeOpacity: number | null
  motion: MotionSpec | null
  diagnostics: FigmaNativeMotionDiagnostic[]
}): SnapshotAnalysis {
  return {
    inspection: {
      version: 1,
      supported: input.supported,
      source: input.source,
      sharedMirror: input.shared.status,
      ownership: input.ownership,
      fields: input.native.operations.map((operation) => operation.field.name),
      operations: structuredClone(input.native.operations),
      timeline: input.native.timeline ? { ...input.native.timeline } : null,
      nodeOpacity: input.nodeOpacity,
      diagnostics: input.diagnostics
    },
    motion: input.motion,
    native: input.native,
    shared: input.shared,
    ownershipState: input.ownershipState
  }
}

function invalidAnalysis(diagnosticValue: FigmaNativeMotionDiagnostic): SnapshotAnalysis {
  const native: NativeState = {
    supported: false,
    operations: [],
    timeline: null,
    diagnostics: [diagnosticValue]
  }
  return {
    inspection: {
      version: 1,
      supported: false,
      source: 'none',
      sharedMirror: 'none',
      ownership: 'none',
      fields: [],
      operations: [],
      timeline: null,
      nodeOpacity: null,
      diagnostics: [diagnosticValue]
    },
    motion: null,
    native,
    shared: { status: 'none' },
    ownershipState: { status: 'none' }
  }
}

function decodeSnapshot(
  value: unknown
): { ok: true; value: DecodedSnapshot } | { ok: false; diagnostic: FigmaNativeMotionDiagnostic } {
  if (
    !isPlainDataRecord(value) ||
    !hasExactKeys(value, [
      'animationStyles',
      'manualKeyframeTracks',
      'ownershipRaw',
      'sharedMotionRaw',
      'timelines'
    ])
  ) {
    return {
      ok: false,
      diagnostic: diagnostic(
        'error',
        'invalid-snapshot',
        'Expected an exact detached Figma Motion snapshot object'
      )
    }
  }
  if (
    !isDenseArray(value.animationStyles, MAX_ANIMATION_STYLES) ||
    !isPlainDataRecord(value.manualKeyframeTracks) ||
    Reflect.ownKeys(value.manualKeyframeTracks).length > MAX_TRACK_FIELDS ||
    !isDenseArray(value.timelines, MAX_TIMELINES + 1) ||
    typeof value.ownershipRaw !== 'string' ||
    value.ownershipRaw.length > MAX_RAW_DATA_LENGTH ||
    typeof value.sharedMotionRaw !== 'string' ||
    value.sharedMotionRaw.length > MAX_RAW_DATA_LENGTH
  ) {
    return {
      ok: false,
      diagnostic: diagnostic(
        'error',
        'invalid-snapshot',
        'Snapshot fields are malformed or exceed bounded inspection limits'
      )
    }
  }
  return {
    ok: true,
    value: {
      animationStyles: value.animationStyles,
      manualKeyframeTracks: value.manualKeyframeTracks,
      timelines: value.timelines,
      ownershipRaw: value.ownershipRaw,
      sharedMotionRaw: value.sharedMotionRaw
    }
  }
}

function decodeSharedMirror(raw: string): SharedMirrorState {
  if (raw === '') return { status: 'none' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      status: 'invalid',
      diagnostic: diagnostic(
        'error',
        'invalid-shared-mirror',
        'Shared Motion mirror is not valid JSON: ' + messageOf(error),
        'sharedMotionRaw'
      )
    }
  }
  if (!isPlainDataRecord(parsed) || parsed.schema !== 'openpencil.motion' || parsed.version !== 1) {
    return {
      status: 'invalid',
      diagnostic: diagnostic(
        'error',
        'invalid-shared-mirror',
        'Shared Motion mirror has an unsupported envelope',
        'sharedMotionRaw'
      )
    }
  }
  if (hasExactKeys(parsed, ['cleared', 'schema', 'version']) && parsed.cleared === true) {
    return { status: 'cleared' }
  }
  if (!hasExactKeys(parsed, ['motion', 'schema', 'version'])) {
    return {
      status: 'invalid',
      diagnostic: diagnostic(
        'error',
        'invalid-shared-mirror',
        'Shared Motion mirror contains unexpected fields',
        'sharedMotionRaw'
      )
    }
  }
  const validated = validateMotionSpec(parsed.motion)
  if (!validated.success) {
    return {
      status: 'invalid',
      diagnostic: diagnostic(
        'error',
        'invalid-shared-mirror',
        validated.issues.map((issue) => issue.path + ': ' + issue.message).join('; '),
        'sharedMotionRaw.motion'
      )
    }
  }
  return { status: 'motion', motion: validated.value }
}

function inspectNativeState(snapshot: DecodedSnapshot): NativeState {
  const diagnostics: FigmaNativeMotionDiagnostic[] = []
  const timeline = inspectTimeline(snapshot.timelines, diagnostics)
  if (snapshot.animationStyles.length > 0) {
    diagnostics.push(
      diagnostic(
        'error',
        'animation-styles',
        'Applied Figma animation styles cannot be represented by MotionSpec v1',
        'animationStyles'
      )
    )
  }

  const trackKeys = Reflect.ownKeys(snapshot.manualKeyframeTracks)
  if (trackKeys.some((key) => typeof key !== 'string')) {
    diagnostics.push(
      diagnostic(
        'error',
        'unknown-property',
        'Symbol-keyed native Motion tracks are not supported',
        'manualKeyframeTracks'
      )
    )
  }
  for (const collection of INDEXED_TRACK_COLLECTIONS) {
    if (hasIndexedTrackValue(snapshot.manualKeyframeTracks[collection])) {
      diagnostics.push(
        diagnostic(
          'error',
          'indexed-track',
          'Indexed ' + collection + ' Motion tracks cannot be imported safely',
          'manualKeyframeTracks.' + collection
        )
      )
    }
  }

  const stringKeys = trackKeys.filter((key): key is string => typeof key === 'string')
  for (const field of stringKeys) {
    if (
      snapshot.manualKeyframeTracks[field] === undefined ||
      INDEXED_TRACK_COLLECTIONS.includes(field as (typeof INDEXED_TRACK_COLLECTIONS)[number]) ||
      FIGMA_NATIVE_MOTION_FIELDS.includes(field as FigmaNativeMotionFieldName)
    ) {
      continue
    }
    diagnostics.push(
      OFFICIAL_PROPERTY_FIELDS.has(field)
        ? diagnostic(
            'error',
            'unsupported-property',
            'Figma property ' + field + ' is outside the MotionSpec v1 numeric intersection',
            'manualKeyframeTracks.' + field
          )
        : diagnostic(
            'error',
            'unknown-property',
            'Unknown Figma Motion property ' + field + ' was rejected',
            'manualKeyframeTracks.' + field
          )
    )
  }

  const operations: FigmaNativeMotionOperation[] = []
  for (const field of FIGMA_NATIVE_MOTION_FIELDS) {
    const rawBinding = snapshot.manualKeyframeTracks[field]
    if (rawBinding === undefined) continue
    const parsed = parseReadbackBinding(field, rawBinding, timeline?.durationSeconds)
    if (parsed.ok) operations.push(parsed.operation)
    else diagnostics.push(parsed.diagnostic)
  }
  if (operations.length > 0 && timeline === null) {
    diagnostics.push(
      diagnostic(
        'error',
        'missing-timeline',
        'Native Motion tracks require exactly one valid timeline',
        'timelines'
      )
    )
  }
  return {
    supported: !diagnostics.some((entry) => entry.severity === 'error'),
    operations,
    timeline,
    diagnostics
  }
}

function inspectTimeline(
  timelines: unknown[],
  diagnostics: FigmaNativeMotionDiagnostic[]
): FigmaNativeMotionTimelineInspection | null {
  if (timelines.length > 1) {
    diagnostics.push(
      diagnostic(
        'error',
        'ambiguous-timeline',
        'Multiple Figma timelines cannot be mapped to one canonical MotionSpec track',
        'timelines'
      )
    )
    return null
  }
  const timeline = timelines[0]
  if (timeline === undefined) return null
  if (
    !isPlainDataRecord(timeline) ||
    !hasExactKeys(timeline, ['duration', 'id']) ||
    !validRuntimeId(timeline.id) ||
    !finiteWithin(timeline.duration, 0, MAX_DURATION_SECONDS)
  ) {
    diagnostics.push(
      diagnostic(
        'error',
        'invalid-timeline',
        'Figma timeline must contain a bounded id and duration',
        'timelines[0]'
      )
    )
    return null
  }
  return { id: timeline.id, durationSeconds: timeline.duration }
}

function parseReadbackBinding(
  field: FigmaNativeMotionFieldName,
  value: unknown,
  timelineDuration: number | undefined
):
  | { ok: true; operation: FigmaNativeMotionOperation }
  | { ok: false; diagnostic: FigmaNativeMotionDiagnostic } {
  const path = 'manualKeyframeTracks.' + field
  if (
    !isPlainDataRecord(value) ||
    !hasExactKeys(value, ['baseValue', 'id', 'keyframes']) ||
    !validRuntimeId(value.id) ||
    !validFieldFloat(field, value.baseValue) ||
    !isDenseArray(value.keyframes, MAX_KEYFRAMES) ||
    value.keyframes.length < 2
  ) {
    return {
      ok: false,
      diagnostic: diagnostic(
        'error',
        'invalid-track',
        'Figma ' + field + ' binding is malformed or outside supported numeric bounds',
        path
      )
    }
  }

  const keyframes: FigmaNativeMotionOperation['track']['keyframes'] = []
  let previousPosition = -Infinity
  for (let index = 0; index < value.keyframes.length; index++) {
    const candidate = value.keyframes[index]
    if (
      !isPlainDataRecord(candidate) ||
      !hasExactKeys(candidate, ['easing', 'id', 'timelinePosition', 'value']) ||
      !validRuntimeId(candidate.id) ||
      !finiteWithin(candidate.timelinePosition, 0, timelineDuration ?? MAX_DURATION_SECONDS) ||
      candidate.timelinePosition <= previousPosition ||
      !validFieldFloat(field, candidate.value) ||
      !validNativeEasing(candidate.easing)
    ) {
      return {
        ok: false,
        diagnostic: diagnostic(
          'error',
          'invalid-track',
          'Figma ' + field + ' keyframe ' + String(index) + ' is malformed',
          path + '.keyframes[' + String(index) + ']'
        )
      }
    }
    previousPosition = candidate.timelinePosition
    keyframes.push({
      timelinePosition: candidate.timelinePosition,
      value: { type: 'FLOAT', value: candidate.value.value },
      ...(index === 0 ? {} : { easing: cloneNativeEasing(candidate.easing) })
    })
  }
  return {
    ok: true,
    operation: {
      field: { type: 'PROPERTY', name: field },
      track: {
        baseValue: { type: 'FLOAT', value: value.baseValue.value },
        keyframes
      }
    }
  }
}

function motionFromNative(native: NativeState): {
  motion: MotionSpec | null
  diagnostics: FigmaNativeMotionDiagnostic[]
} {
  const diagnostics: FigmaNativeMotionDiagnostic[] = []
  const reference = native.operations[0]
  if (!native.timeline) return { motion: null, diagnostics }
  const positions = reference.track.keyframes.map((keyframe) => keyframe.timelinePosition)
  const durationSeconds = positions.at(-1) ?? 0
  if (positions[0] !== 0 || durationSeconds <= 0) {
    diagnostics.push(
      diagnostic(
        'error',
        'inconsistent-keyframes',
        'Native Motion must start at 0 seconds and end after 0 seconds'
      )
    )
    return { motion: null, diagnostics }
  }
  if (
    native.operations.some(
      (operation) =>
        operation.track.keyframes.length !== positions.length ||
        operation.track.keyframes.some(
          (keyframe, index) => !closeNumber(keyframe.timelinePosition, positions[index])
        )
    )
  ) {
    diagnostics.push(
      diagnostic(
        'error',
        'inconsistent-keyframes',
        'Native property tracks use different keyframe positions and cannot be merged safely'
      )
    )
    return { motion: null, diagnostics }
  }

  const keyframes: MotionKeyframe[] = positions.map((position) => ({
    offset: roundUnit(position / durationSeconds)
  }))
  for (const operation of native.operations) {
    if (!appendOperationValues(operation, keyframes, diagnostics)) {
      return { motion: null, diagnostics }
    }
  }
  if (!appendSegmentEasing(native.operations, keyframes, diagnostics)) {
    return { motion: null, diagnostics }
  }
  const durationMs = roundNumber(durationSeconds * 1_000, 6)
  const motion: MotionSpec = {
    version: 1,
    tracks: [
      {
        id: 'figmaNative',
        trigger: 'mount',
        keyframes,
        timing: {
          durationMs,
          delayMs: 0,
          easing: 'ease',
          iterations: 1,
          direction: 'normal',
          fill: 'both'
        },
        exit: 'none'
      }
    ],
    reducedMotion: 'reduce'
  }
  const validated = validateMotionSpec(motion)
  if (!validated.success) {
    diagnostics.push(
      diagnostic(
        'error',
        'invalid-track',
        'Imported native Motion is outside MotionSpec bounds: ' +
          validated.issues.map((issue) => issue.path + ': ' + issue.message).join('; ')
      )
    )
    return { motion: null, diagnostics }
  }
  diagnostics.push(
    diagnostic(
      'warning',
      'defaulted-semantics',
      'Native import defaults trigger=mount, delayMs=0, easing=ease, iterations=1, direction=normal, fill=both, exit=none, and reducedMotion=reduce; preset provenance is unavailable'
    )
  )
  if (native.timeline.durationSeconds > durationSeconds + EPSILON) {
    diagnostics.push(
      diagnostic(
        'warning',
        'timeline-slack',
        'The containing Figma timeline is longer than the imported Motion track; unused tail time is not represented'
      )
    )
  }
  return { motion: validated.value, diagnostics }
}

// oxlint-disable-next-line eslint/complexity -- Each bounded native field has one explicit, auditable MotionSpec mapping.
function appendOperationValues(
  operation: FigmaNativeMotionOperation,
  keyframes: MotionKeyframe[],
  diagnostics: FigmaNativeMotionDiagnostic[]
): boolean {
  const base = operation.track.baseValue.value
  if (
    (operation.field.name === 'TRANSLATION_X' ||
      operation.field.name === 'TRANSLATION_Y' ||
      operation.field.name === 'ROTATION') &&
    !closeNumber(base, 0)
  ) {
    diagnostics.push(
      diagnostic(
        'error',
        'unsupported-base-value',
        operation.field.name + ' uses a non-identity base value'
      )
    )
    return false
  }
  if (
    (operation.field.name === 'SCALE_X' || operation.field.name === 'SCALE_Y') &&
    !closeNumber(base, 1)
  ) {
    diagnostics.push(
      diagnostic(
        'error',
        'unsupported-base-value',
        operation.field.name + ' uses a non-identity base value'
      )
    )
    return false
  }
  if (operation.field.name === 'OPACITY' && base <= EPSILON) {
    diagnostics.push(
      diagnostic(
        'error',
        'opacity-base-zero',
        'Opacity multipliers cannot be recovered from a zero authored opacity'
      )
    )
    return false
  }

  for (let index = 0; index < keyframes.length; index++) {
    const frame = keyframes[index]
    const value = operation.track.keyframes[index].value.value
    switch (operation.field.name) {
      case 'OPACITY': {
        const multiplier = value / base
        if (!finiteWithin(multiplier, 0, 1)) {
          diagnostics.push(
            diagnostic(
              'error',
              'unsupported-base-value',
              'Opacity values cannot be represented as bounded authored-opacity multipliers'
            )
          )
          return false
        }
        frame.opacity = roundNumber(multiplier, 9)
        break
      }
      case 'TRANSLATION_X':
        frame.x = value
        break
      case 'TRANSLATION_Y':
        frame.y = value
        break
      case 'ROTATION':
        frame.rotate = value
        break
      case 'SCALE_X':
        frame.scaleX = value
        break
      case 'SCALE_Y':
        frame.scaleY = value
        break
    }
  }
  return true
}

function appendSegmentEasing(
  operations: FigmaNativeMotionOperation[],
  keyframes: MotionKeyframe[],
  diagnostics: FigmaNativeMotionDiagnostic[]
): boolean {
  const reference = operations[0]
  for (let segment = 0; segment < keyframes.length - 1; segment++) {
    const arrivingIndex = segment + 1
    const expected = reference.track.keyframes[arrivingIndex]?.easing
    if (
      expected === undefined ||
      operations.some(
        (operation) => !sameNativeEasing(operation.track.keyframes[arrivingIndex]?.easing, expected)
      )
    ) {
      diagnostics.push(
        diagnostic(
          'error',
          'inconsistent-easing',
          'Native property tracks use missing or inconsistent segment easing'
        )
      )
      return false
    }
    const easing = motionEasing(expected)
    if (!sameMotionEasing(easing, 'ease')) {
      keyframes[segment].easing = easing
    }
  }
  return true
}

function ownershipStatus(
  ownership: OwnershipState,
  native: NativeState
): FigmaNativeMotionOwnershipStatus {
  if (ownership.status === 'none' || ownership.status === 'invalid') return ownership.status
  if (
    !native.supported ||
    !native.timeline ||
    native.timeline.durationSeconds + EPSILON < ownership.record.durationSeconds ||
    !operationsMatchExactly(native.operations, ownership.record.operations)
  ) {
    return 'edited'
  }
  return 'valid'
}

function ignoredNativeDiagnostics(
  native: NativeState,
  ownership: OwnershipState,
  ownershipStatusValue: FigmaNativeMotionOwnershipStatus,
  forceIgnoredDiagnostic: boolean
): FigmaNativeMotionDiagnostic[] {
  const diagnostics: FigmaNativeMotionDiagnostic[] = native.diagnostics.map((entry) => ({
    ...entry,
    severity: 'warning'
  }))
  if (ownership.status === 'invalid') {
    diagnostics.push({ ...ownership.diagnostic, severity: 'warning' })
  } else if (ownershipStatusValue === 'edited') {
    diagnostics.push(
      diagnostic(
        'warning',
        'owned-native-edited',
        'Native Motion differs from ownership metadata; the valid shared mirror was recovered instead'
      )
    )
  }
  if (
    forceIgnoredDiagnostic ||
    native.diagnostics.length > 0 ||
    (native.operations.length > 0 && ownershipStatusValue !== 'valid')
  ) {
    diagnostics.push(
      diagnostic(
        'warning',
        'native-state-ignored',
        'Native Motion readback was diagnostic-only because shared Motion metadata is authoritative'
      )
    )
  }
  return diagnostics
}

function decodeOwnership(raw: string): OwnershipState {
  if (raw === '') return { status: 'none' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return invalidOwnership('Ownership record is not valid JSON: ' + messageOf(error))
  }
  if (
    !isPlainDataRecord(parsed) ||
    !hasExactKeys(parsed, [
      'apiRevision',
      'durationSeconds',
      'operations',
      'sourceSignature',
      'version'
    ]) ||
    parsed.version !== 1 ||
    parsed.apiRevision !== FIGMA_MOTION_API_REVISION ||
    typeof parsed.sourceSignature !== 'string' ||
    parsed.sourceSignature.length === 0 ||
    parsed.sourceSignature.length > MAX_RAW_DATA_LENGTH ||
    !finiteWithin(parsed.durationSeconds, EPSILON, MAX_DURATION_SECONDS) ||
    !isDenseArray(parsed.operations, FIGMA_NATIVE_MOTION_FIELDS.length) ||
    parsed.operations.length === 0
  ) {
    return invalidOwnership('Ownership record has an unsupported shape')
  }
  const operations: FigmaNativeMotionOperation[] = []
  for (const value of parsed.operations) {
    const operation = parseOwnershipOperation(value, parsed.durationSeconds)
    if (!operation) return invalidOwnership('Ownership record contains an invalid operation')
    operations.push(operation)
  }
  const fields = operations.map((operation) => operation.field.name)
  if (new Set(fields).size !== fields.length) {
    return invalidOwnership('Ownership record contains duplicate fields')
  }
  const record: FigmaNativeMotionOwnershipRecord = {
    version: 1,
    apiRevision: FIGMA_MOTION_API_REVISION,
    sourceSignature: parsed.sourceSignature,
    durationSeconds: parsed.durationSeconds,
    operations
  }
  if (record.sourceSignature !== ownershipSignature(record)) {
    return invalidOwnership('Ownership source signature does not match its operations')
  }
  return { status: 'valid', record }
}

// oxlint-disable-next-line eslint/complexity -- Ownership decoding mirrors the applicator's complete fail-closed wire validation.
function parseOwnershipOperation(
  value: unknown,
  durationSeconds: number
): FigmaNativeMotionOperation | null {
  if (!isPlainDataRecord(value) || !hasExactKeys(value, ['field', 'track'])) return null
  const field = value.field
  const track = value.track
  if (
    !isPlainDataRecord(field) ||
    !hasExactKeys(field, ['name', 'type']) ||
    field.type !== 'PROPERTY' ||
    typeof field.name !== 'string' ||
    !FIGMA_NATIVE_MOTION_FIELDS.includes(field.name as FigmaNativeMotionFieldName) ||
    !isPlainDataRecord(track) ||
    !hasExactKeys(track, ['baseValue', 'keyframes']) ||
    !validFieldFloat(field.name as FigmaNativeMotionFieldName, track.baseValue) ||
    !isDenseArray(track.keyframes, MAX_KEYFRAMES) ||
    track.keyframes.length < 2
  ) {
    return null
  }
  const keyframes: FigmaNativeMotionOperation['track']['keyframes'] = []
  let previous = -Infinity
  for (const candidate of track.keyframes) {
    if (!isPlainDataRecord(candidate)) return null
    const keys = Object.keys(candidate).sort().join(',')
    if (keys !== 'timelinePosition,value' && keys !== 'easing,timelinePosition,value') return null
    if (
      !finiteWithin(candidate.timelinePosition, 0, durationSeconds) ||
      candidate.timelinePosition <= previous ||
      !validFieldFloat(field.name as FigmaNativeMotionFieldName, candidate.value) ||
      (candidate.easing !== undefined && !validNativeEasing(candidate.easing))
    ) {
      return null
    }
    previous = candidate.timelinePosition
    keyframes.push({
      timelinePosition: candidate.timelinePosition,
      value: { type: 'FLOAT', value: candidate.value.value },
      ...(candidate.easing === undefined ? {} : { easing: cloneNativeEasing(candidate.easing) })
    })
  }
  return {
    field: { type: 'PROPERTY', name: field.name as FigmaNativeMotionFieldName },
    track: {
      baseValue: { type: 'FLOAT', value: track.baseValue.value },
      keyframes
    }
  }
}

function invalidOwnership(message: string): OwnershipState {
  return {
    status: 'invalid',
    diagnostic: diagnostic('error', 'invalid-ownership', message, 'ownershipRaw')
  }
}

function diffInputDiagnostics(analysis: SnapshotAnalysis): FigmaNativeMotionDiagnostic[] {
  if (analysis.inspection.diagnostics.some((entry) => entry.code === 'invalid-snapshot')) {
    return [...analysis.inspection.diagnostics]
  }
  const diagnostics = [...analysis.native.diagnostics]
  if (analysis.shared.status === 'invalid') diagnostics.push(analysis.shared.diagnostic)
  if (analysis.ownershipState.status === 'invalid') {
    diagnostics.push(analysis.ownershipState.diagnostic)
  } else if (analysis.inspection.ownership === 'edited') {
    diagnostics.push(
      diagnostic(
        'error',
        'owned-native-edited',
        'Native Motion no longer matches its OpenPencil ownership record'
      )
    )
  }
  return diagnostics
}

function compareTimeline(
  current: number | null,
  target: number | null,
  diagnostics: FigmaNativeMotionDiagnostic[]
): FigmaNativeMotionTimelineGrowth {
  if (target === null) {
    return {
      change: 'none',
      currentDurationSeconds: current,
      targetDurationSeconds: null,
      deltaSeconds: 0
    }
  }
  if (current === null) {
    return {
      change: 'create',
      currentDurationSeconds: null,
      targetDurationSeconds: target,
      deltaSeconds: target
    }
  }
  if (current + EPSILON < target) {
    return {
      change: 'grow',
      currentDurationSeconds: current,
      targetDurationSeconds: target,
      deltaSeconds: roundNumber(target - current, 6)
    }
  }
  if (current > target + EPSILON) {
    diagnostics.push(
      diagnostic(
        'warning',
        'timeline-preserved',
        'The existing Figma timeline is longer than the desired Motion plan and will not be shortened'
      )
    )
  }
  return {
    change: 'none',
    currentDurationSeconds: current,
    targetDurationSeconds: target,
    deltaSeconds: 0
  }
}

function compareOwnership(
  current: OwnershipState,
  desired: FigmaNativeMotionOwnershipRecord | null
): FigmaNativeMotionOwnershipChange {
  if (desired === null) return current.status === 'none' ? 'none' : 'remove'
  if (current.status !== 'valid') return 'create'
  return current.record.sourceSignature === desired.sourceSignature ? 'none' : 'update'
}

function operationMap(
  operations: readonly FigmaNativeMotionOperation[]
): Map<FigmaNativeMotionFieldName, FigmaNativeMotionOperation> {
  return new Map(operations.map((operation) => [operation.field.name, operation]))
}

function operationsMatchExactly(
  actual: readonly FigmaNativeMotionOperation[],
  expected: readonly FigmaNativeMotionOperation[]
): boolean {
  if (actual.length !== expected.length) return false
  const actualByField = operationMap(actual)
  return expected.every((operation) => {
    const current = actualByField.get(operation.field.name)
    return current !== undefined && sameOperation(current, operation)
  })
}

function sameOperation(
  actual: FigmaNativeMotionOperation,
  expected: FigmaNativeMotionOperation
): boolean {
  if (
    actual.field.name !== expected.field.name ||
    !closeNumber(actual.track.baseValue.value, expected.track.baseValue.value) ||
    actual.track.keyframes.length !== expected.track.keyframes.length
  ) {
    return false
  }
  return expected.track.keyframes.every((expectedFrame, index) => {
    const actualFrame = actual.track.keyframes[index]
    if (
      !closeNumber(actualFrame.timelinePosition, expectedFrame.timelinePosition) ||
      !closeNumber(actualFrame.value.value, expectedFrame.value.value)
    ) {
      return false
    }
    return index === 0 || sameNativeEasing(actualFrame.easing, expectedFrame.easing)
  })
}

function ownershipSignature(value: {
  version: number
  apiRevision: number
  durationSeconds: number
  operations: readonly FigmaNativeMotionOperation[]
}): string {
  return JSON.stringify({
    version: value.version,
    apiRevision: value.apiRevision,
    durationSeconds: value.durationSeconds,
    operations: value.operations
  })
}

function validFieldFloat(
  field: FigmaNativeMotionFieldName,
  value: unknown
): value is {
  type: 'FLOAT'
  value: number
} {
  if (
    !isPlainDataRecord(value) ||
    !hasExactKeys(value, ['type', 'value']) ||
    value.type !== 'FLOAT'
  ) {
    return false
  }
  if (field === 'OPACITY') return finiteWithin(value.value, 0, 1)
  if (field === 'ROTATION') return finiteWithin(value.value, -36_000, 36_000)
  if (field === 'SCALE_X' || field === 'SCALE_Y') {
    return finiteWithin(value.value, 0, 100)
  }
  return finiteWithin(value.value, -100_000, 100_000)
}

function validNativeEasing(value: unknown): value is FigmaNativeMotionEasing {
  if (!isPlainDataRecord(value) || typeof value.type !== 'string') return false
  if (value.type !== 'CUSTOM_CUBIC_BEZIER') {
    return (
      hasExactKeys(value, ['type']) &&
      ['LINEAR', 'EASE_IN', 'EASE_OUT', 'EASE_IN_AND_OUT'].includes(value.type)
    )
  }
  const curve = value.easingFunctionCubicBezier
  return (
    hasExactKeys(value, ['easingFunctionCubicBezier', 'type']) &&
    isPlainDataRecord(curve) &&
    hasExactKeys(curve, ['x1', 'x2', 'y1', 'y2']) &&
    finiteWithin(curve.x1, 0, 1) &&
    finiteWithin(curve.y1, -100, 100) &&
    finiteWithin(curve.x2, 0, 1) &&
    finiteWithin(curve.y2, -100, 100)
  )
}

function cloneNativeEasing(value: FigmaNativeMotionEasing): FigmaNativeMotionEasing {
  if (value.type !== 'CUSTOM_CUBIC_BEZIER') return { type: value.type }
  const curve = value.easingFunctionCubicBezier
  if (!curve) throw new TypeError('Missing custom cubic bezier values')
  return {
    type: value.type,
    easingFunctionCubicBezier: { ...curve }
  }
}

function motionEasing(value: FigmaNativeMotionEasing): MotionEasing {
  switch (value.type) {
    case 'LINEAR':
      return 'linear'
    case 'EASE_IN':
      return 'ease-in'
    case 'EASE_OUT':
      return 'ease-out'
    case 'EASE_IN_AND_OUT':
      return 'ease-in-out'
    case 'CUSTOM_CUBIC_BEZIER': {
      const curve = value.easingFunctionCubicBezier
      if (!curve) throw new TypeError('Missing custom cubic bezier values')
      if (
        closeNumber(curve.x1, 0.25) &&
        closeNumber(curve.y1, 0.1) &&
        closeNumber(curve.x2, 0.25) &&
        closeNumber(curve.y2, 1)
      ) {
        return 'ease'
      }
      return { type: 'cubicBezier', ...curve }
    }
  }
  throw new TypeError('Unsupported native Motion easing')
}

function sameNativeEasing(
  left: FigmaNativeMotionEasing | undefined,
  right: FigmaNativeMotionEasing | undefined
): boolean {
  if (!left || !right || left.type !== right.type) return left === right
  if (left.type !== 'CUSTOM_CUBIC_BEZIER') return true
  const leftCurve = left.easingFunctionCubicBezier
  const rightCurve = right.easingFunctionCubicBezier
  return (
    leftCurve !== undefined &&
    rightCurve !== undefined &&
    closeNumber(leftCurve.x1, rightCurve.x1) &&
    closeNumber(leftCurve.y1, rightCurve.y1) &&
    closeNumber(leftCurve.x2, rightCurve.x2) &&
    closeNumber(leftCurve.y2, rightCurve.y2)
  )
}

function sameMotionEasing(left: MotionEasing, right: MotionEasing): boolean {
  if (typeof left === 'string' || typeof right === 'string') return left === right
  if (left.type !== 'cubicBezier' || right.type !== 'cubicBezier') return false
  return (
    closeNumber(left.x1, right.x1) &&
    closeNumber(left.y1, right.y1) &&
    closeNumber(left.x2, right.x2) &&
    closeNumber(left.y2, right.y2)
  )
}

function hasIndexedTrackValue(value: unknown): boolean {
  if (value === undefined) return false
  if (Array.isArray(value)) {
    return value.length > 0 || Reflect.ownKeys(value).some((key) => key !== 'length')
  }
  if (isPlainDataRecord(value)) return Reflect.ownKeys(value).length > 0
  return true
}

function diagnostic(
  severity: FigmaNativeMotionDiagnosticSeverity,
  code: FigmaNativeMotionDiagnosticCode,
  message: string,
  path?: string
): FigmaNativeMotionDiagnostic {
  return path === undefined ? { severity, code, message } : { severity, code, message, path }
}

function isPlainDataRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && descriptor.get === undefined && descriptor.set === undefined
  })
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value)
  return (
    keys.every((key): key is string => typeof key === 'string') &&
    keys.sort().join(',') === [...expected].sort().join(',')
  )
}

function isDenseArray(value: unknown, maxLength: number): value is unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maxLength
  ) {
    return false
  }
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key === 'symbol')) return false
  if (
    keys.some(
      (key) =>
        key !== 'length' &&
        (typeof key !== 'string' ||
          !Number.isInteger(Number(key)) ||
          Number(key) < 0 ||
          Number(key) >= value.length ||
          String(Number(key)) !== key)
    )
  ) {
    return false
  }
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) return false
  }
  return true
}

function validRuntimeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_RUNTIME_ID_LENGTH
}

function finiteWithin(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function closeNumber(left: unknown, right: unknown): boolean {
  return (
    typeof left === 'number' &&
    Number.isFinite(left) &&
    typeof right === 'number' &&
    Number.isFinite(right) &&
    Math.abs(left - right) <= EPSILON
  )
}

function roundUnit(value: number): number {
  if (value <= EPSILON) return 0
  if (value >= 1 - EPSILON) return 1
  return roundNumber(value, 9)
}

function roundNumber(value: number, precision: number): number {
  return Number(value.toFixed(precision))
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
