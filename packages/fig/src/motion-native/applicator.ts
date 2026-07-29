import type {
  FigmaNativeMotionEasing,
  FigmaNativeMotionFieldName,
  FigmaNativeMotionOperation,
  FigmaNativeMotionPlan,
  FigmaNativeMotionWarning
} from './index'

export const FIGMA_MOTION_API_REVISION = 130 as const
export const FIGMA_NATIVE_MOTION_OWNERSHIP_NAMESPACE = 'openpencil'
export const FIGMA_NATIVE_MOTION_OWNERSHIP_KEY = 'nativeMotionAdapterV1'
export const FIGMA_NATIVE_MOTION_APPLICATOR_SCHEMA =
  'openpencil.figma-native-motion-applicator' as const

export const FIGMA_NATIVE_MOTION_FIELDS: readonly FigmaNativeMotionFieldName[] = [
  'OPACITY',
  'TRANSLATION_X',
  'TRANSLATION_Y',
  'ROTATION',
  'SCALE_X',
  'SCALE_Y'
]

export type FigmaNativeMotionConflictPolicy = 'replace-owned' | 'replace-all'

export interface FigmaNativeMotionOwnershipRecord {
  version: 1
  apiRevision: typeof FIGMA_MOTION_API_REVISION
  sourceSignature: string
  durationSeconds: number
  operations: FigmaNativeMotionOperation[]
}

export interface FigmaNativeMotionApplyRequest {
  schema: typeof FIGMA_NATIVE_MOTION_APPLICATOR_SCHEMA
  version: 1
  apiRevision: typeof FIGMA_MOTION_API_REVISION
  conflictPolicy: FigmaNativeMotionConflictPolicy
  allowTimelineGrowth: boolean
  ownershipNamespace: typeof FIGMA_NATIVE_MOTION_OWNERSHIP_NAMESPACE
  ownershipKey: typeof FIGMA_NATIVE_MOTION_OWNERSHIP_KEY
  supportedFields: FigmaNativeMotionFieldName[]
  ownership: FigmaNativeMotionOwnershipRecord
}

export interface FigmaNativeMotionApplyOptions {
  /** Replace only verified OpenPencil-owned tracks by default. */
  conflictPolicy?: FigmaNativeMotionConflictPolicy
  /** Explicitly permit extending a pre-existing, top-level-frame-owned timeline. */
  allowTimelineGrowth?: boolean
}

type SafeFigmaNativeMotionPlan = FigmaNativeMotionPlan & {
  supported: true
  durationSeconds: number
  sourceSignature: string
}

export interface FigmaNativeMotionTransactionHost {
  commitUndo(): void
  triggerUndo(): void
}

/** Structural surface shared by official Figma nodes and isolated test doubles. */
export interface FigmaNativeMotionTransactionTarget {
  readonly id: string
  readonly animationStyles: unknown
  readonly manualKeyframeTracks: unknown
  readonly timelines: unknown
  getSharedPluginData(namespace: string, key: string): string
  setSharedPluginData(namespace: string, key: string, value: string): void
  applyManualKeyframeTrack(
    field: FigmaNativeMotionOperation['field'],
    track: FigmaNativeMotionOperation['track']
  ): void
  removeManualKeyframeTrack(field: { type: 'PROPERTY'; name: string }): void
  removeAnimationStyle?(id: string): void
  setTimelineDuration(id: string, duration: number): void
}

export type FigmaNativeMotionTransactionStatus = 'applied' | 'unchanged' | 'conflict' | 'failed'

export interface FigmaNativeMotionTransactionResult {
  status: FigmaNativeMotionTransactionStatus
  code: string | null
  message: string | null
  nodeId: string | null
  timelineId: string | null
  durationSeconds: number | null
  managedFields: FigmaNativeMotionFieldName[]
  replacedForeignMotion: boolean
  rolledBack: boolean
  /** Diagnostic identifier for the canonical enumerable state captured before mutation. */
  preflightFingerprint: string | null
}

/**
 * Build the data-only request consumed by both the development plugin and generated scripts.
 * Runtime validation still happens inside the transaction; this guard rejects unsafe generation
 * inputs before any executable script is emitted.
 */
export function createFigmaNativeMotionApplyRequest(
  plan: FigmaNativeMotionPlan,
  options: FigmaNativeMotionApplyOptions = {}
): FigmaNativeMotionApplyRequest {
  assertSafeApplyOptions(options)
  const ownership = ownershipFromPlan(plan)
  return {
    schema: FIGMA_NATIVE_MOTION_APPLICATOR_SCHEMA,
    version: 1,
    apiRevision: FIGMA_MOTION_API_REVISION,
    conflictPolicy: options.conflictPolicy ?? 'replace-owned',
    allowTimelineGrowth: options.allowTimelineGrowth ?? false,
    ownershipNamespace: FIGMA_NATIVE_MOTION_OWNERSHIP_NAMESPACE,
    ownershipKey: FIGMA_NATIVE_MOTION_OWNERSHIP_KEY,
    supportedFields: [...FIGMA_NATIVE_MOTION_FIELDS],
    ownership
  }
}

/**
 * The single Figma-native Motion mutation algorithm.
 *
 * This function deliberately has zero module-scope runtime references: every helper and constant
 * used by the transaction is declared inside the function. Consequently its runtime JavaScript
 * `toString()` value can be embedded in a Figma-hosted script without creating hidden closures.
 */
// oxlint-disable-next-line eslint/complexity -- This is intentionally one zero-closure transaction so generated Figma scripts execute the exact audited validation, mutation, and rollback algorithm.
export function applyFigmaNativeMotionTransaction(
  host: FigmaNativeMotionTransactionHost,
  target: FigmaNativeMotionTransactionTarget | null,
  requestInput: unknown
): FigmaNativeMotionTransactionResult {
  const epsilon = 0.000001
  const ownershipLimit = 100_000
  const expectedApiRevision = 130
  const expectedSchema = 'openpencil.figma-native-motion-applicator'
  const expectedOwnershipNamespace = 'openpencil'
  const expectedOwnershipKey = 'nativeMotionAdapterV1'
  const supportedFields = [
    'OPACITY',
    'TRANSLATION_X',
    'TRANSLATION_Y',
    'ROTATION',
    'SCALE_X',
    'SCALE_Y'
  ]
  const indexedCollections = ['fills', 'strokes', 'effects']
  const removablePropertyFields = new Set([
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
  const maxDurationSeconds = 120
  const maxKeyframes = 32

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
  const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
    if (!isRecord(value)) return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  }
  const exactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
    isPlainRecord(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
  const finiteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value)
  const closeNumber = (left: unknown, right: unknown): boolean =>
    finiteNumber(left) && finiteNumber(right) && Math.abs(left - right) <= epsilon
  const within = (value: unknown, min: number, max: number): value is number =>
    finiteNumber(value) && value >= min && value <= max
  const propertyField = (name: string) => ({ type: 'PROPERTY' as const, name })
  const messageOf = (error: unknown): string =>
    error instanceof Error ? error.message : String(error)
  const safeNodeId = (value: unknown): string | null => {
    try {
      return isRecord(value) && typeof value.id === 'string' ? value.id : null
    } catch {
      return null
    }
  }
  const sameFloat = (actual: unknown, expected: unknown): boolean =>
    exactKeys(actual, ['type', 'value']) &&
    exactKeys(expected, ['type', 'value']) &&
    actual.type === 'FLOAT' &&
    expected.type === 'FLOAT' &&
    closeNumber(actual.value, expected.value)

  const validFieldFloat = (field: string, value: unknown): boolean => {
    if (!exactKeys(value, ['type', 'value']) || value.type !== 'FLOAT') return false
    if (field === 'OPACITY') return within(value.value, 0, 1)
    if (field === 'ROTATION') return within(value.value, -36_000, 36_000)
    if (field === 'SCALE_X' || field === 'SCALE_Y') return within(value.value, 0, 100)
    return within(value.value, -100_000, 100_000)
  }

  const validEasing = (value: unknown): boolean => {
    if (!isPlainRecord(value) || typeof value.type !== 'string') return false
    if (value.type !== 'CUSTOM_CUBIC_BEZIER') {
      return (
        exactKeys(value, ['type']) &&
        ['LINEAR', 'EASE_IN', 'EASE_OUT', 'EASE_IN_AND_OUT'].includes(value.type)
      )
    }
    const curve = value.easingFunctionCubicBezier
    return (
      exactKeys(value, ['easingFunctionCubicBezier', 'type']) &&
      exactKeys(curve, ['x1', 'x2', 'y1', 'y2']) &&
      within(curve.x1, 0, 1) &&
      within(curve.y1, -100, 100) &&
      within(curve.x2, 0, 1) &&
      within(curve.y2, -100, 100)
    )
  }

  const sameEasing = (actual: unknown, expected: unknown): boolean => {
    // Figma supplies a default easing on the first keyframe even though that easing has no segment.
    if (expected === undefined) return true
    if (!isRecord(actual) || !isRecord(expected) || actual.type !== expected.type) return false
    if (expected.type !== 'CUSTOM_CUBIC_BEZIER') return true
    const left = actual.easingFunctionCubicBezier
    const right = expected.easingFunctionCubicBezier
    return (
      isRecord(left) &&
      isRecord(right) &&
      closeNumber(left.x1, right.x1) &&
      closeNumber(left.y1, right.y1) &&
      closeNumber(left.x2, right.x2) &&
      closeNumber(left.y2, right.y2)
    )
  }

  // oxlint-disable-next-line eslint/complexity -- Keeping request decoding inside the serialized zero-closure preserves identical fail-closed validation in package, plugin, and generated-script execution.
  const decodeOperation = (
    value: unknown,
    durationSeconds: number
  ): FigmaNativeMotionOperation | null => {
    if (!exactKeys(value, ['field', 'track'])) return null
    const field = value.field
    const track = value.track
    if (
      !exactKeys(field, ['name', 'type']) ||
      field.type !== 'PROPERTY' ||
      typeof field.name !== 'string' ||
      !supportedFields.includes(field.name) ||
      !exactKeys(track, ['baseValue', 'keyframes']) ||
      !validFieldFloat(field.name, track.baseValue) ||
      !Array.isArray(track.keyframes) ||
      track.keyframes.length < 2 ||
      track.keyframes.length > maxKeyframes
    ) {
      return null
    }
    let previousPosition = -Infinity
    const keyframes: FigmaNativeMotionOperation['track']['keyframes'] = []
    for (const candidate of track.keyframes) {
      const keys = isPlainRecord(candidate) ? Object.keys(candidate).sort().join(',') : ''
      if (keys !== 'timelinePosition,value' && keys !== 'easing,timelinePosition,value') return null
      if (
        !isPlainRecord(candidate) ||
        !finiteNumber(candidate.timelinePosition) ||
        candidate.timelinePosition < 0 ||
        candidate.timelinePosition <= previousPosition ||
        candidate.timelinePosition > durationSeconds + epsilon ||
        !validFieldFloat(field.name, candidate.value) ||
        (candidate.easing !== undefined && !validEasing(candidate.easing))
      ) {
        return null
      }
      previousPosition = candidate.timelinePosition
      keyframes.push({
        timelinePosition: candidate.timelinePosition,
        value: {
          type: 'FLOAT',
          value: (candidate.value as { value: number }).value
        },
        ...(candidate.easing === undefined
          ? {}
          : { easing: candidate.easing as FigmaNativeMotionEasing })
      })
    }
    return {
      field: { type: 'PROPERTY', name: field.name as FigmaNativeMotionFieldName },
      track: {
        baseValue: {
          type: 'FLOAT',
          value: (track.baseValue as { value: number }).value
        },
        keyframes
      }
    }
  }

  const signatureFor = (ownership: {
    version: number
    apiRevision: number
    durationSeconds: number
    operations: unknown[]
  }): string =>
    JSON.stringify({
      version: ownership.version,
      apiRevision: ownership.apiRevision,
      durationSeconds: ownership.durationSeconds,
      operations: ownership.operations
    })

  const decodeOwnershipValue = (
    value: unknown
  ):
    | { status: 'ok'; value: FigmaNativeMotionOwnershipRecord }
    | { status: 'invalid'; error: string } => {
    if (
      !exactKeys(value, [
        'apiRevision',
        'durationSeconds',
        'operations',
        'sourceSignature',
        'version'
      ]) ||
      value.version !== 1 ||
      value.apiRevision !== expectedApiRevision ||
      typeof value.sourceSignature !== 'string' ||
      value.sourceSignature.length === 0 ||
      value.sourceSignature.length > ownershipLimit ||
      !finiteNumber(value.durationSeconds) ||
      value.durationSeconds <= 0 ||
      value.durationSeconds > maxDurationSeconds ||
      !Array.isArray(value.operations) ||
      value.operations.length === 0 ||
      value.operations.length > supportedFields.length
    ) {
      return { status: 'invalid', error: 'Invalid ownership record shape' }
    }
    const operations: FigmaNativeMotionOperation[] = []
    for (const candidate of value.operations) {
      const operation = decodeOperation(candidate, value.durationSeconds)
      if (!operation) return { status: 'invalid', error: 'Invalid ownership operation' }
      operations.push(operation)
    }
    const names = operations.map((operation) => operation.field.name)
    if (new Set(names).size !== names.length) {
      return { status: 'invalid', error: 'Duplicate ownership fields' }
    }
    const ownership: FigmaNativeMotionOwnershipRecord = {
      version: 1,
      apiRevision: expectedApiRevision,
      sourceSignature: value.sourceSignature,
      durationSeconds: value.durationSeconds,
      operations
    }
    if (signatureFor(ownership) !== ownership.sourceSignature) {
      return { status: 'invalid', error: 'Ownership signature does not match its operations' }
    }
    return { status: 'ok', value: ownership }
  }

  const decodeOwnershipRaw = (
    raw: string
  ):
    | { status: 'none' }
    | { status: 'ok'; value: FigmaNativeMotionOwnershipRecord }
    | { status: 'invalid'; error: string } => {
    if (raw === '') return { status: 'none' }
    if (raw.length > ownershipLimit) {
      return { status: 'invalid', error: 'Ownership record is too large' }
    }
    try {
      return decodeOwnershipValue(JSON.parse(raw))
    } catch (error) {
      return { status: 'invalid', error: messageOf(error) }
    }
  }

  const decodeRequest = (value: unknown): FigmaNativeMotionApplyRequest | null => {
    const requestFields = isRecord(value) ? value.supportedFields : undefined
    if (
      !exactKeys(value, [
        'allowTimelineGrowth',
        'apiRevision',
        'conflictPolicy',
        'ownership',
        'ownershipKey',
        'ownershipNamespace',
        'schema',
        'supportedFields',
        'version'
      ]) ||
      value.schema !== expectedSchema ||
      value.version !== 1 ||
      value.apiRevision !== expectedApiRevision ||
      (value.conflictPolicy !== 'replace-owned' && value.conflictPolicy !== 'replace-all') ||
      typeof value.allowTimelineGrowth !== 'boolean' ||
      value.ownershipNamespace !== expectedOwnershipNamespace ||
      value.ownershipKey !== expectedOwnershipKey ||
      !Array.isArray(requestFields) ||
      requestFields.length !== supportedFields.length ||
      !supportedFields.every((field, index) => requestFields[index] === field)
    ) {
      return null
    }
    if (JSON.stringify(value).length > ownershipLimit) return null
    const ownership = decodeOwnershipValue(value.ownership)
    if (ownership.status !== 'ok') return null
    return {
      schema: expectedSchema,
      version: 1,
      apiRevision: expectedApiRevision,
      conflictPolicy: value.conflictPolicy,
      allowTimelineGrowth: value.allowTimelineGrowth,
      ownershipNamespace: expectedOwnershipNamespace,
      ownershipKey: expectedOwnershipKey,
      supportedFields: [...supportedFields] as FigmaNativeMotionFieldName[],
      ownership: ownership.value
    }
  }

  const baseResult = (
    status: FigmaNativeMotionTransactionStatus,
    code: string | null,
    message: string | null,
    nodeId: string | null,
    managedFields: FigmaNativeMotionFieldName[],
    preflightFingerprint: string | null
  ): FigmaNativeMotionTransactionResult => ({
    status,
    code,
    message,
    nodeId,
    timelineId: null,
    durationSeconds: null,
    managedFields,
    replacedForeignMotion: false,
    rolledBack: false,
    preflightFingerprint
  })

  const failed = (
    code: string,
    message: string,
    nodeId: string | null,
    managedFields: FigmaNativeMotionFieldName[],
    preflightFingerprint: string | null,
    rolledBack = false
  ): FigmaNativeMotionTransactionResult => ({
    ...baseResult('failed', code, message, nodeId, managedFields, preflightFingerprint),
    rolledBack
  })

  const conflict = (
    code: string,
    message: string,
    nodeId: string,
    managedFields: FigmaNativeMotionFieldName[],
    preflightFingerprint: string
  ): FigmaNativeMotionTransactionResult =>
    baseResult('conflict', code, message, nodeId, managedFields, preflightFingerprint)

  const canonicalState = (value: unknown): string => {
    const active = new Set<object>()
    const visit = (current: unknown): string => {
      if (current === null) return 'null'
      if (current === undefined) return 'undefined'
      if (typeof current === 'string') return `string:${JSON.stringify(current)}`
      if (typeof current === 'boolean') return `boolean:${String(current)}`
      if (typeof current === 'number') {
        return Number.isFinite(current) ? `number:${String(current)}` : `number:${String(current)}`
      }
      if (typeof current !== 'object') {
        throw new TypeError(`Unsupported Figma Motion readback value type: ${typeof current}`)
      }
      if (active.has(current)) return 'circular'
      active.add(current)
      let serialized: string
      if (Array.isArray(current)) {
        serialized = `[${current.map(visit).join(',')}]`
      } else {
        serialized = `{${Object.keys(current)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${visit(Reflect.get(current, key))}`)
          .join(',')}}`
      }
      active.delete(current)
      return serialized
    }
    return visit(value)
  }

  const fingerprintFor = (canonical: string): string => {
    let hash = 0x811c9dc5
    for (let index = 0; index < canonical.length; index++) {
      hash ^= canonical.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193)
    }
    return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}:${canonical.length}`
  }

  const captureState = (
    node: FigmaNativeMotionTransactionTarget,
    ownershipRaw: string
  ): { canonical: string; fingerprint: string } => {
    if (!Array.isArray(node.animationStyles)) {
      throw new TypeError('Figma Motion animation style readback is unavailable')
    }
    if (!isRecord(node.manualKeyframeTracks)) {
      throw new Error('Figma Motion manual track readback is unavailable')
    }
    if (!Array.isArray(node.timelines)) {
      throw new TypeError('Figma Motion timeline readback is unavailable')
    }
    const canonical = canonicalState({
      animationStyles: node.animationStyles,
      manualKeyframeTracks: node.manualKeyframeTracks,
      timelines: node.timelines,
      ownershipRaw
    })
    return { canonical, fingerprint: fingerprintFor(canonical) }
  }

  const existingPropertyNames = (tracks: Record<string, unknown>): string[] =>
    Object.keys(tracks).filter(
      (name) => !indexedCollections.includes(name) && tracks[name] !== undefined
    )
  const hasIndexedCollectionValue = (value: unknown): boolean => {
    if (value === undefined) return false
    if (Array.isArray(value)) {
      return value.length > 0 || Reflect.ownKeys(value).some((key) => key !== 'length')
    }
    if (isPlainRecord(value)) return Reflect.ownKeys(value).length > 0
    return true
  }
  const hasIndexedManualTracks = (tracks: Record<string, unknown>): boolean =>
    indexedCollections.some((name) => hasIndexedCollectionValue(tracks[name]))

  const bindingMatches = (binding: unknown, operation: FigmaNativeMotionOperation): boolean => {
    if (!isRecord(binding) || !sameFloat(binding.baseValue, operation.track.baseValue)) return false
    const keyframes = binding.keyframes
    if (!Array.isArray(keyframes)) return false
    if (keyframes.length !== operation.track.keyframes.length) return false
    return operation.track.keyframes.every((expected, index) => {
      const actual = keyframes[index]
      return (
        isRecord(actual) &&
        closeNumber(actual.timelinePosition, expected.timelinePosition) &&
        sameFloat(actual.value, expected.value) &&
        sameEasing(actual.easing, expected.easing)
      )
    })
  }
  const nativeMatches = (
    tracks: Record<string, unknown>,
    ownership: FigmaNativeMotionOwnershipRecord
  ): boolean =>
    ownership.operations.every((operation) =>
      bindingMatches(tracks[operation.field.name], operation)
    )
  const nativeMatchesExactly = (
    tracks: Record<string, unknown>,
    ownership: FigmaNativeMotionOwnershipRecord
  ): boolean => {
    const expectedNames = ownership.operations.map((operation) => operation.field.name)
    const actualNames = existingPropertyNames(tracks)
    return (
      actualNames.length === expectedNames.length &&
      expectedNames.every((name) => actualNames.includes(name)) &&
      !hasIndexedManualTracks(tracks) &&
      nativeMatches(tracks, ownership)
    )
  }

  const singleTimeline = (
    node: FigmaNativeMotionTransactionTarget
  ): { id: string; duration: number } | undefined => {
    if (!Array.isArray(node.timelines)) throw new Error('Figma Motion timelines are unavailable')
    if (node.timelines.length > 1) {
      throw new Error('Figma Motion timeline readback is ambiguous')
    }
    const timeline = node.timelines[0]
    if (timeline === undefined) return undefined
    if (
      !isRecord(timeline) ||
      typeof timeline.id !== 'string' ||
      !finiteNumber(timeline.duration) ||
      timeline.duration < 0
    ) {
      throw new Error('Figma Motion timeline readback is invalid')
    }
    return { id: timeline.id, duration: timeline.duration }
  }

  const initialNodeId = safeNodeId(target)
  let request: FigmaNativeMotionApplyRequest | null
  try {
    request = decodeRequest(requestInput)
  } catch {
    request = null
  }
  if (!request) {
    return failed(
      'adapter-config-invalid',
      'The Figma Motion adapter request is invalid',
      initialNodeId,
      [],
      null
    )
  }
  const managedFields = request.ownership.operations.map((operation) => operation.field.name)
  if (!target) {
    return failed('node-not-found', 'The target node was not found', null, managedFields, null)
  }
  const nodeId = initialNodeId
  try {
    if (
      nodeId === null ||
      typeof target.applyManualKeyframeTrack !== 'function' ||
      typeof target.removeManualKeyframeTrack !== 'function' ||
      typeof target.setTimelineDuration !== 'function' ||
      !isRecord(target.manualKeyframeTracks) ||
      !Array.isArray(target.animationStyles) ||
      !Array.isArray(target.timelines)
    ) {
      return failed(
        'motion-api-unavailable',
        'The selected node does not support the Figma Motion API',
        nodeId,
        managedFields,
        null
      )
    }
    if (
      typeof target.getSharedPluginData !== 'function' ||
      typeof target.setSharedPluginData !== 'function'
    ) {
      return failed(
        'ownership-api-unavailable',
        'The selected node cannot store Motion ownership safely',
        nodeId,
        managedFields,
        null
      )
    }
  } catch {
    return failed(
      'motion-api-unavailable',
      'The selected node Motion API capabilities could not be inspected safely',
      nodeId,
      managedFields,
      null
    )
  }
  try {
    if (typeof host.commitUndo !== 'function' || typeof host.triggerUndo !== 'function') {
      return failed(
        'undo-api-unavailable',
        'The plugin cannot guarantee an atomic Motion update',
        nodeId,
        managedFields,
        null
      )
    }
  } catch {
    return failed(
      'undo-api-unavailable',
      'The plugin undo capabilities could not be inspected safely',
      nodeId,
      managedFields,
      null
    )
  }

  let mutationStarted = false
  let preflight: { canonical: string; fingerprint: string } | null = null
  try {
    const rawOwnership = target.getSharedPluginData(
      request.ownershipNamespace,
      request.ownershipKey
    )
    const previous = decodeOwnershipRaw(rawOwnership)
    preflight = captureState(target, rawOwnership)
    const fingerprint = preflight.fingerprint
    const tracks = target.manualKeyframeTracks
    const animationStyles = target.animationStyles
    if (!isRecord(tracks) || !Array.isArray(animationStyles)) {
      throw new Error('Figma Motion capability readback changed during preflight')
    }
    const styles = [...animationStyles]
    const existingNames = existingPropertyNames(tracks)
    const unknownNames = existingNames.filter((name) => !removablePropertyFields.has(name))
    const destructive = request.conflictPolicy === 'replace-all'
    const ownedNames =
      previous.status === 'ok'
        ? new Set<string>(previous.value.operations.map((operation) => operation.field.name))
        : new Set<string>()
    const foreignNames = existingNames.filter((name) => !ownedNames.has(name))
    const replacesForeignMotion = destructive && (styles.length > 0 || foreignNames.length > 0)

    if (previous.status === 'invalid' && !destructive) {
      return conflict('ownership-invalid', previous.error, nodeId, managedFields, fingerprint)
    }
    if (styles.length > 0 && !destructive) {
      return conflict(
        'foreign-style',
        'The node has a Figma animation style that OpenPencil does not own',
        nodeId,
        managedFields,
        fingerprint
      )
    }
    if (hasIndexedManualTracks(tracks)) {
      return conflict(
        'foreign-indexed-track',
        'The node has indexed paint, stroke, or effect Motion tracks that cannot be replaced safely',
        nodeId,
        managedFields,
        fingerprint
      )
    }
    if (unknownNames.length > 0) {
      return conflict(
        'foreign-unknown-track',
        `The node has unknown native Motion tracks: ${unknownNames.join(', ')}`,
        nodeId,
        managedFields,
        fingerprint
      )
    }
    if (previous.status === 'none' && existingNames.length > 0 && !destructive) {
      return conflict(
        'foreign-track',
        'The node has native Motion tracks that OpenPencil does not own',
        nodeId,
        managedFields,
        fingerprint
      )
    }
    if (previous.status === 'ok' && !destructive) {
      if (foreignNames.length > 0) {
        return conflict(
          'foreign-track',
          `The node has additional native Motion tracks: ${foreignNames.join(', ')}`,
          nodeId,
          managedFields,
          fingerprint
        )
      }
      if (!nativeMatches(tracks, previous.value)) {
        return conflict(
          'native-edited',
          'The OpenPencil-owned native Motion tracks were edited in Figma',
          nodeId,
          managedFields,
          fingerprint
        )
      }
    }

    const timelineBefore = singleTimeline(target)
    const expectedTimelineDuration = Math.max(
      timelineBefore?.duration ?? 0,
      request.ownership.durationSeconds
    )
    if (
      timelineBefore &&
      timelineBefore.duration + epsilon < request.ownership.durationSeconds &&
      !request.allowTimelineGrowth
    ) {
      return conflict(
        'timeline-growth-required',
        'The containing Figma timeline is shared and must be explicitly allowed to grow',
        nodeId,
        managedFields,
        fingerprint
      )
    }
    if (
      previous.status === 'ok' &&
      !destructive &&
      previous.value.sourceSignature === request.ownership.sourceSignature &&
      timelineBefore &&
      timelineBefore.duration + epsilon >= request.ownership.durationSeconds
    ) {
      return {
        ...baseResult('unchanged', null, null, nodeId, managedFields, fingerprint),
        timelineId: timelineBefore.id,
        durationSeconds: timelineBefore.duration
      }
    }

    const serializedOwnership = JSON.stringify(request.ownership)
    if (serializedOwnership.length > ownershipLimit) {
      return failed(
        'ownership-too-large',
        'The Motion ownership record exceeds Figma shared plugin data limits',
        nodeId,
        managedFields,
        fingerprint
      )
    }
    if (destructive && styles.length > 0) {
      if (typeof target.removeAnimationStyle !== 'function') {
        return failed(
          'motion-api-unavailable',
          'The selected node cannot remove existing Figma animation styles',
          nodeId,
          managedFields,
          fingerprint
        )
      }
      if (styles.some((style) => !isRecord(style) || typeof style.id !== 'string')) {
        return failed(
          'motion-api-unavailable',
          'The selected node returned an invalid Figma animation style',
          nodeId,
          managedFields,
          fingerprint
        )
      }
    }

    host.commitUndo()
    mutationStarted = true

    if (destructive) {
      for (const style of styles) {
        if (!isRecord(style) || typeof style.id !== 'string') {
          throw new TypeError('The selected node returned an invalid Figma animation style')
        }
        if (typeof target.removeAnimationStyle !== 'function') {
          throw new TypeError('The selected node cannot remove existing Figma animation styles')
        }
        target.removeAnimationStyle(style.id)
      }
      for (const name of existingNames) {
        target.removeManualKeyframeTrack(propertyField(name) as FigmaNativeMotionOperation['field'])
      }
    } else if (previous.status === 'ok') {
      for (const operation of previous.value.operations) {
        target.removeManualKeyframeTrack(operation.field)
      }
    }
    for (const operation of request.ownership.operations) {
      target.applyManualKeyframeTrack(operation.field, operation.track)
    }

    let timeline = singleTimeline(target)
    if (!timeline) throw new Error('Figma did not create or expose a Motion timeline')
    const appliedTimelineId = timeline.id
    if (timelineBefore && appliedTimelineId !== timelineBefore.id) {
      throw new Error('Figma replaced the shared Motion timeline during apply')
    }
    if (timeline.duration + epsilon < expectedTimelineDuration) {
      target.setTimelineDuration(timeline.id, expectedTimelineDuration)
      timeline = singleTimeline(target)
    }
    if (
      !timeline ||
      timeline.id !== appliedTimelineId ||
      !closeNumber(timeline.duration, expectedTimelineDuration)
    ) {
      throw new Error('Figma Motion timeline readback did not preserve the exact expected state')
    }
    if (
      !isRecord(target.manualKeyframeTracks) ||
      !nativeMatchesExactly(target.manualKeyframeTracks, request.ownership)
    ) {
      throw new Error('Figma Motion track readback is not the exact requested property set')
    }
    if (!Array.isArray(target.animationStyles) || target.animationStyles.length !== 0) {
      throw new Error('Figma Motion style readback still contains an animation style')
    }

    target.setSharedPluginData(
      request.ownershipNamespace,
      request.ownershipKey,
      serializedOwnership
    )
    if (
      target.getSharedPluginData(request.ownershipNamespace, request.ownershipKey) !==
      serializedOwnership
    ) {
      throw new Error('Figma did not preserve the OpenPencil Motion ownership record')
    }

    host.commitUndo()
    mutationStarted = false
    return {
      ...baseResult('applied', null, null, nodeId, managedFields, fingerprint),
      timelineId: timeline.id,
      durationSeconds: timeline.duration,
      replacedForeignMotion: replacesForeignMotion
    }
  } catch (error) {
    let rolledBack = false
    if (mutationStarted && preflight) {
      try {
        host.triggerUndo()
        const rawAfterUndo = target.getSharedPluginData(
          request.ownershipNamespace,
          request.ownershipKey
        )
        const afterUndo = captureState(target, rawAfterUndo)
        rolledBack = afterUndo.canonical === preflight.canonical
      } catch {
        rolledBack = false
      }
    }
    return failed(
      'apply-failed',
      messageOf(error),
      nodeId,
      managedFields,
      preflight?.fingerprint ?? null,
      rolledBack
    )
  }
}

/** Runtime JavaScript expression for the same zero-closure transaction used by package callers. */
export function getFigmaNativeMotionTransactionSource(): string {
  const source = Function.prototype.toString.call(applyFigmaNativeMotionTransaction)
  if (source.includes('[native code]')) {
    throw new Error('Figma Motion transaction source is not serializable')
  }
  return `(${source})`
}

function ownershipFromPlan(plan: FigmaNativeMotionPlan): FigmaNativeMotionOwnershipRecord {
  assertSafeNativeMotionPlan(plan)
  return {
    version: 1,
    apiRevision: FIGMA_MOTION_API_REVISION,
    sourceSignature: plan.sourceSignature,
    durationSeconds: plan.durationSeconds,
    operations: plan.operations
  }
}

function assertSafeApplyOptions(value: unknown): asserts value is FigmaNativeMotionApplyOptions {
  if (!isPlainRecord(value)) {
    throw new TypeError('Figma Motion script options must be an object')
  }
  const unknownKeys = Object.keys(value).filter(
    (key) => !['conflictPolicy', 'allowTimelineGrowth'].includes(key)
  )
  if (unknownKeys.length > 0) {
    throw new TypeError(`Unknown Figma Motion script option: ${unknownKeys.join(', ')}`)
  }
  if (
    value.conflictPolicy !== undefined &&
    value.conflictPolicy !== 'replace-owned' &&
    value.conflictPolicy !== 'replace-all'
  ) {
    throw new TypeError('Figma Motion conflictPolicy must be replace-owned or replace-all')
  }
  if (value.allowTimelineGrowth !== undefined && typeof value.allowTimelineGrowth !== 'boolean') {
    throw new TypeError('Figma Motion allowTimelineGrowth must be a boolean')
  }
}

// oxlint-disable-next-line eslint/complexity -- The complete fail-closed schema guard is intentionally kept together so every executable plan field is audited before script generation.
function assertSafeNativeMotionPlan(value: unknown): asserts value is SafeFigmaNativeMotionPlan {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'apiRevision',
      'durationPolicy',
      'durationSeconds',
      'issues',
      'managedFields',
      'operations',
      'sourceSignature',
      'supported',
      'version',
      'warnings'
    ])
  ) {
    throw new TypeError('Cannot build a Figma Motion script for an unsupported or malformed plan')
  }
  const duration = value.durationSeconds
  const operations = value.operations
  if (
    value.version !== 1 ||
    value.apiRevision !== FIGMA_MOTION_API_REVISION ||
    value.supported !== true ||
    value.durationPolicy !== 'grow-only' ||
    typeof duration !== 'number' ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 120 ||
    !Array.isArray(operations) ||
    operations.length === 0 ||
    operations.length > FIGMA_NATIVE_MOTION_FIELDS.length ||
    !Array.isArray(value.managedFields) ||
    !Array.isArray(value.issues) ||
    value.issues.length !== 0 ||
    !Array.isArray(value.warnings) ||
    value.warnings.length > 2 ||
    !value.warnings.every(validWarning) ||
    typeof value.sourceSignature !== 'string' ||
    value.sourceSignature.length === 0 ||
    value.sourceSignature.length > 100_000
  ) {
    throw new TypeError('Cannot build a Figma Motion script for an unsupported or malformed plan')
  }

  const names: string[] = []
  for (const operation of operations) {
    if (!validOperation(operation, duration)) {
      throw new TypeError('Figma Motion plan contains an unsupported native track')
    }
    names.push(operation.field.name)
  }
  if (new Set(names).size !== names.length) {
    throw new TypeError('Figma Motion plan contains duplicate native fields')
  }
  const managedNames = value.managedFields.map((field) =>
    isPlainRecord(field) &&
    hasExactKeys(field, ['name', 'type']) &&
    field.type === 'PROPERTY' &&
    typeof field.name === 'string'
      ? field.name
      : undefined
  )
  if (
    managedNames.length !== names.length ||
    !names.every((name, index) => managedNames[index] === name)
  ) {
    throw new TypeError('Figma Motion managed fields do not match its operations')
  }
  const signature = JSON.stringify({
    version: 1,
    apiRevision: FIGMA_MOTION_API_REVISION,
    durationSeconds: duration,
    operations
  })
  if (value.sourceSignature !== signature) {
    throw new TypeError('Figma Motion plan signature does not match its operations')
  }
}

// oxlint-disable-next-line eslint/complexity -- Native operation validation mirrors the strict wire schema and is clearer as one auditable fail-closed predicate.
function validOperation(value: unknown, duration: number): value is FigmaNativeMotionOperation {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['field', 'track'])) return false
  const field = value.field
  const track = value.track
  if (
    !isPlainRecord(field) ||
    !hasExactKeys(field, ['name', 'type']) ||
    field.type !== 'PROPERTY' ||
    typeof field.name !== 'string' ||
    !FIGMA_NATIVE_MOTION_FIELDS.includes(field.name as FigmaNativeMotionFieldName) ||
    !isPlainRecord(track) ||
    !hasExactKeys(track, ['baseValue', 'keyframes']) ||
    !validFieldFloat(field.name, track.baseValue) ||
    !Array.isArray(track.keyframes) ||
    track.keyframes.length < 2 ||
    track.keyframes.length > 32
  ) {
    return false
  }
  let previousPosition = -Infinity
  for (const keyframe of track.keyframes) {
    if (!isPlainRecord(keyframe)) return false
    const keys = Object.keys(keyframe).sort().join(',')
    if (keys !== 'timelinePosition,value' && keys !== 'easing,timelinePosition,value') return false
    if (
      typeof keyframe.timelinePosition !== 'number' ||
      !Number.isFinite(keyframe.timelinePosition) ||
      keyframe.timelinePosition < 0 ||
      keyframe.timelinePosition <= previousPosition ||
      keyframe.timelinePosition > duration ||
      !validFieldFloat(field.name, keyframe.value) ||
      (keyframe.easing !== undefined && !validNativeEasing(keyframe.easing))
    ) {
      return false
    }
    previousPosition = keyframe.timelinePosition
  }
  return true
}

function validFieldFloat(field: string, value: unknown): boolean {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ['type', 'value']) ||
    value.type !== 'FLOAT' ||
    typeof value.value !== 'number' ||
    !Number.isFinite(value.value)
  ) {
    return false
  }
  if (field === 'OPACITY') return value.value >= 0 && value.value <= 1
  if (field === 'ROTATION') return value.value >= -36_000 && value.value <= 36_000
  if (field === 'SCALE_X' || field === 'SCALE_Y') {
    return value.value >= 0 && value.value <= 100
  }
  return value.value >= -100_000 && value.value <= 100_000
}

// oxlint-disable-next-line eslint/complexity -- Cubic-bezier bounds are intentionally explicit to make unsafe values visible during review.
function validNativeEasing(value: unknown): boolean {
  if (!isPlainRecord(value) || typeof value.type !== 'string') return false
  if (value.type !== 'CUSTOM_CUBIC_BEZIER') {
    return (
      hasExactKeys(value, ['type']) &&
      ['LINEAR', 'EASE_IN', 'EASE_OUT', 'EASE_IN_AND_OUT'].includes(value.type)
    )
  }
  const curve = value.easingFunctionCubicBezier
  return (
    hasExactKeys(value, ['easingFunctionCubicBezier', 'type']) &&
    isPlainRecord(curve) &&
    hasExactKeys(curve, ['x1', 'x2', 'y1', 'y2']) &&
    typeof curve.x1 === 'number' &&
    Number.isFinite(curve.x1) &&
    curve.x1 >= 0 &&
    curve.x1 <= 1 &&
    typeof curve.y1 === 'number' &&
    Number.isFinite(curve.y1) &&
    curve.y1 >= -100 &&
    curve.y1 <= 100 &&
    typeof curve.x2 === 'number' &&
    Number.isFinite(curve.x2) &&
    curve.x2 >= 0 &&
    curve.x2 <= 1 &&
    typeof curve.y2 === 'number' &&
    Number.isFinite(curve.y2) &&
    curve.y2 >= -100 &&
    curve.y2 <= 100
  )
}

function validWarning(value: unknown): value is FigmaNativeMotionWarning {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, ['code', 'message']) &&
    (value.code === 'reduced-motion-plugin-data' ||
      value.code === 'preset-provenance-plugin-data') &&
    typeof value.message === 'string' &&
    value.message.length <= 256
  )
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join(',') === [...expected].sort().join(',')
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
