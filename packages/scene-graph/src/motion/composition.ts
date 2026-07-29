import type { MotionTrack, MotionTrackComposition } from './types'

export interface ResolvedMotionTrackComposition {
  readonly mode: MotionTrackComposition['mode']
  readonly weight: number
  readonly priority: number
}

export const DEFAULT_MOTION_TRACK_COMPOSITION: Readonly<ResolvedMotionTrackComposition> =
  Object.freeze({
    mode: 'replace',
    weight: 1,
    priority: 0
  })

/** Resolve the v1/v2-compatible defaults without mutating authored track data. */
export function resolveMotionTrackComposition(
  track: Pick<MotionTrack, 'composition'>
): ResolvedMotionTrackComposition {
  const composition = track.composition
  if (!composition) return DEFAULT_MOTION_TRACK_COMPOSITION
  return {
    mode: composition.mode,
    weight: composition.weight ?? DEFAULT_MOTION_TRACK_COMPOSITION.weight,
    priority: composition.priority ?? DEFAULT_MOTION_TRACK_COMPOSITION.priority
  }
}
