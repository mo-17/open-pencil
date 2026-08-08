export type PreviewRefreshPolicy = 'realtime' | 'auto' | 'manual'

export const DEFAULT_PREVIEW_REFRESH_POLICY: PreviewRefreshPolicy = 'auto'
export const PREVIEW_REFRESH_POLICIES: readonly PreviewRefreshPolicy[] = [
  'realtime',
  'auto',
  'manual'
]
export const MIN_PREVIEW_AUTO_DELAY_MS = 200
export const MAX_PREVIEW_AUTO_DELAY_MS = 1_000

export function normalizePreviewRefreshPolicy(value: unknown): PreviewRefreshPolicy {
  return typeof value === 'string' &&
    PREVIEW_REFRESH_POLICIES.includes(value as PreviewRefreshPolicy)
    ? (value as PreviewRefreshPolicy)
    : DEFAULT_PREVIEW_REFRESH_POLICY
}

export type PreviewCompileReason = 'initial' | 'change' | 'manual'
export type PreviewCompileOutcome = 'pushed' | 'superseded' | 'failed'

export interface PreviewCompileRun {
  revision: number
  refreshFonts: boolean
  reason: PreviewCompileReason
  isCurrent(): boolean
}

export interface PreviewCompileSchedulerState {
  policy: PreviewRefreshPolicy
  autoDelayMs: number
  inFlight: boolean
  pending: boolean
  activeRevision: number | null
  pendingRevision: number | null
  latestRevision: number
  lastPushedRevision: number | null
  lastDurationMs: number | null
  recentDurationMs: number | null
  supersededRuns: number
  coalescedRequests: number
}

interface PendingCompile {
  revision: number
  refreshFonts: boolean
  reason: PreviewCompileReason
  requestedAt: number
}

interface PreviewCompileSchedulerClock {
  now(): number
  setTimer(callback: () => void, delayMs: number): () => void
}

export interface PreviewCompileSchedulerOptions {
  policy?: PreviewRefreshPolicy
  run(request: PreviewCompileRun): Promise<PreviewCompileOutcome>
  onStateChange?(state: PreviewCompileSchedulerState): void
  clock?: PreviewCompileSchedulerClock
}

const DEFAULT_CLOCK: PreviewCompileSchedulerClock = {
  now: () => performance.now(),
  setTimer: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs)
    return () => clearTimeout(timer)
  }
}

function clampDelay(durationMs: number): number {
  return Math.min(
    MAX_PREVIEW_AUTO_DELAY_MS,
    Math.max(MIN_PREVIEW_AUTO_DELAY_MS, Math.round(durationMs))
  )
}

export function nextPreviewAutoDelayMs(
  previousRecentDurationMs: number | null,
  latestDurationMs: number
): { delayMs: number; recentDurationMs: number } {
  const safeDuration = Math.max(0, latestDurationMs)
  const recentDurationMs =
    previousRecentDurationMs === null
      ? safeDuration
      : previousRecentDurationMs * 0.6 + safeDuration * 0.4
  return { delayMs: clampDelay(recentDurationMs), recentDurationMs }
}

export function createPreviewCompileSchedulerState(
  policy: PreviewRefreshPolicy = DEFAULT_PREVIEW_REFRESH_POLICY
): PreviewCompileSchedulerState {
  return {
    policy,
    autoDelayMs: MIN_PREVIEW_AUTO_DELAY_MS,
    inFlight: false,
    pending: false,
    activeRevision: null,
    pendingRevision: null,
    latestRevision: 0,
    lastPushedRevision: null,
    lastDurationMs: null,
    recentDurationMs: null,
    supersededRuns: 0,
    coalescedRequests: 0
  }
}

export function createPreviewCompileScheduler(options: PreviewCompileSchedulerOptions) {
  const clock = options.clock ?? DEFAULT_CLOCK
  const state = createPreviewCompileSchedulerState(options.policy)

  let active: PendingCompile | null = null
  let pending: PendingCompile | null = null
  let cancelScheduledRun: (() => void) | null = null
  let disposed = false

  function emitState(): void {
    state.inFlight = active !== null
    state.pending = pending !== null
    state.activeRevision = active?.revision ?? null
    state.pendingRevision = pending?.revision ?? null
    options.onStateChange?.({ ...state })
  }

  function cancelTimer(): void {
    cancelScheduledRun?.()
    cancelScheduledRun = null
  }

  function shouldKeepInitialCurrent(request: PendingCompile): boolean {
    return request.reason === 'initial' && state.policy === 'manual'
  }

  function isCurrent(request: PendingCompile): boolean {
    if (disposed || active?.revision !== request.revision) return false
    return request.revision === state.latestRevision || shouldKeepInitialCurrent(request)
  }

  function delayFor(request: PendingCompile): number | null {
    if (request.reason !== 'change' || state.policy === 'realtime') return 0
    if (state.policy === 'manual') return null
    const elapsed = Math.max(0, clock.now() - request.requestedAt)
    return Math.max(0, state.autoDelayMs - elapsed)
  }

  function schedulePending(): void {
    cancelTimer()
    if (disposed || active || !pending) {
      emitState()
      return
    }
    const delayMs = delayFor(pending)
    if (delayMs === null) {
      emitState()
      return
    }
    if (delayMs <= 0) {
      void runPending()
      return
    }
    cancelScheduledRun = clock.setTimer(() => {
      cancelScheduledRun = null
      void runPending()
    }, delayMs)
    emitState()
  }

  async function runPending(): Promise<void> {
    if (disposed || active || !pending) return
    cancelTimer()
    const request = pending
    pending = null
    active = request
    emitState()
    const startedAt = clock.now()
    let outcome: PreviewCompileOutcome = 'failed'
    try {
      outcome = await options.run({
        revision: request.revision,
        refreshFonts: request.refreshFonts,
        reason: request.reason,
        isCurrent: () => isCurrent(request)
      })
    } catch (error) {
      console.warn('[preview] scheduled compile failed:', error)
    }

    if (outcome === 'pushed') {
      const durationMs = Math.max(0, clock.now() - startedAt)
      state.lastPushedRevision = request.revision
      state.lastDurationMs = durationMs
      const nextDelay = nextPreviewAutoDelayMs(state.recentDurationMs, durationMs)
      state.recentDurationMs = nextDelay.recentDurationMs
      state.autoDelayMs = nextDelay.delayMs
    } else if (outcome === 'superseded') {
      state.supersededRuns++
    }

    active = null
    emitState()
    schedulePending()
  }

  function enqueue(reason: PreviewCompileReason, refreshFonts: boolean): number {
    if (disposed) return state.latestRevision
    const revision = ++state.latestRevision
    if (pending) state.coalescedRequests++
    pending = {
      revision,
      refreshFonts: refreshFonts || (pending?.refreshFonts ?? false),
      reason,
      requestedAt: clock.now()
    }
    schedulePending()
    return revision
  }

  emitState()

  return {
    getState: (): PreviewCompileSchedulerState => ({ ...state }),
    requestInitial: (): number => enqueue('initial', false),
    requestChange: (refreshFonts = false): number => enqueue('change', refreshFonts),
    flush: (refreshFonts = false): number => enqueue('manual', refreshFonts),
    setPolicy(policy: PreviewRefreshPolicy): void {
      if (disposed || state.policy === policy) return
      state.policy = policy
      schedulePending()
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      cancelTimer()
      pending = null
      emitState()
    }
  }
}
