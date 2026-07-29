import type { MotionDirection, MotionTrack } from '@open-pencil/scene-graph'

import type { PreparedMotionSamplingPlan } from './types'

/** Resolve the runtime default used by both playback and authoring timelines. */
export function resolveMotionTrackIterations(track: MotionTrack): number | 'infinite' {
  return track.timing.iterations ?? (track.trigger === 'loop' ? 'infinite' : 1)
}

export function applyMotionDirection(
  progress: number,
  iteration: number,
  direction: MotionDirection
): number {
  const reversed =
    direction === 'reverse' ||
    (direction === 'alternate' && iteration % 2 === 1) ||
    (direction === 'alternate-reverse' && iteration % 2 === 0)
  return reversed ? 1 - progress : progress
}

export function motionEndProgress(iterations: number, direction: MotionDirection): number {
  const wholeIterations = Math.floor(iterations)
  const remainder = iterations - wholeIterations
  const iteration = remainder === 0 ? Math.max(0, wholeIterations - 1) : wholeIterations
  const progress = remainder === 0 ? 1 : remainder
  return applyMotionDirection(progress, iteration, direction)
}

/** Resolve the finite authoring/export envelope represented by a prepared plan. */
export function preparedMotionPlanDuration(plan: PreparedMotionSamplingPlan): number {
  let durationMs = 0
  for (const track of plan.tracks) {
    const iterations = track.iterations === 'infinite' ? 1 : track.iterations
    durationMs = Math.max(durationMs, track.delayMs + track.durationMs * iterations)
  }
  return durationMs
}
