import { fontManager } from '@open-pencil/core/text'

import { createBrowserPreviewWorkerClient } from '../browser-worker/client'
import type {
  BrowserPreviewFontProvider,
  BrowserPreviewWorkerBuildResult,
  CreateBrowserPreviewWorkerRequestInput
} from '../browser-worker/protocol'
import {
  EMPTY_PREVIEW_HOST_METRICS,
  type PreviewDiagnostic,
  type PreviewFrameDescriptor,
  type PreviewHost,
  type PreviewHostBuildMetrics,
  type PreviewHostBuildRequest,
  type PreviewHostBuildResult,
  type PreviewTarget
} from './types'

interface BrowserPreviewWorkerClient {
  build(
    input: CreateBrowserPreviewWorkerRequestInput,
    channelId: string,
    signal?: AbortSignal
  ): Promise<BrowserPreviewWorkerBuildResult>
  dispose(): void
}

export interface CreateBrowserPreviewHostOptions {
  client?: BrowserPreviewWorkerClient
  createObjectURL?: (blob: Blob) => string
  revokeObjectURL?: (url: string) => void
  createChannelId?: () => string
  getFontProviders?: () => readonly BrowserPreviewFontProvider[]
}

function browserUnsupportedResult(generation: number): PreviewHostBuildResult {
  const reason =
    'Vue browser preview is not available in the reviewed Web Worker sandbox yet. Use React or the desktop Vue preview.'
  return {
    status: 'unsupported',
    generation,
    reason,
    diagnostics: [
      {
        code: 'browser-preview-vue-unsupported',
        severity: 'warning',
        message: reason
      }
    ],
    metrics: { ...EMPTY_PREVIEW_HOST_METRICS }
  }
}

function errorMessage(value: unknown): string {
  return (value instanceof Error ? value.message : 'Browser preview Worker failed').slice(0, 2_048)
}

function firstError(diagnostics: readonly PreviewDiagnostic[]): string {
  return (
    diagnostics.find((diagnostic) => diagnostic.severity === 'error')?.message ??
    'Browser preview build failed'
  )
}

function staleResult(
  generation: number,
  metrics: PreviewHostBuildMetrics = EMPTY_PREVIEW_HOST_METRICS
): PreviewHostBuildResult {
  return { status: 'stale', generation, diagnostics: [], metrics: { ...metrics } }
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === 'AbortError'
}

export function createBrowserPreviewHost(
  target: PreviewTarget,
  options: CreateBrowserPreviewHostOptions = {}
): PreviewHost {
  const client = options.client ?? createBrowserPreviewWorkerClient()
  const createObjectURL = options.createObjectURL ?? ((blob: Blob) => URL.createObjectURL(blob))
  const revokeObjectURL = options.revokeObjectURL ?? ((url: string) => URL.revokeObjectURL(url))
  const createChannelId = options.createChannelId ?? (() => crypto.randomUUID())
  const getFontProviders =
    options.getFontProviders ?? (() => fontManager.enabledOnlineFontProviders())
  const activeControllers = new Set<AbortController>()
  let activeArtifactURL: string | null = null
  let activeSerial = 0
  let latestGeneration = -1
  let disposed = false

  const hostIsDisposed = (): boolean => disposed
  const requestIsStale = (request: PreviewHostBuildRequest, serial: number): boolean =>
    hostIsDisposed() || serial !== activeSerial || request.generation !== latestGeneration

  function releaseArtifact(): void {
    if (!activeArtifactURL) return
    revokeObjectURL(activeArtifactURL)
    activeArtifactURL = null
  }

  function abortActiveBuilds(): void {
    for (const controller of activeControllers) controller.abort()
    activeControllers.clear()
  }

  async function build(request: PreviewHostBuildRequest): Promise<PreviewHostBuildResult> {
    if (hostIsDisposed()) {
      return {
        status: 'error',
        generation: request.generation,
        reason: 'Browser preview host has been disposed',
        diagnostics: [
          {
            code: 'browser-preview-host-disposed',
            severity: 'error',
            message: 'Browser preview host has been disposed'
          }
        ],
        metrics: { ...EMPTY_PREVIEW_HOST_METRICS }
      }
    }
    if (request.generation < latestGeneration) return staleResult(request.generation)
    latestGeneration = request.generation
    const serial = ++activeSerial
    abortActiveBuilds()
    releaseArtifact()

    if (target === 'vue') return browserUnsupportedResult(request.generation)
    if (request.options.target !== target) {
      const reason = `Browser preview host target ${target} does not match compiler target ${request.options.target}`
      return {
        status: 'error',
        generation: request.generation,
        reason,
        diagnostics: [
          { code: 'browser-preview-target-mismatch', severity: 'error', message: reason }
        ],
        metrics: { ...EMPTY_PREVIEW_HOST_METRICS }
      }
    }

    const controller = new AbortController()
    const abort = (): void => controller.abort()
    request.signal?.addEventListener('abort', abort, { once: true })
    activeControllers.add(controller)
    if (request.signal?.aborted) controller.abort()
    const channelId = createChannelId()
    let workerResult: BrowserPreviewWorkerBuildResult
    try {
      workerResult = await client.build(
        {
          generation: request.generation,
          graph: request.graph,
          pageIds: request.pageIds,
          options: request.options,
          fontProviders: [...getFontProviders()],
          refreshFonts: request.refreshFonts
        },
        channelId,
        controller.signal
      )
    } catch (cause) {
      if (requestIsStale(request, serial)) {
        return staleResult(request.generation)
      }
      if (isAbortError(cause) && request.signal?.aborted) throw cause
      const reason = errorMessage(cause)
      return {
        status: 'error',
        generation: request.generation,
        reason,
        diagnostics: [
          { code: 'browser-preview-worker-failed', severity: 'error', message: reason }
        ],
        metrics: { ...EMPTY_PREVIEW_HOST_METRICS }
      }
    } finally {
      request.signal?.removeEventListener('abort', abort)
      activeControllers.delete(controller)
    }

    if (requestIsStale(request, serial)) {
      return staleResult(request.generation, workerResult.metrics)
    }
    if (workerResult.status === 'unsupported') {
      return {
        status: 'unsupported',
        generation: request.generation,
        reason: workerResult.reason,
        diagnostics: workerResult.diagnostics,
        metrics: workerResult.metrics
      }
    }
    if (workerResult.status === 'error') {
      return {
        status: 'error',
        generation: request.generation,
        reason: firstError(workerResult.diagnostics),
        diagnostics: workerResult.diagnostics,
        metrics: workerResult.metrics
      }
    }

    const artifactURL = createObjectURL(new Blob([workerResult.html], { type: 'text/html' }))
    if (requestIsStale(request, serial)) {
      revokeObjectURL(artifactURL)
      return staleResult(request.generation, workerResult.metrics)
    }
    activeArtifactURL = artifactURL
    return {
      status: 'ready',
      generation: request.generation,
      diagnostics: workerResult.diagnostics,
      metrics: workerResult.metrics,
      frame: {
        src: artifactURL,
        displayURL: `browser-preview://local/${request.generation}/`,
        port: null,
        expectedMessageOrigin: 'null',
        postMessageTargetOrigin: '*',
        sandbox: 'allow-scripts',
        channelId
      }
    }
  }

  return Object.freeze({
    kind: 'browser-worker' as const,
    target,
    terminal: null,
    build,
    releaseFrame(frame: PreviewFrameDescriptor) {
      if (frame.src === activeArtifactURL) releaseArtifact()
    },
    isAlive: () => !hostIsDisposed(),
    async dispose() {
      if (hostIsDisposed()) return
      disposed = true
      activeSerial += 1
      abortActiveBuilds()
      try {
        client.dispose()
      } finally {
        releaseArtifact()
      }
    }
  })
}
