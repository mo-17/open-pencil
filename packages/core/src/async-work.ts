export interface CooperativeExecution {
  signal?: AbortSignal
  workSinceYield: number
  yieldEvery: number
}

export function abortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(
    signal?.aborted ||
    (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
  )
}

export function throwIfAborted(signal: AbortSignal | undefined, message: string): void {
  if (signal?.aborted) throw abortError(message)
}

export function yieldToHost(signal: AbortSignal | undefined, abortMessage: string): Promise<void> {
  throwIfAborted(signal, abortMessage)
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      reject(abortError(abortMessage))
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, 0)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
