/** A bounded GPU operation; cancellation releases its waiter even if a driver never resolves. */
export function createShaderFrameJob(signal?: AbortSignal) {
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    abort()
  }, 10_000)
  let cancel: () => void = () => {
    /* Installed synchronously by the Promise constructor. */
  }
  const cancelled = new Promise<null>((resolve) => {
    cancel = () => resolve(null)
  })
  controller.signal.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) abort()
  return {
    controller,
    timedOut: () => timedOut,
    wait: (work: Promise<Uint8Array | null>) => Promise.race([work, cancelled]),
    close() {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      controller.signal.removeEventListener('abort', cancel)
    }
  }
}

/** One cancelled exporter stops waiting without cancelling another exporter's shared draw. */
export async function waitForShaderFrames(
  work: Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  if (!signal) return work
  signal.throwIfAborted()
  let abort: () => void = () => {
    /* Installed synchronously. */
  }
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new DOMException('Shader frame preparation cancelled', 'AbortError'))
  })
  signal.addEventListener('abort', abort, { once: true })
  try {
    await Promise.race([work, cancelled])
  } finally {
    signal.removeEventListener('abort', abort)
  }
}
