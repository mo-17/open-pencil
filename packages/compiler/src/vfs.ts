// Shared in-memory virtual filesystem for the lowcode preview/build pipeline.
//
// The compiler emits a project as a `Map<path, content>`; both the preview
// dev-server (`dev-server.ts`, Vite `createServer`) and the static build
// (`build.ts`, Vite `build`) feed that Map to Vite through this plugin instead
// of writing it to disk. Vite resolves npm deps (react / tailwind / …) by
// walking up from a real `scanRoot` dir to the workspace's hoisted
// `node_modules`, so emitted files never touch the filesystem.
//
// Phase 3 §5: extracted from `dev-server.ts` so the build path reuses the
// identical resolution logic (经验 A — one source, no jscpd clone). The
// `configureServer` hook is a dev-only Vite lifecycle hook; it's a no-op during
// `vite build`, so the same plugin instance serves both paths.

import { Buffer } from 'node:buffer'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'

import type { ESBuildOptions, Plugin } from 'vite'

export type PreviewFiles = Map<string, string | Uint8Array>

/**
 * The Vite `esbuild` JSX override shared by the dev-server and the static
 * build. Vite's import-analysis / TS-strip stage reads tsconfig from disk
 * before plugin-react's transform runs; the workspace root tsconfig sets
 * `jsx: "preserve"` (for Vue), which makes esbuild reject the React TSX as
 * invalid JS. This forces the React automatic runtime regardless.
 */
export const VITE_JSX_ESBUILD: ESBuildOptions = {
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
}

/**
 * Prepare the Vite `root` both pipelines share: a quiet sub-dir of the
 * workspace whose default html/dep scan finds nothing on disk (the VFS plugin
 * supplies everything) but whose ancestor chain reaches the workspace's hoisted
 * node_modules. The VFS prefix sits *inside* scanRoot so npm-package resolution
 * from any virtual file walks up to that node_modules chain (trailing + leading
 * slash make the prefix look like an absolute directory path). Plants the
 * JSX-mode tsconfig that wins the upward search Vite/esbuild does (the workspace
 * root sets jsx:preserve for Vue — see VITE_JSX_ESBUILD).
 */
const PREVIEW_TSCONFIG = JSON.stringify(
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

export function prepareVfsRoot(workspaceRoot: string): { scanRoot: string; vfsPrefix: string } {
  const scanRoot = join(workspaceRoot, 'packages/compiler/.preview-root')
  mkdirSync(scanRoot, { recursive: true })
  // Idempotent write: this tsconfig lives inside the host app's Vite root, so
  // rewriting it (even with identical content, since mtime changes) trips
  // Vite's tsconfig watcher into a forced full reload. That reload re-creates
  // the preview dev server, which calls prepareVfsRoot again — an infinite
  // reload loop. Only touch the file when its content actually differs.
  const tsconfigPath = join(scanRoot, 'tsconfig.json')
  let current: string | null = null
  try {
    current = readFileSync(tsconfigPath, 'utf8')
  } catch {
    current = null
  }
  if (current !== PREVIEW_TSCONFIG) writeFileSync(tsconfigPath, PREVIEW_TSCONFIG)
  return { scanRoot, vfsPrefix: `${scanRoot}/` }
}

/**
 * Resolve a path relative to an importer. Both are project-rooted (no leading
 * slash) — e.g. importer `src/main.tsx`, source `./App` → `src/App`.
 */
export function resolveRelative(source: string, importerRel: string): string {
  if (!source.startsWith('.')) return source
  const dir = dirname(importerRel)
  return posix.normalize(posix.join(dir, source))
}

/**
 * Look up a file by stem — tries `.tsx`, `.ts`, `.jsx`, `.js`, `.css`,
 * then `${stem}/index.{tsx,ts,jsx,js}`. Mirrors Vite's default extension
 * resolution so import statements without extensions work.
 */
export function lookupFile(files: PreviewFiles, stem: string): string | null {
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

/** Drop any `?…` suffix Vite appends for HMR cache-busting or asset hints. */
export function stripQuery(s: string): string {
  const i = s.indexOf('?')
  return i === -1 ? s : s.slice(0, i)
}

export function inMemoryVFS(state: { files: PreviewFiles }, vfsPrefix: string): Plugin {
  return {
    name: 'openpencil-lowcode-vfs',
    enforce: 'pre',

    resolveId(source, importer) {
      if (source.startsWith(vfsPrefix)) return source

      // Absolute-path imports (`/src/main.tsx` from index.html, or any URL
      // route the iframe fetches). These come in two flavours:
      //   - source has no importer → first-load from index.html
      //   - source has importer == VFS html → same, after Vite re-resolves
      // Vite's CSS HMR appends `?t=<ts>` to bust the browser cache when it
      // sends a `css-update` event; strip that (and any other query) so the
      // VFS lookup still resolves.
      if (source.startsWith('/') && !source.startsWith('//')) {
        const rel = stripQuery(source.slice(1))
        const found = lookupFile(state.files, rel)
        if (found) return vfsPrefix + found
        // Fall through — could be `/@vite/client`, `/@react-refresh`, etc.
        return null
      }

      // Relative imports from inside a VFS module: `./App`, `./index.css`.
      if (importer?.startsWith(vfsPrefix) && source.startsWith('.')) {
        const importerRel = stripQuery(importer.slice(vfsPrefix.length))
        const rel = stripQuery(resolveRelative(source, importerRel))
        const found = lookupFile(state.files, rel)
        return found ? vfsPrefix + found : null
      }

      // Phase 3 §15: the shadcn UI-kit emit aliases `@/` → the project's `src/`
      // (`@/components/ui/button`, `@/lib/utils`). The emitted vite.config.ts
      // declares this alias for the standalone build, but the VFS build runs
      // `configFile: false`, so resolve it here too. Non-`@/` scoped packages
      // (`@radix-ui/…`, `@supabase/…`) keep falling through to node_modules.
      if (source.startsWith('@/')) {
        const rel = stripQuery('src/' + source.slice(2))
        const found = lookupFile(state.files, rel)
        return found ? vfsPrefix + found : null
      }

      // Bare imports (`react`, `react-dom/client`, …) fall through to Vite's
      // standard resolver, which walks node_modules from scanRoot upwards.
      return null
    },

    load(id) {
      if (!id.startsWith(vfsPrefix)) return null
      // Strip any HMR / asset-hint query so the VFS lookup matches the keys
      // emitted by the compiler (`src/App.tsx`, not `src/App.tsx?t=12345`).
      const rel = stripQuery(id.slice(vfsPrefix.length))
      const content = state.files.get(rel)
      if (content === undefined) return null
      if (typeof content === 'string') return content
      // Binary content for VFS isn't supported in Phase 0; skip silently
      return null
    },

    configureServer(server) {
      // Dev-only (no-op during `vite build`): intercept `/` and `/index.html`
      // from the VFS instead of Vite's default disk-based html-fallback
      // middleware.
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '/').split('?')[0]
        const asset = lookupBinaryAsset(state.files, url)
        if (asset) {
          res.setHeader('Content-Type', asset.contentType)
          res.setHeader('Content-Length', String(asset.bytes.byteLength))
          res.setHeader('Connection', 'close')
          res.statusCode = 200
          res.end(Buffer.from(asset.bytes))
          return
        }
        if (url !== '/' && url !== '/index.html') return next()
        const html = state.files.get('index.html')
        if (typeof html !== 'string') return next()
        void (async () => {
          try {
            const transformed = await server.transformIndexHtml(req.originalUrl ?? '/', html)
            res.setHeader('Content-Type', 'text/html')
            res.statusCode = 200
            res.end(transformed)
          } catch (err) {
            next(err)
          }
        })()
      })
    }
  }
}

function lookupBinaryAsset(
  files: PreviewFiles,
  urlPath: string
): { bytes: Uint8Array; contentType: string } | null {
  const rel = stripQuery(urlPath.replace(/^\/+/, ''))
  const candidates = rel.startsWith('assets/') ? [rel, `src/${rel}`] : [rel]
  for (const candidate of candidates) {
    const content = files.get(candidate)
    if (content instanceof Uint8Array) {
      return { bytes: content, contentType: contentTypeForPath(candidate) }
    }
  }
  return null
}

function contentTypeForPath(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  return 'application/octet-stream'
}
