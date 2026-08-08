export interface CooperativeExecution {
  signal?: AbortSignal
  workSinceYield: number
  yieldEvery: number
}

export interface ConcurrencyLimiterState {
  concurrency: number
  active: number
  pending: number
}

/**
 * FIFO concurrency gate for memory-sensitive async work.
 *
 * Changing the limit only affects queued work. Tasks that already started are
 * allowed to settle naturally, even when the new limit is below `active`.
 */
export class DynamicConcurrencyLimiter {
  private concurrencyLimit: number
  private activeCount = 0
  private readonly pendingStarts: Array<() => void> = []

  constructor(concurrency: number) {
    this.concurrencyLimit = normalizedConcurrency(concurrency)
  }

  setConcurrency(concurrency: number): void {
    this.concurrencyLimit = normalizedConcurrency(concurrency)
    this.drain()
  }

  state(): ConcurrencyLimiterState {
    return {
      concurrency: this.concurrencyLimit,
      active: this.activeCount,
      pending: this.pendingStarts.length
    }
  }

  run<T>(task: () => T | PromiseLike<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pendingStarts.push(() => {
        this.activeCount++
        void this.execute(task, resolve, reject)
      })
      this.drain()
    })
  }

  private async execute<T>(
    task: () => T | PromiseLike<T>,
    resolve: (value: T | PromiseLike<T>) => void,
    reject: (reason?: unknown) => void
  ): Promise<void> {
    try {
      resolve(await task())
    } catch (error) {
      reject(error)
    } finally {
      this.activeCount--
      this.drain()
    }
  }

  private drain(): void {
    while (this.activeCount < this.concurrencyLimit) {
      const start = this.pendingStarts.shift()
      if (!start) return
      start()
    }
  }
}

function normalizedConcurrency(concurrency: number): number {
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new RangeError('Concurrency must be a finite number greater than or equal to 1')
  }
  return Math.floor(concurrency)
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
