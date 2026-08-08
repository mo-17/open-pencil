import type { CanvasPerformanceMode } from '@open-pencil/core/canvas'
import type { CanvasActiveFrameSample } from '@open-pencil/vue'

const MODE_ORDER: readonly CanvasPerformanceMode[] = ['resource-saving', 'balanced', 'smooth']

export interface CanvasAutoPerformanceOptions {
  evaluationIntervalMs: number
  overloadWindowMs: number
  recoveryWindowMs: number
  cooldownMs: number
  minSamples: number
  overloadP95Ratio: number
  healthyP95Ratio: number
  overloadMissedFrameRatio: number
  healthyMissedFrameRatio: number
}

export interface CanvasAutoPerformanceSnapshot {
  mode: CanvasPerformanceMode
  sampleCount: number
  frameBudgetMs: number
  p95RenderRatio: number
  missedFrameRatio: number
}

const DEFAULT_OPTIONS: Readonly<CanvasAutoPerformanceOptions> = Object.freeze({
  evaluationIntervalMs: 250,
  overloadWindowMs: 2_000,
  recoveryWindowMs: 10_000,
  cooldownMs: 5_000,
  minSamples: 24,
  overloadP95Ratio: 0.9,
  healthyP95Ratio: 0.55,
  overloadMissedFrameRatio: 0.2,
  healthyMissedFrameRatio: 0.05
})

const DEFAULT_FRAME_BUDGET_MS = 1000 / 60
const MIN_REFRESH_INTERVAL_MS = 5
const MAX_REFRESH_INTERVAL_MS = 50
const MAX_ACTIVE_FRAME_INTERVAL_MS = 250

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))
  return sorted[index]
}

function adjacentMode(mode: CanvasPerformanceMode, direction: -1 | 1): CanvasPerformanceMode {
  const index = MODE_ORDER.indexOf(mode)
  return MODE_ORDER[Math.min(MODE_ORDER.length - 1, Math.max(0, index + direction))]
}

/**
 * Lightweight hysteresis controller for the app's optional Automatic canvas preference.
 * It consumes only active frames; callers must not feed idle gaps or overlay-only renders.
 */
export class CanvasAutoPerformanceController {
  private readonly options: Readonly<CanvasAutoPerformanceOptions>
  private readonly samples: CanvasActiveFrameSample[] = []
  private currentMode: CanvasPerformanceMode
  private overloadSince: number | null = null
  private healthySince: number | null = null
  private cooldownUntil = 0
  private lastEvaluationAt = Number.NEGATIVE_INFINITY
  private latestSnapshot: CanvasAutoPerformanceSnapshot

  constructor(
    initialMode: CanvasPerformanceMode = 'balanced',
    options: Partial<CanvasAutoPerformanceOptions> = {}
  ) {
    this.currentMode = initialMode
    this.options = Object.freeze({ ...DEFAULT_OPTIONS, ...options })
    this.latestSnapshot = {
      mode: initialMode,
      sampleCount: 0,
      frameBudgetMs: DEFAULT_FRAME_BUDGET_MS,
      p95RenderRatio: 0,
      missedFrameRatio: 0
    }
  }

  get mode(): CanvasPerformanceMode {
    return this.currentMode
  }

  get snapshot(): Readonly<CanvasAutoPerformanceSnapshot> {
    return this.latestSnapshot
  }

  reset(mode: CanvasPerformanceMode = 'balanced'): CanvasPerformanceMode {
    this.currentMode = mode
    this.samples.length = 0
    this.overloadSince = null
    this.healthySince = null
    this.cooldownUntil = 0
    this.lastEvaluationAt = Number.NEGATIVE_INFINITY
    this.latestSnapshot = {
      mode,
      sampleCount: 0,
      frameBudgetMs: DEFAULT_FRAME_BUDGET_MS,
      p95RenderRatio: 0,
      missedFrameRatio: 0
    }
    return mode
  }

  record(sample: CanvasActiveFrameSample): CanvasPerformanceMode {
    if (!Number.isFinite(sample.timestampMs) || !Number.isFinite(sample.renderDurationMs)) {
      return this.currentMode
    }
    this.samples.push({
      timestampMs: sample.timestampMs,
      renderDurationMs: Math.max(0, sample.renderDurationMs),
      ...(sample.frameIntervalMs !== undefined && Number.isFinite(sample.frameIntervalMs)
        ? { frameIntervalMs: Math.max(0, sample.frameIntervalMs) }
        : {})
    })

    if (sample.timestampMs - this.lastEvaluationAt < this.options.evaluationIntervalMs) {
      return this.currentMode
    }
    this.lastEvaluationAt = sample.timestampMs

    const oldestAllowed = sample.timestampMs - this.options.recoveryWindowMs
    const firstRetainedIndex = this.samples.findIndex(
      (candidate) => candidate.timestampMs >= oldestAllowed
    )
    if (firstRetainedIndex > 0) this.samples.splice(0, firstRetainedIndex)

    const metrics = this.computeSnapshot()
    this.latestSnapshot = { mode: this.currentMode, ...metrics }
    if (this.samples.length < this.options.minSamples || sample.timestampMs < this.cooldownUntil) {
      return this.currentMode
    }

    const overloaded =
      metrics.p95RenderRatio >= this.options.overloadP95Ratio ||
      metrics.missedFrameRatio >= this.options.overloadMissedFrameRatio
    const healthy =
      metrics.p95RenderRatio <= this.options.healthyP95Ratio &&
      metrics.missedFrameRatio <= this.options.healthyMissedFrameRatio

    if (overloaded) {
      this.healthySince = null
      this.overloadSince ??= sample.timestampMs
      if (sample.timestampMs - this.overloadSince >= this.options.overloadWindowMs) {
        this.changeMode(adjacentMode(this.currentMode, -1), sample.timestampMs)
      }
    } else if (healthy) {
      this.overloadSince = null
      this.healthySince ??= sample.timestampMs
      if (sample.timestampMs - this.healthySince >= this.options.recoveryWindowMs) {
        this.changeMode(adjacentMode(this.currentMode, 1), sample.timestampMs)
      }
    } else {
      this.overloadSince = null
      this.healthySince = null
    }
    return this.currentMode
  }

  private computeSnapshot(): Omit<CanvasAutoPerformanceSnapshot, 'mode'> {
    const activeIntervals = this.samples
      .map((sample) => sample.frameIntervalMs)
      .filter(
        (interval): interval is number =>
          interval !== undefined &&
          interval >= MIN_REFRESH_INTERVAL_MS &&
          interval <= MAX_ACTIVE_FRAME_INTERVAL_MS
      )
    const cadenceIntervals = activeIntervals.filter(
      (interval) => interval <= MAX_REFRESH_INTERVAL_MS
    )
    // A low percentile approximates the display cadence without treating occasional dropped
    // frames as a slower monitor refresh rate.
    const frameBudgetMs = cadenceIntervals.length
      ? percentile(cadenceIntervals, 0.2)
      : DEFAULT_FRAME_BUDGET_MS
    const renderRatios = this.samples.map((sample) => sample.renderDurationMs / frameBudgetMs)
    const missedFrames = activeIntervals.filter((interval) => interval > frameBudgetMs * 1.5).length
    return {
      sampleCount: this.samples.length,
      frameBudgetMs,
      p95RenderRatio: percentile(renderRatios, 0.95),
      missedFrameRatio: activeIntervals.length === 0 ? 0 : missedFrames / activeIntervals.length
    }
  }

  private changeMode(mode: CanvasPerformanceMode, timestampMs: number): void {
    if (mode === this.currentMode) {
      this.overloadSince = null
      this.healthySince = null
      return
    }
    this.currentMode = mode
    this.samples.length = 0
    this.overloadSince = null
    this.healthySince = null
    this.cooldownUntil = timestampMs + this.options.cooldownMs
    this.lastEvaluationAt = timestampMs
    this.latestSnapshot = {
      mode,
      sampleCount: 0,
      frameBudgetMs: DEFAULT_FRAME_BUDGET_MS,
      p95RenderRatio: 0,
      missedFrameRatio: 0
    }
  }
}
