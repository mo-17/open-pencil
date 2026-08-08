const DEFAULT_UPDATE_ACK_TIMEOUT_MS = 30_000

export type PreviewUpdateAckEvent =
  | { type: 'ready'; url: string; port: number }
  | { type: 'error'; message: string }
  | { type: 'updated' }
  | { type: 'closing' }

export type PreviewStartupEvent = Extract<PreviewUpdateAckEvent, { type: 'ready' | 'error' }>

/** Preserve a startup result emitted before `Command.spawn()` resolves and the
 * ready waiter is attached. Tauri may deliver stdout before the spawn promise,
 * so dropping this event otherwise turns a healthy server into a 15s timeout. */
export function createPreviewStartupEventBuffer(): {
  capture: (event: PreviewUpdateAckEvent) => void
  replay: (listener: (event: PreviewStartupEvent) => void) => void
  settle: () => void
} {
  let settled = false
  let buffered: PreviewStartupEvent | null = null
  return {
    capture(event) {
      if (!settled && buffered === null && (event.type === 'ready' || event.type === 'error')) {
        buffered = event
      }
    },
    replay(listener) {
      if (buffered) listener(buffered)
    },
    settle() {
      settled = true
      buffered = null
    }
  }
}

/** Wait for the sidecar to accept one serialized full-file snapshot. */
export function waitForPreviewUpdateAck(
  listeners: Set<(event: PreviewUpdateAckEvent) => void>,
  timeoutMs = DEFAULT_UPDATE_ACK_TIMEOUT_MS
): { promise: Promise<void>; cancel: () => void } {
  let listener: ((event: PreviewUpdateAckEvent) => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = (): void => {
    if (timer) clearTimeout(timer)
    if (listener) listeners.delete(listener)
  }
  const promise = new Promise<void>((resolve, reject) => {
    listener = (event): void => {
      if (event.type === 'updated') {
        cancel()
        resolve()
      } else if (event.type === 'error' || event.type === 'closing') {
        cancel()
        reject(
          new Error(
            event.type === 'error'
              ? event.message
              : 'Preview sidecar closed before acknowledging the update'
          )
        )
      }
    }
    listeners.add(listener)
    timer = setTimeout(() => {
      cancel()
      reject(new Error(`Preview sidecar did not acknowledge update within ${timeoutMs}ms`))
    }, timeoutMs)
  })
  return { promise, cancel }
}
