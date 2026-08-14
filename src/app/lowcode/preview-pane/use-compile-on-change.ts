// Wires the editor scene-graph into the lowcode preview pipeline:
//
//   sceneVersion --(refresh policy)--> compile(all pages | currentPage)
//                                          |
//                                          v
//                                  Map<path, content>
//                                          |
//                                          v
//                              dev-server sidecar (stdio)
//                                          |
//                                          v
//                                  iframe HMR refresh
//
// Phase 2 §7: multi-page docs (pages.length > 1) compile all pages so the
// iframe runs the same react-router-dom router shell as CLI export, and
// editor↔iframe navigation rides the preview-bridge `navigate` channel
// (owned by PreviewPane.vue, not this composable). Single-page docs keep
// the legacy [currentPageId] fast path for byte-identical regression with
// Phase 1 §11.5 #5 (§7 decision #a). Switching `currentPageId` no longer
// triggers a recompile — only `sceneVersion` does (§7 decision #4).
//
// Tauri-only. The sidecar runs `bun packages/compiler/src/dev-server.ts`
// via @tauri-apps/plugin-shell; that path is never imported statically so
// the browser bundle stays clean.

import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

import {
  compile,
  createPreviewFileEncodeCache,
  resolveCompilerWebFonts,
  resetPreviewFileEncodeCache,
  serializePreviewFiles,
  withDefaults,
  type CompilerOptions,
  type CompileWarning
} from '@open-pencil/compiler'
import { fontManager } from '@open-pencil/core/text'

import { useEditorStore } from '@/app/editor/active-store'
import { importedFontRevision } from '@/app/editor/fonts'
import { decodeTauriStderr } from '@/app/shell/ui'
import { isTauri } from '@/app/tauri/env'
import { tauriFetch } from '@/app/tauri/http'

import {
  createPreviewCompileScheduler,
  createPreviewCompileSchedulerState,
  DEFAULT_PREVIEW_REFRESH_POLICY,
  type PreviewCompileRun,
  type PreviewCompileSchedulerState,
  type PreviewRefreshPolicy
} from './compile-scheduler'
import { parsePreviewSidecarReady, type PreviewSidecarReady } from './sidecar-ready'
import { createPreviewStartupEventBuffer, waitForPreviewUpdateAck } from './update-ack'

export { parsePreviewSidecarReady, type PreviewSidecarReady } from './sidecar-ready'

interface SidecarReadyEvent {
  type: 'ready'
  url: string
  port: number
}
interface SidecarErrorEvent {
  type: 'error'
  message: string
}
interface SidecarUpdatedEvent {
  type: 'updated'
}
interface SidecarClosingEvent {
  type: 'closing'
}
type SidecarEvent =
  | SidecarReadyEvent
  | SidecarErrorEvent
  | SidecarUpdatedEvent
  | SidecarClosingEvent

const SIDECAR_NAME = 'lowcode-preview'
const SIDECAR_ENTRY = 'packages/compiler/src/dev-server.ts'
const READY_TIMEOUT_MS = 15_000
const NOOP = (): void => undefined

export type PreviewUIKit = 'none' | 'shadcn'
export type PreviewTarget = 'react' | 'vue'

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
    .map((s) => s.trim())
    .filter((s) => s !== '')
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

interface PreviewSidecar {
  url: string
  port: number
  readonly terminal: Promise<{ code: number | null; message: string }>
  isAlive(): boolean
  update(files: Map<string, string | Uint8Array>): Promise<void>
  dispose(): Promise<void>
}

export function previewSidecarCommandArgs(projectRoot: string, target: PreviewTarget): string[] {
  return [SIDECAR_ENTRY, '--root', projectRoot, '--target', target]
}

function parsePreviewSidecarEvent(line: string): SidecarEvent {
  const value: unknown = JSON.parse(line)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Preview sidecar event must be an object')
  }
  const type = (value as { type?: unknown }).type
  if (type === 'ready') return { type, ...parsePreviewSidecarReady(value) }
  if (type === 'updated' || type === 'closing') return { type }
  if (type === 'error' && typeof (value as { message?: unknown }).message === 'string') {
    return { type, message: (value as { message: string }).message }
  }
  throw new Error('Unsupported preview sidecar event')
}

async function startPreviewSidecar(target: PreviewTarget): Promise<PreviewSidecar> {
  const { Command } = await import('@tauri-apps/plugin-shell')
  // PROJECT_ROOT is injected by Vite via `define` (see vite.config.ts).
  const projectRoot: string = __OPENPENCIL_PROJECT_ROOT__
  const command = Command.create(SIDECAR_NAME, previewSidecarCommandArgs(projectRoot, target), {
    cwd: projectRoot
  })

  let stdoutBuffer = ''
  const stderrTail: string[] = []
  const listeners = new Set<(event: SidecarEvent) => void>()
  const processState: {
    closed: boolean
    unhealthy: boolean
    exitCode: number | null
    terminalMessage: string | null
  } = { closed: false, unhealthy: false, exitCode: null, terminalMessage: null }
  let resolveTerminal: (value: { code: number | null; message: string }) => void = NOOP
  const terminal = new Promise<{ code: number | null; message: string }>((resolve) => {
    resolveTerminal = resolve
  })
  const startupEvents = createPreviewStartupEventBuffer()
  const processIsClosed = (): boolean => processState.closed
  const processIsAlive = (): boolean => !processState.closed && !processState.unhealthy

  const settleTerminal = (message: string, code: number | null): void => {
    processState.unhealthy = true
    if (processState.terminalMessage !== null) return
    processState.terminalMessage = message
    resolveTerminal({ code, message })
  }

  const dispatch = (event: SidecarEvent): void => {
    startupEvents.capture(event)
    for (const fn of listeners) fn(event)
  }

  command.stdout.on('data', (raw: Uint8Array | number[] | string) => {
    const chunk = typeof raw === 'string' ? raw : decodeTauriStderr(raw)
    stdoutBuffer += chunk
    let nl = stdoutBuffer.indexOf('\n')
    while (nl !== -1) {
      const line = stdoutBuffer.slice(0, nl).trim()
      stdoutBuffer = stdoutBuffer.slice(nl + 1)
      nl = stdoutBuffer.indexOf('\n')
      if (!line) continue
      try {
        dispatch(parsePreviewSidecarEvent(line))
      } catch (e) {
        console.warn('[preview] non-JSON stdout:', line, e)
      }
    }
  })

  command.stderr.on('data', (raw: Uint8Array | number[] | string) => {
    const text = decodeTauriStderr(raw)
    stderrTail.push(text)
    // Keep at most ~8KiB of recent stderr for error context.
    let total = stderrTail.reduce((n, s) => n + s.length, 0)
    while (total > 8192 && stderrTail.length > 1) {
      total -= stderrTail.shift()?.length ?? 0
    }
    console.warn('[preview]', text)
  })

  command.on('close', (data: { code: number | null }) => {
    processState.closed = true
    processState.exitCode = data.code
    const message = `dev-server exited (code ${data.code ?? 'null'})`
    settleTerminal(message, data.code)
    dispatch({ type: 'error', message })
  })
  command.on('error', (message: string) => {
    settleTerminal(message, null)
    dispatch({ type: 'error', message })
  })

  let child: Awaited<ReturnType<typeof command.spawn>>
  try {
    child = await command.spawn()
  } catch (e) {
    const hint =
      'Failed to spawn `bun`. Ensure bun is on the launching shell PATH ' +
      '(GUI apps on macOS may need `~/.bun/bin` exported in /etc/paths.d or via launchctl).'
    throw new Error(`${e instanceof Error ? e.message : String(e)} — ${hint}`)
  }

  let ready: PreviewSidecarReady
  try {
    ready = await new Promise<PreviewSidecarReady>((resolve, reject) => {
      const fail = (msg: string): void => {
        clearTimeout(timer)
        listeners.delete(handle)
        const stderr = stderrTail.join('').trim()
        reject(new Error(stderr ? `${msg}\n--- stderr ---\n${stderr}` : msg))
      }
      const timer = setTimeout(() => {
        if (processIsClosed()) {
          fail(`dev-server exited (code ${processState.exitCode ?? 'null'}) before ready`)
        } else {
          fail(`Preview server did not become ready within ${READY_TIMEOUT_MS}ms`)
        }
      }, READY_TIMEOUT_MS)
      const handle = (event: SidecarEvent): void => {
        if (event.type === 'ready') {
          try {
            const parsed = parsePreviewSidecarReady(event)
            clearTimeout(timer)
            listeners.delete(handle)
            resolve(parsed)
          } catch (cause) {
            fail(cause instanceof Error ? cause.message : String(cause))
          }
        } else if (event.type === 'error') {
          fail(event.message)
        }
      }
      listeners.add(handle)
      startupEvents.replay(handle)
    })
    if (!processIsAlive()) {
      throw new Error(
        processState.terminalMessage ?? 'Preview sidecar stopped before startup completed'
      )
    }
  } catch (error) {
    if (!processIsClosed()) {
      try {
        await child.kill()
      } catch (killError) {
        console.warn('[preview] startup cleanup failed:', killError)
      }
    }
    throw error
  } finally {
    startupEvents.settle()
  }

  const encodeCache = createPreviewFileEncodeCache()
  let updateQueue: Promise<void> = Promise.resolve()
  let disposed = false
  return {
    url: ready.url,
    port: ready.port,
    terminal,
    isAlive: () => !disposed && processIsAlive(),
    async update(files: Map<string, string | Uint8Array>): Promise<void> {
      if (disposed) return
      const pending = updateQueue.then(async () => {
        if (disposed) return undefined
        if (!processIsAlive()) {
          throw new Error(processState.terminalMessage ?? 'Preview sidecar is not running')
        }
        const acknowledgement = waitForPreviewUpdateAck(listeners)
        try {
          const serializable = serializePreviewFiles(files, encodeCache)
          const line = JSON.stringify({ type: 'update', files: serializable }) + '\n'
          await child.write(line)
          await acknowledgement.promise
          if (!processIsAlive()) {
            throw new Error(
              processState.terminalMessage ?? 'Preview sidecar stopped after the update'
            )
          }
          return undefined
        } catch (cause) {
          resetPreviewFileEncodeCache(encodeCache)
          settleTerminal(
            cause instanceof Error ? cause.message : 'Preview sidecar update failed',
            processState.exitCode
          )
          if (!processIsClosed()) {
            try {
              await child.kill()
            } catch (killError) {
              console.warn('[preview] update failure cleanup failed:', killError)
            }
          }
          throw cause
        } finally {
          acknowledgement.cancel()
        }
      })
      updateQueue = pending.catch(() => undefined)
      await pending
    },
    async dispose(): Promise<void> {
      if (disposed) return
      disposed = true
      await updateQueue
      try {
        await child.write(JSON.stringify({ type: 'close' }) + '\n')
      } catch (e) {
        console.warn('[preview] close write failed (stdin closed?):', e)
      }
      try {
        await child.kill()
      } catch (e) {
        console.warn('[preview] kill failed:', e)
      }
    }
  }
}

export type PreviewStatus =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'ready'; url: string; port: number }
  | { kind: 'error'; message: string }
  | { kind: 'disabled'; reason: string }

interface UseCompileOnChangeResult {
  status: Ref<PreviewStatus>
  compileState: Ref<PreviewCompileSchedulerState>
  compileWarnings: Ref<CompileWarning[]>
  compileError: Ref<string | null>
  motionWarnings: Ref<CompileWarning[]>
  motionCompileError: Ref<string | null>
  /** Compile + push immediately, bypassing the active refresh policy. Used by
   *  the PreviewPane reload button so the user can force a fresh build without
   *  waiting on an Auto trailing flush. No-op until the sidecar is ready. */
  forceRecompile: () => void
}

export function onlyMotionWarnings(warnings: readonly CompileWarning[]): CompileWarning[] {
  return warnings.filter((warning) => warning.code.startsWith('motion-'))
}

/**
 * Mount-time: spawn the dev-server, do an initial compile + push.
 * Then policy-watch `sceneVersion` and push fresh compiles on change.
 * Unmount: dispose the sidecar.
 */
export function useCompileOnChange(settings?: PreviewCompileSettings): UseCompileOnChangeResult {
  const status = ref<PreviewStatus>({ kind: 'idle' })
  const compileState = ref(
    createPreviewCompileSchedulerState(
      settings?.refreshPolicy?.value ?? DEFAULT_PREVIEW_REFRESH_POLICY
    )
  )
  const compileWarnings = ref<CompileWarning[]>([])
  const compileError = ref<string | null>(null)
  const motionWarnings = ref<CompileWarning[]>([])
  const motionCompileError = ref<string | null>(null)

  if (!isTauri()) {
    status.value = { kind: 'disabled', reason: 'Preview is only available in the desktop app' }
    return {
      status,
      compileState,
      compileWarnings,
      compileError,
      motionWarnings,
      motionCompileError,
      forceRecompile: NOOP
    }
  }

  const store = useEditorStore()
  let sidecar: PreviewSidecar | null = null
  let cancelled = false
  let sidecarGeneration = 0

  async function compileAndPush(request: PreviewCompileRun) {
    const activeSidecar = sidecar
    if (!activeSidecar) return 'superseded' as const
    try {
      const graph = store.graph
      const pages = graph.getPages()
      // §7 decision #a: single-page docs keep the legacy fast path so the
      // emitted bytes stay identical to Phase 1 §11.5 #5. Multi-page docs
      // hand all pages to the compiler so the iframe boots the same
      // BrowserRouter shell as CLI export — that's what makes editor↔iframe
      // navigation possible (decision #1).
      const pageIds = pages.length > 1 ? pages.map((p) => p.id) : [store.state.currentPageId]
      const fontManifest = await resolveCompilerWebFonts({
        graph,
        pageIds,
        providers: fontManager.enabledOnlineFontProviders(),
        fetcher: tauriFetch,
        preferLoaded: true,
        refresh: request.refreshFonts
      })
      if (!request.isCurrent() || sidecar !== activeSidecar) {
        return 'superseded' as const
      }
      const out = compile({
        graph,
        pageIds,
        fontManifest,
        options: withDefaults({
          packageName: 'openpencil-preview',
          ...previewCompilerOverrides(settings, pageIds.length)
        })
      })
      // `compile` is synchronous. Re-check the scheduler revision before the
      // sidecar write so a newer scene snapshot never joins the sidecar queue
      // behind an already obsolete compile.
      if (!request.isCurrent() || sidecar !== activeSidecar) {
        return 'superseded' as const
      }
      compileWarnings.value = [...out.warnings]
      compileError.value = null
      motionWarnings.value = onlyMotionWarnings(out.warnings)
      motionCompileError.value = null
      for (const w of out.warnings) {
        console.warn(`[preview] ${w.code}: ${w.message}`)
      }
      await activeSidecar.update(out.files)
      if (!request.isCurrent() || sidecar !== activeSidecar) {
        return 'superseded' as const
      }
      if (!activeSidecar.isAlive()) {
        throw new Error('Preview sidecar stopped before the initial preview was ready')
      }
      // Do not mount the iframe while the sidecar still has an empty VFS.
      // A first request made before this acknowledged push receives Vite's
      // disk 404 page, which has no HMR client and therefore cannot observe
      // the full-reload emitted by the initial update.
      if (status.value.kind !== 'ready' || status.value.port !== activeSidecar.port) {
        status.value = {
          kind: 'ready',
          url: activeSidecar.url,
          port: activeSidecar.port
        }
      }
      return 'pushed' as const
    } catch (e) {
      if (!request.isCurrent()) return 'superseded' as const
      const message = e instanceof Error ? e.message : String(e)
      compileWarnings.value = []
      compileError.value = message
      motionWarnings.value = []
      motionCompileError.value = message
      if (status.value.kind === 'starting' && sidecar === activeSidecar) {
        status.value = { kind: 'error', message }
      }
      console.warn('[preview] compile failed:', e)
      return 'failed' as const
    }
  }

  const scheduler = createPreviewCompileScheduler({
    policy: compileState.value.policy,
    run: compileAndPush,
    onStateChange: (next) => {
      compileState.value = next
    }
  })

  async function launchPreviewSidecar(target: PreviewTarget): Promise<void> {
    const generation = ++sidecarGeneration
    const launchIsStale = (): boolean => cancelled || generation !== sidecarGeneration
    status.value = { kind: 'starting' }
    const previous = sidecar
    sidecar = null
    if (previous) await previous.dispose()
    if (launchIsStale()) return
    try {
      const handle = await startPreviewSidecar(target)
      if (launchIsStale()) {
        await handle.dispose()
      } else {
        sidecar = handle
        void handle.terminal.then((terminal) => {
          if (cancelled || generation !== sidecarGeneration || sidecar !== handle) return undefined
          sidecar = null
          status.value = { kind: 'error', message: terminal.message }
          return undefined
        })
        // `compileAndPush` promotes this launch to ready only after the first
        // VFS update is acknowledged, so the iframe never mounts against the
        // sidecar's intentionally empty startup state.
        scheduler.requestInitial()
      }
    } catch (e: unknown) {
      if (launchIsStale()) return
      const message = e instanceof Error ? e.message : String(e)
      status.value = { kind: 'error', message }
    }
  }
  void launchPreviewSidecar(settings?.target?.value ?? 'react')

  const stopSceneWatch = watch(
    () => [store.state.sceneVersion, importedFontRevision.value] as const,
    (current, previous) => {
      if (!sidecar) return
      scheduler.requestChange(current[1] !== previous[1])
    }
  )
  const stopPolicyWatch = settings?.refreshPolicy
    ? watch(settings.refreshPolicy, (policy) => scheduler.setPolicy(policy))
    : NOOP
  const stopTargetWatch = settings?.target
    ? watch(settings.target, (target) => {
        compileWarnings.value = []
        compileError.value = null
        motionWarnings.value = []
        motionCompileError.value = null
        void launchPreviewSidecar(target)
      })
    : NOOP

  // §7 decision #4: switching `currentPageId` no longer rebuilds the
  // preview — it just navigates the existing iframe via the bridge
  // (handled in PreviewPane.vue). For single-page docs the watcher would
  // have been a no-op anyway (only one page id exists); for multi-page
  // we explicitly avoid the recompile cost on every page switch.

  onBeforeUnmount(() => {
    cancelled = true
    stopSceneWatch()
    stopPolicyWatch()
    stopTargetWatch()
    scheduler.dispose()
    if (sidecar) {
      void sidecar.dispose()
      sidecar = null
    }
  })

  return {
    status,
    compileState,
    compileWarnings,
    compileError,
    motionWarnings,
    motionCompileError,
    forceRecompile: () => {
      if (sidecar) scheduler.flush(true)
    }
  }
}
