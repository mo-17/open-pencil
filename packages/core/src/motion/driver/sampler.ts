import type { MotionDriver, MotionTrack, MotionTrigger } from '@open-pencil/scene-graph'

import type { MotionResolvedTarget } from '#core/motion/resolved-target'
import { prepareMotionSamplingPlan, samplePreparedMotionPlan } from '#core/motion/sampler'
import { resolveMotionTrackIterations } from '#core/motion/timing'
import type { MotionSample, PreparedMotionSamplingPlan } from '#core/motion/types'

export type MotionDriverPlanIssueCode =
  | 'motion-missing'
  | 'target-missing'
  | 'track-disabled'
  | 'track-missing'
  | 'track-not-drivable'

export interface MotionDriverPlanIssue {
  readonly code: MotionDriverPlanIssueCode
  readonly driverId: string
  readonly targetNodeId: string
  readonly trackId: string
  readonly message: string
}

export type MotionInputResolvedTarget = MotionResolvedTarget

export type MotionInputTargetResolver = (
  targetNodeId: string
) => MotionInputResolvedTarget | undefined

export interface PrepareMotionDriverTargetOptions {
  readonly prefersReducedMotion?: boolean
}

/** A single finite, direct-progress reference sampler target. */
export interface PreparedMotionDriverTarget {
  readonly driver: MotionDriver
  readonly targetNodeId: string
  readonly resolvedNodeId: string
  readonly trackId: string
  readonly authoredTrigger: MotionTrigger
  /** Consumers use this runtime state instead of mutating the authored track trigger. */
  readonly automaticTriggerSuppressed: true
  readonly durationMs: number
  readonly plan: PreparedMotionSamplingPlan
}

export interface MotionDriverTargetSample {
  readonly progress: number
  readonly elapsedMs: number
  readonly sample: MotionSample
}

export type MotionDriverTargetPreparation =
  | { readonly success: true; readonly target: PreparedMotionDriverTarget }
  | { readonly success: false; readonly issue: MotionDriverPlanIssue }

function issue(
  code: MotionDriverPlanIssueCode,
  driver: MotionDriver,
  message: string
): MotionDriverTargetPreparation {
  return {
    success: false,
    issue: {
      code,
      driverId: driver.id,
      targetNodeId: driver.target.targetNodeId,
      trackId: driver.target.trackId,
      message
    }
  }
}

function nonDrivableReason(track: MotionTrack): string | undefined {
  if ((track.timing.delayMs ?? 0) !== 0) return 'delayMs must be 0'
  if (resolveMotionTrackIterations(track) !== 1) return 'iterations must resolve to 1'
  if ((track.timing.direction ?? 'normal') !== 'normal') return 'direction must be normal'
  if ((track.timing.fill ?? 'both') !== 'both') return 'fill must be both'
  return undefined
}

/**
 * Resolve and prepare one driver without changing its authored MotionSpec. Temporal looping,
 * direction, delay, and fill are rejected because a continuous input owns progress directly.
 */
export function prepareMotionDriverTarget(
  driver: MotionDriver,
  resolveTarget: MotionInputTargetResolver,
  options: PrepareMotionDriverTargetOptions = {}
): MotionDriverTargetPreparation {
  const resolved = resolveTarget(driver.target.targetNodeId)
  if (!resolved) {
    return issue(
      'target-missing',
      driver,
      `Motion driver target not found: ${driver.target.targetNodeId}`
    )
  }
  if (!resolved.motion) {
    return issue(
      'motion-missing',
      driver,
      `Motion driver target has no MotionSpec: ${resolved.nodeId}`
    )
  }
  const track = resolved.motion.tracks.find((candidate) => candidate.id === driver.target.trackId)
  if (!track) {
    return issue(
      'track-missing',
      driver,
      `Motion driver target ${resolved.nodeId} has no track ${driver.target.trackId}`
    )
  }
  const reason = nonDrivableReason(track)
  if (reason) {
    return issue(
      'track-not-drivable',
      driver,
      `Motion driver track ${resolved.nodeId}/${track.id} is not direct-progress safe: ${reason}`
    )
  }

  const plan = prepareMotionSamplingPlan(resolved.motion, {
    selection: { mode: 'trackIds', trackIds: [track.id] },
    prefersReducedMotion: options.prefersReducedMotion
  })
  const preparedTrack = plan.tracks.at(0)
  if (!preparedTrack) {
    return issue(
      'track-disabled',
      driver,
      `Motion driver track ${resolved.nodeId}/${track.id} is disabled by reduced-motion policy`
    )
  }
  return {
    success: true,
    target: {
      driver,
      targetNodeId: driver.target.targetNodeId,
      resolvedNodeId: resolved.nodeId,
      trackId: track.id,
      authoredTrigger: track.trigger,
      automaticTriggerSuppressed: true,
      durationMs: preparedTrack.durationMs,
      plan
    }
  }
}

/** Sample one prepared target through the same reference sampler used by Canvas and export. */
export function samplePreparedMotionDriverTarget(
  target: PreparedMotionDriverTarget,
  progress: number
): MotionDriverTargetSample {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new RangeError('Motion driver progress must be finite and in the range 0..1')
  }
  const normalized = Object.is(progress, -0) ? 0 : progress
  const elapsedMs = normalized * target.durationMs
  return {
    progress: normalized,
    elapsedMs,
    sample: samplePreparedMotionPlan(target.plan, elapsedMs)
  }
}
