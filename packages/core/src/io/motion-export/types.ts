import type { MotionTrigger, SceneGraph } from '@open-pencil/scene-graph'

import type { RasterRenderBounds } from '#core/io/formats/raster'
import type { MotionVisualState } from '#core/motion'

export type MotionExportFormat = 'png-sequence' | 'gif' | 'webm' | 'mp4'

export type MotionExportReducedMotion = 'allow' | 'reduce' | 'disable'

export const MOTION_EXPORT_LIMITS = Object.freeze({
  minFps: 1,
  maxFps: 120,
  maxSourceDurationMs: 120_000,
  maxTotalDurationMs: 300_000,
  maxLoops: 100,
  maxFrames: 3_600,
  minScale: 0.1,
  maxScale: 4,
  maxPixelDimension: 8_192,
  maxPixelArea: 33_554_432,
  maxTotalPixels: 100_000_000,
  maxPadding: 4_096
})

export interface MotionFrameTime {
  /** Exact presentation timestamp represented as a rational number of seconds. */
  readonly numerator: number
  readonly denominator: number
  readonly timestampUs: number
  readonly durationUs: number
  readonly loopIndex: number
  readonly localTimeUs: number
}

export interface MotionPlannedFrame extends MotionFrameTime {
  readonly index: number
  readonly fileName: string
}

export interface MotionFramePlan {
  readonly version: 1
  readonly fps: number
  readonly timebase: { readonly numerator: 1; readonly denominator: number }
  readonly sourceDurationUs: number
  readonly totalDurationUs: number
  readonly loops: number
  readonly scale: number
  readonly width: number
  readonly height: number
  readonly pixelWidth: number
  readonly pixelHeight: number
  readonly frameCount: number
  readonly frames: readonly MotionPlannedFrame[]
}

export interface PlanMotionFramesOptions {
  readonly durationMs: number
  readonly fps?: number
  readonly loops?: number
  readonly scale?: number
  /** Unscaled, fixed export width in document pixels. */
  readonly width: number
  /** Unscaled, fixed export height in document pixels. */
  readonly height: number
}

export type MotionGraphExportSource =
  | {
      readonly kind: 'nodes'
      readonly nodeIds: readonly string[]
      readonly trigger?: MotionTrigger | 'all'
      readonly trackId?: string
    }
  | {
      readonly kind: 'scene'
      readonly ownerNodeId: string
      readonly sequenceId: string
    }

export type MotionExportBounds = Readonly<RasterRenderBounds>

export interface MotionFrameRenderRequest {
  readonly graph: SceneGraph
  readonly pageId: string
  readonly nodeIds: readonly string[]
  readonly scale: number
  readonly bounds: MotionExportBounds
  readonly visuals: ReadonlyMap<string, MotionVisualState>
  readonly frame: MotionPlannedFrame
  readonly generatedEffectMode: MotionExportReducedMotion
  readonly signal?: AbortSignal
}

export type MotionFrameRenderer = (request: MotionFrameRenderRequest) => Promise<Uint8Array | null>

export interface MotionRenderedFrame extends MotionPlannedFrame {
  readonly mimeType: 'image/png'
  readonly bytes: Uint8Array
  readonly byteLength: number
}

export type MotionExportProgressPhase = 'prepare' | 'render' | 'encode'

export interface MotionExportProgress {
  readonly phase: MotionExportProgressPhase
  readonly completed: number
  readonly total: number
  readonly frameIndex?: number
}

export type MotionExportProgressCallback = (progress: MotionExportProgress) => void

export interface MotionAnimationEncoderInput {
  readonly plan: MotionFramePlan
  readonly frames: readonly MotionRenderedFrame[]
  readonly signal?: AbortSignal
  readonly onProgress?: MotionExportProgressCallback
}

/** Optional real encoder supplied by a platform integration. Core never emits disguised files. */
export interface MotionAnimationEncoder {
  readonly format: Exclude<MotionExportFormat, 'png-sequence'>
  readonly mimeType: string
  readonly extension: string
  readonly capability: string
  /** Whether encoded pixels preserve source alpha. Opaque-only encoders must say so explicitly. */
  readonly alpha?: 'preserved' | 'binary-threshold' | 'opaque-only' | 'unknown'
  /** Byte stability is stronger than preserving the authored fixed presentation timebase. */
  readonly determinism?: 'bit-exact' | 'timeline-exact'
  encode(input: MotionAnimationEncoderInput): Promise<Uint8Array>
}

export interface MotionExportCapability {
  readonly format: MotionExportFormat
  readonly available: boolean
  readonly mode: 'builtin' | 'injected' | 'unavailable'
  readonly reason?: string
  readonly encoder?: string
  readonly alpha?: MotionAnimationEncoder['alpha']
  readonly determinism?: MotionAnimationEncoder['determinism']
}

interface BaseMotionExportResult {
  readonly format: MotionExportFormat
  readonly plan: MotionFramePlan
  readonly source: MotionGraphExportSource
  readonly reducedMotion: MotionExportReducedMotion
  readonly issues: readonly string[]
}

export interface MotionPngSequenceResult extends BaseMotionExportResult {
  readonly format: 'png-sequence'
  readonly mimeType: 'image/png'
  readonly frames: readonly MotionRenderedFrame[]
  readonly manifest: MotionPngSequenceManifest
}

export interface MotionEncodedAnimationResult extends BaseMotionExportResult {
  readonly format: 'gif' | 'webm' | 'mp4'
  readonly mimeType: string
  readonly extension: string
  readonly bytes: Uint8Array
  readonly byteLength: number
  readonly encoder: string
  readonly alpha?: MotionAnimationEncoder['alpha']
  readonly determinism?: MotionAnimationEncoder['determinism']
}

export type MotionAnimationExportResult = MotionPngSequenceResult | MotionEncodedAnimationResult

export interface MotionPngSequenceManifest {
  readonly version: 1
  readonly format: 'png-sequence'
  readonly fps: number
  readonly timebase: { readonly numerator: 1; readonly denominator: number }
  readonly sourceDurationUs: number
  readonly totalDurationUs: number
  readonly loops: number
  readonly width: number
  readonly height: number
  readonly pixelWidth: number
  readonly pixelHeight: number
  readonly frameCount: number
  readonly frames: ReadonlyArray<{
    readonly index: number
    readonly file: string
    readonly timestampUs: number
    readonly durationUs: number
    readonly loopIndex: number
    readonly localTimeUs: number
    readonly byteLength: number
  }>
}

export interface ExportGraphMotionOptions {
  readonly graph: SceneGraph
  readonly pageId: string
  readonly source: MotionGraphExportSource
  readonly format?: MotionExportFormat
  readonly fps?: number
  readonly loops?: number
  readonly scale?: number
  readonly padding?: number
  /** Optional deterministic trim/extension of the prepared source duration. */
  readonly durationMs?: number
  readonly reducedMotion?: MotionExportReducedMotion
  readonly signal?: AbortSignal
  readonly onProgress?: MotionExportProgressCallback
  readonly renderFrame?: MotionFrameRenderer
  readonly encoders?: readonly MotionAnimationEncoder[]
}

/** Geometry/timing inputs shared by export and capability preflight. */
export type PlanGraphMotionExportOptions = Pick<
  ExportGraphMotionOptions,
  | 'graph'
  | 'pageId'
  | 'source'
  | 'fps'
  | 'loops'
  | 'scale'
  | 'padding'
  | 'durationMs'
  | 'reducedMotion'
  | 'signal'
>

/** Exact fixed canvas that exportGraphMotion will render for the same inputs. */
export interface MotionGraphExportPlan {
  readonly plan: MotionFramePlan
  readonly bounds: MotionExportBounds
  readonly nodeIds: readonly string[]
  readonly issues: readonly string[]
  readonly reducedMotion: MotionExportReducedMotion
}

export class MotionExportCapabilityError extends Error {
  readonly format: MotionExportFormat

  constructor(format: MotionExportFormat, reason: string) {
    super(`Motion export format "${format}" is unavailable: ${reason}`)
    this.name = 'MotionExportCapabilityError'
    this.format = format
  }
}

export class MotionExportCancelledError extends Error {
  constructor() {
    super('Motion export was cancelled')
    this.name = 'MotionExportCancelledError'
  }
}
