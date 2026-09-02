import { randomHex } from '#core/random'

import type { FigSessionResponse } from './protocol'

const DEFAULT_FIG_SESSION_REQUEST_TIMEOUT_MS = 30_000

export function createFigSessionWorker(): Worker {
  if (typeof Worker === 'undefined') throw new Error('FIG session workers are unavailable')
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
}

export interface FigSessionOriginalArchiveRequester {
  request: () => Promise<Uint8Array>
  dispose: () => void
}

export interface FigSessionOriginalArchiveRequesterOptions {
  timeoutMs?: number
}

function sessionError(message: string): Error {
  return new Error(`FIG session failed: ${message}`)
}

/**
 * Adds archive-response routing without taking over MessagePort.onmessage, which
 * remains owned by the lazy-population client for the same document session.
 */
export function createFigSessionOriginalArchiveRequester(
  worker: Worker,
  port: MessagePort,
  options: FigSessionOriginalArchiveRequesterOptions = {}
): FigSessionOriginalArchiveRequester {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FIG_SESSION_REQUEST_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('FIG session request timeout must be positive')
  }
  const pending = new Map<
    string,
    {
      reject: (error: Error) => void
      resolve: (bytes: Uint8Array) => void
      timeout: ReturnType<typeof setTimeout>
    }
  >()
  let failure: Error | null = null

  const fail = (error: Error) => {
    if (!failure) failure = error
    for (const request of pending.values()) {
      clearTimeout(request.timeout)
      request.reject(failure)
    }
    pending.clear()
  }
  const onMessage = (event: MessageEvent<FigSessionResponse>) => {
    const response = event.data
    if (response.type !== 'original-archive-result' && response.type !== 'population-error') {
      return
    }
    if (!response.requestId) return
    const request = pending.get(response.requestId)
    if (!request) return
    if (response.type === 'population-error') {
      fail(sessionError(response.error))
      return
    }
    clearTimeout(request.timeout)
    pending.delete(response.requestId)
    request.resolve(response.bytes)
  }
  const onWorkerError = (event: ErrorEvent) => {
    fail(sessionError(event.message || 'worker error'))
  }
  const onMessageError = () => fail(sessionError('response could not be deserialized'))
  port.addEventListener('message', onMessage)
  port.addEventListener('messageerror', onMessageError)
  worker.addEventListener('error', onWorkerError)
  worker.addEventListener('messageerror', onMessageError)
  port.start()

  return {
    request() {
      if (failure) return Promise.reject(failure)
      const requestId = randomHex()
      return new Promise<Uint8Array>((resolve, reject) => {
        const timeout = setTimeout(() => {
          fail(sessionError('original archive request timed out'))
        }, timeoutMs)
        pending.set(requestId, { reject, resolve, timeout })
        try {
          port.postMessage({ type: 'original-archive', requestId })
        } catch (error) {
          fail(error instanceof Error ? error : sessionError(String(error)))
        }
      })
    },
    dispose() {
      port.removeEventListener('message', onMessage)
      port.removeEventListener('messageerror', onMessageError)
      worker.removeEventListener('error', onWorkerError)
      worker.removeEventListener('messageerror', onMessageError)
      fail(sessionError('disposed'))
    }
  }
}
