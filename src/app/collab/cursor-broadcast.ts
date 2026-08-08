export interface CursorBroadcastScheduler {
  now: () => number
  requestFrame: (callback: FrameRequestCallback) => number
  cancelFrame: (handle: number) => void
  setDelay: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearDelay: (handle: ReturnType<typeof setTimeout>) => void
}

export interface CursorBroadcastQueue<T> {
  push: (value: T, fpsCap: number) => void
  flush: () => void
  clear: () => void
}

const DEFAULT_CURSOR_FPS_CAP = 30

function defaultScheduler(): CursorBroadcastScheduler {
  return {
    now: () => performance.now(),
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
    setDelay: (callback, delayMs) => setTimeout(callback, delayMs),
    clearDelay: (handle) => clearTimeout(handle)
  }
}

function normalizeFpsCap(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_CURSOR_FPS_CAP
}

/**
 * Coalesces high-frequency cursor samples without losing the most recent one.
 * `flush()` is deliberately synchronous so interaction boundaries can publish
 * an exact trailing coordinate before the awareness session changes state.
 */
export function createCursorBroadcastQueue<T>(
  emit: (value: T) => void,
  scheduler: CursorBroadcastScheduler = defaultScheduler()
): CursorBroadcastQueue<T> {
  let pending: T | null = null
  let fpsCap = DEFAULT_CURSOR_FPS_CAP
  let lastSentAt = Number.NEGATIVE_INFINITY
  let frameHandle: number | null = null
  let delayHandle: ReturnType<typeof setTimeout> | null = null

  function intervalMs() {
    return 1000 / normalizeFpsCap(fpsCap)
  }

  function cancelScheduled() {
    if (frameHandle !== null) {
      scheduler.cancelFrame(frameHandle)
      frameHandle = null
    }
    if (delayHandle !== null) {
      scheduler.clearDelay(delayHandle)
      delayHandle = null
    }
  }

  function emitPending() {
    if (pending === null) return
    const value = pending
    pending = null
    lastSentAt = scheduler.now()
    emit(value)
  }

  function requestFrame() {
    if (frameHandle !== null) return
    frameHandle = scheduler.requestFrame(() => {
      frameHandle = null
      const remaining = intervalMs() - (scheduler.now() - lastSentAt)
      if (remaining > 0) {
        delayHandle = scheduler.setDelay(() => {
          delayHandle = null
          requestFrame()
        }, remaining)
        return
      }
      emitPending()
    })
  }

  function schedule() {
    if (frameHandle !== null || delayHandle !== null) return
    const remaining = intervalMs() - (scheduler.now() - lastSentAt)
    if (remaining <= 0) {
      requestFrame()
      return
    }
    delayHandle = scheduler.setDelay(() => {
      delayHandle = null
      requestFrame()
    }, remaining)
  }

  function push(value: T, nextFpsCap: number) {
    pending = value
    fpsCap = normalizeFpsCap(nextFpsCap)
    schedule()
  }

  function flush() {
    cancelScheduled()
    emitPending()
  }

  function clear() {
    cancelScheduled()
    pending = null
    lastSentAt = Number.NEGATIVE_INFINITY
  }

  return { push, flush, clear }
}
