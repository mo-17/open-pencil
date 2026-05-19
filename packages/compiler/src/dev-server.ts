#!/usr/bin/env bun
// Bun-only. Imports `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite` — none
// safe to load in a browser bundle. The Vue editor talks to this over stdio
// after spawning it via @tauri-apps/plugin-shell.
//
// Two entrypoints in one file:
//   - Library: `createPreviewServer({ initialFiles, port })`
//   - CLI/sidecar: `bun packages/compiler/src/dev-server.ts [--port N]`
//     stdin reads newline-delimited JSON commands; stdout emits NDJSON events.

import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { dirname, join, posix } from 'node:path'
import process from 'node:process'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { createServer, type Plugin, type ViteDevServer } from 'vite'

export type PreviewFiles = Map<string, string | Uint8Array>

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
      probe.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

/**
 * Resolve a path relative to an importer. Both are project-rooted (no leading
 * slash) — e.g. importer `src/main.tsx`, source `./App` → `src/App`.
 */
function resolveRelative(source: string, importerRel: string): string {
  if (!source.startsWith('.')) return source
  const dir = dirname(importerRel)
  return posix.normalize(posix.join(dir, source))
}

/**
 * Look up a file by stem — tries `.tsx`, `.ts`, `.jsx`, `.js`, `.css`,
 * then `${stem}/index.{tsx,ts,jsx,js}`. Mirrors Vite's default extension
 * resolution so import statements without extensions work.
 */
function lookupFile(files: PreviewFiles, stem: string): string | null {
  if (files.has(stem)) return stem
  const exts = ['.tsx', '.ts', '.jsx', '.js', '.css']
  for (const ext of exts) {
    if (files.has(stem + ext)) return stem + ext
  }
  for (const ext of exts) {
    const idx = `${stem}/index${ext}`
    if (files.has(idx)) return idx
  }
  return null
}

function inMemoryVFS(state: { files: PreviewFiles }, vfsPrefix: string): Plugin {
  return {
    name: 'openpencil-lowcode-vfs',
    enforce: 'pre',

    resolveId(source, importer) {
      if (source.startsWith(vfsPrefix)) return source

      // Absolute-path imports (`/src/main.tsx` from index.html, or any URL
      // route the iframe fetches). These come in two flavours:
      //   - source has no importer → first-load from index.html
      //   - source has importer == VFS html → same, after Vite re-resolves
      // In both cases we want to map `/<rel>` into the VFS.
      if (source.startsWith('/') && !source.startsWith('//')) {
        const rel = source.slice(1)
        const found = lookupFile(state.files, rel)
        if (found) return vfsPrefix + found
        // Fall through — could be `/@vite/client`, `/@react-refresh`, etc.
        return null
      }

      // Relative imports from inside a VFS module: `./App`, `./index.css`.
      if (importer?.startsWith(vfsPrefix) && source.startsWith('.')) {
        const importerRel = importer.slice(vfsPrefix.length)
        const rel = resolveRelative(source, importerRel)
        const found = lookupFile(state.files, rel)
        return found ? vfsPrefix + found : null
      }

      // Bare imports (`react`, `react-dom/client`, …) fall through to Vite's
      // standard resolver, which walks node_modules from scanRoot upwards.
      return null
    },

    load(id) {
      if (!id.startsWith(vfsPrefix)) return null
      const rel = id.slice(vfsPrefix.length)
      const content = state.files.get(rel)
      if (content === undefined) return null
      if (typeof content === 'string') return content
      // Binary content for VFS isn't supported in Phase 0; skip silently
      return null
    },

    configureServer(server) {
      // Intercept `/` and `/index.html` from the VFS instead of Vite's
      // default disk-based html-fallback middleware.
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '/').split('?')[0]
        if (url !== '/' && url !== '/index.html') return next()
        const html = state.files.get('index.html')
        if (typeof html !== 'string') return next()
        server
          .transformIndexHtml(req.originalUrl ?? '/', html)
          .then((transformed) => {
            res.setHeader('Content-Type', 'text/html')
            res.statusCode = 200
            res.end(transformed)
          })
          .catch(next)
      })
    }
  }
}

export async function createPreviewServer(
  opts: PreviewServerOptions = {}
): Promise<PreviewServer> {
  const state = { files: opts.initialFiles ?? new Map() }
  const workspaceRoot = opts.fsRoot ?? process.cwd()
  // Use a quiet sub-directory as Vite's root so its default `**/*.html`
  // scan and dep discovery don't crawl the editor's source tree. Node
  // module resolution still walks up from this dir to the workspace's
  // hoisted `node_modules`, so react / tailwind resolve cleanly.
  const scanRoot = join(workspaceRoot, 'packages/compiler/.preview-root')
  mkdirSync(scanRoot, { recursive: true })
  // VFS prefix sits *inside* scanRoot so that npm-package resolution from
  // any virtual file walks up to scanRoot's `node_modules` chain (which
  // ultimately reaches the workspace root). Trailing slash + leading slash
  // matter — they make the prefix look like an absolute directory path.
  const vfsPrefix = `${scanRoot}/`
  const vfs = inMemoryVFS(state, vfsPrefix)
  // Plant a tsconfig.json that wins the upward search Vite/esbuild does for
  // JSX mode. The workspace root tsconfig sets `jsx: "preserve"` (for Vue);
  // if we let that win, esbuild's import-analysis rejects the React TSX as
  // invalid JS. This local tsconfig forces the React transform instead.
  writeFileSync(
    join(scanRoot, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          allowImportingTsExtensions: false,
          isolatedModules: true,
          strict: true,
          skipLibCheck: true,
          useDefineForClassFields: true
        }
      },
      null,
      2
    )
  )
  // Pre-pick a free port instead of letting Vite scan 5173 → 5174 → … when
  // its defaults clash with zombie preview servers from prior sessions.
  const chosenPort = opts.port && opts.port > 0 ? opts.port : await pickFreePort()
  trace(`createServer: workspaceRoot=${workspaceRoot} scanRoot=${scanRoot} port=${chosenPort}`)

  const server = await createServer({
    root: scanRoot,
    configFile: false,
    envFile: false,
    appType: 'spa',
    server: {
      port: chosenPort,
      host: '127.0.0.1',
      strictPort: false,
      fs: { strict: false, allow: [workspaceRoot] }
    },
    optimizeDeps: {
      // Skip Vite's html crawler; we pre-declare the npm deps the emitted
      // app needs so the depscan has nothing to do.
      entries: [],
      include: ['react', 'react-dom', 'react-dom/client']
    },
    // Vite's import-analysis stage runs its built-in TS-strip transformer
    // before plugin-react's babel transform gets a chance, and it reads
    // tsconfig from disk. The workspace root tsconfig sets `jsx: "preserve"`
    // (for Vue) which makes esbuild reject the React TSX as invalid JS.
    // Hard-override `jsx` here so the in-memory tsx parses cleanly.
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: 'react',
      tsconfigRaw: {
        compilerOptions: {
          jsx: 'react-jsx',
          jsxImportSource: 'react',
          target: 'esnext',
          useDefineForClassFields: true
        }
      }
    },
    plugins: [vfs, react(), tailwindcss()]
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
      const changed: string[] = []
      for (const [rel, content] of files) {
        if (prev.get(rel) !== content) changed.push(rel)
      }
      for (const rel of prev.keys()) {
        if (!files.has(rel)) changed.push(rel)
      }
      if (changed.length === 0) return

      let invalidated = 0
      for (const rel of changed) {
        const mod = server.moduleGraph.getModuleById(vfsPrefix + rel)
        if (mod) {
          server.moduleGraph.invalidateModule(mod)
          invalidated++
        }
      }

      // If index.html changed (or we couldn't resolve any module), force a
      // full reload — HMR can't recover a fresh entry. Otherwise let
      // plugin-react's Fast Refresh pick up changed .tsx/.css.
      if (changed.includes('index.html') || invalidated === 0) {
        server.ws.send({ type: 'full-reload' })
      } else {
        server.ws.send({ type: 'full-reload' })
        // Note: plugin-react auto-emits fine-grained js-updates when modules
        // are invalidated and re-requested. For Phase 0 we play it safe with
        // a full-reload broadcast; React Fast Refresh upgrade is a followup.
      }
    },
    async close() {
      await server.close()
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// CLI / sidecar entrypoint
// ────────────────────────────────────────────────────────────────────────────

interface IncomingCommand {
  type: 'update' | 'close'
  files?: Array<[string, string]>
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

async function runCli(): Promise<void> {
  let portArg = 0
  let rootArg: string | undefined
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === '--port') {
      portArg = Number.parseInt(argv[i + 1], 10) || 0
      i++
    } else if (argv[i] === '--root') {
      rootArg = argv[i + 1]
      i++
    }
  }
  trace(`CLI start: cwd=${process.cwd()} root=${rootArg ?? '(cwd)'} port=${portArg}`)

  let server: PreviewServer
  try {
    server = await createPreviewServer({ port: portArg, fsRoot: rootArg })
  } catch (e) {
    const message = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)
    trace(`createPreviewServer failed: ${message}`)
    emit({ type: 'error', message })
    process.exit(1)
  }
  emit({ type: 'ready', url: server.url, port: server.port })

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
        handleCommand(server, cmd).catch((e) => {
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

async function handleCommand(server: PreviewServer, cmd: IncomingCommand): Promise<void> {
  if (cmd.type === 'update' && Array.isArray(cmd.files)) {
    const files: PreviewFiles = new Map(cmd.files)
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
  void runCli()
}

// Used by ViteDevServer reference — keeping the import explicit avoids `vite`
// being tree-shaken from the d.ts. The cast is a no-op at runtime.
export type { ViteDevServer }
