import type { MotionTrigger } from '@open-pencil/scene-graph'

/** Ephemeral visual delta sampled from a node's authored MotionSpec. */
export interface MotionVisualState {
  readonly x: number
  readonly y: number
  readonly scaleX: number
  readonly scaleY: number
  readonly rotate: number
  /** Multiplier applied to the node's authored opacity. */
  readonly opacity: number
}

export const MOTION_VISUAL_IDENTITY: Readonly<MotionVisualState> = Object.freeze({
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotate: 0,
  opacity: 1
})

export interface MotionSampleOptions {
  /** Only tracks for this trigger participate. */
  trigger?: MotionTrigger
  /** Applies the MotionSpec reduced-motion policy when true. */
  prefersReducedMotion?: boolean
}

export interface MotionSample {
  readonly visual: MotionVisualState
  /** Whether at least one playable track matched the requested trigger. */
  readonly hasTracks: boolean
  /** Whether at least one matched track contributes at this instant. */
  readonly contributes: boolean
  /** Whether every matched playable track has reached its finite end. */
  readonly finished: boolean
}
