/** Cancellation releases the host even when a driver or module initializer never settles. */
export async function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let cleanup = () => {
    /* Installed synchronously by the promise constructor. */
  }
  const cancelled = new Promise<never>((_resolve, reject) => {
    const abort = () => reject(new DOMException('Shader playback cancelled', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    cleanup = () => signal.removeEventListener('abort', abort)
    if (signal.aborted) abort()
  })
  return Promise.race([work, cancelled]).finally(() => cleanup())
}

/** Serialize capture and texture initialization; cancelled queued work never allocates. */
export function initializationQueue() {
  let tail: Promise<void> = Promise.resolve()
  return {
    run<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
      const next = tail.then(() => {
        signal.throwIfAborted()
        return untilAborted(work(), signal)
      })
      tail = next.then(
        () => undefined,
        () => undefined
      )
      return untilAborted(next, signal)
    }
  }
}
