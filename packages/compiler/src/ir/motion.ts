/**
 * Framework-neutral motion IR. Source-format metadata and preset provenance are
 * deliberately absent: adapters consume only the validated, expanded behavior.
 */

import type { Vector } from '@open-pencil/scene-graph/primitives'

export type IRMotionPoint = Vector

export type IRMotionTrigger =
  | 'mount'
  | 'pageEnter'
  | 'pageExit'
  | 'hover'
  | 'press'
  | 'focus'
  | 'click'
  | 'inView'
  | 'loop'

export type IRMotionEasingName = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out'

export interface IRMotionCubicBezierEasing {
  type: 'cubicBezier'
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface IRMotionHoldEasing {
  type: 'hold'
}

export interface IRMotionStepsEasing {
  type: 'steps'
  steps: number
  position: 'start' | 'end'
}

export interface IRMotionSpringEasing {
  type: 'spring'
  mass: number
  stiffness: number
  damping: number
  velocity: number
}

export interface IRMotionInertiaEasing {
  type: 'inertia'
  velocity: number
  deceleration: number
}

export type IRMotionEasing =
  | IRMotionEasingName
  | IRMotionCubicBezierEasing
  | IRMotionHoldEasing
  | IRMotionStepsEasing
  | IRMotionSpringEasing
  | IRMotionInertiaEasing

export interface IRMotionColor {
  r: number
  g: number
  b: number
  a: number
}

export type IRMotionPaintKind = 'fill' | 'stroke'

export interface IRMotionPaintTarget {
  kind: IRMotionPaintKind
  index: number
  color?: IRMotionColor
  opacity?: number
}

export interface IRMotionGradientStopTarget {
  kind: IRMotionPaintKind
  paintIndex: number
  stopIndex: number
  position: number
  color: IRMotionColor
}

export type IRMotionEffectTarget =
  | { kind: 'blur'; index: number; radius: number }
  | {
      kind: 'shadow'
      index: number
      x: number
      y: number
      blur: number
      spread: number
      color: IRMotionColor
    }

export interface IRMotionCornerRadii {
  topLeft: number
  topRight: number
  bottomRight: number
  bottomLeft: number
}

export interface IRMotionFontAxisTarget {
  tag: string
  value: number
}

export interface IRMotionVectorMorph {
  topologyId: string
  points: IRMotionPoint[]
  /** SVG paths derived from the topology-gated vector network for this frame. */
  paths: string[]
}

export interface IRMotionKeyframe {
  offset: number
  opacity?: number
  x?: number
  y?: number
  scaleX?: number
  scaleY?: number
  rotate?: number
  originX?: number
  originY?: number
  width?: number
  height?: number
  cornerRadius?: number
  fillColor?: IRMotionColor
  strokeColor?: IRMotionColor
  strokeWidth?: number
  blur?: number
  shadowX?: number
  shadowY?: number
  shadowBlur?: number
  shadowSpread?: number
  shadowColor?: IRMotionColor
  pathProgress?: number
  trimStart?: number
  trimEnd?: number
  trimOffset?: number
  gap?: number
  rowGap?: number
  columnGap?: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  paints?: IRMotionPaintTarget[]
  gradientStops?: IRMotionGradientStopTarget[]
  effects?: IRMotionEffectTarget[]
  cornerRadii?: IRMotionCornerRadii
  textReveal?: number
  fontAxes?: IRMotionFontAxisTarget[]
  vectorMorph?: IRMotionVectorMorph
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

export type IRMotionCompositeMode = 'replace' | 'add' | 'accumulate'

/** Fully-resolved v3 composition metadata. Source index is runtime-only
 * ordering data and is never written back to the source document. */
export interface IRMotionTrackComposition {
  mode: IRMotionCompositeMode
  weight: number
  priority: number
  sourceIndex: number
}

export interface IRMotionTrack {
  id: string
  trigger: IRMotionTrigger
  keyframes: IRMotionKeyframe[]
  timing: IRMotionTiming
  exit: IRMotionExit
  /** Present for every MotionSpec v3 track and absent for v1/v2. */
  composition?: IRMotionTrackComposition
  /** The source motion path was deterministically expanded into bounded
   * transform samples. Generated runtimes may project those samples directly
   * through registered composition properties so WAAPI scrubbing remains
   * faithful after a filled animation has finished. */
  sampledPath?: true
  path?: {
    points: IRMotionPoint[]
    autoRotate?: boolean
  }
}

export interface IRMotionAuthoredTransform {
  opacity: number
  rotate: number
}

export interface IRMotionRenderTarget {
  kind: 'box' | 'text' | 'vector'
  /** Authored paints gate v2 overrides: missing paint means the channel is a no-op. */
  fillColor?: IRMotionColor
  fillOpacity?: number
  fillIndex?: number
  strokeColor?: IRMotionColor
  strokeOpacity?: number
  strokeWidth?: number
  /** Imported outline-only VECTORs animate stroke color through outline fill. */
  vectorStrokeTarget?: 'geometry' | 'outline'
  shadowX?: number
  shadowY?: number
  shadowBlur?: number
  shadowSpread?: number
  shadowColor?: IRMotionColor
  /** Authored filter components retained when one combined SVG filter channel animates. */
  blur?: number
  hasShadow?: boolean
  /** Authored resources needed to project v3 structured channels at runtime. */
  fills?: IRMotionResourceFill[]
  strokes?: IRMotionStroke[]
  effects?: IRMotionEffect[]
  cornerRadii?: IRMotionCornerRadii
  text?: string
  fontAxes?: IRMotionFontAxisTarget[]
  vectorMorph?: IRMotionVectorTarget
}

export interface IRMotionGradientStop {
  position: number
  color: IRMotionColor
}

export interface IRMotionGradientTransform {
  m00: number
  m01: number
  m02: number
  m10: number
  m11: number
  m12: number
}

export interface IRMotionResourceFill {
  type:
    | 'SOLID'
    | 'GRADIENT_LINEAR'
    | 'GRADIENT_RADIAL'
    | 'GRADIENT_ANGULAR'
    | 'GRADIENT_DIAMOND'
    | 'UNSUPPORTED'
  color: IRMotionColor
  opacity: number
  visible: boolean
  gradientStops?: IRMotionGradientStop[]
  gradientTransform?: IRMotionGradientTransform
}

export interface IRMotionStroke {
  color: IRMotionColor
  opacity: number
  visible: boolean
  weight: number
}

export interface IRMotionEffect {
  type: 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR' | 'FOREGROUND_BLUR'
  color: IRMotionColor
  x: number
  y: number
  radius: number
  spread: number
  visible: boolean
}

export interface IRMotionVectorTarget {
  topologyId: string
  pathCount: number
}

export interface IRMotion {
  version: 1 | 2 | 3
  tracks: IRMotionTrack[]
  reducedMotion: IRReducedMotion
  /** Runtime paint/effect semantics for MotionSpec v2/v3. Omitted for v1. */
  target?: IRMotionRenderTarget
  /** Authored values used as the identity baseline for v3 composition. */
  authoredTransform?: IRMotionAuthoredTransform
}

export type IRMotionSceneTrigger = 'pageEnter' | 'pageExit' | 'manual'

export interface IRMotionSceneCue {
  id: string
  targetNodeId: string
  trackId: string
  startMs: number
  timeScale: number
}

export interface IRMotionSceneSequence {
  id: string
  trigger: IRMotionSceneTrigger
  cues: IRMotionSceneCue[]
  /** Full-motion duration calculated by the core scene planner. */
  durationMs: number
}

/** Validated page-level choreography consumed by generated framework runtimes. */
export interface IRMotionScene {
  id: string
  sequences: IRMotionSceneSequence[]
}
