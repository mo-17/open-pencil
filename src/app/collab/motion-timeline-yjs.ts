import * as Y from 'yjs'

import {
  ensureMotionTimelineIds,
  MOTION_LIMITS,
  parseMotionSpec,
  type MotionKeyframe,
  type MotionSpec,
  type MotionTrack
} from '@open-pencil/scene-graph'

export const MOTION_TIMELINES_DOC_KEY = 'motionTimelines'
export const MOTION_TIMELINE_LOCAL_ORIGIN = Symbol('open-pencil-motion-timeline')
export const MOTION_TIMELINE_CHECKPOINT_ORIGIN = Symbol('open-pencil-motion-timeline-checkpoint')

export const MOTION_TIMELINE_CRDT_LIMITS = Object.freeze({
  maxStoredTimelineNodes: 256,
  maxStoredTracksPerNode: 64,
  maxStoredKeyframesPerTrack: 128,
  maxValueDepth: 8,
  maxValueEntriesPerNode: 131_072,
  maxValueBytesPerNode: 2 * 1024 * 1024,
  maxArrayEntries: 1_024,
  maxObjectEntries: 64,
  maxStringCodeUnits: 16_384,
  maxConflicts: 32
})

export type MotionTimelineConflictCode =
  | 'invalid-timeline'
  | 'invalid-track'
  | 'insufficient-keyframes'
  | 'normalized-offsets'
  | 'partial-channel'
  | 'resource-limit'
  | 'tombstones-compacted'

export interface MotionTimelineConflict {
  nodeId: string
  code: MotionTimelineConflictCode
  trackId?: string
  keyframeId?: string
  message: string
}

export interface MotionTimelineReadResult {
  motion: MotionSpec | undefined
  conflicts: MotionTimelineConflict[]
}

export interface MotionTimelineCompactionResult {
  tracksRemoved: number
  keyframesRemoved: number
  liveTracksRemoved: number
  liveKeyframesRemoved: number
  invalidRecordsRemoved: number
  schemaFieldsRemoved: number
  resourceFieldsRemoved: number
}

type YRecord = Y.Map<unknown>
type YRecordMap = Y.Map<YRecord>

const KEYFRAME_CHANNELS = [
  'opacity',
  'x',
  'y',
  'scaleX',
  'scaleY',
  'rotate',
  'originX',
  'originY',
  'width',
  'height',
  'cornerRadius',
  'fillColor',
  'strokeColor',
  'strokeWidth',
  'blur',
  'shadowX',
  'shadowY',
  'shadowBlur',
  'shadowSpread',
  'shadowColor',
  'pathProgress',
  'trimStart',
  'trimEnd',
  'trimOffset',
  'gap',
  'rowGap',
  'columnGap',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'paints',
  'gradientStops',
  'effects',
  'cornerRadii',
  'textReveal',
  'fontAxes',
  'vectorMorph'
] as const satisfies readonly (keyof MotionKeyframe)[]

const TRACK_VALUE_KEYS = [
  'name',
  'trigger',
  'exit',
  'path'
] as const satisfies readonly (keyof MotionTrack)[]

const ROOT_KEYS = new Set(['version', 'reducedMotion', 'preset', 'tracks'])
const TRACK_KEYS = new Set([
  'deleted',
  'id',
  'order',
  ...TRACK_VALUE_KEYS,
  'timing',
  'composition',
  'keyframes'
])
const TRACK_PLAIN_VALUE_KEYS = ['id', 'order', ...TRACK_VALUE_KEYS] as const
const TIMING_KEYS = new Set(['durationMs', 'delayMs', 'easing', 'iterations', 'direction', 'fill'])
const COMPOSITION_KEYS = new Set(['mode', 'weight', 'priority'])
const KEYFRAME_KEYS = new Set(['deleted', 'id', 'order', 'offset', 'easing', ...KEYFRAME_CHANNELS])
const KEYFRAME_PLAIN_VALUE_KEYS = ['offset', 'easing', ...KEYFRAME_CHANNELS] as const
const SAFE_RECORD_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const DANGEROUS_RECORD_IDS = new Set(['constructor', 'prototype', '__proto__', 'javascript'])

type DecodeFailureKind = 'schema' | 'resource'

class MotionTimelineDecodeFailureError extends Error {
  constructor(
    readonly kind: DecodeFailureKind,
    message: string
  ) {
    super(message)
    this.name = 'MotionTimelineDecodeFailureError'
  }
}

interface DecodeBudget {
  entriesRemaining: number
  bytesRemaining: number
}

function createDecodeBudget(): DecodeBudget {
  return {
    entriesRemaining: MOTION_TIMELINE_CRDT_LIMITS.maxValueEntriesPerNode,
    bytesRemaining: MOTION_TIMELINE_CRDT_LIMITS.maxValueBytesPerNode
  }
}

function copyBudget(budget: DecodeBudget): DecodeBudget {
  return { ...budget }
}

function commitBudget(target: DecodeBudget, source: DecodeBudget): void {
  target.entriesRemaining = source.entriesRemaining
  target.bytesRemaining = source.bytesRemaining
}

function chargeBudget(budget: DecodeBudget, entries: number, bytes: number): void {
  if (entries > budget.entriesRemaining || bytes > budget.bytesRemaining) {
    throw new MotionTimelineDecodeFailureError(
      'resource',
      'Motion timeline payload budget exceeded'
    )
  }
  budget.entriesRemaining -= entries
  budget.bytesRemaining -= bytes
}

function stringBytes(value: string): number {
  if (value.length > MOTION_TIMELINE_CRDT_LIMITS.maxStringCodeUnits) {
    throw new MotionTimelineDecodeFailureError('resource', 'Motion timeline string limit exceeded')
  }
  // Four bytes per UTF-16 code unit is a conservative, allocation-free UTF-8 upper bound.
  return value.length * 4
}

function safeRecordId(value: string): boolean {
  return SAFE_RECORD_ID.test(value) && !DANGEROUS_RECORD_IDS.has(value.toLowerCase())
}

interface PrimitiveCloneResult {
  handled: boolean
  value: unknown
}

function cloneBoundedPrimitive(value: unknown, budget: DecodeBudget): PrimitiveCloneResult {
  if (value === null || value === undefined) {
    chargeBudget(budget, 1, 1)
    return { handled: true, value }
  }
  if (typeof value === 'string') {
    chargeBudget(budget, 1, stringBytes(value))
    return { handled: true, value }
  }
  if (typeof value === 'number') {
    chargeBudget(budget, 1, 8)
    return { handled: true, value }
  }
  if (typeof value === 'boolean') {
    chargeBudget(budget, 1, 1)
    return { handled: true, value }
  }
  return { handled: false, value }
}

function assertDensePlainArray(value: unknown[]): void {
  let fields = 0
  for (const key of Object.keys(value)) {
    fields++
    const numericKey = /^(0|[1-9][0-9]*)$/.test(key)
    if (fields > value.length || !numericKey || Number(key) >= value.length) {
      throw new MotionTimelineDecodeFailureError(
        'schema',
        'Sparse arrays and custom array fields are unsupported'
      )
    }
  }
  if (fields !== value.length) {
    throw new MotionTimelineDecodeFailureError(
      'schema',
      'Sparse Motion timeline arrays are unsupported'
    )
  }
}

function cloneBoundedArray(
  value: unknown[] | Y.Array<unknown>,
  budget: DecodeBudget,
  depth: number,
  seen: WeakSet<object>
): unknown[] {
  if (value.length > MOTION_TIMELINE_CRDT_LIMITS.maxArrayEntries) {
    throw new MotionTimelineDecodeFailureError('resource', 'Motion timeline array limit exceeded')
  }
  chargeBudget(budget, 1, 8)
  const result: unknown[] = []
  for (let index = 0; index < value.length; index++) {
    const item = Array.isArray(value) ? value[index] : value.get(index)
    result.push(cloneBoundedValue(item, budget, depth + 1, seen))
  }
  if (Array.isArray(value)) assertDensePlainArray(value)
  return result
}

function cloneBoundedYMap(
  value: Y.Map<unknown>,
  budget: DecodeBudget,
  depth: number,
  seen: WeakSet<object>
): Record<string, unknown> {
  if (value.size > MOTION_TIMELINE_CRDT_LIMITS.maxObjectEntries) {
    throw new MotionTimelineDecodeFailureError('resource', 'Motion timeline object limit exceeded')
  }
  const result: Record<string, unknown> = Object.create(null)
  chargeBudget(budget, 1, 8)
  for (const [key, item] of value.entries()) {
    chargeBudget(budget, 1, stringBytes(key))
    result[key] = cloneBoundedValue(item, budget, depth + 1, seen)
  }
  return result
}

function cloneBoundedPlainRecord(
  value: object,
  budget: DecodeBudget,
  depth: number,
  seen: WeakSet<object>
): Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new MotionTimelineDecodeFailureError(
      'schema',
      'Motion timeline values must use plain objects'
    )
  }
  const result: Record<string, unknown> = Object.create(null)
  chargeBudget(budget, 1, 8)
  let entries = 0
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue
    entries++
    if (entries > MOTION_TIMELINE_CRDT_LIMITS.maxObjectEntries) {
      throw new MotionTimelineDecodeFailureError(
        'resource',
        'Motion timeline object limit exceeded'
      )
    }
    chargeBudget(budget, 1, stringBytes(key))
    result[key] = cloneBoundedValue(Reflect.get(value, key), budget, depth + 1, seen)
  }
  return result
}

function cloneBoundedValue(
  value: unknown,
  budget: DecodeBudget,
  depth = 0,
  seen = new WeakSet<object>()
): unknown {
  if (depth > MOTION_TIMELINE_CRDT_LIMITS.maxValueDepth) {
    throw new MotionTimelineDecodeFailureError('resource', 'Motion timeline nesting limit exceeded')
  }
  const primitive = cloneBoundedPrimitive(value, budget)
  if (primitive.handled) return primitive.value
  if (value === null || typeof value !== 'object') {
    throw new MotionTimelineDecodeFailureError('schema', 'Unsupported Motion timeline value')
  }
  if (seen.has(value)) {
    throw new MotionTimelineDecodeFailureError(
      'schema',
      'Cyclic Motion timeline values are unsupported'
    )
  }
  seen.add(value)
  try {
    if (Array.isArray(value) || value instanceof Y.Array) {
      return cloneBoundedArray(value, budget, depth, seen)
    }
    if (value instanceof Y.Map) return cloneBoundedYMap(value, budget, depth, seen)
    return cloneBoundedPlainRecord(value, budget, depth, seen)
  } finally {
    seen.delete(value)
  }
}

function comparable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(comparable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${comparable(Reflect.get(value, key))}`)
      .join(',')}}`
  }
  const serialized = JSON.stringify(value)
  return typeof serialized === 'string' ? serialized : 'null'
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return Object.is(left, right) || comparable(left) === comparable(right)
}

function setIfChanged(map: YRecord, key: string, value: unknown): void {
  if (!valuesEqual(map.get(key), value)) map.set(key, structuredClone(value))
}

function deleteIfPresent(map: YRecord, key: string): void {
  if (map.has(key)) map.delete(key)
}

function syncOptionalValue(map: YRecord, key: string, value: unknown): void {
  if (value === undefined) deleteIfPresent(map, key)
  else setIfChanged(map, key, value)
}

function ensureRecord(map: YRecord, key: string): YRecord {
  const existing = map.get(key)
  if (existing instanceof Y.Map) return existing
  const created = new Y.Map<unknown>()
  map.set(key, created)
  return created
}

function ensureRecordMap(map: YRecord, key: string): YRecordMap {
  const existing = map.get(key)
  if (existing instanceof Y.Map) return existing as YRecordMap
  const created = new Y.Map<YRecord>()
  map.set(key, created)
  return created
}

function syncPlainRecord(target: YRecord, source: object): void {
  const keys = new Set(Object.keys(source))
  for (const key of target.keys()) {
    if (!keys.has(key)) target.delete(key)
  }
  for (const key of keys) setIfChanged(target, key, Reflect.get(source, key))
}

function activeRecord(map: YRecordMap, id: string): YRecord {
  let record = map.get(id)
  if (!(record instanceof Y.Map)) {
    record = new Y.Map<unknown>()
    map.set(id, record)
  }
  if (record.get('deleted') === true) record.delete('deleted')
  return record
}

function tombstoneMissing(map: YRecordMap, activeIds: ReadonlySet<string>): void {
  for (const [id, value] of map.entries()) {
    if (!activeIds.has(id) && value instanceof Y.Map && value.get('deleted') !== true) {
      value.set('deleted', true)
    }
  }
}

function syncKeyframes(track: MotionTrack, target: YRecord): void {
  const keyframes = ensureRecordMap(target, 'keyframes')
  const activeIds = new Set<string>()
  track.keyframes.forEach((keyframe, order) => {
    if (!keyframe.id) throw new Error(`MotionSpec v3 keyframe in ${track.id} has no stable id`)
    activeIds.add(keyframe.id)
    const frameMap = activeRecord(keyframes, keyframe.id)
    setIfChanged(frameMap, 'order', order)
    setIfChanged(frameMap, 'id', keyframe.id)
    const activeKeys = new Set(['order', 'id'])
    for (const key of Object.keys(keyframe)) {
      if (key === 'id') continue
      activeKeys.add(key)
      setIfChanged(frameMap, key, Reflect.get(keyframe, key))
    }
    for (const key of frameMap.keys()) {
      if (key !== 'deleted' && !activeKeys.has(key)) frameMap.delete(key)
    }
  })
  tombstoneMissing(keyframes, activeIds)
}

function syncTrack(track: MotionTrack, target: YRecord, order: number): void {
  setIfChanged(target, 'id', track.id)
  setIfChanged(target, 'order', order)
  for (const key of TRACK_VALUE_KEYS) syncOptionalValue(target, key, track[key])
  syncPlainRecord(ensureRecord(target, 'timing'), track.timing)
  if (track.composition) {
    syncPlainRecord(ensureRecord(target, 'composition'), track.composition)
  } else {
    deleteIfPresent(target, 'composition')
  }
  syncKeyframes(track, target)
}

/** Synchronize a validated v3 spec without replacing track/keyframe Y.Maps. */
export function syncMotionSpecToYMap(value: unknown, target: YRecord): MotionSpec {
  const spec = ensureMotionTimelineIds(value)
  if (spec.version !== 3)
    throw new Error('Fine-grained collaborative timelines require MotionSpec v3')

  setIfChanged(target, 'version', 3)
  syncOptionalValue(target, 'reducedMotion', spec.reducedMotion)
  syncOptionalValue(target, 'preset', spec.preset)

  const tracks = ensureRecordMap(target, 'tracks')
  const activeIds = new Set(spec.tracks.map(({ id }) => id))
  spec.tracks.forEach((track, order) => syncTrack(track, activeRecord(tracks, track.id), order))
  tombstoneMissing(tracks, activeIds)
  return spec
}

/** Mark every currently known track deleted while retaining causal tombstones. */
export function clearMotionSpecYMap(target: YRecord): void {
  const tracks = target.get('tracks')
  if (!(tracks instanceof Y.Map)) return
  for (const value of tracks.values()) {
    if (value instanceof Y.Map && value.get('deleted') !== true) value.set('deleted', true)
  }
}

function finiteOrder(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
}

function compareStableIds(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function compareRecords([leftId, left]: [string, YRecord], [rightId, right]: [string, YRecord]) {
  const byOrder = finiteOrder(left.get('order')) - finiteOrder(right.get('order'))
  return byOrder || compareStableIds(leftId, rightId)
}

function insertBoundedRecord(
  records: Array<[string, YRecord]>,
  entry: [string, YRecord],
  limit: number,
  compare: (left: [string, YRecord], right: [string, YRecord]) => number
): void {
  let index = 0
  while (index < records.length && compare(records[index], entry) <= 0) index++
  records.splice(index, 0, entry)
  if (records.length > limit) records.pop()
}

interface BoundedRecordResult {
  records: Array<[string, YRecord]>
  liveCount: number
  invalidCount: number
}

function boundedLiveRecords(map: YRecordMap, limit: number): BoundedRecordResult {
  const records: Array<[string, YRecord]> = []
  let liveCount = 0
  let invalidCount = 0
  for (const [id, value] of map.entries()) {
    if (!safeRecordId(id) || !(value instanceof Y.Map)) {
      invalidCount++
      continue
    }
    if (value.get('deleted') === true) continue
    liveCount++
    insertBoundedRecord(records, [id, value], limit, compareRecords)
  }
  return { records, liveCount, invalidCount }
}

function recordToPlain(
  map: YRecord,
  allowedKeys: ReadonlySet<string>,
  ignored: ReadonlySet<string>,
  budget: DecodeBudget
): Record<string, unknown> {
  if (map.size > allowedKeys.size) {
    throw new MotionTimelineDecodeFailureError(
      'schema',
      'Motion timeline record has unknown fields'
    )
  }
  for (const key of map.keys()) {
    if (!allowedKeys.has(key)) {
      throw new MotionTimelineDecodeFailureError(
        'schema',
        'Motion timeline record has unknown fields'
      )
    }
  }

  const trial = copyBudget(budget)
  const result: Record<string, unknown> = Object.create(null)
  for (const key of allowedKeys) {
    if (ignored.has(key) || !map.has(key)) continue
    chargeBudget(trial, 1, stringBytes(key))
    result[key] = cloneBoundedValue(map.get(key), trial)
  }
  commitBudget(budget, trial)
  return result
}

function conflict(
  conflicts: MotionTimelineConflict[],
  nodeId: string,
  code: MotionTimelineConflictCode,
  message: string,
  detail: Pick<MotionTimelineConflict, 'trackId' | 'keyframeId'> = {}
): void {
  if (conflicts.length >= MOTION_TIMELINE_CRDT_LIMITS.maxConflicts) return
  conflicts.push({ nodeId, code, message, ...detail })
}

function normalizeKeyframes(
  nodeId: string,
  trackId: string,
  keyframeMap: YRecordMap,
  conflicts: MotionTimelineConflict[],
  available: number,
  budget: DecodeBudget
): MotionKeyframe[] {
  if (keyframeMap.size > MOTION_TIMELINE_CRDT_LIMITS.maxStoredKeyframesPerTrack) {
    conflict(conflicts, nodeId, 'resource-limit', 'Keyframe storage limit was exceeded', {
      trackId
    })
    return []
  }
  const all = boundedLiveRecords(
    keyframeMap,
    Math.min(MOTION_LIMITS.maxKeyframes, Math.max(0, available))
  )
  if (all.invalidCount > 0) {
    conflict(conflicts, nodeId, 'invalid-track', 'Invalid keyframe records were ignored', {
      trackId
    })
  }
  if (all.liveCount > MOTION_LIMITS.maxKeyframes || all.liveCount > available) {
    conflict(conflicts, nodeId, 'resource-limit', 'Keyframe resource limit was applied', {
      trackId
    })
  }
  const frames = all.records.flatMap(([id, map]) => {
    let plain: Record<string, unknown>
    try {
      plain = recordToPlain(map, KEYFRAME_KEYS, new Set(['deleted', 'order', 'id']), budget)
    } catch (error) {
      const resource =
        error instanceof MotionTimelineDecodeFailureError && error.kind === 'resource'
      conflict(
        conflicts,
        nodeId,
        resource ? 'resource-limit' : 'invalid-track',
        resource
          ? 'A keyframe exceeding the payload budget was ignored'
          : 'A keyframe with unknown or unsafe fields was ignored',
        { trackId, keyframeId: id }
      )
      return []
    }
    if (typeof plain.offset !== 'number' || !Number.isFinite(plain.offset)) {
      conflict(
        conflicts,
        nodeId,
        'invalid-track',
        'A keyframe with an invalid offset was ignored',
        {
          trackId,
          keyframeId: id
        }
      )
      return []
    }
    const offset = Math.min(1, Math.max(0, plain.offset))
    if (offset !== plain.offset) {
      conflict(
        conflicts,
        nodeId,
        'normalized-offsets',
        'A concurrent keyframe offset outside the timeline was clamped',
        { trackId, keyframeId: id }
      )
    }
    return [{ ...plain, id, offset } as MotionKeyframe]
  })
  frames.sort(
    (left, right) => left.offset - right.offset || compareStableIds(left.id ?? '', right.id ?? '')
  )

  if (frames.length < 2) {
    conflict(
      conflicts,
      nodeId,
      'insufficient-keyframes',
      'A track with fewer than two live keyframes was removed',
      { trackId }
    )
    return []
  }

  let normalized = false
  if (frames[0].offset !== 0) {
    frames[0].offset = 0
    normalized = true
  }
  if (frames.at(-1)?.offset !== 1) {
    frames[frames.length - 1].offset = 1
    normalized = true
  }
  if (normalized) {
    conflict(conflicts, nodeId, 'normalized-offsets', 'Concurrent endpoint edits were normalized', {
      trackId
    })
  }

  for (const channel of KEYFRAME_CHANNELS) {
    const authored = frames.filter((frame) => frame[channel] !== undefined).length
    if (authored === 0 || authored === frames.length) continue
    for (const frame of frames) Reflect.deleteProperty(frame, channel)
    conflict(
      conflicts,
      nodeId,
      'partial-channel',
      `Concurrent ${channel} edits were removed because not every keyframe defined the channel`,
      { trackId }
    )
  }
  return frames
}

function decodeTrack(
  nodeId: string,
  trackId: string,
  map: YRecord,
  conflicts: MotionTimelineConflict[],
  availableKeyframes: number,
  budget: DecodeBudget
): MotionTrack | undefined {
  const keyframes = map.get('keyframes')
  if (!(keyframes instanceof Y.Map)) {
    conflict(conflicts, nodeId, 'invalid-track', 'A track without a keyframe map was removed', {
      trackId
    })
    return undefined
  }
  const normalizedFrames = normalizeKeyframes(
    nodeId,
    trackId,
    keyframes as YRecordMap,
    conflicts,
    availableKeyframes,
    budget
  )
  if (normalizedFrames.length < 2) return undefined

  const timing = map.get('timing')
  const composition = map.get('composition')
  let plain: Record<string, unknown>
  let timingValue: Record<string, unknown>
  let compositionValue: Record<string, unknown> | undefined
  try {
    plain = recordToPlain(
      map,
      TRACK_KEYS,
      new Set(['deleted', 'id', 'order', 'keyframes', 'timing', 'composition']),
      budget
    )
    timingValue =
      timing instanceof Y.Map ? recordToPlain(timing, TIMING_KEYS, new Set(), budget) : {}
    compositionValue =
      composition instanceof Y.Map
        ? recordToPlain(composition, COMPOSITION_KEYS, new Set(), budget)
        : undefined
  } catch (error) {
    const resource = error instanceof MotionTimelineDecodeFailureError && error.kind === 'resource'
    conflict(
      conflicts,
      nodeId,
      resource ? 'resource-limit' : 'invalid-track',
      resource
        ? 'A track exceeding the payload budget was ignored'
        : 'A track with unknown or unsafe fields was ignored',
      { trackId }
    )
    return undefined
  }
  const candidate = {
    ...plain,
    id: trackId,
    keyframes: normalizedFrames,
    timing: timingValue,
    ...(compositionValue ? { composition: compositionValue } : {})
  }
  try {
    return parseMotionSpec({ version: 3, tracks: [candidate] }).tracks[0]
  } catch {
    conflict(conflicts, nodeId, 'invalid-track', 'A concurrently invalid track was removed', {
      trackId
    })
    return undefined
  }
}

function validatedTrackMap(
  nodeId: string,
  source: YRecord,
  conflicts: MotionTimelineConflict[]
): YRecordMap | undefined {
  if (source.size > ROOT_KEYS.size || [...source.keys()].some((key) => !ROOT_KEYS.has(key))) {
    conflict(
      conflicts,
      nodeId,
      'invalid-timeline',
      'Collaborative timeline has unknown root fields'
    )
    return undefined
  }
  if (source.get('version') !== 3) {
    conflict(conflicts, nodeId, 'invalid-timeline', 'Unsupported collaborative timeline version')
    return undefined
  }
  const trackMap = source.get('tracks')
  if (!(trackMap instanceof Y.Map)) {
    conflict(conflicts, nodeId, 'invalid-timeline', 'Collaborative timeline has no track map')
    return undefined
  }
  if (trackMap.size > MOTION_TIMELINE_CRDT_LIMITS.maxStoredTracksPerNode) {
    conflict(conflicts, nodeId, 'resource-limit', 'Track storage limit was exceeded')
    return undefined
  }
  return trackMap as YRecordMap
}

function decodeTimelineTracks(
  nodeId: string,
  trackMap: YRecordMap,
  conflicts: MotionTimelineConflict[],
  budget: DecodeBudget
): MotionTrack[] {
  const records = boundedLiveRecords(trackMap, MOTION_LIMITS.maxTracks)
  if (records.invalidCount > 0) {
    conflict(conflicts, nodeId, 'invalid-timeline', 'Invalid track records were ignored')
  }
  if (records.liveCount > MOTION_LIMITS.maxTracks) {
    conflict(conflicts, nodeId, 'resource-limit', 'Track resource limit was applied')
  }
  const tracks: MotionTrack[] = []
  let keyframesRemaining = MOTION_LIMITS.maxKeyframes
  for (const [trackId, map] of records.records) {
    const trial = copyBudget(budget)
    const track = decodeTrack(nodeId, trackId, map, conflicts, keyframesRemaining, trial)
    if (!track) continue
    commitBudget(budget, trial)
    tracks.push(track)
    keyframesRemaining -= track.keyframes.length
    if (keyframesRemaining < 2) break
  }
  return tracks
}

interface MetadataReadResult {
  present: boolean
  value?: unknown
}

function readTimelineMetadata(
  nodeId: string,
  source: YRecord,
  key: 'reducedMotion' | 'preset',
  budget: DecodeBudget,
  conflicts: MotionTimelineConflict[]
): MetadataReadResult {
  const value = source.get(key)
  if (value === undefined) return { present: false }
  const trial = copyBudget(budget)
  try {
    const cloned = cloneBoundedValue(value, trial)
    commitBudget(budget, trial)
    return { present: true, value: cloned }
  } catch (error) {
    const resource = error instanceof MotionTimelineDecodeFailureError && error.kind === 'resource'
    conflict(
      conflicts,
      nodeId,
      resource ? 'resource-limit' : 'invalid-timeline',
      key === 'preset'
        ? 'Timeline preset payload was discarded'
        : 'Timeline metadata payload was discarded'
    )
    return { present: false }
  }
}

function parseTimelineCandidate(
  nodeId: string,
  candidate: Record<string, unknown>,
  conflicts: MotionTimelineConflict[]
): MotionTimelineReadResult {
  try {
    return { motion: parseMotionSpec(candidate), conflicts }
  } catch {
    delete candidate.preset
    delete candidate.reducedMotion
    try {
      conflict(
        conflicts,
        nodeId,
        'invalid-timeline',
        'Invalid concurrent timeline metadata was discarded'
      )
      return { motion: parseMotionSpec(candidate), conflicts }
    } catch {
      conflict(conflicts, nodeId, 'invalid-timeline', 'Invalid collaborative timeline was cleared')
      return { motion: undefined, conflicts }
    }
  }
}

/** Decode a deterministic bounded snapshot from the converged timeline CRDT. */
export function readMotionSpecFromYMap(nodeId: string, source: YRecord): MotionTimelineReadResult {
  const conflicts: MotionTimelineConflict[] = []
  const trackMap = validatedTrackMap(nodeId, source, conflicts)
  if (!trackMap) return { motion: undefined, conflicts }

  const budget = createDecodeBudget()
  const tracks = decodeTimelineTracks(nodeId, trackMap, conflicts, budget)
  if (tracks.length === 0) return { motion: undefined, conflicts }

  const candidate: Record<string, unknown> = { version: 3, tracks }
  const reducedMotion = readTimelineMetadata(nodeId, source, 'reducedMotion', budget, conflicts)
  const preset = readTimelineMetadata(nodeId, source, 'preset', budget, conflicts)
  if (reducedMotion.present) candidate.reducedMotion = reducedMotion.value
  if (preset.present) candidate.preset = preset.value
  return parseTimelineCandidate(nodeId, candidate, conflicts)
}

interface RecordCompactionResult {
  removed: number
  liveRemoved: number
  invalidRemoved: number
}

function compareTombstones([leftId]: [string, YRecord], [rightId]: [string, YRecord]): number {
  return compareStableIds(leftId, rightId)
}

function compactRecordMap(map: YRecordMap, limit: number): RecordCompactionResult {
  const live = boundedLiveRecords(map, limit)
  const keep = new Set(live.records.map(([id]) => id))
  const tombstoneCapacity = Math.max(0, limit - keep.size)
  const tombstones: Array<[string, YRecord]> = []
  for (const [id, value] of map.entries()) {
    if (!safeRecordId(id) || !(value instanceof Y.Map) || value.get('deleted') !== true) continue
    insertBoundedRecord(tombstones, [id, value], tombstoneCapacity, compareTombstones)
  }
  for (const [id] of tombstones) keep.add(id)

  let removed = 0
  let liveRemoved = 0
  let invalidRemoved = 0
  for (const [id, value] of map.entries()) {
    if (keep.has(id)) continue
    if (!safeRecordId(id) || !(value instanceof Y.Map)) invalidRemoved++
    else if (value.get('deleted') !== true) liveRemoved++
    map.delete(id)
    removed++
  }
  return { removed, liveRemoved, invalidRemoved }
}

interface SanitizeCounters {
  schemaFieldsRemoved: number
  resourceFieldsRemoved: number
}

function removeUnknownFields(
  map: YRecord,
  allowed: ReadonlySet<string>,
  counters: SanitizeCounters
): void {
  for (const key of map.keys()) {
    if (allowed.has(key)) continue
    map.delete(key)
    counters.schemaFieldsRemoved++
  }
}

function sanitizeValueField(
  map: YRecord,
  key: string,
  budget: DecodeBudget,
  counters: SanitizeCounters
): void {
  if (!map.has(key)) return
  const trial = copyBudget(budget)
  try {
    chargeBudget(trial, 1, stringBytes(key))
    cloneBoundedValue(map.get(key), trial)
    commitBudget(budget, trial)
  } catch (error) {
    map.delete(key)
    if (error instanceof MotionTimelineDecodeFailureError && error.kind === 'resource') {
      counters.resourceFieldsRemoved++
    } else {
      counters.schemaFieldsRemoved++
    }
  }
}

function sanitizeNestedRecord(
  owner: YRecord,
  key: string,
  allowed: ReadonlySet<string>,
  budget: DecodeBudget,
  counters: SanitizeCounters
): YRecord | undefined {
  const value = owner.get(key)
  if (!(value instanceof Y.Map)) {
    if (owner.has(key)) {
      owner.delete(key)
      counters.schemaFieldsRemoved++
    }
    return undefined
  }
  removeUnknownFields(value, allowed, counters)
  for (const field of allowed) sanitizeValueField(value, field, budget, counters)
  return value
}

function recordsForSanitize(map: YRecordMap): Array<[string, YRecord]> {
  const records: Array<[string, YRecord]> = []
  for (const [id, value] of map.entries()) {
    if (safeRecordId(id) && value instanceof Y.Map) records.push([id, value])
  }
  return records.sort((left, right) => {
    const leftDeleted = left[1].get('deleted') === true
    const rightDeleted = right[1].get('deleted') === true
    if (leftDeleted !== rightDeleted) return leftDeleted ? 1 : -1
    return leftDeleted ? compareTombstones(left, right) : compareRecords(left, right)
  })
}

function sanitizeKeyframe(map: YRecord, budget: DecodeBudget, counters: SanitizeCounters): void {
  removeUnknownFields(map, KEYFRAME_KEYS, counters)
  for (const key of KEYFRAME_PLAIN_VALUE_KEYS) sanitizeValueField(map, key, budget, counters)
  for (const key of ['id', 'order', 'deleted']) sanitizeValueField(map, key, budget, counters)
}

function sanitizeTrack(
  map: YRecord,
  budget: DecodeBudget,
  counters: SanitizeCounters
): RecordCompactionResult {
  removeUnknownFields(map, TRACK_KEYS, counters)
  for (const key of TRACK_PLAIN_VALUE_KEYS) sanitizeValueField(map, key, budget, counters)
  for (const key of ['deleted']) sanitizeValueField(map, key, budget, counters)
  sanitizeNestedRecord(map, 'timing', TIMING_KEYS, budget, counters)
  sanitizeNestedRecord(map, 'composition', COMPOSITION_KEYS, budget, counters)

  const keyframes = map.get('keyframes')
  if (!(keyframes instanceof Y.Map)) {
    if (map.has('keyframes')) {
      map.delete('keyframes')
      counters.schemaFieldsRemoved++
    }
    return { removed: 0, liveRemoved: 0, invalidRemoved: 0 }
  }
  const compacted = compactRecordMap(
    keyframes as YRecordMap,
    MOTION_TIMELINE_CRDT_LIMITS.maxStoredKeyframesPerTrack
  )
  for (const [, frame] of recordsForSanitize(keyframes as YRecordMap)) {
    sanitizeKeyframe(frame, budget, counters)
  }
  return compacted
}

/**
 * Apply the deterministic collaboration checkpoint. It bounds both live records and tombstones,
 * removes unknown CRDT fields before decoding, and quarantines values outside the node-wide
 * depth/entry/byte budget. Callers should transact this operation with observer re-entry suppressed.
 */
export function compactMotionTimelineYMap(source: YRecord): MotionTimelineCompactionResult {
  const counters: SanitizeCounters = { schemaFieldsRemoved: 0, resourceFieldsRemoved: 0 }
  const budget = createDecodeBudget()
  removeUnknownFields(source, ROOT_KEYS, counters)
  for (const key of ['version', 'reducedMotion', 'preset']) {
    sanitizeValueField(source, key, budget, counters)
  }

  const tracks = source.get('tracks')
  if (!(tracks instanceof Y.Map)) {
    if (source.has('tracks')) {
      source.delete('tracks')
      counters.schemaFieldsRemoved++
    }
    return {
      tracksRemoved: 0,
      keyframesRemoved: 0,
      liveTracksRemoved: 0,
      liveKeyframesRemoved: 0,
      invalidRecordsRemoved: 0,
      ...counters
    }
  }

  const trackCompaction = compactRecordMap(
    tracks as YRecordMap,
    MOTION_TIMELINE_CRDT_LIMITS.maxStoredTracksPerNode
  )
  let keyframesRemoved = 0
  let liveKeyframesRemoved = 0
  let invalidRecordsRemoved = trackCompaction.invalidRemoved
  for (const [, track] of recordsForSanitize(tracks as YRecordMap)) {
    const compacted = sanitizeTrack(track, budget, counters)
    keyframesRemoved += compacted.removed
    liveKeyframesRemoved += compacted.liveRemoved
    invalidRecordsRemoved += compacted.invalidRemoved
  }
  return {
    tracksRemoved: trackCompaction.removed,
    keyframesRemoved,
    liveTracksRemoved: trackCompaction.liveRemoved,
    liveKeyframesRemoved,
    invalidRecordsRemoved,
    ...counters
  }
}

export function createMotionTimelineUndoManager(timelines: Y.Map<YRecord>): Y.UndoManager {
  return new Y.UndoManager(timelines, {
    trackedOrigins: new Set([MOTION_TIMELINE_LOCAL_ORIGIN]),
    captureTimeout: 350
  })
}
