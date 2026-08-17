import {
  compile,
  resolveCompilerWebFonts,
  type CompilerFontManifest,
  type CompilerInput,
  type CompilerOutput
} from '@open-pencil/compiler'
import { fontManager } from '@open-pencil/core/text'

import { createPluginExportAbortError } from '@/app/plugins/host/exporter-abort'
import { tauriFetch } from '@/app/tauri/http'

import { startTauriPreviewSidecar, type TauriPreviewSidecar } from './tauri-sidecar'
import {
  EMPTY_PREVIEW_HOST_METRICS,
  type PreviewDiagnostic,
  type PreviewHost,
  type PreviewHostBuildMetrics,
  type PreviewHostBuildRequest,
  type PreviewHostBuildResult,
  type PreviewTarget
} from './types'

export interface CreateTauriPreviewHostOptions {
  startSidecar?: (target: PreviewTarget) => Promise<TauriPreviewSidecar>
  resolveFonts?: (request: PreviewHostBuildRequest) => Promise<CompilerFontManifest>
  compileProject?: (input: CompilerInput) => CompilerOutput
  createChannelId?: () => string
  now?: () => number
}

function outputByteLength(files: ReadonlyMap<string, string | Uint8Array>): number {
  const encoder = new TextEncoder()
  let bytes = 0
  for (const [path, content] of files) {
    bytes += encoder.encode(path).byteLength
    bytes += typeof content === 'string' ? encoder.encode(content).byteLength : content.byteLength
  }
  return bytes
}

function warningDiagnostics(
  warnings: readonly { code: string; message: string; nodeId?: string }[]
): PreviewDiagnostic[] {
  return warnings.map((warning) => ({
    code: warning.code,
    severity: 'warning',
    message: warning.message,
    ...(warning.nodeId ? { nodeId: warning.nodeId } : {})
  }))
}

function defaultResolveFonts(request: PreviewHostBuildRequest): Promise<CompilerFontManifest> {
  return resolveCompilerWebFonts({
    graph: request.graph,
    pageIds: request.pageIds,
    providers: fontManager.enabledOnlineFontProviders(),
    fetcher: tauriFetch,
    preferLoaded: true,
    refresh: request.refreshFonts
  })
}

function errorResult(
  generation: number,
  reason: string,
  metrics: PreviewHostBuildMetrics
): PreviewHostBuildResult {
  return {
    status: 'error',
    generation,
    reason,
    diagnostics: [{ code: 'tauri-preview-build-failed', severity: 'error', message: reason }],
    metrics
  }
}

function staleResult(
  generation: number,
  metrics: PreviewHostBuildMetrics = EMPTY_PREVIEW_HOST_METRICS
): PreviewHostBuildResult {
  return { status: 'stale', generation, diagnostics: [], metrics: { ...metrics } }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createPluginExportAbortError()
}

export async function createTauriPreviewHost(
  target: PreviewTarget,
  options: CreateTauriPreviewHostOptions = {}
): Promise<PreviewHost> {
  const startSidecar = options.startSidecar ?? startTauriPreviewSidecar
  const resolveFonts = options.resolveFonts ?? defaultResolveFonts
  const compileProject = options.compileProject ?? compile
  const createChannelId = options.createChannelId ?? (() => crypto.randomUUID())
  const now = options.now ?? (() => performance.now())
  const sidecar = await startSidecar(target)
  const channelId = createChannelId()
  const origin = new URL(sidecar.url).origin
  let latestGeneration = -1
  let activeSerial = 0
  let disposed = false

  const hostIsDisposed = (): boolean => disposed
  const requestIsStale = (request: PreviewHostBuildRequest, serial: number): boolean =>
    hostIsDisposed() || serial !== activeSerial || request.generation !== latestGeneration
  const requestIsCancelled = (request: PreviewHostBuildRequest, serial: number): boolean =>
    request.signal?.aborted === true || requestIsStale(request, serial)
  const checkpoint = (
    request: PreviewHostBuildRequest,
    serial: number,
    metrics: PreviewHostBuildMetrics
  ): PreviewHostBuildResult | null => {
    if (!requestIsCancelled(request, serial)) return null
    throwIfAborted(request.signal)
    return staleResult(request.generation, metrics)
  }

  async function build(request: PreviewHostBuildRequest): Promise<PreviewHostBuildResult> {
    if (hostIsDisposed() || !sidecar.isAlive()) {
      return errorResult(request.generation, 'Preview sidecar is not running', {
        ...EMPTY_PREVIEW_HOST_METRICS
      })
    }
    if (request.generation < latestGeneration) {
      return staleResult(request.generation)
    }
    latestGeneration = request.generation
    const serial = ++activeSerial
    if (request.options.target !== target) {
      return errorResult(
        request.generation,
        `Preview sidecar target ${target} does not match compiler target ${request.options.target}`,
        { ...EMPTY_PREVIEW_HOST_METRICS }
      )
    }
    throwIfAborted(request.signal)
    const startedAt = now()
    let compileMs = 0
    try {
      const fontManifest = await resolveFonts(request)
      const afterFonts = checkpoint(request, serial, {
        ...EMPTY_PREVIEW_HOST_METRICS,
        totalMs: Math.max(0, now() - startedAt)
      })
      if (afterFonts) return afterFonts
      const compileStartedAt = now()
      const output = compileProject({
        graph: request.graph,
        pageIds: request.pageIds,
        options: request.options,
        fontManifest
      })
      compileMs = Math.max(0, now() - compileStartedAt)
      const afterCompile = checkpoint(request, serial, {
        ...EMPTY_PREVIEW_HOST_METRICS,
        compileMs,
        totalMs: Math.max(0, now() - startedAt)
      })
      if (afterCompile) return afterCompile
      await sidecar.update(output.files)
      const metrics: PreviewHostBuildMetrics = {
        compileMs,
        bundleMs: 0,
        totalMs: Math.max(0, now() - startedAt),
        inputBytes: 0,
        outputBytes: outputByteLength(output.files),
        fileCount: output.files.size,
        dependencyCount: 0
      }
      const afterUpdate = checkpoint(request, serial, metrics)
      if (afterUpdate) return afterUpdate
      if (!sidecar.isAlive()) throw new Error('Preview sidecar stopped before update completed')
      return {
        status: 'ready',
        generation: request.generation,
        diagnostics: warningDiagnostics(output.warnings),
        metrics,
        frame: {
          src: sidecar.url,
          displayURL: sidecar.url,
          port: sidecar.port,
          expectedMessageOrigin: origin,
          postMessageTargetOrigin: origin,
          sandbox: null,
          channelId
        }
      }
    } catch (cause) {
      throwIfAborted(request.signal)
      const stale = checkpoint(request, serial, {
        ...EMPTY_PREVIEW_HOST_METRICS,
        compileMs,
        totalMs: Math.max(0, now() - startedAt)
      })
      if (stale) return stale
      const reason = cause instanceof Error ? cause.message : 'Tauri preview build failed'
      return errorResult(request.generation, reason, {
        ...EMPTY_PREVIEW_HOST_METRICS,
        compileMs,
        totalMs: Math.max(0, now() - startedAt)
      })
    }
  }

  return Object.freeze({
    kind: 'tauri-sidecar' as const,
    target,
    terminal: sidecar.terminal,
    build,
    releaseFrame: () => undefined,
    isAlive: () => !hostIsDisposed() && sidecar.isAlive(),
    async dispose() {
      if (hostIsDisposed()) return
      disposed = true
      activeSerial += 1
      await sidecar.dispose()
    }
  })
}
