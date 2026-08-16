// Shared in-memory virtual filesystem for the lowcode preview/build pipeline.
//
// The compiler emits a project as a `Map<path, content>`; both the preview
// dev-server (`dev-server.ts`, Vite `createServer`) and the static build
// (`build.ts`, Vite `build`) feed that Map to Vite through this plugin instead
// of writing it to disk. Vite resolves framework/Tailwind npm deps by
// walking up from a real `scanRoot` dir to the workspace's hoisted
// `node_modules`, so emitted files never touch the filesystem.
//
// Phase 3 §5: extracted from `dev-server.ts` so the build path reuses the
// identical resolution logic (经验 A — one source, no jscpd clone). The
// `configureServer` hook is a dev-only Vite lifecycle hook; it's a no-op during
// `vite build`, so the same plugin instance serves both paths.

import { Buffer } from 'node:buffer'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'

import type { Plugin } from 'vite'

export type PreviewFiles = Map<string, string | Uint8Array>
export type WebVfsTarget = 'react' | 'vue'

export function reactViteOptions(development?: boolean) {
  return {
    oxc: {
      jsx: {
        runtime: 'automatic' as const,
        importSource: 'react',
        ...(development === undefined ? {} : { development })
      }
    },
    resolve: { dedupe: ['react', 'react-dom'] }
  }
}

/**
 * Prepare the Vite `root` both pipelines share: a quiet sub-dir of the
 * workspace whose default html/dep scan finds nothing on disk (the VFS plugin
 * supplies everything) but whose ancestor chain reaches the workspace's hoisted
 * node_modules. The VFS prefix sits *inside* scanRoot so npm-package resolution
 * from any virtual file walks up to that node_modules chain (trailing + leading
 * slash make the prefix look like an absolute directory path). Plants the
 * target-specific tsconfig that wins the upward search performed by Vite/OXC;
 * the workspace root keeps JSX preserved for Vue while React uses jsx-runtime.
 */
function previewTsconfig(target: WebVfsTarget): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        ...(target === 'react' ? { jsx: 'react-jsx' } : {}),
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
}

export function prepareVfsRoot(
  workspaceRoot: string,
  target: WebVfsTarget = 'react'
): { scanRoot: string; vfsPrefix: string } {
  // Keep framework roots isolated: plugin-vue and plugin-react maintain
  // transform caches keyed by absolute ids and must never share one id space.
  const requestedScanRoot = join(workspaceRoot, `packages/compiler/.preview-root/${target}`)
  mkdirSync(requestedScanRoot, { recursive: true })
  // Vite/Rolldown may canonicalize loaded module IDs. Keep the configured root
  // on that same path so aliases such as macOS /var -> /private/var cannot turn
  // the emitted HTML asset name into a root-escaping ../../ path.
  const scanRoot = realpathSync(requestedScanRoot)
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
  const expected = previewTsconfig(target)
  if (current !== expected) writeFileSync(tsconfigPath, expected)
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
 * Look up a file by stem — tries Vue SFC, TypeScript/JavaScript, then CSS
 * extensions and matching `index.*` files. Mirrors the generated projects'
 * extensionless imports for both web targets.
 */
export function lookupFile(files: PreviewFiles, stem: string): string | null {
  if (files.has(stem)) return stem
  const exts = ['.vue', '.tsx', '.ts', '.jsx', '.js', '.css']
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

interface BinaryBuildAsset {
  sourceUrl: string
  outputPath: string
  bytes: Uint8Array
}

function binaryOutputRelativePath(path: string): string {
  const normalized = posix.normalize(path).replace(/^(\.\.\/)+/, '')
  return normalized.startsWith('src/assets/')
    ? normalized.slice('src/assets/'.length)
    : posix.basename(normalized)
}

function binaryBuildAssets(files: PreviewFiles): BinaryBuildAsset[] {
  const assets: BinaryBuildAsset[] = []
  for (const [path, content] of files) {
    if (!(content instanceof Uint8Array)) continue
    const relative = binaryOutputRelativePath(path)
    assets.push({
      sourceUrl: `./assets/${relative}`,
      outputPath: `assets/${relative}`,
      bytes: content
    })
  }
  return assets
}

export function inMemoryVFS(
  state: { files: PreviewFiles; inlineBinaryAssets?: boolean; inlineBinaryCSSAssets?: boolean },
  vfsPrefix: string
): Plugin {
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
      // plugin-vue owns its generated SFC submodules. Returning the original
      // .vue source for `?vue&type=script|template|style` would bypass that
      // plugin and make Rollup parse an SFC as JavaScript.
      const query = id.slice(id.indexOf('?') + 1)
      if (id.includes('?') && new URLSearchParams(query).has('vue')) return null
      // Strip any HMR / asset-hint query so the VFS lookup matches the keys
      // emitted by the compiler (`src/App.tsx`, not `src/App.tsx?t=12345`).
      const rel = stripQuery(id.slice(vfsPrefix.length))
      const content = state.files.get(rel)
      if (content === undefined) return null
      if (typeof content === 'string') return content
      if (state.inlineBinaryAssets) {
        return `export default ${JSON.stringify(binaryAssetDataURL(rel, content))}\n`
      }
      // Imported VFS binaries cannot fall through to Vite's disk asset plugin
      // because no source file exists on disk. Emit a tiny URL module; the
      // middleware serves that stable path in dev and generateBundle writes the
      // byte-identical asset at the same path for static builds.
      return `export default import.meta.env.BASE_URL + ${JSON.stringify(
        `assets/${binaryOutputRelativePath(rel)}`
      )}\n`
    },

    generateBundle(_options, bundle) {
      const assets = binaryBuildAssets(state.files)
      if (assets.length === 0) return

      if (!state.inlineBinaryAssets) {
        for (const asset of assets) {
          this.emitFile({
            type: 'asset',
            fileName: asset.outputPath,
            source: asset.bytes
          })
        }
      }

      for (const output of Object.values(bundle)) {
        if (output.type !== 'asset' || !output.fileName.endsWith('.css')) continue
        let source: string | null = null
        if (typeof output.source === 'string') {
          source = output.source
        } else if (output.source instanceof Uint8Array) {
          source = new TextDecoder().decode(output.source)
        }
        if (source === null) continue
        let css = source
        for (const asset of assets) {
          if (state.inlineBinaryCSSAssets) {
            const runtimeURL = binaryAssetDataURL(asset.outputPath, asset.bytes)
            const authoredURL = `./assets/${posix.basename(asset.outputPath)}`
            css = css.replaceAll(asset.sourceUrl, runtimeURL)
            css = css.replaceAll(authoredURL, runtimeURL)
            css = css.replaceAll(authoredURL.replaceAll('/', '\\/'), runtimeURL)
            continue
          }
          const relative = posix.relative(posix.dirname(output.fileName), asset.outputPath)
          const runtimeURL = relative.startsWith('.') ? relative : `./${relative}`
          css = css.replaceAll(asset.sourceUrl, runtimeURL)
        }
        output.source = css
      }
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

function binaryAssetDataURL(path: string, bytes: Uint8Array): string {
  return `data:${contentTypeForPath(path)};base64,${Buffer.from(bytes).toString('base64')}`
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

export function contentTypeForPath(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.woff2')) return 'font/woff2'
  if (lower.endsWith('.woff')) return 'font/woff'
  if (lower.endsWith('.ttf')) return 'font/ttf'
  if (lower.endsWith('.otf')) return 'font/otf'
  return 'application/octet-stream'
}
