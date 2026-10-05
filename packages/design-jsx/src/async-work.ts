export interface CooperativeExecution {
  signal?: AbortSignal
  workSinceYield: number
  yieldEvery: number
}

export function throwIfAborted(signal: AbortSignal | undefined, message: string): void {
  if (!signal?.aborted) return
  const error = new Error(message)
  error.name = 'AbortError'
  throw error
}

export function yieldToHost(signal: AbortSignal | undefined, message: string): Promise<void> {
  throwIfAborted(signal, message)
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      try {
        throwIfAborted(signal, message)
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, 0)
    signal?.addEventListener('abort', abort, { once: true })
  })
}
