/**
 * MotionSpec is a declarative, bounded animation model for design nodes.
 * It deliberately contains no arbitrary JavaScript or CSS payloads. Version 2
 * adds a finite set of visual/layout channels plus deterministic physical and rich curve easing.
 * Version 3 adds explicit composition, indexed/structured visual channels,
 * and cubic paths while retaining every v2 channel and timing semantic.
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
  cubicBezierY: range(-100, 100),
  dimension: range(0, 100_000),
  cornerRadius: range(0, 100_000),
  strokeWidth: range(0, 10_000),
  blur: range(0, 1_000),
  shadowOffset: range(-100_000, 100_000),
  shadowSpread: range(-10_000, 10_000),
  layout: range(0, 100_000),
  normalized: range(0, 1),
  trimOffset: range(-1_000, 1_000),
  maxPathPoints: 128,
  maxPathSegments: 64,
  maxPaintTargets: 16,
  maxGradientStopTargets: 32,
  maxEffectTargets: 16,
  maxFontAxes: 16,
  maxVectorMorphPoints: 256,
  targetIndex: range(0, 255),
  fontAxisValue: range(-1_000_000, 1_000_000),
  maxTopologyIdLength: 128,
  steps: range(1, 100),
  springMass: range(0.01, 100),
  springStiffness: range(0.01, 10_000),
  springDamping: range(0, 1_000),
  physicalVelocity: range(-1_000, 1_000),
  inertiaDeceleration: range(0.0001, 1),
  backOvershoot: range(0, 10),
  elasticAmplitude: range(1, 10),
  elasticPeriod: range(0.1, 2)
})

export type MotionTrigger =
  | 'mount'
  | 'pageEnter'
  | 'pageExit'
  | 'hover'
  | 'press'
  | 'focus'
  | 'click'
  | 'inView'
  | 'loop'

export type MotionEasingName = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out'

export type MotionEaseMode = 'in' | 'out' | 'inOut'

export interface MotionCubicBezierEasing {
  type: 'cubicBezier'
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface MotionHoldEasing {
  type: 'hold'
}

export interface MotionStepsEasing {
  type: 'steps'
  steps: number
  position: 'start' | 'end'
}

export interface MotionSpringEasing {
  type: 'spring'
  mass: number
  stiffness: number
  damping: number
  velocity: number
}

export interface MotionInertiaEasing {
  type: 'inertia'
  velocity: number
  deceleration: number
}

export interface MotionPowerEasing {
  type: 'power'
  mode: MotionEaseMode
  power: 1 | 2 | 3 | 4
}

export interface MotionSineEasing {
  type: 'sine'
  mode: MotionEaseMode
}

export interface MotionExpoEasing {
  type: 'expo'
  mode: MotionEaseMode
}

export interface MotionCircEasing {
  type: 'circ'
  mode: MotionEaseMode
}

export interface MotionBackEasing {
  type: 'back'
  mode: MotionEaseMode
  overshoot: number
}

export interface MotionBounceEasing {
  type: 'bounce'
  mode: MotionEaseMode
}

export interface MotionElasticEasing {
  type: 'elastic'
  mode: MotionEaseMode
  amplitude: number
  period: number
}

export type MotionEasing =
  | MotionEasingName
  | MotionCubicBezierEasing
  | MotionHoldEasing
  | MotionStepsEasing
  | MotionSpringEasing
  | MotionInertiaEasing
  | MotionPowerEasing
  | MotionSineEasing
  | MotionExpoEasing
  | MotionCircEasing
  | MotionBackEasing
  | MotionBounceEasing
  | MotionElasticEasing

export interface MotionColor {
  r: number
  g: number
  b: number
  a: number
}

export interface MotionPathPoint {
  x: number
  y: number
}

export interface MotionPolylinePath {
  /** Optional explicit discriminator. Omitted preserves the legacy v2/v3 wire shape. */
  version?: 1
  points: MotionPathPoint[]
  autoRotate?: boolean
}

export interface MotionCubicPathSegment {
  control1: MotionPathPoint
  control2: MotionPathPoint
  end: MotionPathPoint
}

/** Bounded piecewise cubic Bezier path. MotionSpec v3 only. */
export interface MotionCubicPath {
  version: 2
  start: MotionPathPoint
  segments: MotionCubicPathSegment[]
  autoRotate?: boolean
}

export type MotionPath = MotionPolylinePath | MotionCubicPath

export type MotionPaintKind = 'fill' | 'stroke'

/** One indexed solid paint override. At least one of color/opacity is required. */
export interface MotionPaintTarget {
  kind: MotionPaintKind
  index: number
  color?: MotionColor
  opacity?: number
}

/** One indexed stop within one indexed gradient paint. */
export interface MotionGradientStopTarget {
  kind: MotionPaintKind
  paintIndex: number
  stopIndex: number
  position: number
  color: MotionColor
}

export interface MotionBlurEffectTarget {
  kind: 'blur'
  index: number
  radius: number
}

export interface MotionShadowEffectTarget {
  kind: 'shadow'
  index: number
  x: number
  y: number
  blur: number
  spread: number
  color: MotionColor
}

export type MotionEffectTarget = MotionBlurEffectTarget | MotionShadowEffectTarget

export interface MotionCornerRadii {
  topLeft: number
  topRight: number
  bottomRight: number
  bottomLeft: number
}

export interface MotionFontAxisTarget {
  /** OpenType variation axis tag: exactly four ASCII alphanumeric characters. */
  tag: string
  value: number
}

export interface MotionVectorMorph {
  /** Stable topology signature owned by the source vector geometry. */
  topologyId: string
  points: MotionPathPoint[]
}

export interface MotionKeyframe {
  /**
   * Stable timeline identity used by collaborative MotionSpec v3 authoring.
   * Older v3 documents may omit it and v1/v2 must not persist it.
   */
  id?: string
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
  /** Transform origin in normalized local coordinates. MotionSpec v2 and newer only. */
  originX?: number
  originY?: number
  /** Absolute visual geometry values. MotionSpec v2 and newer only. */
  width?: number
  height?: number
  cornerRadius?: number
  /** First visible solid paint/stroke overrides. MotionSpec v2 and newer only. */
  fillColor?: MotionColor
  strokeColor?: MotionColor
  strokeWidth?: number
  /** Bounded effect values. MotionSpec v2 and newer only. */
  blur?: number
  shadowX?: number
  shadowY?: number
  shadowBlur?: number
  shadowSpread?: number
  shadowColor?: MotionColor
  /** Normalized progress along the track's bounded path. MotionSpec v2 and newer only. */
  pathProgress?: number
  /** Normalized vector trim plus a bounded cyclic offset. MotionSpec v2 and newer only. */
  trimStart?: number
  trimEnd?: number
  trimOffset?: number
  /** Absolute auto-layout values. MotionSpec v2 and newer only. */
  gap?: number
  rowGap?: number
  columnGap?: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  /** Indexed paint/effect and structured visual channels. MotionSpec v3 only. */
  paints?: MotionPaintTarget[]
  gradientStops?: MotionGradientStopTarget[]
  effects?: MotionEffectTarget[]
  cornerRadii?: MotionCornerRadii
  /** Normalized leading-text reveal progress. MotionSpec v3 only. */
  textReveal?: number
  fontAxes?: MotionFontAxisTarget[]
  vectorMorph?: MotionVectorMorph
  easing?: MotionEasing
}

export type MotionDirection = 'normal' | 'reverse' | 'alternate' | 'alternate-reverse'
export type MotionFill = 'none' | 'forwards' | 'backwards' | 'both'

export type MotionCompositeMode = 'replace' | 'add' | 'accumulate'

export interface MotionTrackComposition {
  mode: MotionCompositeMode
  /** Blend strength applied by the sampler. Omitted means 1. MotionSpec v3 only. */
  weight?: number
  /** Lower priorities compose first; source order breaks ties. MotionSpec v3 only. */
  priority?: number
}

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
  /** Human-readable label independent of the stable track id. MotionSpec v3 only. */
  name?: string
  trigger: MotionTrigger
  keyframes: MotionKeyframe[]
  timing: MotionTiming
  exit?: 'none' | 'reverse' | 'reset'
  /** Legacy polyline or v3 bounded cubic path used by pathProgress keyframes. */
  path?: MotionPath
  /** Explicit channel-composition policy. MotionSpec v3 only. */
  composition?: MotionTrackComposition
}

export interface MotionPresetProvenance {
  id: string
  version: number
  parameters: Record<string, string | number | boolean>
}

export interface MotionSpec {
  version: 1 | 2 | 3
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
