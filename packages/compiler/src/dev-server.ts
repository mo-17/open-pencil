#!/usr/bin/env bun
// Bun-only. Imports Vite, its React/Vue framework plugins, and Tailwind — none
// safe to load in a browser bundle. The Vue editor talks to this over stdio
// after spawning it via @tauri-apps/plugin-shell.
//
// Two entrypoints in one file:
//   - Library: `createPreviewServer({ initialFiles, port })`
//   - CLI/sidecar: `bun packages/compiler/src/dev-server.ts [--port N]`
//     stdin reads newline-delimited JSON commands; stdout emits NDJSON events.

import { createServer as createNetServer } from 'node:net'
import process from 'node:process'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import vue from '@vitejs/plugin-vue'
import { createServer, type PluginOption, type Update, type ViteDevServer } from 'vite'

import { reactModuleOptimizeDepsForFiles } from './adapters/react/modules/registry'
import { createSupabaseBuildDefines } from './build'
import {
  createPreviewFileDecodeCache,
  deserializePreviewFiles,
  type PreviewFileDecodeCache,
  type SerializedPreviewFile
} from './preview-protocol'
import {
  inMemoryVFS,
  prepareVfsRoot,
  VITE_JSX_ESBUILD,
  type PreviewFiles,
  type WebVfsTarget
} from './vfs'

export type { PreviewFiles }

export type UpdateMode = 'full-reload' | 'hmr' | 'noop'

/**
 * Decide how the iframe should react to a batch of VFS changes.
 *
 * - `noop` — nothing changed (idempotent updateFiles call).
 * - `full-reload` — index.html changed, the VFS module topology changed, or
 *   not every changed file maps to a loaded module (Vite can't HMR imports it
 *   does not know about yet).
 * - `hmr` — broadcast Vite's native `update` event so the selected framework
 *   plugin's injected HMR boundaries can swap loaded modules in place.
 */
export function classifyUpdate(
  changes: readonly string[],
  invalidated: number,
  topologyChanged = false
): UpdateMode {
  if (changes.length === 0) return 'noop'
  if (changes.includes('index.html') || topologyChanged || invalidated !== changes.length) {
    return 'full-reload'
  }
  return 'hmr'
}

export interface PreviewFileDiff {
  changed: string[]
  topologyChanged: boolean
}

function sameFileContent(
  previous: string | Uint8Array | undefined,
  next: string | Uint8Array
): boolean {
  if (previous === next) return true
  if (typeof previous === 'string' || typeof next === 'string' || previous === undefined) {
    return false
  }
  if (previous.byteLength !== next.byteLength) return false
  for (let index = 0; index < previous.byteLength; index++) {
    if (previous[index] !== next[index]) return false
  }
  return true
}

/**
 * Compare VFS snapshots by value. Binary sidecar payloads are base64-decoded
 * into fresh Uint8Array instances on every update, so reference equality would
 * turn an unchanged font asset into a full reload.
 */
export function diffPreviewFiles(previous: PreviewFiles, next: PreviewFiles): PreviewFileDiff {
  const changed: string[] = []
  let topologyChanged = false
  for (const [path, content] of next) {
    if (!previous.has(path)) topologyChanged = true
    if (!sameFileContent(previous.get(path), content)) changed.push(path)
  }
  for (const path of previous.keys()) {
    if (!next.has(path)) {
      topologyChanged = true
      changed.push(path)
    }
  }
  return { changed, topologyChanged }
}

export interface PreviewServerOptions {
  /** Port to bind. 0 picks a free port. Default 0. */
  port?: number
  /** Initial VFS contents. Same shape as `CompilerOutput.files`. */
  initialFiles?: PreviewFiles
  /**
   * Filesystem root Vite uses to resolve npm deps (react / tailwind / …).
   * Must be a real path so Vite's depscan + node_modules resolution work.
   * Defaults to `process.cwd()`.
   */
  fsRoot?: string
  /** Framework plugin used for the immutable lifetime of this Vite server. */
  target?: WebVfsTarget
}

export interface PreviewServer {
  /** Final URL the iframe should load. */
  url: string
  /** Resolved port (after free-port selection). */
  port: number
  /** Replace the entire VFS contents and trigger HMR on changed entries. */
  updateFiles(files: PreviewFiles): void
  close(): Promise<void>
}

const PREVIEW_BASE_OPTIMIZE_DEPS = [
  'react',
  'react-dom',
  'react-dom/client',
  'zustand',
  'zustand/vanilla'
] as const

/** Prebundle optional trusted-module runtimes present in the initial VFS.
 * Modules added later resolve on demand after the topology-triggered reload. */
export function previewOptimizeDeps(files: PreviewFiles, target: WebVfsTarget = 'react'): string[] {
  if (target === 'vue') {
    return files.has('src/router.ts') ? ['vue', 'vue-router'] : ['vue']
  }
  return [...PREVIEW_BASE_OPTIMIZE_DEPS, ...reactModuleOptimizeDepsForFiles(files)]
}

// VFS ids look like `${scanRoot}/src/main.tsx`. Two constraints:
//   1. No `\0` prefix — Rolldown's plugin filter system skips null-prefixed
//      ids, so plugin-react would never transform them.
//   2. The id must sit inside a real directory that contains the workspace's
//      node_modules in its ancestor chain — otherwise Tailwind's CSS plugin
//      can't resolve `tailwindcss` from the (virtual) index.css.
// We don't actually write these files; the load hook intercepts before any
// filesystem read.

function trace(message: string): void {
  process.stderr.write(`[preview-dev-server] ${message}\n`)
}

/** Ask the OS for a free TCP port (binds, reads, closes). */
function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      probe.close(() => {
        resolve(port)
      })
    })
  })
}

export async function createPreviewServer(opts: PreviewServerOptions = {}): Promise<PreviewServer> {
  const state = { files: opts.initialFiles ?? new Map() }
  const workspaceRoot = opts.fsRoot ?? process.cwd()
  const target = opts.target ?? 'react'
  // Use a quiet sub-directory as Vite's root so its default `**/*.html`
  // scan and dep discovery don't crawl the editor's source tree. Node
  // module resolution still walks up from this dir to the workspace's
  // hoisted `node_modules`, so framework and Tailwind imports resolve cleanly.
  // Shared with the static build: scanRoot for dep resolution + the planted
  // JSX-mode tsconfig (the VFS prefix sits inside scanRoot so npm resolution
  // walks up to the workspace's hoisted node_modules).
  const { scanRoot, vfsPrefix } = prepareVfsRoot(workspaceRoot, target)
  const vfs = inMemoryVFS(state, vfsPrefix)
  const frameworkPlugins: PluginOption[] =
    target === 'vue' ? [vue() as PluginOption] : (react() as PluginOption[])
  // Pre-pick a free port instead of letting Vite scan 5173 → 5174 → … when
  // its defaults clash with zombie preview servers from prior sessions.
  const chosenPort = opts.port && opts.port > 0 ? opts.port : await pickFreePort()
  trace(`createServer: workspaceRoot=${workspaceRoot} scanRoot=${scanRoot} port=${chosenPort}`)

  const server = await createServer({
    root: scanRoot,
    configFile: false,
    envFile: false,
    appType: 'spa',
    // Preview must use the document-authored fallback in the generated runtime,
    // never an unrelated VITE_SUPABASE_* value inherited from the editor shell.
    define: createSupabaseBuildDefines(undefined),
    server: {
      port: chosenPort,
      host: '127.0.0.1',
      strictPort: false,
      fs: { strict: false, allow: [workspaceRoot] }
    },
    optimizeDeps: {
      // Skip Vite's html crawler; we pre-declare the npm deps the emitted
      // app needs so the depscan has nothing to do. Optional module runtimes
      // are included only when their generated VFS file is present.
      entries: [],
      include: previewOptimizeDeps(state.files, target)
    },
    // React's in-memory TSX needs an explicit JSX override (shared with the
    // static build — see VITE_JSX_ESBUILD). Vue SFCs stay on plugin-vue's path.
    ...(target === 'react' ? { esbuild: VITE_JSX_ESBUILD } : {}),
    plugins: [vfs, ...frameworkPlugins, ...tailwindcss()]
  })

  trace('listen…')
  await server.listen()
  const port = server.config.server.port
  const url = `http://localhost:${port}/`
  trace(`listening on ${url}`)

  return {
    url,
    port,
    updateFiles(files: PreviewFiles): void {
      const prev = state.files
      state.files = files

      // Invalidate everything that changed (added / removed / different content)
      const { changed, topologyChanged } = diffPreviewFiles(prev, files)
      if (changed.length === 0) return

      const invalidatedPaths: string[] = []
      for (const rel of changed) {
        const mod = server.moduleGraph.getModuleById(vfsPrefix + rel)
        if (mod) {
          server.moduleGraph.invalidateModule(mod)
          invalidatedPaths.push(rel)
        }
      }

      const mode = classifyUpdate(changed, invalidatedPaths.length, topologyChanged)
      if (mode === 'noop') return
      if (mode === 'full-reload') {
        server.ws.send({ type: 'full-reload' })
        return
      }
      // HMR: send Vite's native `update` event. Every emitted file — .tsx and
      // .css alike — is served as a JS module in Vite dev: CSS goes through
      // an `import './index.css'` statement that's transformed into a module
      // calling `__vite__updateStyle(id, css)` to inject a `<style>` tag, and
      // the module self-accepts via `import.meta.hot.accept()`. The native
      // `css-update` event scans `document.querySelectorAll('link')` for the
      // matching stylesheet — but we have no `<link>` tags, so css-update
      // would be silently dropped. `js-update` routes through `queueUpdate`
      // → `fetchUpdate`, which re-imports the module and re-runs its
      // top-level `__vite__updateStyle` call, replacing the existing style.
      // plugin-react's transform injects accept boundaries for React
      // component modules, so `js-update` preserves `useState` for them too.
      const timestamp = Date.now()
      const updates: Update[] = invalidatedPaths.map((rel) => {
        const url = '/' + rel
        return { type: 'js-update', path: url, acceptedPath: url, timestamp }
      })
      server.ws.send({ type: 'update', updates })
    },
    async close() {
      const closed = server.close()
      server.httpServer?.closeIdleConnections?.()
      server.httpServer?.closeAllConnections?.()
      await closed
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// CLI / sidecar entrypoint
// ────────────────────────────────────────────────────────────────────────────

interface IncomingCommand {
  type: 'update' | 'close'
  files?: SerializedPreviewFile[]
}

interface OutgoingEvent {
  type: 'ready' | 'updated' | 'error' | 'closing'
  url?: string
  port?: number
  message?: string
}

function emit(event: OutgoingEvent): void {
  process.stdout.write(JSON.stringify(event) + '\n')
}

async function runCLI(): Promise<void> {
  let portArg = 0
  let rootArg: string | undefined
  let targetArg: WebVfsTarget = 'react'
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === '--port') {
      portArg = Number.parseInt(argv[i + 1], 10) || 0
      i++
    } else if (argv[i] === '--root') {
      rootArg = argv[i + 1]
      i++
    } else if (argv[i] === '--target') {
      const value = argv[i + 1]
      if (value !== 'react' && value !== 'vue') {
        emit({ type: 'error', message: `invalid preview target: ${String(value)}` })
        process.exit(1)
      }
      targetArg = value
      i++
    }
  }
  trace(
    `CLI start: cwd=${process.cwd()} root=${rootArg ?? '(cwd)'} port=${portArg} target=${targetArg}`
  )

  let server: PreviewServer
  try {
    server = await createPreviewServer({ port: portArg, fsRoot: rootArg, target: targetArg })
  } catch (e) {
    const message = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)
    trace(`createPreviewServer failed: ${message}`)
    emit({ type: 'error', message })
    process.exit(1)
  }
  emit({ type: 'ready', url: server.url, port: server.port })

  const decodeCache = createPreviewFileDecodeCache()
  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk
    let nl = buffer.indexOf('\n')
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      nl = buffer.indexOf('\n')
      if (!line) continue
      try {
        const cmd = JSON.parse(line) as IncomingCommand
        handleCommand(server, cmd, decodeCache).catch((e) => {
          emit({ type: 'error', message: e instanceof Error ? e.message : String(e) })
        })
      } catch (e) {
        emit({
          type: 'error',
          message: `bad command: ${e instanceof Error ? e.message : String(e)}`
        })
      }
    }
  })

  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    emit({ type: 'closing' })
    // Hard-exit fallback: Vite's close() can hang on Bun if a watcher is
    // still holding a handle, leaving a zombie that holds the listening
    // port. 1s grace then SIGKILL ourselves.
    setTimeout(() => process.exit(0), 1000).unref()
    try {
      await server.close()
    } catch (e) {
      console.warn('[preview] close failed during shutdown:', e)
    }
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
  process.stdin.on('close', () => void shutdown())
}

async function handleCommand(
  server: PreviewServer,
  cmd: IncomingCommand,
  decodeCache: PreviewFileDecodeCache
): Promise<void> {
  if (cmd.type === 'update' && Array.isArray(cmd.files)) {
    const files = deserializePreviewFiles(cmd.files, decodeCache)
    server.updateFiles(files)
    emit({ type: 'updated' })
    return
  }
  if (cmd.type === 'close') {
    emit({ type: 'closing' })
    await server.close()
    process.exit(0)
  }
}

// Bun sets `import.meta.main = true` for the entry module. The type
// augmentation lives in bun-types; cast to access without redeclaring.
if ((import.meta as { main?: boolean }).main) {
  void runCLI()
}

// Used by ViteDevServer reference — keeping the import explicit avoids `vite`
// being tree-shaken from the d.ts. The cast is a no-op at runtime.
export type { ViteDevServer }
