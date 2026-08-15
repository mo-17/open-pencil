import type {
  MotionColor,
  MotionCornerRadii,
  MotionEasing,
  MotionEffectTarget,
  MotionFontAxisTarget,
  MotionGradientStopTarget,
  MotionKeyframe,
  MotionPaintTarget,
  MotionSpec,
  MotionTrack,
  MotionTrackComposition,
  MotionVectorMorph
} from '@open-pencil/scene-graph'
import { cloneMotionKeyframe, getMotionChannels } from '@open-pencil/scene-graph'

import { sampleMotionEasing } from './easing'
import { prepareMotionPath, samplePreparedMotionPath } from './path'
import { applyMotionDirection, motionEndProgress, resolveMotionTrackIterations } from './timing'
import {
  MOTION_VISUAL_IDENTITY,
  type MotionDiagnosticSample,
  type MotionTrackSampleDiagnostic,
  type MotionSample,
  type MotionSampleOptions,
  type MotionSamplingSelection,
  type PrepareMotionSamplingOptions,
  type PreparedMotionComposition,
  type PreparedMotionSamplingPlan,
  type PreparedMotionTrack,
  type MotionVisualState
} from './types'

interface TrackProgress {
  contributes: boolean
  progress: number
  finished: boolean
  completedIterations: number
}

function prepareComposition(
  track: MotionTrack,
  sourceIndex: number,
  enabled: boolean
): PreparedMotionComposition {
  const authored: MotionTrackComposition | undefined = enabled ? track.composition : undefined
  const weight = authored?.weight
  const priority = authored?.priority
  return {
    mode: authored?.mode ?? 'replace',
    weight:
      typeof weight === 'number' && Number.isFinite(weight) ? Math.min(1, Math.max(0, weight)) : 1,
    priority: typeof priority === 'number' && Number.isFinite(priority) ? priority : 0,
    sourceIndex
  }
}

function copyEasing(easing: MotionEasing | undefined): MotionEasing | undefined {
  return easing && typeof easing === 'object' ? { ...easing } : easing
}

function prepareTrack(
  track: MotionTrack,
  reducedMotion: NonNullable<MotionSpec['reducedMotion']>,
  prefersReducedMotion: boolean,
  composition: PreparedMotionComposition
): PreparedMotionTrack | null {
  const channels = getMotionChannels(track.keyframes)
  if (prefersReducedMotion && reducedMotion === 'disable') return null

  const reduced = prefersReducedMotion && reducedMotion === 'reduce'
  if (reduced && !channels.opacity) return null
  return {
    id: track.id,
    trigger: track.trigger,
    // Keep the reference sampler/debug view aligned with the compiler runtime:
    // an omitted exit policy resets the track when its trigger ends.
    exit: track.exit ?? 'reset',
    channels: reduced ? { opacity: true, translate: false, scale: false, rotate: false } : channels,
    keyframes: track.keyframes.map(cloneMotionKeyframe),
    ...(track.path ? { path: prepareMotionPath(track.path) } : {}),
    easing: copyEasing(track.timing.easing),
    durationMs: reduced ? Math.min(track.timing.durationMs, 120) : track.timing.durationMs,
    delayMs: reduced ? 0 : (track.timing.delayMs ?? 0),
    iterations: resolveMotionTrackIterations(track),
    direction: track.timing.direction ?? 'normal',
    fill: track.timing.fill ?? 'both',
    composition
  }
}

function trackProgress(track: PreparedMotionTrack, elapsedMs: number): TrackProgress {
  const { delayMs, durationMs, iterations, direction, fill } = track
  if (elapsedMs < delayMs) {
    return {
      contributes: fill === 'backwards' || fill === 'both',
      progress: applyMotionDirection(0, 0, direction),
      finished: false,
      completedIterations: 0
    }
  }

  const activeTime = elapsedMs - delayMs
  if (iterations !== 'infinite') {
    const activeDuration = durationMs * iterations
    if (activeTime >= activeDuration) {
      return {
        contributes: fill === 'forwards' || fill === 'both',
        progress: motionEndProgress(iterations, direction),
        finished: true,
        // The sampled end frame is the final (possibly fractional) iteration's contribution.
        // Every earlier iteration is complete and contributes one accumulated end-start delta.
        // `ceil(iterations) - 1` keeps the exact endpoint continuous for fractional counts:
        // 1.5 iterations has one completed iteration plus 0.5 of the current iteration.
        completedIterations: Math.max(0, Math.ceil(iterations) - 1)
      }
    }
  }

  const iteration = Math.floor(activeTime / durationMs)
  const progress = (activeTime % durationMs) / durationMs
  return {
    contributes: true,
    progress: applyMotionDirection(progress, iteration, direction),
    finished: false,
    completedIterations: iteration
  }
}

type LegacyNumericChannel = 'opacity' | 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotate'
type V2NumericChannel =
  | 'originX'
  | 'originY'
  | 'width'
  | 'height'
  | 'cornerRadius'
  | 'strokeWidth'
  | 'blur'
  | 'shadowX'
  | 'shadowY'
  | 'shadowBlur'
  | 'shadowSpread'
  | 'pathProgress'
  | 'trimStart'
  | 'trimEnd'
  | 'trimOffset'
  | 'gap'
  | 'rowGap'
  | 'columnGap'
  | 'paddingTop'
  | 'paddingRight'
  | 'paddingBottom'
  | 'paddingLeft'
  | 'textReveal'
type ColorChannel = 'fillColor' | 'strokeColor' | 'shadowColor'

function frameValue(frame: MotionKeyframe, channel: LegacyNumericChannel): number {
  const value = frame[channel]
  if (value !== undefined) return value
  return channel === 'scaleX' || channel === 'scaleY' || channel === 'opacity' ? 1 : 0
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress
}

function sampleChannel(
  keyframes: readonly MotionKeyframe[],
  channel: LegacyNumericChannel,
  progress: number,
  fallbackEasing: MotionTrack['timing']['easing']
): number {
  let startIndex = 0
  for (let index = 1; index < keyframes.length; index++) {
    if (keyframes[index].offset > progress) break
    startIndex = index
  }
  const start = keyframes[startIndex]
  const end = keyframes.at(startIndex + 1)
  if (!end) return frameValue(start, channel)

  const span = end.offset - start.offset
  if (span <= 0) return frameValue(end, channel)
  const localProgress = (progress - start.offset) / span
  const eased = sampleMotionEasing(start.easing ?? fallbackEasing ?? 'ease', localProgress)
  return interpolate(frameValue(start, channel), frameValue(end, channel), eased)
}

function framesWithNumber(
  keyframes: readonly MotionKeyframe[],
  channel: V2NumericChannel
): Array<MotionKeyframe & Record<V2NumericChannel, number>> {
  return keyframes.filter(
    (frame): frame is MotionKeyframe & Record<V2NumericChannel, number> =>
      typeof frame[channel] === 'number'
  )
}

function surroundingFrames<T extends { offset: number }>(
  frames: readonly T[],
  progress: number
): { start: T; end: T | undefined } {
  let startIndex = 0
  for (let index = 1; index < frames.length; index++) {
    if (frames[index].offset > progress) break
    startIndex = index
  }
  return { start: frames[startIndex], end: frames.at(startIndex + 1) }
}

function sampleOptionalNumber(
  keyframes: readonly MotionKeyframe[],
  channel: V2NumericChannel,
  progress: number,
  fallbackEasing: MotionTrack['timing']['easing']
): number | undefined {
  const frames = framesWithNumber(keyframes, channel)
  if (frames.length === 0) return undefined
  const { start, end } = surroundingFrames(frames, progress)
  if (!end || progress <= start.offset) return start[channel]
  const span = end.offset - start.offset
  if (span <= 0) return end[channel]
  const eased = sampleMotionEasing(
    start.easing ?? fallbackEasing ?? 'ease',
    (progress - start.offset) / span
  )
  return interpolate(start[channel], end[channel], eased)
}

function sampleColor(
  keyframes: readonly MotionKeyframe[],
  channel: ColorChannel,
  progress: number,
  fallbackEasing: MotionTrack['timing']['easing']
): MotionColor | undefined {
  const frames = keyframes.filter(
    (frame): frame is MotionKeyframe & Record<ColorChannel, MotionColor> =>
      frame[channel] !== undefined
  )
  if (frames.length === 0) return undefined
  const { start, end } = surroundingFrames(frames, progress)
  if (!end || progress <= start.offset) return { ...start[channel] }
  const span = end.offset - start.offset
  if (span <= 0) return { ...end[channel] }
  const eased = sampleMotionEasing(
    start.easing ?? fallbackEasing ?? 'ease',
    (progress - start.offset) / span
  )
  const from = start[channel]
  const to = end[channel]
  return interpolateColor(from, to, eased)
}

function interpolateColor(from: MotionColor, to: MotionColor, progress: number): MotionColor {
  return {
    r: Math.min(1, Math.max(0, interpolate(from.r, to.r, progress))),
    g: Math.min(1, Math.max(0, interpolate(from.g, to.g, progress))),
    b: Math.min(1, Math.max(0, interpolate(from.b, to.b, progress))),
    a: Math.min(1, Math.max(0, interpolate(from.a, to.a, progress)))
  }
}

interface StructuredFrame<T> {
  offset: number
  easing?: MotionEasing
  value: T
}

function sampleStructured<T>(
  keyframes: readonly MotionKeyframe[],
  progress: number,
  fallbackEasing: MotionTrack['timing']['easing'],
  read: (frame: MotionKeyframe) => T | undefined,
  clone: (value: T) => T,
  blend: (from: T, to: T, progress: number) => T
): T | undefined {
  const frames = keyframes.flatMap((frame): StructuredFrame<T>[] => {
    const value = read(frame)
    return value === undefined
      ? []
      : [{ offset: frame.offset, ...(frame.easing ? { easing: frame.easing } : {}), value }]
  })
  if (frames.length === 0) return undefined
  const { start, end } = surroundingFrames(frames, progress)
  if (!end || progress <= start.offset) return clone(start.value)
  const span = end.offset - start.offset
  if (span <= 0) return clone(end.value)
  const eased = sampleMotionEasing(
    start.easing ?? fallbackEasing ?? 'ease',
    (progress - start.offset) / span
  )
  return blend(start.value, end.value, eased)
}

function clonePaintTargets(targets: readonly MotionPaintTarget[]): MotionPaintTarget[] {
  return targets.map((target) => ({
    ...target,
    ...(target.color ? { color: { ...target.color } } : {})
  }))
}

function interpolatePaintTargets(
  from: readonly MotionPaintTarget[],
  to: readonly MotionPaintTarget[],
  progress: number
): MotionPaintTarget[] {
  return from.map((target, index) => {
    const next = to.at(index)
    return {
      kind: target.kind,
      index: target.index,
      ...(target.color && next?.color
        ? { color: interpolateColor(target.color, next.color, progress) }
        : {}),
      ...(target.opacity !== undefined && next?.opacity !== undefined
        ? { opacity: interpolate(target.opacity, next.opacity, progress) }
        : {})
    }
  })
}

function cloneGradientStops(
  targets: readonly MotionGradientStopTarget[]
): MotionGradientStopTarget[] {
  return targets.map((target) => ({ ...target, color: { ...target.color } }))
}

function interpolateGradientStops(
  from: readonly MotionGradientStopTarget[],
  to: readonly MotionGradientStopTarget[],
  progress: number
): MotionGradientStopTarget[] {
  return from.map((target, index) => {
    const next = to.at(index)
    return {
      kind: target.kind,
      paintIndex: target.paintIndex,
      stopIndex: target.stopIndex,
      position: interpolate(target.position, next?.position ?? target.position, progress),
      color: interpolateColor(target.color, next?.color ?? target.color, progress)
    }
  })
}

function cloneEffects(targets: readonly MotionEffectTarget[]): MotionEffectTarget[] {
  return targets.map((target) =>
    target.kind === 'shadow' ? { ...target, color: { ...target.color } } : { ...target }
  )
}

function interpolateEffects(
  from: readonly MotionEffectTarget[],
  to: readonly MotionEffectTarget[],
  progress: number
): MotionEffectTarget[] {
  return from.map((target, index) => {
    const next = to.at(index)
    if (target.kind === 'blur') {
      return {
        kind: target.kind,
        index: target.index,
        radius: interpolate(
          target.radius,
          next?.kind === 'blur' ? next.radius : target.radius,
          progress
        )
      }
    }
    const shadow = next?.kind === 'shadow' ? next : target
    return {
      kind: target.kind,
      index: target.index,
      x: interpolate(target.x, shadow.x, progress),
      y: interpolate(target.y, shadow.y, progress),
      blur: interpolate(target.blur, shadow.blur, progress),
      spread: interpolate(target.spread, shadow.spread, progress),
      color: interpolateColor(target.color, shadow.color, progress)
    }
  })
}

function interpolateCornerRadii(
  from: MotionCornerRadii,
  to: MotionCornerRadii,
  progress: number
): MotionCornerRadii {
  return {
    topLeft: interpolate(from.topLeft, to.topLeft, progress),
    topRight: interpolate(from.topRight, to.topRight, progress),
    bottomRight: interpolate(from.bottomRight, to.bottomRight, progress),
    bottomLeft: interpolate(from.bottomLeft, to.bottomLeft, progress)
  }
}

function cloneFontAxes(axes: readonly MotionFontAxisTarget[]): MotionFontAxisTarget[] {
  return axes.map((axis) => ({ ...axis }))
}

function interpolateFontAxes(
  from: readonly MotionFontAxisTarget[],
  to: readonly MotionFontAxisTarget[],
  progress: number
): MotionFontAxisTarget[] {
  return from.map((axis, index) => {
    const next = to.at(index)
    return {
      tag: axis.tag,
      value: interpolate(axis.value, next?.value ?? axis.value, progress)
    }
  })
}

function cloneVectorMorph(morph: MotionVectorMorph): MotionVectorMorph {
  return {
    topologyId: morph.topologyId,
    points: morph.points.map((point) => ({ ...point }))
  }
}

function interpolateVectorMorph(
  from: MotionVectorMorph,
  to: MotionVectorMorph,
  progress: number
): MotionVectorMorph {
  return {
    topologyId: from.topologyId,
    points: from.points.map((point, index) => ({
      x: interpolate(point.x, to.points.at(index)?.x ?? point.x, progress),
      y: interpolate(point.y, to.points.at(index)?.y ?? point.y, progress)
    }))
  }
}

function bounded(value: number | undefined, min: number, max: number): number | undefined {
  return value === undefined ? undefined : Math.min(max, Math.max(min, value))
}

type MutableMotionVisualState = {
  -readonly [Channel in keyof MotionVisualState]: MotionVisualState[Channel]
}

const OPTIONAL_NUMBER_CHANNELS: readonly (readonly [
  V2NumericChannel,
  keyof PreparedMotionTrack['channels'],
  number,
  number
])[] = [
  ['originX', 'origin', 0, 1],
  ['originY', 'origin', 0, 1],
  ['width', 'width', 0, 100_000],
  ['height', 'height', 0, 100_000],
  ['cornerRadius', 'cornerRadius', 0, 100_000],
  ['strokeWidth', 'strokeWidth', 0, 10_000],
  ['blur', 'blur', 0, 1_000],
  ['shadowX', 'shadow', -100_000, 100_000],
  ['shadowY', 'shadow', -100_000, 100_000],
  ['shadowBlur', 'shadow', 0, 1_000],
  ['shadowSpread', 'shadow', -10_000, 10_000],
  ['pathProgress', 'path', 0, 1],
  ['trimStart', 'trim', 0, 1],
  ['trimEnd', 'trim', 0, 1],
  ['trimOffset', 'trim', -1_000, 1_000],
  ['gap', 'gap', 0, 100_000],
  ['rowGap', 'rowGap', 0, 100_000],
  ['columnGap', 'columnGap', 0, 100_000],
  ['paddingTop', 'padding', 0, 100_000],
  ['paddingRight', 'padding', 0, 100_000],
  ['paddingBottom', 'padding', 0, 100_000],
  ['paddingLeft', 'padding', 0, 100_000],
  ['textReveal', 'textReveal', 0, 1]
]

function applyLegacyChannels(
  next: MutableMotionVisualState,
  playable: PreparedMotionTrack,
  progress: number
): void {
  const { keyframes, easing } = playable
  if (playable.channels.opacity) {
    next.opacity = Math.min(1, Math.max(0, sampleChannel(keyframes, 'opacity', progress, easing)))
  }
  if (playable.channels.translate) {
    next.x = sampleChannel(keyframes, 'x', progress, easing)
    next.y = sampleChannel(keyframes, 'y', progress, easing)
  }
  if (playable.channels.scale) {
    next.scaleX = sampleChannel(keyframes, 'scaleX', progress, easing)
    next.scaleY = sampleChannel(keyframes, 'scaleY', progress, easing)
  }
  if (playable.channels.rotate) {
    next.rotate = sampleChannel(keyframes, 'rotate', progress, easing)
  }
}

function applyOptionalNumberChannels(
  next: MutableMotionVisualState,
  playable: PreparedMotionTrack,
  progress: number
): void {
  const { keyframes, easing } = playable
  for (const [channel, owner, min, max] of OPTIONAL_NUMBER_CHANNELS) {
    if (!playable.channels[owner]) continue
    const value = bounded(sampleOptionalNumber(keyframes, channel, progress, easing), min, max)
    if (value !== undefined) next[channel] = value
  }
}

function applyColorChannels(
  next: MutableMotionVisualState,
  playable: PreparedMotionTrack,
  progress: number
): void {
  const { keyframes, easing } = playable
  for (const channel of ['fillColor', 'strokeColor', 'shadowColor'] as const) {
    if (!playable.channels[channel === 'shadowColor' ? 'shadow' : channel]) continue
    const value = sampleColor(keyframes, channel, progress, easing)
    if (value !== undefined) next[channel] = value
  }
}

function applyStructuredChannels(
  next: MutableMotionVisualState,
  playable: PreparedMotionTrack,
  progress: number
): void {
  const { keyframes, easing } = playable
  if (playable.channels.paints) {
    next.paints = sampleStructured(
      keyframes,
      progress,
      easing,
      (frame) => frame.paints,
      clonePaintTargets,
      interpolatePaintTargets
    )
  }
  if (playable.channels.gradientStops) {
    next.gradientStops = sampleStructured(
      keyframes,
      progress,
      easing,
      (frame) => frame.gradientStops,
      cloneGradientStops,
      interpolateGradientStops
    )
  }
  if (playable.channels.effects) {
    next.effects = sampleStructured(
      keyframes,
      progress,
      easing,
      (frame) => frame.effects,
      cloneEffects,
      interpolateEffects
    )
  }
  if (playable.channels.cornerRadii) {
    next.cornerRadii = sampleStructured(
      keyframes,
      progress,
      easing,
      (frame) => frame.cornerRadii,
      (value) => ({ ...value }),
      interpolateCornerRadii
    )
  }
  if (playable.channels.fontAxes) {
    next.fontAxes = sampleStructured(
      keyframes,
      progress,
      easing,
      (frame) => frame.fontAxes,
      cloneFontAxes,
      interpolateFontAxes
    )
  }
  if (playable.channels.vectorMorph) {
    next.vectorMorph = sampleStructured(
      keyframes,
      progress,
      easing,
      (frame) => frame.vectorMorph,
      cloneVectorMorph,
      interpolateVectorMorph
    )
  }
}

function applyPathChannel(next: MutableMotionVisualState, playable: PreparedMotionTrack): void {
  if (playable.channels.path && playable.path && next.pathProgress !== undefined) {
    const point = samplePreparedMotionPath(playable.path, next.pathProgress)
    next.x = (playable.channels.translate ? next.x : 0) + point.x
    next.y = (playable.channels.translate ? next.y : 0) + point.y
    if (playable.path.autoRotate) {
      next.rotate = (playable.channels.rotate ? next.rotate : 0) + point.angle
    }
  }
}

function applyTrack(
  visual: MotionVisualState,
  playable: PreparedMotionTrack,
  progress: number
): MotionVisualState {
  const next: MutableMotionVisualState = { ...visual }
  applyLegacyChannels(next, playable, progress)
  applyOptionalNumberChannels(next, playable, progress)
  applyColorChannels(next, playable, progress)
  applyStructuredChannels(next, playable, progress)
  applyPathChannel(next, playable)
  return next
}

type ComposedNumericChannel = 'opacity' | 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotate'

const COMPOSED_NUMERIC_CHANNELS: readonly ComposedNumericChannel[] = [
  'opacity',
  'x',
  'y',
  'scaleX',
  'scaleY',
  'rotate'
]

function channelIdentity(channel: ComposedNumericChannel): number {
  return channel === 'opacity' || channel === 'scaleX' || channel === 'scaleY' ? 1 : 0
}

function trackOwnsChannel(track: PreparedMotionTrack, channel: ComposedNumericChannel): boolean {
  if (channel === 'opacity') return track.channels.opacity
  if (channel === 'x' || channel === 'y') {
    return track.channels.translate || track.channels.path === true
  }
  if (channel === 'scaleX' || channel === 'scaleY') return track.channels.scale
  return track.channels.rotate || (track.channels.path === true && track.path?.autoRotate === true)
}

/** Compose the bounded transform/opacity channels introduced by MotionSpec v3. Advanced v2
 * channels keep deterministic later-track replacement until their additive identities are
 * explicitly specified by a future schema revision. */
function composeTrack(
  current: MotionVisualState,
  replacement: MotionVisualState,
  sampled: MotionVisualState,
  start: MotionVisualState,
  end: MotionVisualState,
  track: PreparedMotionTrack,
  completedIterations: number
): MotionVisualState {
  const next = { ...replacement }
  const { mode, weight } = track.composition
  for (const channel of COMPOSED_NUMERIC_CHANNELS) {
    if (!trackOwnsChannel(track, channel)) continue
    const currentValue = current[channel]
    const trackValue = sampled[channel]
    const identity = channelIdentity(channel)
    if (mode === 'replace') {
      next[channel] = interpolate(currentValue, trackValue, weight)
      continue
    }
    const accumulated =
      mode === 'accumulate' ? completedIterations * (end[channel] - start[channel]) : 0
    next[channel] = currentValue + (trackValue - identity + accumulated) * weight
  }
  return next
}

/**
 * Normalize one MotionSpec for repeated sampling. Channel discovery, reduced-motion policy, and
 * timing defaults are resolved once instead of on every animation frame.
 */
export function prepareMotionSamplingPlan(
  spec: MotionSpec,
  options: PrepareMotionSamplingOptions = {}
): PreparedMotionSamplingPlan {
  const requestedSelection = options.selection ?? { mode: 'trigger', trigger: 'mount' }
  const selection: MotionSamplingSelection =
    requestedSelection.mode === 'trackIds'
      ? { mode: 'trackIds', trackIds: [...requestedSelection.trackIds] }
      : { ...requestedSelection }
  const prefersReducedMotion = options.prefersReducedMotion ?? false
  const reducedMotion = spec.reducedMotion ?? 'reduce'
  const compositionEnabled = Number(spec.version) === 3
  const selectedTrackIds = selection.mode === 'trackIds' ? new Set(selection.trackIds) : undefined
  const tracks = spec.tracks
    .map((track, sourceIndex) => ({ track, sourceIndex }))
    .filter(({ track }) => {
      if (selection.mode === 'all') return true
      if (selection.mode === 'trigger') return track.trigger === selection.trigger
      return selectedTrackIds?.has(track.id) === true
    })
    .map(({ track, sourceIndex }) =>
      prepareTrack(
        track,
        reducedMotion,
        prefersReducedMotion,
        prepareComposition(track, sourceIndex, compositionEnabled)
      )
    )
    .filter((track): track is PreparedMotionTrack => track !== null)
  if (compositionEnabled) {
    tracks.sort(
      (a, b) =>
        a.composition.priority - b.composition.priority ||
        a.composition.sourceIndex - b.composition.sourceIndex
    )
  }
  return { version: spec.version, selection, prefersReducedMotion, reducedMotion, tracks }
}

function samplePrepared(
  plan: PreparedMotionSamplingPlan,
  elapsedMs: number,
  includeDiagnostics: boolean
): MotionSample | MotionDiagnosticSample {
  const normalizedElapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  let visual: MotionVisualState = { ...MOTION_VISUAL_IDENTITY }
  let contributes = false
  let finished = plan.tracks.length === 0
  if (plan.tracks.length > 0) finished = true
  const diagnostics: MotionTrackSampleDiagnostic[] | null = includeDiagnostics ? [] : null
  const compositionEnabled = Number(plan.version) === 3

  for (const track of plan.tracks) {
    const timing = trackProgress(track, normalizedElapsed)
    const isolated = timing.contributes
      ? applyTrack({ ...MOTION_VISUAL_IDENTITY }, track, timing.progress)
      : { ...MOTION_VISUAL_IDENTITY }
    if (timing.contributes) {
      const replacement = applyTrack(visual, track, timing.progress)
      if (compositionEnabled) {
        const start = applyTrack({ ...MOTION_VISUAL_IDENTITY }, track, 0)
        const end = applyTrack({ ...MOTION_VISUAL_IDENTITY }, track, 1)
        visual = composeTrack(
          visual,
          replacement,
          isolated,
          start,
          end,
          track,
          timing.completedIterations
        )
      } else visual = replacement
      contributes = true
    }
    if (diagnostics) {
      diagnostics.push({
        trackId: track.id,
        trigger: track.trigger,
        exit: track.exit,
        progress: timing.progress,
        contributes: timing.contributes,
        finished: timing.finished,
        visual: isolated,
        ...(compositionEnabled
          ? {
              composition: {
                mode: track.composition.mode,
                weight: track.composition.weight,
                priority: track.composition.priority
              }
            }
          : {})
      })
    }
    finished = finished && timing.finished
  }

  const sample: MotionSample = {
    visual,
    hasTracks: plan.tracks.length > 0,
    contributes,
    finished
  }
  return diagnostics ? { ...sample, tracks: diagnostics } : sample
}

/** Sample a plan prepared by prepareMotionSamplingPlan(). */
export function samplePreparedMotionPlan(
  plan: PreparedMotionSamplingPlan,
  elapsedMs: number
): MotionSample {
  return samplePrepared(plan, elapsedMs, false) as MotionSample
}

/** Sample aggregate output and the isolated contribution of every playable track. */
export function samplePreparedMotionPlanWithDiagnostics(
  plan: PreparedMotionSamplingPlan,
  elapsedMs: number
): MotionDiagnosticSample {
  return samplePrepared(plan, elapsedMs, true) as MotionDiagnosticSample
}

/**
 * Sample MotionSpec without touching a SceneGraph. Tracks are evaluated in source array order;
 * when tracks write the same channel, the later contributing track deterministically wins.
 */
export function sampleMotionSpec(
  spec: MotionSpec,
  elapsedMs: number,
  options: MotionSampleOptions = {}
): MotionSample {
  return samplePreparedMotionPlan(
    prepareMotionSamplingPlan(spec, {
      selection: { mode: 'trigger', trigger: options.trigger ?? 'mount' },
      prefersReducedMotion: options.prefersReducedMotion
    }),
    elapsedMs
  )
}
