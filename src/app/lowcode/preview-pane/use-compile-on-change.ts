// Wires SceneGraph changes into the environment-specific preview host:
//
//   SceneGraph --(Auto | Real-time | Manual)--> PreviewHost
//        Tauri: compiler + Bun/Vite sidecar ACK/HMR
//        Browser: bounded snapshot + disposable Worker + WASM bundle + Blob iframe
//
// Page switches remain bridge-only navigation. The scheduler still coalesces
// scene revisions, while generation and AbortSignal gates prevent a late build
// from publishing an obsolete iframe artifact.

import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

import { withDefaults, type CompilerOptions, type CompileWarning } from '@open-pencil/compiler'

import { useEditorStore } from '@/app/editor/active-store'
import { importedFontRevision } from '@/app/editor/fonts'
import { appPluginStoreSnapshot } from '@/app/plugins/app'

import { watchPreviewBackendProvider, watchPreviewLoginRoute } from './backend-provider-watch'
import {
  createPreviewCompileScheduler,
  createPreviewCompileSchedulerState,
  DEFAULT_PREVIEW_REFRESH_POLICY,
  type PreviewCompileOutcome,
  type PreviewCompileRun,
  type PreviewCompileSchedulerState,
  type PreviewRefreshPolicy
} from './compile-scheduler'
import { createPreviewHost } from './host/create'
import type {
  PreviewDiagnostic,
  PreviewFrameDescriptor,
  PreviewHost,
  PreviewHostBuildResult,
  PreviewHostBuildMetrics,
  PreviewTarget as HostPreviewTarget
} from './host/types'
import {
  createLocalBackendPreviewConnection,
  LOCAL_BACKEND_CHANGED_MESSAGE,
  prepareLocalBackendPreview
} from './local-backend-connection'
import { captureManagedBackendSnapshot } from './managed-backend/capture'
import { createManagedBackendPreviewController } from './managed-backend/controller'
import { createManagedBackendPreviewHost } from './managed-backend/host'

export { parsePreviewSidecarReady, type PreviewSidecarReady } from './sidecar-ready'

const NOOP = (): void => undefined

export type PreviewUIKit = 'none' | 'shadcn'
export type PreviewTarget = HostPreviewTarget
export const BROWSER_PREVIEW_RUNTIME_READY_TIMEOUT_MS = 15_000

export interface PreviewCompileSettings {
  target?: Ref<PreviewTarget>
  uiKit: Ref<PreviewUIKit>
  i18nEnabled: Ref<boolean>
  localesInput: Ref<string>
  refreshPolicy?: Ref<PreviewRefreshPolicy>
}

export function parsePreviewLocales(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter((value) => value !== '')
}

export function previewCompilerOverrides(
  settings?: PreviewCompileSettings,
  pageCount = 1
): Partial<CompilerOptions> {
  if (!settings) return {}
  const target = settings.target?.value ?? 'react'
  const locales = parsePreviewLocales(settings.localesInput.value)
  return {
    target,
    router: pageCount > 1 ? (target === 'vue' ? 'vue-router-v4' : 'react-router-v6') : 'none',
    ...(target === 'react' && settings.uiKit.value === 'shadcn'
      ? { uiKit: 'shadcn' as const }
      : {}),
    ...(target === 'react' && settings.i18nEnabled.value
      ? { i18n: true, ...(locales.length > 0 ? { locales } : {}) }
      : { i18n: false })
  }
}

export type PreviewStatus =
  | { kind: 'idle' }
  | {
      kind: 'starting'
      host: PreviewHost['kind'] | null
      generation?: number
      frame?: PreviewFrameDescriptor
    }
  | {
      kind: 'ready'
      generation: number
      url: string
      port: number | null
      frame: PreviewFrameDescriptor
    }
  | { kind: 'error'; message: string }
  | { kind: 'unsupported'; reason: string }

interface UseCompileOnChangeResult {
  localBackend: ReturnType<typeof createLocalBackendPreviewConnection>
  managedBackend: ReturnType<typeof createManagedBackendPreviewController>
  backendMode: Ref<'external' | 'managed'>
  selectBackendMode(mode: 'external' | 'managed'): Promise<void>
  status: Ref<PreviewStatus>
  hostKind: Ref<PreviewHost['kind'] | null>
  compileState: Ref<PreviewCompileSchedulerState>
  compileMetrics: Ref<PreviewHostBuildMetrics | null>
  compileDiagnostics: Ref<PreviewDiagnostic[]>
  compileWarnings: Ref<CompileWarning[]>
  compileError: Ref<string | null>
  motionWarnings: Ref<CompileWarning[]>
  motionCompileError: Ref<string | null>
  forceRecompile: () => void
  markRuntimeReady: (channelId: string) => boolean
  reportRuntimeError: (channelId: string, message: string) => boolean
}

export function onlyMotionWarnings(warnings: readonly CompileWarning[]): CompileWarning[] {
  return warnings.filter((warning) => warning.code.startsWith('motion-'))
}

function diagnosticWarnings(diagnostics: readonly PreviewDiagnostic[]): CompileWarning[] {
  return diagnostics
    .filter((diagnostic) => diagnostic.severity === 'warning')
    .map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
      ...(diagnostic.nodeId ? { nodeId: diagnostic.nodeId } : {})
    }))
}

function normalizedDiagnostics(
  diagnostics: readonly PreviewDiagnostic[],
  fallbackError?: string
): PreviewDiagnostic[] {
  const output = diagnostics.map((diagnostic) => ({ ...diagnostic }))
  if (fallbackError && !output.some((diagnostic) => diagnostic.severity === 'error')) {
    output.unshift({
      code: 'preview-build-failed',
      severity: 'error',
      message: fallbackError
    })
  }
  return output
}

/**
 * Mount: create the current PreviewHost and request the initial build.
 * Change: preserve the scheduler policy and coalesce obsolete active builds.
 * Unmount/target change: terminate Workers/sidecars and revoke host artifacts.
 */
export function useCompileOnChange(settings?: PreviewCompileSettings): UseCompileOnChangeResult {
  const status = ref<PreviewStatus>({ kind: 'idle' })
  const hostKind = ref<PreviewHost['kind'] | null>(null)
  const compileState = ref(
    createPreviewCompileSchedulerState(
      settings?.refreshPolicy?.value ?? DEFAULT_PREVIEW_REFRESH_POLICY
    )
  )
  const compileMetrics = ref<PreviewHostBuildMetrics | null>(null)
  const compileDiagnostics = ref<PreviewDiagnostic[]>([])
  const compileWarnings = ref<CompileWarning[]>([])
  const compileError = ref<string | null>(null)
  const motionWarnings = ref<CompileWarning[]>([])
  const motionCompileError = ref<string | null>(null)
  const store = useEditorStore()

  let host: PreviewHost | null = null
  let activeBuildController: AbortController | null = null
  let cancelled = false
  let hostGeneration = 0
  let buildGeneration = 0
  let runtimeReadyTimer: ReturnType<typeof setTimeout> | null = null
  let hostTransition = Promise.resolve()
  const localBackend = createLocalBackendPreviewConnection({
    prepare: (apiPort) =>
      prepareLocalBackendPreview(store.graph, settings?.target?.value ?? 'react', apiPort),
    start: () => {
      scheduler.setPolicy('auto')
      return launchPreviewHost(settings?.target?.value ?? 'react')
    },
    stop: stopPreviewHost
  })
  const backendMode = ref<'external' | 'managed'>('external')
  const managedBackend = createManagedBackendPreviewController({
    createHost: createManagedBackendPreviewHost,
    capture: (isCurrent) => {
      const graph = store.graph
      const target = settings?.target?.value ?? 'react'
      return captureManagedBackendSnapshot(
        graph,
        target,
        () =>
          isCurrent() && graph === store.graph && target === (settings?.target?.value ?? 'react')
      )
    },
    stopFrontend: () => localBackend.disconnect(),
    connectFrontend: (prepared) => localBackend.adoptPrepared(prepared)
  })
  let managedGraph = store.graph
  async function selectBackendMode(mode: 'external' | 'managed') {
    if (backendMode.value === mode) return
    backendMode.value = mode
    await localBackend.disconnect()
    if (mode === 'external') await managedBackend.deactivate()
  }

  function publishDiagnostics(
    diagnostics: readonly PreviewDiagnostic[],
    fallbackError?: string
  ): void {
    const normalized = normalizedDiagnostics(diagnostics, fallbackError)
    const warnings = diagnosticWarnings(normalized)
    compileDiagnostics.value = normalized
    compileWarnings.value = warnings
    compileError.value = fallbackError ?? null
    motionWarnings.value = onlyMotionWarnings(warnings)
    motionCompileError.value = fallbackError ?? null
    for (const warning of warnings) {
      console.warn(`[preview] ${warning.code}: ${warning.message}`)
    }
  }

  function clearBuildOutput(): void {
    compileMetrics.value = null
    compileDiagnostics.value = []
    compileWarnings.value = []
    compileError.value = null
    motionWarnings.value = []
    motionCompileError.value = null
  }

  function clearRuntimeReadyTimer(): void {
    if (runtimeReadyTimer === null) return
    clearTimeout(runtimeReadyTimer)
    runtimeReadyTimer = null
  }

  function currentBrowserFrame(channelId: string): PreviewFrameDescriptor | null {
    if (host?.kind !== 'browser-worker') return null
    const current = status.value
    if (current.kind !== 'starting' && current.kind !== 'ready') return null
    const frame = current.frame
    return frame?.channelId === channelId ? frame : null
  }

  function failBrowserRuntime(channelId: string, code: string, message: string): boolean {
    const frame = currentBrowserFrame(channelId)
    if (!frame) return false
    clearRuntimeReadyTimer()
    host?.releaseFrame(frame)
    publishDiagnostics(
      [
        ...compileDiagnostics.value.filter((diagnostic) => diagnostic.code !== code),
        { code, severity: 'error', message }
      ],
      message
    )
    status.value = { kind: 'error', message }
    return true
  }

  function waitForBrowserRuntime(generation: number, frame: PreviewFrameDescriptor): void {
    clearRuntimeReadyTimer()
    status.value = { kind: 'starting', host: 'browser-worker', generation, frame }
    runtimeReadyTimer = setTimeout(() => {
      failBrowserRuntime(
        frame.channelId,
        'browser-preview-runtime-timeout',
        `Browser preview did not become ready within ${BROWSER_PREVIEW_RUNTIME_READY_TIMEOUT_MS}ms`
      )
    }, BROWSER_PREVIEW_RUNTIME_READY_TIMEOUT_MS)
  }

  function markRuntimeReady(channelId: string): boolean {
    const current = status.value
    if (
      current.kind !== 'starting' ||
      current.host !== 'browser-worker' ||
      current.frame?.channelId !== channelId ||
      current.generation === undefined
    ) {
      return false
    }
    clearRuntimeReadyTimer()
    status.value = {
      kind: 'ready',
      generation: current.generation,
      url: current.frame.src,
      port: current.frame.port,
      frame: current.frame
    }
    return true
  }

  function reportRuntimeError(channelId: string, message: string): boolean {
    return failBrowserRuntime(channelId, 'browser-preview-runtime-error', message)
  }

  function buildResultIsStale(
    request: PreviewCompileRun,
    activeHost: PreviewHost,
    generation: number,
    result: PreviewHostBuildResult
  ): boolean {
    return (
      !request.isCurrent() ||
      cancelled ||
      host !== activeHost ||
      result.generation !== generation ||
      result.status === 'stale'
    )
  }

  function publishHostResult(
    activeHost: PreviewHost,
    generation: number,
    result: Exclude<PreviewHostBuildResult, { status: 'stale' }>
  ): PreviewCompileOutcome {
    compileMetrics.value = { ...result.metrics }
    if (result.status === 'ready') {
      publishDiagnostics(result.diagnostics)
      if (activeHost.kind === 'browser-worker') {
        waitForBrowserRuntime(generation, result.frame)
      } else {
        status.value = {
          kind: 'ready',
          generation,
          url: result.frame.src,
          port: result.frame.port,
          frame: result.frame
        }
        localBackend.markReady()
      }
      return 'pushed'
    }
    if (result.status === 'unsupported') {
      publishDiagnostics(result.diagnostics)
      status.value = { kind: 'unsupported', reason: result.reason }
      if (localBackend.connection.value) void localBackend.fail(result.reason)
      return 'failed'
    }
    publishDiagnostics(result.diagnostics, result.reason)
    status.value = { kind: 'error', message: result.reason }
    if (localBackend.connection.value) void localBackend.fail(result.reason)
    return 'failed'
  }

  function buildWasCancelled(
    request: PreviewCompileRun,
    activeHost: PreviewHost,
    controller: AbortController
  ): boolean {
    return !request.isCurrent() || cancelled || host !== activeHost || controller.signal.aborted
  }

  async function compileAndPublish(request: PreviewCompileRun): Promise<PreviewCompileOutcome> {
    const activeHost = host
    if (!activeHost || !activeHost.isAlive()) return 'superseded' as const
    const generation = ++buildGeneration
    const controller = new AbortController()
    activeBuildController = controller
    if (activeHost.kind === 'browser-worker') clearRuntimeReadyTimer()

    // Browser artifacts are revoked at build start, so the old iframe must not
    // remain visible. Tauri keeps its acknowledged iframe mounted for HMR.
    if (activeHost.kind === 'browser-worker' || status.value.kind !== 'ready') {
      status.value = { kind: 'starting', host: activeHost.kind }
    }

    try {
      const pages = store.graph.getPages()
      const pageIds = pages.length > 1 ? pages.map((page) => page.id) : [store.state.currentPageId]
      const result = await activeHost.build({
        generation,
        graph: store.graph,
        pageIds,
        options: withDefaults({
          packageName: 'openpencil-preview',
          ...previewCompilerOverrides(settings, pageIds.length),
          ...(localBackend.connection.value
            ? {
                backendPreview: {
                  kind: 'nestjs-local' as const,
                  applicationDigest: localBackend.connection.value.applicationDigest
                }
              }
            : {})
        }),
        refreshFonts: request.refreshFonts,
        signal: controller.signal
      })

      if (buildResultIsStale(request, activeHost, generation, result)) {
        if (result.status === 'ready') activeHost.releaseFrame(result.frame)
        return 'superseded'
      }
      if (result.status === 'stale') return 'superseded'
      return publishHostResult(activeHost, generation, result)
    } catch (cause) {
      if (buildWasCancelled(request, activeHost, controller)) return 'superseded'
      const message = cause instanceof Error ? cause.message : String(cause)
      publishDiagnostics([], message)
      status.value = { kind: 'error', message }
      if (localBackend.connection.value) void localBackend.fail(message)
      console.warn('[preview] compile failed:', cause)
      return 'failed'
    } finally {
      if (activeBuildController === controller) activeBuildController = null
    }
  }

  const scheduler = createPreviewCompileScheduler({
    policy: compileState.value.policy,
    run: compileAndPublish,
    onStateChange: (next) => {
      compileState.value = next
    }
  })

  function cancelActiveBuild(): void {
    activeBuildController?.abort()
  }

  function enqueueChange(refreshFonts: boolean): void {
    // The scheduler serializes builds and marks an obsolete result stale. Do
    // not terminate esbuild-wasm mid-initialization for ordinary edits: the
    // next coalesced snapshot runs immediately after the stale one settles.
    // Target changes and unmount still cancel through cancelActiveBuild().
    scheduler.requestChange(refreshFonts)
  }

  function flushBuild(refreshFonts: boolean): void {
    scheduler.flush(refreshFonts)
  }

  function stopPreviewHost(): Promise<void> {
    hostGeneration += 1
    clearRuntimeReadyTimer()
    cancelActiveBuild()
    const previous = host
    host = null
    hostKind.value = null
    status.value = { kind: 'idle' }
    // Begin revocation immediately, then join any in-flight launch. A replacement
    // must not bind the fixed preview port until the old owned sidecar has stopped.
    const disposal = previous ? previous.dispose() : Promise.resolve()
    hostTransition = Promise.all([hostTransition, disposal]).then(() => undefined)
    return hostTransition
  }

  function launchPreviewHost(target: PreviewTarget): Promise<void> {
    const stopped = stopPreviewHost()
    const generation = hostGeneration
    const connection = localBackend.connection.value
    hostTransition = stopped.then(() => startPreviewHost(target, generation, connection))
    return hostTransition
  }

  async function startPreviewHost(
    target: PreviewTarget,
    generation: number,
    connection: typeof localBackend.connection.value
  ): Promise<void> {
    const launchIsStale = (): boolean => cancelled || generation !== hostGeneration
    if (launchIsStale()) return
    status.value = { kind: 'starting', host: null }
    hostKind.value = null
    clearBuildOutput()
    clearRuntimeReadyTimer()
    cancelActiveBuild()

    try {
      const created = await createPreviewHost(target, { localBackend: connection ?? undefined })
      if (launchIsStale()) {
        await created.dispose()
        return
      }
      host = created
      hostKind.value = created.kind
      status.value = { kind: 'starting', host: created.kind }
      if (created.terminal) {
        void created.terminal.then((terminal) => {
          if (launchIsStale() || host !== created) return undefined
          host = null
          hostKind.value = null
          cancelActiveBuild()
          publishDiagnostics([], terminal.message)
          status.value = { kind: 'error', message: terminal.message }
          if (localBackend.connection.value) void localBackend.fail(terminal.message)
          return undefined
        })
      }
      scheduler.requestInitial()
    } catch (cause) {
      if (launchIsStale()) return
      const message = cause instanceof Error ? cause.message : String(cause)
      publishDiagnostics([], message)
      status.value = { kind: 'error', message }
      if (localBackend.connection.value) void localBackend.fail(message)
    }
  }

  void launchPreviewHost(settings?.target?.value ?? 'react')

  const stopSceneWatch = watch(
    () => [store.state.sceneVersion, importedFontRevision.value] as const,
    (current, previous) => {
      if (!host) return
      enqueueChange(current[1] !== previous[1])
    }
  )
  const stopPolicyWatch = settings?.refreshPolicy
    ? watch(settings.refreshPolicy, (policy) =>
        scheduler.setPolicy(localBackend.connection.value ? 'auto' : policy)
      )
    : NOOP
  const stopBackendProviderWatch = watchPreviewBackendProvider({
    graph: () => store.graph,
    sceneVersion: () => store.state.sceneVersion,
    providerSnapshot: () => appPluginStoreSnapshot.value,
    invalidate: () => {
      if (cancelled) return
      if (backendMode.value === 'managed') {
        if (managedGraph !== store.graph) {
          managedGraph = store.graph
          void managedBackend.invalidate('Document changed. Prepare this managed backend again.')
        } else managedBackend.documentChanged()
      } else if (localBackend.active.value)
        void localBackend.disconnect(LOCAL_BACKEND_CHANGED_MESSAGE)
      else void launchPreviewHost(settings?.target?.value ?? 'react')
    }
  })
  const stopTargetWatch = settings?.target
    ? watch(settings.target, (target) => {
        if (backendMode.value === 'managed') {
          void managedBackend.invalidate(
            'Preview framework changed. Prepare the managed backend again.'
          )
        } else if (localBackend.active.value) {
          void localBackend.disconnect('Preview framework changed. Reconnect the local Backend.')
        } else void launchPreviewHost(target)
      })
    : NOOP
  const stopLoginRouteWatch = watchPreviewLoginRoute({
    graph: () => store.graph,
    sceneVersion: () => store.state.sceneVersion,
    invalidate: () => {
      if (cancelled) return
      if (backendMode.value === 'managed') managedBackend.documentChanged()
      else if (localBackend.active.value)
        void localBackend.disconnect('Login route changed. Reconnect the local Backend preview.')
    }
  })

  onBeforeUnmount(() => {
    cancelled = true
    void localBackend.disconnect()
    void managedBackend.dispose()
    stopSceneWatch()
    stopPolicyWatch()
    stopBackendProviderWatch()
    stopTargetWatch()
    stopLoginRouteWatch()
    scheduler.dispose()
    clearRuntimeReadyTimer()
    cancelActiveBuild()
  })

  return {
    localBackend,
    managedBackend,
    backendMode,
    selectBackendMode,
    status,
    hostKind,
    compileState,
    compileMetrics,
    compileDiagnostics,
    compileWarnings,
    compileError,
    motionWarnings,
    motionCompileError,
    markRuntimeReady,
    reportRuntimeError,
    forceRecompile: () => {
      if (host?.isAlive()) flushBuild(true)
    }
  }
}
