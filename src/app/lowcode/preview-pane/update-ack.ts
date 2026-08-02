const DEFAULT_UPDATE_ACK_TIMEOUT_MS = 30_000

export type PreviewUpdateAckEvent =
  | { type: 'ready'; url: string; port: number }
  | { type: 'error'; message: string }
  | { type: 'updated' }
  | { type: 'closing' }

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
