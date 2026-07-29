import type {
  MotionChannels,
  MotionColor,
  MotionCompositeMode,
  MotionCornerRadii,
  MotionDirection,
  MotionEasing,
  MotionEffectTarget,
  MotionFill,
  MotionFontAxisTarget,
  MotionGradientStopTarget,
  MotionKeyframe,
  MotionPaintTarget,
  MotionSpec,
  MotionTrack,
  MotionTrigger,
  MotionVectorMorph
} from '@open-pencil/scene-graph'

import type { PreparedMotionPath } from './path'

/** Ephemeral visual delta sampled from a node's authored MotionSpec. */
export interface MotionVisualState {
  readonly x: number
  readonly y: number
  readonly scaleX: number
  readonly scaleY: number
  readonly rotate: number
  /** Multiplier applied to the node's authored opacity. */
  readonly opacity: number
  /** Optional MotionSpec v2 visual/layout overrides. Missing means authored value. */
  readonly originX?: number
  readonly originY?: number
  readonly width?: number
  readonly height?: number
  readonly cornerRadius?: number
  readonly fillColor?: MotionColor
  readonly strokeColor?: MotionColor
  readonly strokeWidth?: number
  readonly blur?: number
  readonly shadowX?: number
  readonly shadowY?: number
  readonly shadowBlur?: number
  readonly shadowSpread?: number
  readonly shadowColor?: MotionColor
  readonly pathProgress?: number
  readonly trimStart?: number
  readonly trimEnd?: number
  readonly trimOffset?: number
  readonly gap?: number
  readonly rowGap?: number
  readonly columnGap?: number
  readonly paddingTop?: number
  readonly paddingRight?: number
  readonly paddingBottom?: number
  readonly paddingLeft?: number
  /** Optional MotionSpec v3 structured overrides. Missing means authored value. */
  readonly paints?: readonly MotionPaintTarget[]
  readonly gradientStops?: readonly MotionGradientStopTarget[]
  readonly effects?: readonly MotionEffectTarget[]
  readonly cornerRadii?: Readonly<MotionCornerRadii>
  readonly textReveal?: number
  readonly fontAxes?: readonly MotionFontAxisTarget[]
  readonly vectorMorph?: Readonly<MotionVectorMorph>
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

export type MotionSamplingSelection =
  | { readonly mode: 'trigger'; readonly trigger: MotionTrigger }
  | { readonly mode: 'trackIds'; readonly trackIds: readonly string[] }
  | { readonly mode: 'all' }

export interface PrepareMotionSamplingOptions {
  /** Select tracks explicitly; defaults to the legacy mount-trigger behavior. */
  readonly selection?: MotionSamplingSelection
  /** Applies the MotionSpec reduced-motion policy when true. */
  readonly prefersReducedMotion?: boolean
}

export interface MotionSample {
  readonly visual: MotionVisualState
  /** Whether at least one selected track is playable. */
  readonly hasTracks: boolean
  /** Whether at least one matched track contributes at this instant. */
  readonly contributes: boolean
  /** Whether every matched playable track has reached its finite end. */
  readonly finished: boolean
}

export type MotionCompositionMode = MotionCompositeMode

/** Fully resolved MotionSpec v3 composition metadata. `sourceIndex` keeps equal-priority tracks
 * stable after selection/filtering without relying on engine sort stability. */
export interface PreparedMotionComposition {
  readonly mode: MotionCompositionMode
  readonly weight: number
  readonly priority: number
  readonly sourceIndex: number
}

/** Track data normalized once for repeated frame sampling. */
export interface PreparedMotionTrack {
  readonly id: string
  readonly trigger: MotionTrigger
  readonly exit: NonNullable<MotionTrack['exit']>
  readonly channels: Readonly<MotionChannels>
  readonly keyframes: readonly MotionKeyframe[]
  readonly path?: PreparedMotionPath
  readonly easing?: MotionEasing
  readonly durationMs: number
  readonly delayMs: number
  readonly iterations: number | 'infinite'
  readonly direction: MotionDirection
  readonly fill: MotionFill
  readonly composition: PreparedMotionComposition
}

/** Immutable-by-contract sampling input prepared for one selection and accessibility preference. */
export interface PreparedMotionSamplingPlan {
  readonly version: MotionSpec['version']
  readonly selection: MotionSamplingSelection
  readonly prefersReducedMotion: boolean
  readonly reducedMotion: NonNullable<MotionSpec['reducedMotion']>
  readonly tracks: readonly PreparedMotionTrack[]
}

/** Isolated contribution of one prepared track at a sampled instant. */
export interface MotionTrackSampleDiagnostic {
  readonly trackId: string
  readonly trigger: MotionTrigger
  readonly exit: NonNullable<MotionTrack['exit']>
  readonly progress: number
  readonly contributes: boolean
  readonly finished: boolean
  readonly visual: MotionVisualState
  /** Present for MotionSpec v3; older specs retain their legacy diagnostic shape. */
  readonly composition?: Readonly<Omit<PreparedMotionComposition, 'sourceIndex'>>
}

/** Aggregate sample plus stable source-order diagnostics for every playable track. */
export interface MotionDiagnosticSample extends MotionSample {
  readonly tracks: readonly MotionTrackSampleDiagnostic[]
}
