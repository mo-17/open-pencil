/** One operation's abort race; each transport owns its error and request lifetime. */
export function waitForManagementOperation<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  createAbortError: () => Error
): Promise<T> {
  if (!signal) return operation
  let onAbort: () => void = () => undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(createAbortError())
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  return Promise.race([operation, aborted]).finally(() => {
    signal.removeEventListener('abort', onAbort)
  })
}
