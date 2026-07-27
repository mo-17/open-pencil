/**
 * MotionSpec v1 is a declarative, bounded animation model for design nodes.
 * It deliberately contains no arbitrary JavaScript, CSS, filters, or blur payloads.
 */

const range = (min: number, max: number) => Object.freeze({ min, max })

export const MOTION_LIMITS = Object.freeze({
  maxTracks: 8,
  maxKeyframes: 32,
  maxIdLength: 64,
  maxPresetParameters: 16,
  maxParameterStringLength: 128,
  durationMs: range(1, 120_000),
  delayMs: range(0, 60_000),
  iterations: range(1, 1_000),
  translate: range(-100_000, 100_000),
  scale: range(0, 100),
  rotate: range(-36_000, 36_000),
  opacity: range(0, 1),
  cubicBezierY: range(-100, 100)
})

export type MotionTrigger = 'mount' | 'hover' | 'press' | 'focus' | 'click' | 'inView' | 'loop'

export type MotionEasingName = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out'

export interface MotionCubicBezierEasing {
  type: 'cubicBezier'
  x1: number
  y1: number
  x2: number
  y2: number
}

export type MotionEasing = MotionEasingName | MotionCubicBezierEasing

export interface MotionKeyframe {
  offset: number
  /** Multiplier applied to the node's authored opacity. */
  opacity?: number
  /** Design-space delta from the node's authored x position. */
  x?: number
  /** Design-space delta from the node's authored y position. */
  y?: number
  /** Multiplier applied to the node's authored horizontal scale. */
  scaleX?: number
  /** Multiplier applied to the node's authored vertical scale. */
  scaleY?: number
  /** Design-space rotation delta in degrees. */
  rotate?: number
  easing?: MotionEasing
}

export type MotionDirection = 'normal' | 'reverse' | 'alternate' | 'alternate-reverse'
export type MotionFill = 'none' | 'forwards' | 'backwards' | 'both'

export interface MotionTiming {
  durationMs: number
  delayMs?: number
  easing?: MotionEasing
  iterations?: number | 'infinite'
  direction?: MotionDirection
  fill?: MotionFill
}

export interface MotionTrack {
  id: string
  trigger: MotionTrigger
  keyframes: MotionKeyframe[]
  timing: MotionTiming
  exit?: 'none' | 'reverse' | 'reset'
}

export interface MotionPresetProvenance {
  id: string
  version: number
  parameters: Record<string, string | number | boolean>
}

export interface MotionSpec {
  version: 1
  tracks: MotionTrack[]
  reducedMotion?: 'reduce' | 'disable' | 'allow'
  preset?: MotionPresetProvenance
}

export type MotionValidationCode =
  | 'invalid_type'
  | 'invalid_value'
  | 'unknown_key'
  | 'out_of_range'
  | 'limit_exceeded'

export interface MotionValidationIssue {
  path: string
  code: MotionValidationCode
  message: string
}

export type MotionValidationResult =
  | { success: true; value: MotionSpec }
  | { success: false; issues: MotionValidationIssue[] }
