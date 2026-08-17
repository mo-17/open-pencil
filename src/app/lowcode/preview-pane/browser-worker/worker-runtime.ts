/// <reference lib="webworker" />
/* oxlint-disable unicorn/require-post-message-target-origin -- DedicatedWorkerGlobalScope has no target origin. */

import esbuildWasmURL from 'esbuild-wasm/esbuild.wasm?url'

import {
  compile,
  resolveCompilerWebFonts,
  type CompilerFontManifest,
  type CompilerOutput
} from '@open-pencil/compiler'
import { buildBrowserPreview } from '@open-pencil/compiler/browser-preview'
import { fontManager } from '@open-pencil/core/text'

import { createBrowserDownloadedFontCache } from '@/app/editor/fonts/browser-downloaded-font-cache'
import { createBrowserWebFontFetch } from '@/app/editor/fonts/browser-web-font-fetch'
import { restoreVueCompilerGraph } from '@/app/plugins/host/vue/compiler/protocol'

import type { PreviewDiagnostic, PreviewHostBuildMetrics } from '../host/types'
import { BROWSER_PREVIEW_WORKER_LIMITS } from './limits'
import {
  BROWSER_PREVIEW_FONT_PROVIDER_IDS,
  BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
  createCorrelatedBrowserPreviewWorkerResponse,
  validateBrowserPreviewWorkerBuildResult,
  validateBrowserPreviewWorkerRequest,
  type BrowserPreviewWorkerBuildResult,
  type BrowserPreviewWorkerRequest,
  type BrowserPreviewWorkerResponse,
  type BrowserPreviewWorkerStage
} from './protocol'

const MAX_FONT_FETCH_REQUESTS = 64
const MAX_FONT_FETCH_BYTES = 32 * 1024 * 1024
const FONT_FETCH_TIMEOUT_MS = 10_000
const FONT_RESOLUTION_TIMEOUT_MS = 20_000
const FONT_RESOLUTION_CONCURRENCY = 4

function now(): number {
  return performance.now()
}

function diagnosticMessage(value: unknown, fallback: string): string {
  const message = value instanceof Error && value.message ? value.message : fallback
  return message.slice(0, BROWSER_PREVIEW_WORKER_LIMITS.maxDiagnosticTextLength)
}

function emptyMetrics(startedAt: number, compileMs = 0): PreviewHostBuildMetrics {
  return {
    compileMs,
    bundleMs: 0,
    totalMs: Math.max(0, now() - startedAt),
    inputBytes: 0,
    outputBytes: 0,
    fileCount: 0,
    dependencyCount: 0
  }
}

function compilerDiagnostics(
  warnings: readonly { code: string; message: string; nodeId?: string }[]
): PreviewDiagnostic[] {
  return warnings.slice(0, BROWSER_PREVIEW_WORKER_LIMITS.maxDiagnostics).map((warning) => ({
    code: warning.code.slice(0, 128),
    severity: 'warning',
    message: warning.message.slice(0, BROWSER_PREVIEW_WORKER_LIMITS.maxDiagnosticTextLength),
    ...(warning.nodeId ? { nodeId: warning.nodeId.slice(0, 256) } : {})
  }))
}

function combineDiagnostics(
  compiler: readonly PreviewDiagnostic[],
  bundler: readonly PreviewDiagnostic[]
): PreviewDiagnostic[] {
  return [...compiler, ...bundler].slice(0, BROWSER_PREVIEW_WORKER_LIMITS.maxDiagnostics)
}

function postProgress(
  request: BrowserPreviewWorkerRequest,
  stage: BrowserPreviewWorkerStage,
  startedAt: number
): void {
  const response: BrowserPreviewWorkerResponse = {
    version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
    type: 'progress',
    requestId: request.requestId,
    generation: request.generation,
    stage,
    elapsedMs: Math.max(0, now() - startedAt)
  }
  globalThis.postMessage(response)
}

export async function executeBrowserPreviewWorkerRequest(value: unknown): Promise<void> {
  const startedAt = now()
  let compileMs = 0
  let warnings: PreviewDiagnostic[] = []
  try {
    validateBrowserPreviewWorkerRequest(value)
    const request = value
    postProgress(request, 'restore', startedAt)
    const graph = restoreVueCompilerGraph(request.graph)
    postProgress(request, 'fonts', startedAt)
    const fontAbortController = new AbortController()
    const fontCache = createBrowserDownloadedFontCache()
    const fontFetch = createBrowserWebFontFetch({
      signal: fontAbortController.signal,
      timeoutMs: FONT_FETCH_TIMEOUT_MS,
      maxRequests: MAX_FONT_FETCH_REQUESTS,
      maxTotalBytes: MAX_FONT_FETCH_BYTES
    })
    fontManager.setDownloadedFontCache(fontCache)
    fontManager.setOnlineFontProviders(
      Object.fromEntries(
        BROWSER_PREVIEW_FONT_PROVIDER_IDS.map((provider) => [
          provider,
          request.fontProviders.includes(provider)
        ])
      )
    )
    fontManager.setWebFontFetch(fontFetch)
    let output: CompilerOutput
    try {
      let fontManifest: CompilerFontManifest = { faces: [] }
      const fontResolutionState = { timedOut: false }
      const fontResolutionTimer = setTimeout(() => {
        fontResolutionState.timedOut = true
        fontAbortController.abort(new Error('Browser preview font resolution timed out'))
      }, FONT_RESOLUTION_TIMEOUT_MS)
      try {
        fontManifest = await resolveCompilerWebFonts({
          graph,
          pageIds: request.pageIds,
          providers: request.fontProviders,
          fetcher: fontFetch,
          preferLoaded: true,
          refresh: request.refreshFonts,
          concurrency: FONT_RESOLUTION_CONCURRENCY
        })
      } catch (cause) {
        if (!fontResolutionState.timedOut) throw cause
      } finally {
        clearTimeout(fontResolutionTimer)
      }
      if (fontResolutionState.timedOut) {
        warnings.push({
          code: 'browser-preview-font-resolution-timeout',
          severity: 'warning',
          message:
            'Browser preview stopped waiting for CDN fonts after 20 seconds and used available fallback fonts.'
        })
      }
      postProgress(request, 'compile', startedAt)
      const compileStartedAt = now()
      output = compile({
        graph,
        pageIds: request.pageIds,
        options: request.options,
        fontManifest
      })
      compileMs = Math.max(0, now() - compileStartedAt)
    } finally {
      fontAbortController.abort()
      fontManager.setWebFontFetch(null)
      fontManager.setDownloadedFontCache(null)
      fontCache.close()
    }
    warnings = combineDiagnostics(warnings, compilerDiagnostics(output.warnings))
    const target = request.options.target
    if (target !== 'react' && target !== 'vue') {
      throw new TypeError('Browser preview Worker target is invalid')
    }
    const bundled = await buildBrowserPreview({
      files: output.files,
      target,
      wasmURL: new URL(esbuildWasmURL, globalThis.location.href).href,
      channel: request.channelId,
      onStage: (stage) => postProgress(request, stage, startedAt)
    })
    const metrics: PreviewHostBuildMetrics = {
      compileMs,
      bundleMs: bundled.metrics.durationMs,
      totalMs: Math.max(0, now() - startedAt),
      inputBytes: bundled.metrics.inputBytes,
      outputBytes: bundled.metrics.outputBytes,
      fileCount: bundled.metrics.fileCount,
      dependencyCount: bundled.metrics.dependencyCount
    }
    const diagnostics = combineDiagnostics(warnings, bundled.diagnostics)
    let result: BrowserPreviewWorkerBuildResult
    if (bundled.status === 'ready') {
      result = { status: 'ready', html: bundled.html, diagnostics, metrics }
    } else if (bundled.status === 'unsupported') {
      result = { status: 'unsupported', reason: bundled.reason.message, diagnostics, metrics }
    } else {
      result = { status: 'error', diagnostics, metrics }
    }
    const response: BrowserPreviewWorkerResponse = {
      version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId: request.requestId,
      generation: request.generation,
      result: validateBrowserPreviewWorkerBuildResult(result)
    }
    globalThis.postMessage(response)
  } catch (cause) {
    const diagnostics: PreviewDiagnostic[] = [
      ...warnings,
      {
        code: 'browser-preview-build-failed',
        severity: 'error' as const,
        message: diagnosticMessage(cause, 'Browser preview build failed')
      }
    ].slice(0, BROWSER_PREVIEW_WORKER_LIMITS.maxDiagnostics)
    const response = createCorrelatedBrowserPreviewWorkerResponse(value, {
      status: 'error',
      diagnostics,
      metrics: emptyMetrics(startedAt, compileMs)
    })
    if (response) globalThis.postMessage(response)
  }
}
