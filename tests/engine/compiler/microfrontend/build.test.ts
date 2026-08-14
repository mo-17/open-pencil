import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  assertExactMicrofrontendRuntimeAssets,
  buildCompositionShell,
  buildMicrofrontendProject,
  createCompositionShellProject,
  microfrontendSha256Base64URL,
  parseCompositionShellBase,
  parseOpenPencilMicrofrontendRuntimeManifestJSON,
  type OpenPencilMicrofrontendCompositionManifestV1
} from '@open-pencil/compiler/microfrontend'
import type { PreviewFiles } from '@open-pencil/compiler/vfs'

const reactFiles: PreviewFiles = new Map([
  [
    'src/microfrontend.tsx',
    `import { createRoot, type Root } from 'react-dom/client'
import './index.css'
import image from './assets/logo.png'

let root: Root | undefined
export async function bootstrap(): Promise<void> {}
export async function mount(container: HTMLElement, context: { appId: string }): Promise<void> {
  root = createRoot(container)
  root.render(<main className="card"><img src={image} />{context.appId}</main>)
}
export async function update(): Promise<void> {}
export async function unmount(): Promise<void> {
  root?.unmount()
  root = undefined
}
`
  ],
  [
    'src/index.css',
    '@import "tailwindcss";\n.card { color: rgb(1 2 3); background-image: url(./assets/logo.png); }\n'
  ],
  ['src/assets/logo.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])]
])

const composition: OpenPencilMicrofrontendCompositionManifestV1 = {
  format: 'openpencil-microfrontend-composition',
  schemaVersion: 1,
  abi: 'openpencil.microfrontend.v1',
  composition: { id: 'business-shell', name: 'Business Shell', version: '1.0.0' },
  slots: [{ id: 'main' }, { id: 'sidebar' }],
  apps: [
    {
      appId: 'home',
      manifest: { kind: 'local', path: './home/openpencil.microfrontend.json' },
      routeBase: '/',
      slotId: 'main'
    },
    {
      appId: 'orders',
      manifest: { kind: 'local', path: './orders/openpencil.microfrontend.json' },
      routeBase: '/orders',
      slotId: 'main'
    },
    {
      appId: 'navigation',
      manifest: { kind: 'local', path: './navigation/openpencil.microfrontend.json' },
      routeBase: '/',
      slotId: 'sidebar'
    }
  ]
}

function writeLocalRuntime(
  sourceDir: string,
  appId: string,
  path: string,
  javascript: string
): void {
  const appDirectory = join(sourceDir, path)
  const entry = new TextEncoder().encode(javascript)
  const css = new TextEncoder().encode(`.${appId} { display: block; }\n`)
  mkdirSync(join(appDirectory, 'assets'), { recursive: true })
  writeFileSync(join(appDirectory, 'assets/app.js'), entry)
  writeFileSync(join(appDirectory, 'assets/app.css'), css)
  writeFileSync(
    join(appDirectory, 'openpencil.microfrontend.json'),
    JSON.stringify({
      format: 'openpencil-microfrontend',
      schemaVersion: 1,
      abi: 'openpencil.microfrontend.v1',
      app: { id: appId, name: appId, version: '1.0.0', framework: 'react' },
      artifact: {
        entry: {
          path: './assets/app.js',
          mediaType: 'text/javascript',
          byteLength: entry.byteLength,
          digest: microfrontendSha256Base64URL(entry)
        },
        styles: [
          {
            path: './assets/app.css',
            mediaType: 'text/css',
            byteLength: css.byteLength,
            digest: microfrontendSha256Base64URL(css)
          }
        ]
      },
      routes: ['/']
    })
  )
}

const temporaryDirectories: string[] = []

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

afterAll(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('microfrontend build and composition shell', () => {
  test('builds one pinned ESM entry plus CSS without unpinned binary sidecars', async () => {
    const outDir = temporaryDirectory('op-mfe-build-')
    const result = await buildMicrofrontendProject({
      output: {
        files: reactFiles,
        warnings: [],
        microfrontend: {
          app: { id: 'orders', name: 'Orders', version: '1.2.3', framework: 'react' },
          routes: ['/orders/*']
        }
      },
      outDir
    })

    expect(result.files).toContain('assets/openpencil-microfrontend.js')
    expect(result.files).toContain('assets/openpencil-microfrontend.css')
    expect(result.files).toContain('openpencil.microfrontend.json')
    expect(result.files.some((path) => path.endsWith('.png'))).toBe(false)

    const manifestText = readFileSync(join(outDir, result.manifestPath), 'utf8')
    const manifestBytes = new Uint8Array(readFileSync(join(outDir, result.manifestPath)))
    expect(result.manifestByteLength).toBe(manifestBytes.byteLength)
    expect(result.manifestDigest).toBe(microfrontendSha256Base64URL(manifestBytes))
    const manifest = parseOpenPencilMicrofrontendRuntimeManifestJSON(manifestText)
    expect(manifest.app).toEqual({
      id: 'orders',
      name: 'Orders',
      version: '1.2.3',
      framework: 'react'
    })
    expect(manifest.routes).toEqual(['/orders/*'])
    for (const asset of [manifest.artifact.entry, ...manifest.artifact.styles]) {
      const bytes = new Uint8Array(readFileSync(join(outDir, asset.path.replace(/^\.\//, ''))))
      expect(bytes.byteLength).toBe(asset.byteLength)
      expect(microfrontendSha256Base64URL(bytes)).toBe(asset.digest)
    }
    expect(
      readFileSync(join(outDir, manifest.artifact.entry.path.replace(/^\.\//, '')), 'utf8')
    ).toContain('data:image/png;base64,')
    const style = manifest.artifact.styles[0]
    if (!style) throw new Error('Expected the fixture to emit one CSS asset')
    expect(readFileSync(join(outDir, style.path.replace(/^\.\//, '')), 'utf8')).toContain(
      'data:image/png;base64,'
    )
  }, 30_000)

  test('requires the explicit target-specific lifecycle entry before writing output', async () => {
    const outDir = temporaryDirectory('op-mfe-missing-entry-')
    await expect(
      buildMicrofrontendProject({
        output: {
          files: new Map([['index.html', '<!doctype html>']]),
          warnings: [],
          microfrontend: {
            app: { id: 'missing', name: 'Missing', version: '1.0.0', framework: 'react' },
            routes: ['/']
          }
        },
        outDir
      })
    ).rejects.toThrow('src/microfrontend.tsx')
  })

  test('rejects standalone compiler output before writing output', async () => {
    const outDir = join(temporaryDirectory('op-mfe-standalone-parent-'), 'build')
    await expect(
      buildMicrofrontendProject({
        output: { files: reactFiles, warnings: [] },
        outDir
      })
    ).rejects.toThrow('Compiler output is not packaged as a microfrontend')
    expect(await Bun.file(join(outDir, 'openpencil.microfrontend.json')).exists()).toBe(false)
  })

  test('rejects any Vite browser sidecar not pinned by the runtime manifest', () => {
    const outDir = temporaryDirectory('op-mfe-sidecar-')
    mkdirSync(join(outDir, 'assets'), { recursive: true })
    writeFileSync(join(outDir, 'assets/openpencil-microfrontend.js'), 'export {}')
    writeFileSync(join(outDir, 'assets/unpinned-worker.js'), 'self.close()')
    expect(() => assertExactMicrofrontendRuntimeAssets(outDir)).toThrow(
      'unpinned browser sidecar: assets/unpinned-worker.js'
    )
  })

  test('generates a longest-prefix route shell with recoverable history instrumentation', () => {
    const files = createCompositionShellProject(composition)
    const html = String(files.get('index.html'))
    const css = String(files.get('src/index.css'))
    const runtime = String(files.get('src/main.ts'))
    expect(html).toContain('data-openpencil-slot="main"')
    expect(html).toContain('data-openpencil-slot="sidebar"')
    expect(runtime).toContain('right.routeBase.length - left.routeBase.length')
    expect(runtime).toContain('history.pushState = patchedPush')
    expect(runtime).toContain('history.pushState = current.originalPush')
    expect(runtime).toContain("window.addEventListener('popstate', notify)")
    expect(runtime).toContain('\'../\' + "openpencil.composition.json"')
    expect(runtime).toContain('import.meta.url')
    expect(runtime).toContain('function compositionPathname(): string')
    expect(runtime).toContain('basePath: deployedRouteBase(app.routeBase)')
    expect(runtime).toContain('routeMatches(compositionPathname(), app.routeBase)')
    expect(runtime).toContain('const MANIFEST_TIMEOUT_MS = 15_000')
    expect(runtime).toContain('const ASSET_TIMEOUT_MS = 60_000')
    expect(runtime).toContain('Runtime manifest aggregate assets exceed the application limit')
    expect(runtime).not.toContain('Promise.all(\n      manifest.artifact.styles')
    expect(runtime).toContain('signal: controller.signal')
    expect(runtime).toContain('window.clearTimeout(timeout)')
    expect(runtime).toContain("container.attachShadow({ mode: 'open' })")
    expect(runtime).toContain(
      'await runtime.module.mount(mountRoot, contextFor(app, portalTarget))'
    )
    expect(runtime).toContain('shadowRoot.append(mountRoot, portalTarget)')
    expect(runtime).not.toContain('document.head.append(style)')
    expect(runtime).toContain("const exports = ['bootstrap', 'mount', 'update', 'unmount']")
    expect(css).toContain('contain: layout paint')
    expect(css).toContain('overflow: clip')
  })

  test('accepts only canonical root paths as the composition shell base', async () => {
    expect(parseCompositionShellBase()).toBe('/')
    expect(parseCompositionShellBase('/suite/')).toBe('/suite/')
    for (const value of [
      'suite/',
      '/suite',
      '//suite/',
      '/suite//nested/',
      '/suite/../root/',
      '/suite/%2e/',
      'https://cdn.acme.dev/suite/',
      '/suite/?theme=dark',
      '/suite/#preview'
    ]) {
      expect(() => parseCompositionShellBase(value), value).toThrow()
    }

    const outDir = join(temporaryDirectory('op-mfe-invalid-base-parent-'), 'shell')
    await expect(
      buildCompositionShell({ composition, outDir, base: 'https://cdn.acme.dev/suite/' })
    ).rejects.toThrow('Composition shell base must be a canonical root path ending in /')
    expect(await Bun.file(join(outDir, 'index.html')).exists()).toBe(false)
  })

  test('builds a static shell and preserves its validated composition manifest', async () => {
    const outDir = temporaryDirectory('op-mfe-shell-')
    const sourceDir = temporaryDirectory('op-mfe-shell-source-')
    writeLocalRuntime(sourceDir, 'home', 'home', 'export const home = true')
    writeLocalRuntime(sourceDir, 'orders', 'orders', 'export const orders = true')
    writeLocalRuntime(sourceDir, 'navigation', 'navigation', 'export const navigation = true')
    const result = await buildCompositionShell({
      composition,
      outDir,
      base: '/suite/',
      sourceDir
    })
    expect(result.files).toContain('index.html')
    expect(result.files).toContain('openpencil.composition.json')
    expect(result.files.some((path) => path.startsWith('assets/') && path.endsWith('.js'))).toBe(
      true
    )
    expect(readFileSync(join(outDir, 'index.html'), 'utf8')).toContain('/suite/assets/')
    expect(readFileSync(join(outDir, 'orders/assets/app.js'), 'utf8')).toContain('orders')
    expect(JSON.parse(readFileSync(join(outDir, result.compositionPath), 'utf8'))).toEqual(
      composition
    )
  }, 30_000)

  test('verifies all local assets before touching the shell output', async () => {
    const outDir = join(temporaryDirectory('op-mfe-atomic-parent-'), 'shell')
    const sourceDir = temporaryDirectory('op-mfe-corrupt-source-')
    writeLocalRuntime(sourceDir, 'home', 'home', 'export const home = true')
    writeLocalRuntime(sourceDir, 'orders', 'orders', 'export const orders = true')
    writeLocalRuntime(sourceDir, 'navigation', 'navigation', 'export const navigation = true')
    writeFileSync(join(sourceDir, 'orders/assets/app.js'), 'tampered')
    await expect(buildCompositionShell({ composition, outDir, sourceDir })).rejects.toThrow(
      'byte length does not match'
    )
    expect(await Bun.file(join(outDir, 'index.html')).exists()).toBe(false)
  })

  test('rejects local artifacts that traverse a symbolic link before building', async () => {
    const outDir = join(temporaryDirectory('op-mfe-symlink-parent-'), 'shell')
    const sourceDir = temporaryDirectory('op-mfe-symlink-source-')
    writeLocalRuntime(sourceDir, 'home', 'home', 'export const home = true')
    writeLocalRuntime(sourceDir, 'orders', 'orders', 'export const orders = true')
    writeLocalRuntime(sourceDir, 'navigation', 'navigation', 'export const navigation = true')
    const entryPath = join(sourceDir, 'orders/assets/app.js')
    rmSync(entryPath)
    symlinkSync('../../home/assets/app.js', entryPath)

    await expect(buildCompositionShell({ composition, outDir, sourceDir })).rejects.toThrow(
      'must not traverse a symbolic link'
    )
    expect(await Bun.file(join(outDir, 'index.html')).exists()).toBe(false)
  })

  test('rewrites local root-relative assets to manifest-relative copies for subpath hosting', async () => {
    const outDir = temporaryDirectory('op-mfe-root-asset-shell-')
    const sourceDir = temporaryDirectory('op-mfe-root-asset-source-')
    writeLocalRuntime(sourceDir, 'home', 'home', 'export const home = true')
    writeLocalRuntime(sourceDir, 'orders', 'orders', 'export const orders = true')
    writeLocalRuntime(sourceDir, 'navigation', 'navigation', 'export const navigation = true')
    const runtimeManifestPath = join(sourceDir, 'orders/openpencil.microfrontend.json')
    const runtimeManifest = JSON.parse(readFileSync(runtimeManifestPath, 'utf8'))
    mkdirSync(join(sourceDir, 'shared'), { recursive: true })
    const entry = new TextEncoder().encode('export const rootRelative = true')
    writeFileSync(join(sourceDir, 'shared/orders.js'), entry)
    runtimeManifest.artifact.entry = {
      path: '/shared/orders.js',
      mediaType: 'text/javascript',
      byteLength: entry.byteLength,
      digest: microfrontendSha256Base64URL(entry)
    }
    writeFileSync(runtimeManifestPath, JSON.stringify(runtimeManifest))

    await buildCompositionShell({ composition, outDir, base: '/suite/', sourceDir })

    const copiedManifest = parseOpenPencilMicrofrontendRuntimeManifestJSON(
      readFileSync(join(outDir, 'orders/openpencil.microfrontend.json'), 'utf8')
    )
    expect(copiedManifest.artifact.entry.path).toBe('./.openpencil-root/shared/orders.js')
    expect(readFileSync(join(outDir, 'orders/.openpencil-root/shared/orders.js'), 'utf8')).toBe(
      'export const rootRelative = true'
    )
  }, 30_000)

  test('rejects local artifacts that collide with shell-owned output paths before building', async () => {
    const outDir = join(temporaryDirectory('op-mfe-collision-parent-'), 'shell')
    const sourceDir = temporaryDirectory('op-mfe-collision-source-')
    writeLocalRuntime(sourceDir, 'home', 'home', 'export const home = true')
    writeLocalRuntime(sourceDir, 'orders', 'orders', 'export const orders = true')
    writeLocalRuntime(sourceDir, 'navigation', 'navigation', 'export const navigation = true')
    const collidingComposition = structuredClone(composition)
    const home = collidingComposition.apps.find((app) => app.appId === 'home')
    if (!home) throw new Error('Expected the fixture to contain the home application')
    home.manifest = { kind: 'local', path: './index.html' }
    mkdirSync(join(sourceDir, 'assets'), { recursive: true })
    writeFileSync(
      join(sourceDir, 'assets/app.js'),
      readFileSync(join(sourceDir, 'home/assets/app.js'))
    )
    writeFileSync(
      join(sourceDir, 'assets/app.css'),
      readFileSync(join(sourceDir, 'home/assets/app.css'))
    )
    writeFileSync(
      join(sourceDir, 'index.html'),
      readFileSync(join(sourceDir, 'home/openpencil.microfrontend.json'))
    )

    await expect(
      buildCompositionShell({ composition: collidingComposition, outDir, sourceDir })
    ).rejects.toThrow('collides with a composition shell output at assets/app.js')
    expect(await Bun.file(join(outDir, 'index.html')).exists()).toBe(false)
  })
})
