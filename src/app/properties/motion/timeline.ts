import {
  applyMotionDirection,
  motionEndProgress,
  resolveMotionTrackIterations,
  splitMotionEasing
} from '@open-pencil/core/motion'
import {
  MOTION_LIMITS,
  type MotionColor,
  type MotionCompositeMode,
  type MotionDirection,
  type MotionEasing,
  type MotionFill,
  type MotionKeyframe,
  type MotionSpec,
  type MotionTrack,
  type MotionTrigger
} from '@open-pencil/scene-graph'

import {
  editAuthoredMotionSpec as editMotionSpec,
  requireMotionTrack as findTrack
} from './spec-edit'
import {
  MOTION_V2_COLOR_CHANNELS,
  MOTION_V2_NUMERIC_CHANNELS,
  motionV2NumericLimit,
  type MotionV2ColorChannel,
  type MotionV2NumericChannel
} from './v2'

export const MOTION_CHANNELS = ['opacity', 'x', 'y', 'scaleX', 'scaleY', 'rotate'] as const

export type MotionChannel = (typeof MOTION_CHANNELS)[number]

const MOTION_CHANNEL_LIMITS = {
  opacity: MOTION_LIMITS.opacity,
  x: MOTION_LIMITS.translate,
  y: MOTION_LIMITS.translate,
  scaleX: MOTION_LIMITS.scale,
  scaleY: MOTION_LIMITS.scale,
  rotate: MOTION_LIMITS.rotate
} as const satisfies Record<MotionChannel, { min: number; max: number }>

export interface MotionTrackTimingPatch {
  durationMs?: number
  delayMs?: number
  easing?: MotionEasing
  iterations?: number | 'infinite'
  direction?: MotionDirection
  fill?: MotionFill
}

export interface MotionTrackCompositionPatch {
  mode?: MotionCompositeMode
  weight?: number
  priority?: number
}

function totalKeyframes(spec: MotionSpec): number {
  return spec.tracks.reduce((total, track) => total + track.keyframes.length, 0)
}

function channelIdentity(channel: MotionChannel): number {
  return channel === 'opacity' || channel === 'scaleX' || channel === 'scaleY' ? 1 : 0
}

function clampChannel(channel: MotionChannel, value: number): number {
  const limits = MOTION_CHANNEL_LIMITS[channel]
  return Math.min(limits.max, Math.max(limits.min, value))
}

interface InterpolatedValue<T> {
  value: T | undefined
  clamped: boolean
}

function interpolatedNumber(
  before: MotionKeyframe,
  after: MotionKeyframe,
  channel: MotionV2NumericChannel | 'pathProgress',
  progress: number
): InterpolatedValue<number> {
  const from = before[channel]
  const to = after[channel]
  if (from === undefined && to === undefined) return { value: undefined, clamped: false }

  const sampled = (from ?? to ?? 0) + ((to ?? from ?? 0) - (from ?? to ?? 0)) * progress
  const limits =
    channel === 'pathProgress' ? MOTION_LIMITS.normalized : motionV2NumericLimit(channel)
  const value = Math.min(limits.max, Math.max(limits.min, sampled))
  return { value, clamped: value !== sampled }
}

function interpolatedColor(
  before: MotionKeyframe,
  after: MotionKeyframe,
  channel: MotionV2ColorChannel,
  progress: number
): InterpolatedValue<MotionColor> {
  const from = before[channel]
  const to = after[channel]
  if (!from && !to) return { value: undefined, clamped: false }

  const start = from ?? to
  const end = to ?? from
  if (!start || !end) return { value: undefined, clamped: false }
  let clamped = false
  const component = (key: keyof MotionColor): number => {
    const sampled = start[key] + (end[key] - start[key]) * progress
    const value = Math.min(1, Math.max(0, sampled))
    if (value !== sampled) clamped = true
    return value
  }
  return {
    value: { r: component('r'), g: component('g'), b: component('b'), a: component('a') },
    clamped
  }
}

function interpolateLegacyChannels(
  frame: MotionKeyframe,
  before: MotionKeyframe,
  after: MotionKeyframe,
  progress: number
): boolean {
  let clampedValue = false
  for (const channel of MOTION_CHANNELS) {
    if (before[channel] === undefined && after[channel] === undefined) continue
    const from = before[channel] ?? channelIdentity(channel)
    const to = after[channel] ?? channelIdentity(channel)
    const sampled = from + (to - from) * progress
    const clamped = clampChannel(channel, sampled)
    if (clamped !== sampled) clampedValue = true
    frame[channel] = clamped
  }
  return clampedValue
}

function interpolateAdvancedChannels(
  frame: MotionKeyframe,
  before: MotionKeyframe,
  after: MotionKeyframe,
  hasPath: boolean,
  progress: number
): boolean {
  let clampedValue = false
  if (hasPath) {
    const sampled = interpolatedNumber(before, after, 'pathProgress', progress)
    if (sampled.value !== undefined) frame.pathProgress = sampled.value
    if (sampled.clamped) clampedValue = true
  }
  for (const channel of MOTION_V2_NUMERIC_CHANNELS) {
    const sampled = interpolatedNumber(before, after, channel, progress)
    if (sampled.value !== undefined) frame[channel] = sampled.value
    if (sampled.clamped) clampedValue = true
  }
  for (const channel of MOTION_V2_COLOR_CHANNELS) {
    const sampled = interpolatedColor(before, after, channel, progress)
    if (sampled.value) frame[channel] = sampled.value
    if (sampled.clamped) clampedValue = true
  }
  return clampedValue
}

function interpolatedKeyframe(track: MotionTrack, offset: number): MotionKeyframe {
  const beforeIndex = track.keyframes.findLastIndex((keyframe) => keyframe.offset < offset)
  const before = track.keyframes.at(beforeIndex)
  const after = track.keyframes.find((keyframe) => keyframe.offset > offset)
  const frame: MotionKeyframe = { offset }
  if (!before || !after) return frame

  const span = after.offset - before.offset
  const progress = span > 0 ? (offset - before.offset) / span : 0
  const easing = before.easing ?? track.timing.easing ?? 'ease'
  const split = splitMotionEasing(easing, progress)
  const clampedLegacy = interpolateLegacyChannels(frame, before, after, split.value)
  const clampedAdvanced = interpolateAdvancedChannels(
    frame,
    before,
    after,
    track.path !== undefined,
    split.value
  )
  const canPreserveCurve = split.exact && !clampedLegacy && !clampedAdvanced
  if (canPreserveCurve) {
    before.easing = split.before
    frame.easing = split.after
  }
  return frame
}

function nextTrackId(spec: MotionSpec): string {
  const existing = new Set(spec.tracks.map((track) => track.id))
  for (let index = 1; index <= MOTION_LIMITS.maxTracks + 1; index++) {
    const id = `track-${index}`
    if (!existing.has(id)) return id
  }
  throw new Error('Unable to allocate a unique motion track id')
}

function trackIndex(spec: MotionSpec, trackId: string): number {
  const index = spec.tracks.findIndex((track) => track.id === trackId)
  if (index === -1) throw new Error(`Unknown motion track: ${trackId}`)
  return index
}

function duplicateKeyframeOffset(track: MotionTrack, keyframeIndex: number): number {
  const source = track.keyframes.at(keyframeIndex)
  if (!source) throw new Error(`Unknown motion keyframe index: ${keyframeIndex}`)

  const next = track.keyframes.at(keyframeIndex + 1)
  if (next && next.offset > source.offset) return (source.offset + next.offset) / 2

  const previous = track.keyframes.at(keyframeIndex - 1)
  if (previous && source.offset > previous.offset) return (previous.offset + source.offset) / 2

  let largestGap = -1
  let offset = source.offset
  for (let index = 1; index < track.keyframes.length; index++) {
    const left = track.keyframes.at(index - 1)
    const right = track.keyframes.at(index)
    if (!left || !right) continue
    const gap = right.offset - left.offset
    if (gap > largestGap) {
      largestGap = gap
      offset = (left.offset + right.offset) / 2
    }
  }
  return offset
}

export function addMotionTrack(
  spec: MotionSpec,
  options: {
    trigger?: MotionTrigger
    durationMs?: number
    delayMs?: number
  } = {}
): MotionSpec {
  if (spec.tracks.length >= MOTION_LIMITS.maxTracks) {
    throw new RangeError(`Motion supports at most ${MOTION_LIMITS.maxTracks} tracks`)
  }
  if (totalKeyframes(spec) + 2 > MOTION_LIMITS.maxKeyframes) {
    throw new RangeError(`Motion supports at most ${MOTION_LIMITS.maxKeyframes} keyframes`)
  }

  return editMotionSpec(spec, (draft) => {
    draft.tracks.push({
      id: nextTrackId(draft),
      trigger: options.trigger ?? 'mount',
      keyframes: [{ offset: 0 }, { offset: 1 }],
      timing: {
        durationMs: options.durationMs ?? 400,
        delayMs: options.delayMs ?? 0,
        easing: 'ease-out',
        iterations: 1,
        direction: 'normal',
        fill: 'both'
      },
      exit: 'none'
    })
  })
}

export function removeMotionTrack(spec: MotionSpec, trackId: string): MotionSpec {
  if (spec.tracks.length <= 1) throw new RangeError('Motion requires at least one track')
  return editMotionSpec(spec, (draft) => {
    const index = draft.tracks.findIndex((track) => track.id === trackId)
    if (index === -1) throw new Error(`Unknown motion track: ${trackId}`)
    draft.tracks.splice(index, 1)
  })
}

export function renameMotionTrack(
  spec: MotionSpec,
  trackId: string,
  nextTrackId: string
): MotionSpec {
  const trimmedId = nextTrackId.trim()
  if (trimmedId === trackId) return spec
  if (spec.tracks.some((track) => track.id === trimmedId)) {
    throw new RangeError(`Motion track id already exists: ${trimmedId}`)
  }
  return editMotionSpec(spec, (draft) => {
    findTrack(draft, trackId).id = trimmedId
  })
}

export function duplicateMotionTrack(
  spec: MotionSpec,
  trackId: string
): { spec: MotionSpec; trackId: string } {
  if (spec.tracks.length >= MOTION_LIMITS.maxTracks) {
    throw new RangeError(`Motion supports at most ${MOTION_LIMITS.maxTracks} tracks`)
  }
  const sourceIndex = trackIndex(spec, trackId)
  const source = spec.tracks.at(sourceIndex)
  if (!source) throw new Error(`Unknown motion track: ${trackId}`)
  if (totalKeyframes(spec) + source.keyframes.length > MOTION_LIMITS.maxKeyframes) {
    throw new RangeError(`Motion supports at most ${MOTION_LIMITS.maxKeyframes} keyframes`)
  }

  let createdId = ''
  const next = editMotionSpec(spec, (draft) => {
    const draftSource = draft.tracks.at(sourceIndex)
    if (!draftSource) throw new Error(`Unknown motion track: ${trackId}`)
    createdId = nextTrackId(draft)
    draft.tracks.splice(sourceIndex + 1, 0, { ...structuredClone(draftSource), id: createdId })
  })
  return { spec: next, trackId: createdId }
}

export function reorderMotionTrack(spec: MotionSpec, trackId: string, toIndex: number): MotionSpec {
  const fromIndex = trackIndex(spec, trackId)
  const boundedIndex = Math.min(spec.tracks.length - 1, Math.max(0, toIndex))
  if (fromIndex === boundedIndex) return spec
  return editMotionSpec(spec, (draft) => {
    const track = draft.tracks.splice(fromIndex, 1).at(0)
    if (!track) throw new Error(`Unknown motion track: ${trackId}`)
    draft.tracks.splice(boundedIndex, 0, track)
  })
}

export function setMotionTrackTrigger(
  spec: MotionSpec,
  trackId: string,
  trigger: MotionTrigger
): MotionSpec {
  return editMotionSpec(spec, (draft) => {
    findTrack(draft, trackId).trigger = trigger
  })
}

export function setMotionTrackName(
  spec: MotionSpec,
  trackId: string,
  name: string | undefined
): MotionSpec {
  if (spec.version !== 3) throw new RangeError('Track labels require MotionSpec v3')
  return editMotionSpec(spec, (draft) => {
    const track = findTrack(draft, trackId)
    const normalized = name?.trim()
    if (normalized) track.name = normalized
    else delete track.name
  })
}

export function setMotionTrackComposition(
  spec: MotionSpec,
  trackId: string,
  patch: MotionTrackCompositionPatch
): MotionSpec {
  if (spec.version !== 3) throw new RangeError('Track composition requires MotionSpec v3')
  return editMotionSpec(spec, (draft) => {
    const track = findTrack(draft, trackId)
    const current = track.composition ?? { mode: 'replace' as const }
    const weight = patch.weight ?? current.weight
    const priority = patch.priority ?? current.priority
    track.composition = {
      mode: patch.mode ?? current.mode,
      ...(weight === undefined ? {} : { weight }),
      ...(priority === undefined ? {} : { priority })
    }
  })
}

export function setMotionTrackTiming(
  spec: MotionSpec,
  trackId: string,
  patch: MotionTrackTimingPatch
): MotionSpec {
  return editMotionSpec(spec, (draft) => {
    const timing = findTrack(draft, trackId).timing
    if (patch.durationMs !== undefined) timing.durationMs = patch.durationMs
    if (patch.delayMs !== undefined) timing.delayMs = patch.delayMs
    if (patch.easing !== undefined) timing.easing = patch.easing
    if (patch.iterations !== undefined) timing.iterations = patch.iterations
    if (patch.direction !== undefined) timing.direction = patch.direction
    if (patch.fill !== undefined) timing.fill = patch.fill
  })
}

export function setMotionTrackExit(
  spec: MotionSpec,
  trackId: string,
  exit: NonNullable<MotionTrack['exit']>
): MotionSpec {
  return editMotionSpec(spec, (draft) => {
    findTrack(draft, trackId).exit = exit
  })
}

export function addMotionKeyframe(
  spec: MotionSpec,
  trackId: string,
  offset: number
): { spec: MotionSpec; index: number } {
  const boundedOffset = Math.min(1, Math.max(0, offset))
  const currentTrack = findTrack(spec, trackId)
  const existingIndex = currentTrack.keyframes.findIndex(
    (keyframe) => Math.abs(keyframe.offset - boundedOffset) < 0.0001
  )
  if (existingIndex !== -1) return { spec, index: existingIndex }
  if (totalKeyframes(spec) >= MOTION_LIMITS.maxKeyframes) {
    throw new RangeError(`Motion supports at most ${MOTION_LIMITS.maxKeyframes} keyframes`)
  }

  let insertedIndex = 0
  const next = editMotionSpec(spec, (draft) => {
    const track = findTrack(draft, trackId)
    insertedIndex = track.keyframes.findIndex((keyframe) => keyframe.offset > boundedOffset)
    if (insertedIndex < 0) insertedIndex = track.keyframes.length
    track.keyframes.splice(insertedIndex, 0, interpolatedKeyframe(track, boundedOffset))
  })
  return { spec: next, index: insertedIndex }
}

export function removeMotionKeyframe(
  spec: MotionSpec,
  trackId: string,
  keyframeIndex: number
): MotionSpec {
  return editMotionSpec(spec, (draft) => {
    const track = findTrack(draft, trackId)
    if (keyframeIndex <= 0 || keyframeIndex >= track.keyframes.length - 1) {
      throw new RangeError('The first and last motion keyframes cannot be removed')
    }
    track.keyframes.splice(keyframeIndex, 1)
  })
}

export function duplicateMotionKeyframe(
  spec: MotionSpec,
  trackId: string,
  keyframeIndex: number
): { spec: MotionSpec; index: number } {
  if (totalKeyframes(spec) >= MOTION_LIMITS.maxKeyframes) {
    throw new RangeError(`Motion supports at most ${MOTION_LIMITS.maxKeyframes} keyframes`)
  }
  const sourceTrack = findTrack(spec, trackId)
  const source = sourceTrack.keyframes.at(keyframeIndex)
  if (!source) throw new Error(`Unknown motion keyframe index: ${keyframeIndex}`)
  const offset = duplicateKeyframeOffset(sourceTrack, keyframeIndex)

  let insertedIndex = 0
  const next = editMotionSpec(spec, (draft) => {
    const track = findTrack(draft, trackId)
    const keyframe = track.keyframes.at(keyframeIndex)
    if (!keyframe) throw new Error(`Unknown motion keyframe index: ${keyframeIndex}`)
    insertedIndex = track.keyframes.findIndex((candidate) => candidate.offset > offset)
    if (insertedIndex < 0) insertedIndex = track.keyframes.length
    const duplicate = { ...structuredClone(keyframe), offset }
    delete duplicate.id
    track.keyframes.splice(insertedIndex, 0, duplicate)
  })
  return { spec: next, index: insertedIndex }
}

export function setMotionKeyframeOffset(
  spec: MotionSpec,
  trackId: string,
  keyframeIndex: number,
  offset: number
): MotionSpec {
  return editMotionSpec(spec, (draft) => {
    const keyframes = findTrack(draft, trackId).keyframes
    const keyframe = keyframes.at(keyframeIndex)
    if (!keyframe) throw new Error(`Unknown motion keyframe index: ${keyframeIndex}`)
    if (keyframeIndex === 0 || keyframeIndex === keyframes.length - 1) {
      throw new RangeError('The first and last motion keyframe offsets are fixed')
    }
    const previous = keyframes[keyframeIndex - 1]?.offset ?? 0
    const next = keyframes[keyframeIndex + 1]?.offset ?? 1
    keyframe.offset = Math.min(next, Math.max(previous, offset))
  })
}

export function setMotionKeyframeChannel(
  spec: MotionSpec,
  trackId: string,
  keyframeIndex: number,
  channel: MotionChannel,
  value: number | undefined
): MotionSpec {
  return editMotionSpec(spec, (draft) => {
    const keyframe = findTrack(draft, trackId).keyframes.at(keyframeIndex)
    if (!keyframe) throw new Error(`Unknown motion keyframe index: ${keyframeIndex}`)
    if (value === undefined) Reflect.deleteProperty(keyframe, channel)
    else keyframe[channel] = value
  })
}

export function setMotionKeyframeEasing(
  spec: MotionSpec,
  trackId: string,
  keyframeIndex: number,
  easing: MotionEasing | undefined
): MotionSpec {
  return editMotionSpec(spec, (draft) => {
    const keyframe = findTrack(draft, trackId).keyframes.at(keyframeIndex)
    if (!keyframe) throw new Error(`Unknown motion keyframe index: ${keyframeIndex}`)
    if (easing === undefined) delete keyframe.easing
    else keyframe.easing = structuredClone(easing)
  })
}

export function motionTimelineDuration(spec: MotionSpec): number {
  return Math.max(
    1,
    ...spec.tracks.map((track) => {
      const iterations = timelineIterations(track)
      return (track.timing.delayMs ?? 0) + track.timing.durationMs * iterations
    })
  )
}

function timelineIterations(track: MotionTrack): number {
  const iterations = resolveMotionTrackIterations(track)
  // An infinite track is intentionally represented as one complete cycle in
  // the authoring timeline. Runtime playback remains infinite.
  return iterations === 'infinite' ? 1 : iterations
}

export function motionKeyframeTimes(track: MotionTrack, keyframe: MotionKeyframe): number[] {
  const iterations = timelineIterations(track)
  const wholeIterations = Math.floor(iterations)
  const remainder = iterations - wholeIterations
  const occurrenceCount = Math.ceil(iterations)
  const delayMs = track.timing.delayMs ?? 0
  const direction = track.timing.direction ?? 'normal'
  const times: number[] = []

  for (let iteration = 0; iteration < occurrenceCount; iteration++) {
    const localTimeOffset = applyMotionDirection(keyframe.offset, iteration, direction)
    const availableFraction = iteration < wholeIterations ? 1 : remainder
    if (availableFraction > 0 && localTimeOffset > availableFraction + 1e-9) continue
    times.push(delayMs + (iteration + localTimeOffset) * track.timing.durationMs)
  }
  return times
}

export function motionKeyframeTime(track: MotionTrack, keyframe: MotionKeyframe): number {
  return motionKeyframeTimes(track, keyframe)[0]
}

export function motionOffsetAtTime(track: MotionTrack, elapsedMs: number): number {
  const direction = track.timing.direction ?? 'normal'
  const activeElapsed = Math.max(0, elapsedMs - (track.timing.delayMs ?? 0))
  const iterations = timelineIterations(track)
  const activeDuration = track.timing.durationMs * iterations
  if (activeElapsed >= activeDuration) return motionEndProgress(iterations, direction)

  const iteration = Math.floor(activeElapsed / track.timing.durationMs)
  const progress = (activeElapsed % track.timing.durationMs) / track.timing.durationMs
  return applyMotionDirection(progress, iteration, direction)
}
