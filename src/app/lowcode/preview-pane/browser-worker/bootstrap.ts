/* oxlint-disable unicorn/require-post-message-target-origin -- DedicatedWorkerGlobalScope has no target origin. */

import { BROWSER_PREVIEW_WORKER_LIMITS } from './limits'
import { BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION } from './worker-bootstrap-protocol'

export interface BrowserPreviewWorkerRuntime {
  executeBrowserPreviewWorkerRequest(value: unknown): Promise<void>
}

export interface BrowserPreviewWorkerBootstrapScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  postMessage(message: unknown): void
}

export interface InstallBrowserPreviewWorkerBootstrapOptions {
  loadRuntime: () => Promise<BrowserPreviewWorkerRuntime>
  now?: () => number
}

interface RequestCorrelation {
  generation: number
  requestId: string
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

function ownValue(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

function requestCorrelation(value: unknown): RequestCorrelation | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const version = ownValue(value, 'version')
  const type = ownValue(value, 'type')
  const requestId = ownValue(value, 'requestId')
  const generation = ownValue(value, 'generation')
  if (
    version !== BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION ||
    type !== 'build-browser-preview' ||
    typeof requestId !== 'string' ||
    !REQUEST_ID_PATTERN.test(requestId) ||
    !Number.isSafeInteger(generation) ||
    (generation as number) < 0
  ) {
    return null
  }
  return { requestId, generation: generation as number }
}

function errorMessage(value: unknown): string {
  const message = value instanceof Error && value.message ? value.message : 'runtime failed to load'
  return `Browser preview Worker runtime failed to load: ${message}`.slice(
    0,
    BROWSER_PREVIEW_WORKER_LIMITS.maxDiagnosticTextLength
  )
}

/**
 * Installs the message handler before loading the compiler/bundler module graph.
 * This closes the otherwise silent Worker startup window and keeps a failed
 * dynamic import correlated with the request that triggered it.
 */
export function installBrowserPreviewWorkerBootstrap(
  scope: BrowserPreviewWorkerBootstrapScope,
  options: InstallBrowserPreviewWorkerBootstrapOptions
): void {
  const now = options.now ?? (() => performance.now())
  let runtimePromise: Promise<BrowserPreviewWorkerRuntime> | null = null
  let executionQueue: Promise<void> = Promise.resolve()

  async function execute(value: unknown): Promise<void> {
    const startedAt = now()
    const correlation = requestCorrelation(value)
    if (!correlation) return
    scope.postMessage({
      version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
      type: 'progress',
      requestId: correlation.requestId,
      generation: correlation.generation,
      stage: 'worker-load',
      elapsedMs: Math.max(0, now() - startedAt)
    })

    try {
      runtimePromise ??= options.loadRuntime()
      const runtime = await runtimePromise
      await runtime.executeBrowserPreviewWorkerRequest(value)
    } catch (cause) {
      scope.postMessage({
        version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
        type: 'error',
        requestId: correlation.requestId,
        generation: correlation.generation,
        error: errorMessage(cause)
      })
    }
  }

  scope.addEventListener('message', (event) => {
    executionQueue = executionQueue.then(
      () => execute(event.data),
      () => execute(event.data)
    )
  })
}
