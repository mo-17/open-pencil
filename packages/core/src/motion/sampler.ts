import type {
  MotionDirection,
  MotionFill,
  MotionChannels,
  MotionKeyframe,
  MotionSpec,
  MotionTrack
} from '@open-pencil/scene-graph'
import { getMotionChannels } from '@open-pencil/scene-graph'

import { sampleMotionEasing } from './easing'
import {
  MOTION_VISUAL_IDENTITY,
  type MotionSample,
  type MotionSampleOptions,
  type MotionVisualState
} from './types'

interface PlayableTrack {
  track: MotionTrack
  channels: MotionChannels
  durationMs: number
  delayMs: number
  iterations: number | 'infinite'
  direction: MotionDirection
  fill: MotionFill
}

interface TrackProgress {
  contributes: boolean
  progress: number
  finished: boolean
}

function playableTrack(
  track: MotionTrack,
  spec: MotionSpec,
  prefersReducedMotion: boolean
): PlayableTrack | null {
  const channels = getMotionChannels(track.keyframes)
  const policy = spec.reducedMotion ?? 'reduce'
  if (prefersReducedMotion && policy === 'disable') return null

  const reduced = prefersReducedMotion && policy === 'reduce'
  if (reduced && !channels.opacity) return null
  return {
    track,
    channels: reduced ? { opacity: true, translate: false, scale: false, rotate: false } : channels,
    durationMs: reduced ? Math.min(track.timing.durationMs, 120) : track.timing.durationMs,
    delayMs: reduced ? 0 : (track.timing.delayMs ?? 0),
    iterations: track.timing.iterations ?? (track.trigger === 'loop' ? 'infinite' : 1),
    direction: track.timing.direction ?? 'normal',
    fill: track.timing.fill ?? 'both'
  }
}

function isReversed(direction: MotionDirection, iteration: number): boolean {
  switch (direction) {
    case 'normal':
      return false
    case 'reverse':
      return true
    case 'alternate':
      return iteration % 2 === 1
    case 'alternate-reverse':
      return iteration % 2 === 0
  }
  return false
}

function directedProgress(progress: number, iteration: number, direction: MotionDirection): number {
  return isReversed(direction, iteration) ? 1 - progress : progress
}

function endProgress(iterations: number, direction: MotionDirection): number {
  const wholeIterations = Math.floor(iterations)
  const remainder = iterations - wholeIterations
  const iteration = remainder === 0 ? Math.max(0, wholeIterations - 1) : wholeIterations
  const progress = remainder === 0 ? 1 : remainder
  return directedProgress(progress, iteration, direction)
}

function trackProgress(track: PlayableTrack, elapsedMs: number): TrackProgress {
  const { delayMs, durationMs, iterations, direction, fill } = track
  if (elapsedMs < delayMs) {
    return {
      contributes: fill === 'backwards' || fill === 'both',
      progress: directedProgress(0, 0, direction),
      finished: false
    }
  }

  const activeTime = elapsedMs - delayMs
  if (iterations !== 'infinite') {
    const activeDuration = durationMs * iterations
    if (activeTime >= activeDuration) {
      return {
        contributes: fill === 'forwards' || fill === 'both',
        progress: endProgress(iterations, direction),
        finished: true
      }
    }
  }

  const iteration = Math.floor(activeTime / durationMs)
  const progress = (activeTime % durationMs) / durationMs
  return {
    contributes: true,
    progress: directedProgress(progress, iteration, direction),
    finished: false
  }
}

function frameValue(frame: MotionKeyframe, channel: keyof MotionVisualState): number {
  const value = frame[channel]
  if (value !== undefined) return value
  return channel === 'scaleX' || channel === 'scaleY' || channel === 'opacity' ? 1 : 0
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress
}

function sampleChannel(
  keyframes: readonly MotionKeyframe[],
  channel: keyof MotionVisualState,
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

function applyTrack(
  visual: MotionVisualState,
  playable: PlayableTrack,
  progress: number
): MotionVisualState {
  const { keyframes } = playable.track
  const easing = playable.track.timing.easing
  const next = { ...visual }
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
  return next
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
  const trigger = options.trigger ?? 'mount'
  const normalizedElapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  const tracks = spec.tracks
    .filter((track) => track.trigger === trigger)
    .map((track) => playableTrack(track, spec, options.prefersReducedMotion ?? false))
    .filter((track): track is PlayableTrack => track !== null)

  let visual: MotionVisualState = { ...MOTION_VISUAL_IDENTITY }
  let contributes = false
  let finished = tracks.length === 0
  if (tracks.length > 0) finished = true
  for (const track of tracks) {
    const timing = trackProgress(track, normalizedElapsed)
    if (timing.contributes) {
      visual = applyTrack(visual, track, timing.progress)
      contributes = true
    }
    finished = finished && timing.finished
  }
  return { visual, hasTracks: tracks.length > 0, contributes, finished }
}
