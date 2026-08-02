// Wires the editor scene-graph into the lowcode preview pipeline:
//
//   sceneVersion --(200ms debounce)--> compile(all pages | currentPage)
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

import { watchDebounced } from '@vueuse/core'
import { onBeforeUnmount, ref, type Ref } from 'vue'

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
import { decodeTauriStderr } from '@/app/shell/ui'
import { isTauri } from '@/app/tauri/env'
import { tauriFetch } from '@/app/tauri/http'

import { waitForPreviewUpdateAck } from './update-ack'

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
const DEBOUNCE_MS = 200

const NOOP = (): void => undefined

export type PreviewUiKit = 'none' | 'shadcn'

export interface PreviewCompileSettings {
  uiKit: Ref<PreviewUiKit>
  i18nEnabled: Ref<boolean>
  localesInput: Ref<string>
}

export function parsePreviewLocales(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

function previewCompilerOverrides(settings?: PreviewCompileSettings): Partial<CompilerOptions> {
  if (!settings) return {}
  const locales = parsePreviewLocales(settings.localesInput.value)
  return {
    ...(settings.uiKit.value === 'shadcn' ? { uiKit: 'shadcn' as const } : {}),
    ...(settings.i18nEnabled.value
      ? { i18n: true, ...(locales.length > 0 ? { locales } : {}) }
      : {})
  }
}

interface PreviewSidecar {
  url: string
  update(files: Map<string, string | Uint8Array>): Promise<void>
  dispose(): Promise<void>
}

async function startPreviewSidecar(): Promise<PreviewSidecar> {
  const { Command } = await import('@tauri-apps/plugin-shell')
  // PROJECT_ROOT is injected by Vite via `define` (see vite.config.ts).
  const projectRoot: string = __OPENPENCIL_PROJECT_ROOT__
  const command = Command.create(SIDECAR_NAME, [SIDECAR_ENTRY, '--root', projectRoot], {
    cwd: projectRoot
  })

  let stdoutBuffer = ''
  const stderrTail: string[] = []
  const listeners = new Set<(event: SidecarEvent) => void>()
  let exited = false
  let exitCode: number | null = null

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
        const event = JSON.parse(line) as SidecarEvent
        for (const fn of listeners) fn(event)
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
    exited = true
    exitCode = data.code
    for (const fn of listeners) {
      fn({ type: 'error', message: `dev-server exited (code ${data.code ?? 'null'})` })
    }
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

  const ready = await new Promise<SidecarReadyEvent>((resolve, reject) => {
    const fail = (msg: string): void => {
      clearTimeout(timer)
      listeners.delete(handle)
      const stderr = stderrTail.join('').trim()
      reject(new Error(stderr ? `${msg}\n--- stderr ---\n${stderr}` : msg))
    }
    const timer = setTimeout(() => {
      if (exited) {
        fail(`dev-server exited (code ${exitCode ?? 'null'}) before ready`)
      } else {
        fail(`Preview server did not become ready within ${READY_TIMEOUT_MS}ms`)
      }
    }, READY_TIMEOUT_MS)
    const handle = (event: SidecarEvent): void => {
      if (event.type === 'ready') {
        clearTimeout(timer)
        listeners.delete(handle)
        resolve(event)
      } else if (event.type === 'error') {
        fail(event.message)
      }
    }
    listeners.add(handle)
  })

  const encodeCache = createPreviewFileEncodeCache()
  let updateQueue: Promise<void> = Promise.resolve()
  let disposed = false
  return {
    url: ready.url,
    async update(files: Map<string, string | Uint8Array>): Promise<void> {
      if (disposed) return
      const pending = updateQueue.then(async () => {
        if (disposed) return undefined
        const acknowledgement = waitForPreviewUpdateAck(listeners)
        try {
          const serializable = serializePreviewFiles(files, encodeCache)
          const line = JSON.stringify({ type: 'update', files: serializable }) + '\n'
          await child.write(line)
          await acknowledgement.promise
          return undefined
        } catch (cause) {
          resetPreviewFileEncodeCache(encodeCache)
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
  | { kind: 'ready'; url: string }
  | { kind: 'error'; message: string }
  | { kind: 'disabled'; reason: string }

interface UseCompileOnChangeResult {
  status: Ref<PreviewStatus>
  motionWarnings: Ref<CompileWarning[]>
  motionCompileError: Ref<string | null>
  /** Compile + push immediately, bypassing the sceneVersion debounce. Used by
   *  the PreviewPane reload button so the user can force a fresh build without
   *  waiting on the next debounced tick. No-op until the sidecar is ready. */
  forceRecompile: () => void
}

export function onlyMotionWarnings(warnings: readonly CompileWarning[]): CompileWarning[] {
  return warnings.filter((warning) => warning.code.startsWith('motion-'))
}

/**
 * Mount-time: spawn the dev-server, do an initial compile + push.
 * Then debounce-watch `sceneVersion` and push fresh compiles on change.
 * Unmount: dispose the sidecar.
 */
export function useCompileOnChange(settings?: PreviewCompileSettings): UseCompileOnChangeResult {
  const status = ref<PreviewStatus>({ kind: 'idle' })
  const motionWarnings = ref<CompileWarning[]>([])
  const motionCompileError = ref<string | null>(null)

  if (!isTauri()) {
    status.value = { kind: 'disabled', reason: 'Preview is only available in the desktop app' }
    return { status, motionWarnings, motionCompileError, forceRecompile: NOOP }
  }

  const store = useEditorStore()
  let sidecar: PreviewSidecar | null = null
  let cancelled = false
  let compileRevision = 0

  async function compileAndPush(refreshFonts: boolean): Promise<void> {
    const activeSidecar = sidecar
    if (!activeSidecar) return
    const revision = ++compileRevision
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
        refresh: refreshFonts
      })
      if (cancelled || revision !== compileRevision || sidecar !== activeSidecar) return
      const out = compile({
        graph,
        pageIds,
        fontManifest,
        options: withDefaults({
          packageName: 'openpencil-preview',
          ...previewCompilerOverrides(settings)
        })
      })
      motionWarnings.value = onlyMotionWarnings(out.warnings)
      motionCompileError.value = null
      for (const w of out.warnings) {
        console.warn(`[preview] ${w.code}: ${w.message}`)
      }
      await activeSidecar.update(out.files)
    } catch (e) {
      if (cancelled || revision !== compileRevision) return
      motionWarnings.value = []
      motionCompileError.value = e instanceof Error ? e.message : String(e)
      console.warn('[preview] compile failed:', e)
    }
  }

  function recompileAndPush(refreshFonts = false): void {
    void compileAndPush(refreshFonts)
  }

  status.value = { kind: 'starting' }
  async function launchPreviewSidecar(): Promise<void> {
    try {
      const handle = await startPreviewSidecar()
      if (cancelled) {
        await handle.dispose()
      } else {
        sidecar = handle
        status.value = { kind: 'ready', url: handle.url }
        recompileAndPush()
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      status.value = { kind: 'error', message }
    }
  }
  void launchPreviewSidecar()

  const stopDebounced = watchDebounced(
    () => store.state.sceneVersion,
    () => {
      if (!sidecar) return
      recompileAndPush()
    },
    { debounce: DEBOUNCE_MS }
  )

  // §7 decision #4: switching `currentPageId` no longer rebuilds the
  // preview — it just navigates the existing iframe via the bridge
  // (handled in PreviewPane.vue). For single-page docs the watcher would
  // have been a no-op anyway (only one page id exists); for multi-page
  // we explicitly avoid the recompile cost on every page switch.

  onBeforeUnmount(() => {
    cancelled = true
    stopDebounced()
    if (sidecar) {
      void sidecar.dispose()
      sidecar = null
    }
  })

  return {
    status,
    motionWarnings,
    motionCompileError,
    forceRecompile: () => recompileAndPush(true)
  }
}
