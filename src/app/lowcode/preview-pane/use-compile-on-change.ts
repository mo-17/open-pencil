// Wires the editor scene-graph into the lowcode preview pipeline:
//
//   sceneVersion --(200ms debounce)--> compile(currentPage)
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
// Tauri-only. The sidecar runs `bun packages/compiler/src/dev-server.ts`
// via @tauri-apps/plugin-shell; that path is never imported statically so
// the browser bundle stays clean.

import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { watchDebounced } from '@vueuse/core'

import { compile, withDefaults } from '@open-pencil/compiler'

import { useEditorStore } from '@/app/editor/active-store'
import { decodeTauriStderr } from '@/app/shell/ui'
import { isTauri } from '@/app/tauri/env'

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

interface PreviewSidecar {
  url: string
  update(files: Map<string, string | Uint8Array>): Promise<void>
  dispose(): Promise<void>
}

async function startPreviewSidecar(): Promise<PreviewSidecar> {
  const { Command } = await import('@tauri-apps/plugin-shell')
  // PROJECT_ROOT is injected by Vite via `define` (see vite.config.ts).
  const projectRoot: string = __OPENPENCIL_PROJECT_ROOT__
  const command = Command.create(
    SIDECAR_NAME,
    [SIDECAR_ENTRY, '--root', projectRoot],
    { cwd: projectRoot }
  )

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

  let disposed = false
  return {
    url: ready.url,
    async update(files: Map<string, string | Uint8Array>): Promise<void> {
      if (disposed) return
      const serializable: Array<[string, string]> = []
      for (const [path, content] of files) {
        if (typeof content === 'string') {
          serializable.push([path, content])
        }
      }
      const line = JSON.stringify({ type: 'update', files: serializable }) + '\n'
      await child.write(line)
    },
    async dispose(): Promise<void> {
      if (disposed) return
      disposed = true
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
}

/**
 * Mount-time: spawn the dev-server, do an initial compile + push.
 * Then debounce-watch `sceneVersion` and push fresh compiles on change.
 * Unmount: dispose the sidecar.
 */
export function useCompileOnChange(): UseCompileOnChangeResult {
  const status = ref<PreviewStatus>({ kind: 'idle' })

  if (!isTauri()) {
    status.value = { kind: 'disabled', reason: 'Preview is only available in the desktop app' }
    return { status }
  }

  const store = useEditorStore()
  let sidecar: PreviewSidecar | null = null
  let cancelled = false

  function recompileAndPush(): void {
    if (!sidecar) return
    try {
      const graph = store.graph
      const pageId = store.state.currentPageId
      const out = compile({
        graph,
        pageIds: [pageId],
        options: withDefaults({ packageName: 'openpencil-preview' })
      })
      for (const w of out.warnings) {
        console.warn(`[preview] ${w.code}: ${w.message}`)
      }
      void sidecar.update(out.files).catch((e) => {
        console.warn('[preview] update failed:', e)
      })
    } catch (e) {
      console.warn('[preview] compile failed:', e)
    }
  }

  status.value = { kind: 'starting' }
  void startPreviewSidecar()
    .then((handle) => {
      if (cancelled) {
        void handle.dispose()
        return
      }
      sidecar = handle
      status.value = { kind: 'ready', url: handle.url }
      recompileAndPush()
    })
    .catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e)
      status.value = { kind: 'error', message }
    })

  const stopDebounced = watchDebounced(
    () => store.state.sceneVersion,
    () => {
      if (!sidecar) return
      recompileAndPush()
    },
    { debounce: DEBOUNCE_MS }
  )

  // Re-push on page switch too — switching currentPageId without a
  // sceneVersion bump should still rebuild the preview.
  const stopPageWatch = watch(
    () => store.state.currentPageId,
    () => {
      if (!sidecar) return
      recompileAndPush()
    }
  )

  onBeforeUnmount(() => {
    cancelled = true
    stopDebounced()
    stopPageWatch()
    if (sidecar) {
      void sidecar.dispose()
      sidecar = null
    }
  })

  return { status }
}
