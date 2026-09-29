/** Shared generated timer ownership for the framework-specific toast stores. */
export function buildToastTimerRuntime(dismissFunction: 'dismiss' | '__opDismissToast'): string {
  return `type ToastPauseReason = 'pointer' | 'focus'
interface ToastTimer {
  handle?: ReturnType<typeof setTimeout>
  remaining: number
  started: number
  paused: Set<ToastPauseReason>
}
const timers = new Map<number, ToastTimer>()

function clearTimer(id: number): void {
  const timer = timers.get(id)
  if (timer?.handle !== undefined) clearTimeout(timer.handle)
  timers.delete(id)
}

function scheduleTimer(id: number, timer: ToastTimer): void {
  timer.started = Date.now()
  timer.handle = setTimeout(() => ${dismissFunction}(id), timer.remaining)
}

function startTimer(id: number, duration: number): void {
  if (duration === 0) return
  const timer: ToastTimer = { remaining: duration, started: Date.now(), paused: new Set() }
  timers.set(id, timer)
  scheduleTimer(id, timer)
}

export function __opPauseToast(id: number, reason: ToastPauseReason): void {
  const timer = timers.get(id)
  if (!timer || timer.paused.has(reason)) return
  if (timer.paused.size === 0 && timer.handle !== undefined) {
    clearTimeout(timer.handle)
    timer.handle = undefined
    timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.started))
  }
  timer.paused.add(reason)
}

export function __opResumeToast(id: number, reason: ToastPauseReason): void {
  const timer = timers.get(id)
  if (!timer || !timer.paused.delete(reason) || timer.paused.size > 0) return
  scheduleTimer(id, timer)
}
`
}
