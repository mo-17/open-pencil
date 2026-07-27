/**
 * Framework-neutral motion IR. Source-format metadata and preset provenance are
 * deliberately absent: adapters consume only the validated, expanded behavior.
 */

export type IRMotionTrigger = 'mount' | 'hover' | 'press' | 'focus' | 'click' | 'inView' | 'loop'

export type IRMotionEasingName = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out'

export interface IRMotionCubicBezierEasing {
  type: 'cubicBezier'
  x1: number
  y1: number
  x2: number
  y2: number
}

export type IRMotionEasing = IRMotionEasingName | IRMotionCubicBezierEasing

export interface IRMotionKeyframe {
  offset: number
  opacity?: number
  x?: number
  y?: number
  scaleX?: number
  scaleY?: number
  rotate?: number
  easing?: IRMotionEasing
}

export type IRMotionDirection = 'normal' | 'reverse' | 'alternate' | 'alternate-reverse'
export type IRMotionFill = 'none' | 'forwards' | 'backwards' | 'both'
export type IRMotionExit = 'none' | 'reverse' | 'reset'
export type IRReducedMotion = 'reduce' | 'disable' | 'allow'

export interface IRMotionTiming {
  durationMs: number
  delayMs: number
  easing: IRMotionEasing
  iterations: number | 'infinite'
  direction: IRMotionDirection
  fill: IRMotionFill
}

export interface IRMotionTrack {
  id: string
  trigger: IRMotionTrigger
  keyframes: IRMotionKeyframe[]
  timing: IRMotionTiming
  exit: IRMotionExit
}

export interface IRMotion {
  version: 1
  tracks: IRMotionTrack[]
  reducedMotion: IRReducedMotion
}
