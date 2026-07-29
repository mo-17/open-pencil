export interface MotionRuntimeClock {
  now(): number
  requestFrame(callback: (timestampMs: number) => void): unknown
  cancelFrame(handle: unknown): void
}

function normalizedTimestamp(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function currentTimestamp(): number {
  const performanceValue = Reflect.get(globalThis, 'performance') as
    | { now?: () => number }
    | undefined
  const now = performanceValue?.now
  return normalizedTimestamp(typeof now === 'function' ? now.call(performanceValue) : Date.now())
}

/** Browser-first clock with a timer fallback. No DOM globals are read at module evaluation. */
export function createDefaultMotionClock(): MotionRuntimeClock {
  if (
    typeof globalThis.requestAnimationFrame === 'function' &&
    typeof globalThis.cancelAnimationFrame === 'function'
  ) {
    return {
      now: currentTimestamp,
      requestFrame: (callback) => globalThis.requestAnimationFrame(callback),
      cancelFrame: (handle) => globalThis.cancelAnimationFrame(handle as number)
    }
  }
  return {
    now: currentTimestamp,
    requestFrame: (callback) => globalThis.setTimeout(() => callback(currentTimestamp()), 16),
    cancelFrame: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
  }
}

export interface ManualMotionClock extends MotionRuntimeClock {
  readonly timestampMs: number
  readonly pendingFrameCount: number
  advanceBy(deltaMs: number): void
  advanceTo(timestampMs: number): void
  flush(): void
}

/** Deterministic clock for tests, frame export, server rendering, and host-controlled playback. */
export function createManualMotionClock(initialTimestampMs = 0): ManualMotionClock {
  let timestampMs = normalizedTimestamp(initialTimestampMs)
  let nextHandle = 0
  const callbacks = new Map<number, (timestampMs: number) => void>()

  const runPending = () => {
    const pending = [...callbacks.values()]
    callbacks.clear()
    for (const callback of pending) callback(timestampMs)
  }

  return {
    get timestampMs() {
      return timestampMs
    },
    get pendingFrameCount() {
      return callbacks.size
    },
    now: () => timestampMs,
    requestFrame(callback) {
      const handle = ++nextHandle
      callbacks.set(handle, callback)
      return handle
    },
    cancelFrame(handle) {
      if (typeof handle === 'number') callbacks.delete(handle)
    },
    advanceBy(deltaMs) {
      if (!Number.isFinite(deltaMs) || deltaMs < 0) {
        throw new RangeError('Manual Motion clock delta must be a finite non-negative number')
      }
      timestampMs += deltaMs
      runPending()
    },
    advanceTo(nextTimestampMs) {
      if (!Number.isFinite(nextTimestampMs) || nextTimestampMs < timestampMs) {
        throw new RangeError('Manual Motion clock cannot move backwards')
      }
      timestampMs = nextTimestampMs
      runPending()
    },
    flush: runPending
  }
}
