export const CANVAS_PERFORMANCE_MODES = ['resource-saving', 'balanced', 'smooth'] as const

export type CanvasPerformanceMode = (typeof CANVAS_PERFORMANCE_MODES)[number]

export const DEFAULT_CANVAS_PERFORMANCE_MODE: CanvasPerformanceMode = 'balanced'

export type SmoothGeneratedEffectCadence = number | 'animation-frame'

export interface CanvasPerformanceProfile {
  mode: CanvasPerformanceMode
  smoothGeneratedEffectCadence: SmoothGeneratedEffectCadence
  /** Caps the redraw timer that is scheduled when discrete noise is the active effect driver. */
  noiseGeneratedEffectFpsCap: number
  /** Maximum collaboration cursor broadcasts per second during passive pointer movement. */
  collaborationCursorFpsCap: number
  /** Maximum simultaneous font-source resolution flights. */
  fontLoadConcurrency: number
  /** Upper bound; the host's memory capability may lower this further. */
  figParseWorkerConcurrency: 1 | 2
  /** Cooperative background-layout slice before yielding to the host. */
  backgroundLayoutTimeSliceMs: number
  /** Retained-scene coverage multiplier around the visible viewport. */
  sceneBackingCoverageScale: number
  /** Maximum retained-scene allocation, measured in device pixels. */
  sceneBackingMaxDevicePixels: number
  sceneBackingMinCrispDelayMs: number
  sceneBackingMaxCrispDelayMs: number
  sceneBackingMaxQuietInputIntervals: number
  sceneBackingMaxTilesPerStep: number
  sceneBackingBuildStepBudgetMs: number | null
  /**
   * Steady-state budget for decoded-image wrappers owned by one renderer. Recorded pictures and
   * retained snapshots may hold native SkImage references longer, so this is not a hard GPU-memory
   * ceiling.
   */
  decodedImageCacheBudgetBytes: number
}

const FRAME_BUDGET_60HZ_MS = 1000 / 60
const MEBIBYTE = 1024 * 1024

export const CANVAS_PERFORMANCE_PROFILES: Readonly<
  Record<CanvasPerformanceMode, Readonly<CanvasPerformanceProfile>>
> = Object.freeze({
  'resource-saving': Object.freeze({
    mode: 'resource-saving',
    smoothGeneratedEffectCadence: 15,
    noiseGeneratedEffectFpsCap: 15,
    collaborationCursorFpsCap: 15,
    fontLoadConcurrency: 2,
    figParseWorkerConcurrency: 1,
    backgroundLayoutTimeSliceMs: 2,
    sceneBackingCoverageScale: 1.5,
    sceneBackingMaxDevicePixels: 6_000_000,
    sceneBackingMinCrispDelayMs: 67,
    sceneBackingMaxCrispDelayMs: 500,
    sceneBackingMaxQuietInputIntervals: 6,
    sceneBackingMaxTilesPerStep: 1,
    sceneBackingBuildStepBudgetMs: null,
    decodedImageCacheBudgetBytes: 64 * MEBIBYTE
  }),
  balanced: Object.freeze({
    mode: 'balanced',
    smoothGeneratedEffectCadence: 30,
    noiseGeneratedEffectFpsCap: 30,
    collaborationCursorFpsCap: 30,
    fontLoadConcurrency: 4,
    figParseWorkerConcurrency: 1,
    backgroundLayoutTimeSliceMs: 5,
    sceneBackingCoverageScale: 3,
    sceneBackingMaxDevicePixels: 12_000_000,
    sceneBackingMinCrispDelayMs: FRAME_BUDGET_60HZ_MS * 2,
    sceneBackingMaxCrispDelayMs: 300,
    sceneBackingMaxQuietInputIntervals: 4,
    sceneBackingMaxTilesPerStep: 1,
    sceneBackingBuildStepBudgetMs: null,
    decodedImageCacheBudgetBytes: 128 * MEBIBYTE
  }),
  smooth: Object.freeze({
    mode: 'smooth',
    smoothGeneratedEffectCadence: 'animation-frame',
    noiseGeneratedEffectFpsCap: 60,
    collaborationCursorFpsCap: 60,
    fontLoadConcurrency: 6,
    figParseWorkerConcurrency: 2,
    backgroundLayoutTimeSliceMs: 3,
    sceneBackingCoverageScale: 3,
    sceneBackingMaxDevicePixels: 12_000_000,
    sceneBackingMinCrispDelayMs: FRAME_BUDGET_60HZ_MS,
    sceneBackingMaxCrispDelayMs: 133,
    sceneBackingMaxQuietInputIntervals: 2,
    sceneBackingMaxTilesPerStep: 4,
    sceneBackingBuildStepBudgetMs: 6,
    // Avoid increasing the default footprint on machines that already approach the app's
    // memory ceiling. A future native memory signal may safely unlock a larger cache.
    decodedImageCacheBudgetBytes: 128 * MEBIBYTE
  })
})

export function normalizeCanvasPerformanceMode(value: unknown): CanvasPerformanceMode {
  return typeof value === 'string' &&
    CANVAS_PERFORMANCE_MODES.includes(value as CanvasPerformanceMode)
    ? (value as CanvasPerformanceMode)
    : DEFAULT_CANVAS_PERFORMANCE_MODE
}

export function canvasPerformanceProfile(value: unknown): Readonly<CanvasPerformanceProfile> {
  return CANVAS_PERFORMANCE_PROFILES[normalizeCanvasPerformanceMode(value)]
}
