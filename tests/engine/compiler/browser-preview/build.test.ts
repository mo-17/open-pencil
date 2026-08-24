import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

import { buildBrowserPreviewHTML } from '#compiler/browser-preview/html'

import { BROWSER_PREVIEW_LIMITS, buildBrowserPreview } from '@open-pencil/compiler/browser-preview'

import { browserPreviewInput, compileBrowserPreviewFixture } from './helpers'

function writeUint16BE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 8) & 0xff
  bytes[offset + 1] = value & 0xff
}

function writeUint32BE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff
  bytes[offset + 1] = (value >>> 16) & 0xff
  bytes[offset + 2] = (value >>> 8) & 0xff
  bytes[offset + 3] = value & 0xff
}

function oversizedWoff2Header(): Uint8Array {
  const bytes = new Uint8Array(49)
  bytes.set(new TextEncoder().encode('wOF2'))
  writeUint32BE(bytes, 8, bytes.byteLength)
  writeUint16BE(bytes, 12, 1)
  writeUint32BE(bytes, 16, BROWSER_PREVIEW_LIMITS.maxExpandedFontBytes + 1)
  writeUint32BE(bytes, 20, 1)
  return bytes
}

function oversizedWoffTable(): Uint8Array {
  const bytes = new Uint8Array(64)
  bytes.set(new TextEncoder().encode('wOFF'))
  writeUint32BE(bytes, 8, bytes.byteLength)
  writeUint16BE(bytes, 12, 1)
  writeUint32BE(bytes, 16, 64)
  writeUint32BE(bytes, 44 + 4, bytes.byteLength)
  writeUint32BE(bytes, 44 + 12, BROWSER_PREVIEW_LIMITS.maxExpandedFontBytes + 1)
  return bytes
}

function compressedWoffWithOriginalLength(originalLength: number): Uint8Array {
  const bytes = new Uint8Array(65)
  bytes.set(new TextEncoder().encode('wOFF'))
  writeUint32BE(bytes, 8, bytes.byteLength)
  writeUint16BE(bytes, 12, 1)
  writeUint32BE(bytes, 16, 28 + Math.ceil(originalLength / 4) * 4)
  writeUint32BE(bytes, 44 + 4, 64)
  writeUint32BE(bytes, 44 + 8, 1)
  writeUint32BE(bytes, 44 + 12, originalLength)
  return bytes
}

describe('compiler browser preview bundler', () => {
  test('turns a real React compiler output into a bounded CSP sandbox document', async () => {
    const files = compileBrowserPreviewFixture()
    const input = await browserPreviewInput(files)
    const stages: string[] = []
    input.onStage = (stage) => stages.push(stage)
    const result = await buildBrowserPreview(input)

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.html).toContain("default-src 'none'")
    expect(result.html).toContain("connect-src 'none'")
    expect(result.html).toContain("script-src 'unsafe-inline' https://esm.sh")
    expect(result.html).toContain('https://esm.sh/react@19.2.0')
    expect(result.html).toContain('browser_preview_test_channel_0001')
    expect(result.html).toContain("window.addEventListener('pagehide', __opClearFrameBootContext")
    expect(result.html).toContain("window.addEventListener('load', () => {")
    expect(result.html).toContain("__opParentOrigin?.transport === 'message-port'")
    expect(result.html).toContain("__opPostWindow('ready', {}, [__opMessageChannel.port2])")
    expect(result.html).toContain('__opPortTransferred = true')
    expect(result.html).toContain("__opPost('runtimeError'")
    expect(result.html).toContain("window.name = ''")
    expect(result.html).toContain('__opRuntimeComplete = true\n__opClearFrameBootContext()')
    expect(result.html).not.toContain('esbuild.wasm')
    expect(result.metrics.fileCount).toBe(files.size)
    expect(result.metrics.dependencyCount).toBe(2)
    expect(result.metrics.outputBytes).toBeGreaterThan(0)
    expect(stages).toEqual([
      'bundle-validate',
      'bundle-load',
      'bundle-initialize',
      'bundle-javascript',
      'bundle-css',
      'bundle-html'
    ])
    expect(
      result.diagnostics.some((item) => item.code === 'browser-preview-pinned-dependency')
    ).toBe(false)
    expect(() => structuredClone(result)).not.toThrow()
  })

  test('returns an explicit unsupported result for Vue', async () => {
    const files = compileBrowserPreviewFixture()
    const result = await buildBrowserPreview(await browserPreviewInput(files, { target: 'vue' }))
    expect(result.status).toBe('unsupported')
    if (result.status !== 'unsupported') return
    expect(result.reason.code).toBe('browser-preview-vue-unsupported')
  })

  test('rejects dynamic imports before esbuild can preserve a runtime address', async () => {
    const files = compileBrowserPreviewFixture()
    const app = files.get('src/App.tsx')
    expect(typeof app).toBe('string')
    files.set('src/App.tsx', `${String(app)}\nvoid import('./late-module')\n`)
    const result = await buildBrowserPreview(await browserPreviewInput(files))
    expect(result.status).toBe('error')
    expect(result.diagnostics[0]?.code).toBe('browser-preview-dynamic-import-unsupported')
  })

  test('rejects secrets and local filesystem paths before bundling', async () => {
    const secretFiles = compileBrowserPreviewFixture()
    secretFiles.set(
      'src/leak.ts',
      "export const apiKey = 'sk-proj-1234567890abcdefghijklmnop'\n" // gitleaks:allow -- Deliberate fake API key for the browser-preview scanner regression.
    )
    const secret = await buildBrowserPreview(await browserPreviewInput(secretFiles))
    expect(secret.status).toBe('error')
    expect(secret.diagnostics[0]?.code).toBe('browser-preview-secret-detected')

    const pathFiles = compileBrowserPreviewFixture()
    pathFiles.set('src/leak.ts', "export const path = '/Users/alice/private.pen'\n")
    const localPath = await buildBrowserPreview(await browserPreviewInput(pathFiles))
    expect(localPath.status).toBe('error')
    expect(localPath.diagnostics[0]?.code).toBe('browser-preview-local-path-detected')
  })

  test('enforces file, dependency, channel, and map runtime policy with stable diagnostics', async () => {
    const oversized = compileBrowserPreviewFixture()
    oversized.set('src/oversized.ts', 'x'.repeat(BROWSER_PREVIEW_LIMITS.maxTextFileBytes + 1))
    const sizeResult = await buildBrowserPreview(await browserPreviewInput(oversized))
    expect(sizeResult.status).toBe('error')
    expect(sizeResult.diagnostics[0]?.code).toBe('browser-preview-file-size-limit')

    const dependencyFiles = compileBrowserPreviewFixture()
    const packageJSON = JSON.parse(String(dependencyFiles.get('package.json'))) as {
      dependencies: Record<string, string>
    }
    packageJSON.dependencies['unreviewed-package'] = '1.0.0'
    dependencyFiles.set('package.json', `${JSON.stringify(packageJSON)}\n`)
    const dependency = await buildBrowserPreview(await browserPreviewInput(dependencyFiles))
    expect(dependency.status).toBe('error')
    expect(dependency.diagnostics[0]?.code).toBe('browser-preview-dependency-unsupported')

    const invalidChannelInput = await browserPreviewInput(compileBrowserPreviewFixture())
    invalidChannelInput.channel = 'short'
    const channel = await buildBrowserPreview(invalidChannelInput)
    expect(channel.status).toBe('error')
    expect(channel.diagnostics[0]?.code).toBe('browser-preview-channel-invalid')

    const invalidTargetInput = await browserPreviewInput(compileBrowserPreviewFixture())
    Object.defineProperty(invalidTargetInput, 'target', { value: 'svelte' })
    const target = await buildBrowserPreview(invalidTargetInput)
    expect(target.status).toBe('error')
    expect(target.diagnostics[0]?.code).toBe('browser-preview-target-invalid')

    const mapFiles = compileBrowserPreviewFixture()
    const mapPackageJSON = JSON.parse(String(mapFiles.get('package.json'))) as {
      dependencies: Record<string, string>
    }
    mapPackageJSON.dependencies['maplibre-gl'] = '6.0.0'
    mapFiles.set('package.json', `${JSON.stringify(mapPackageJSON)}\n`)
    mapFiles.set('src/map.ts', "import maplibre from 'maplibre-gl'\nexport default maplibre\n")
    const main = String(mapFiles.get('src/main.tsx'))
    mapFiles.set('src/main.tsx', `import './map'\n${main}`)
    const map = await buildBrowserPreview(await browserPreviewInput(mapFiles))
    expect(map.status).toBe('error')
    expect(map.diagnostics[0]?.code).toBe('browser-preview-map-runtime-unsupported')
  })

  test('embeds the reviewed 10.5 MiB Noto Sans SC font without relaxing other binary limits', async () => {
    const files = compileBrowserPreviewFixture('Noto Sans SC browser preview')
    const fontPath = 'src/assets/fonts/noto-sans-sc-400-normal.ttf'
    const font = await readFile(
      new URL('../../../../packages/core/assets/NotoSansSC-Regular.ttf', import.meta.url)
    )
    expect(font.byteLength).toBeGreaterThan(BROWSER_PREVIEW_LIMITS.maxBinaryFileBytes)
    expect(font.byteLength).toBeLessThanOrEqual(BROWSER_PREVIEW_LIMITS.maxFontFileBytes)
    files.set(fontPath, font)
    files.set(
      'src/index.css',
      `${String(files.get('src/index.css'))}\n@font-face{font-family:"Noto Sans SC";src:url("./assets/fonts/noto-sans-sc-400-normal.ttf") format("truetype");font-weight:400;font-style:normal}\n`
    )

    const result = await buildBrowserPreview(await browserPreviewInput(files))
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.html).toContain('data:font/ttf;base64,')
    expect(result.metrics.outputBytes).toBeGreaterThan(BROWSER_PREVIEW_LIMITS.maxHTMLBytes)
    expect(result.metrics.outputBytes).toBeLessThanOrEqual(
      BROWSER_PREVIEW_LIMITS.maxAssetExpandedHTMLBytes
    )

    const nonFont = compileBrowserPreviewFixture()
    nonFont.set(
      'src/assets/not-a-font.bin',
      new Uint8Array(BROWSER_PREVIEW_LIMITS.maxBinaryFileBytes + 1)
    )
    const nonFontResult = await buildBrowserPreview(await browserPreviewInput(nonFont))
    expect(nonFontResult.status).toBe('error')
    expect(nonFontResult.diagnostics[0]?.code).toBe('browser-preview-file-size-limit')

    const encoded = compileBrowserPreviewFixture()
    for (let index = 0; index < 3; index++) {
      encoded.set(`src/assets/fonts/noto-sans-sc-${index}.ttf`, font)
    }
    const encodedResult = await buildBrowserPreview(await browserPreviewInput(encoded))
    expect(encodedResult.status).toBe('error')
    expect(encodedResult.diagnostics[0]?.code).toBe('browser-preview-asset-output-limit')
  })

  test('budgets reviewed CSS image data separately from plain stylesheet output', async () => {
    const files = compileBrowserPreviewFixture()
    const image = await readFile(
      new URL('../../../../packages/demos/videos/toolbar.png', import.meta.url)
    )
    const imagePath = 'src/assets/toolbar.png'
    files.set(imagePath, image)
    const encodedImageBytes = `data:image/png;base64,`.length + 4 * Math.ceil(image.byteLength / 3)
    const occurrences = Math.ceil(BROWSER_PREVIEW_LIMITS.maxHTMLBytes / encodedImageBytes) + 1
    const imageRules = Array.from(
      { length: occurrences },
      (_, index) => `.reviewed-image-${index}{background-image:url("./assets/toolbar.png")}`
    ).join('\n')
    files.set('src/index.css', `${String(files.get('src/index.css'))}\n${imageRules}\n`)

    const result = await buildBrowserPreview(await browserPreviewInput(files))
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.metrics.outputBytes).toBeGreaterThan(BROWSER_PREVIEW_LIMITS.maxHTMLBytes)
    expect(result.metrics.outputBytes).toBeLessThanOrEqual(
      BROWSER_PREVIEW_LIMITS.maxAssetExpandedHTMLBytes
    )
    expect(result.html.match(/data:image\/png;base64,/g)?.length).toBe(occurrences)

    const plain = await browserPreviewInput(compileBrowserPreviewFixture())
    plain.tailwindCompile = async () => ({
      build: () => '.oversized-plain-css{color:red}'.repeat(80_000)
    })
    const plainResult = await buildBrowserPreview(plain)
    expect(plainResult.status).toBe('error')
    expect(plainResult.diagnostics[0]?.code).toBe('browser-preview-css-output-limit')

    const unreviewed = compileBrowserPreviewFixture()
    unreviewed.set(
      'src/index.css',
      `${String(unreviewed.get('src/index.css'))}\n.unreviewed{background:url("data:image/png;base64,AAAA")}`
    )
    const unreviewedResult = await buildBrowserPreview(await browserPreviewInput(unreviewed))
    expect(unreviewedResult.status).toBe('error')
    expect(unreviewedResult.diagnostics[0]?.code).toBe('browser-preview-css-url-unsafe')
  })

  test('keeps the absolute sandbox document limit after reviewed asset accounting', () => {
    expect(() =>
      buildBrowserPreviewHTML({
        channel: 'browser_preview_absolute_limit_test',
        javascript: '',
        css: 'a'.repeat(BROWSER_PREVIEW_LIMITS.maxAssetExpandedHTMLBytes),
        imports: {},
        reviewedDataURLBytes: BROWSER_PREVIEW_LIMITS.maxAssetExpandedHTMLBytes
      })
    ).toThrow('Browser preview sandbox document exceeds the output byte limit.')
  })

  test('returns dedicated font size and count diagnostics', async () => {
    const oversized = compileBrowserPreviewFixture()
    oversized.set(
      'src/assets/fonts/oversized.ttf',
      new Uint8Array(BROWSER_PREVIEW_LIMITS.maxFontFileBytes + 1)
    )
    const sizeResult = await buildBrowserPreview(await browserPreviewInput(oversized))
    expect(sizeResult.status).toBe('error')
    expect(sizeResult.diagnostics[0]).toMatchObject({
      code: 'browser-preview-font-size-limit',
      path: 'src/assets/fonts/oversized.ttf'
    })

    const tooMany = compileBrowserPreviewFixture()
    const inter = await readFile(
      new URL('../../../../packages/core/assets/Inter-Regular.ttf', import.meta.url)
    )
    for (let index = 0; index <= BROWSER_PREVIEW_LIMITS.maxFontAssets; index++) {
      tooMany.set(`src/assets/fonts/inter-${index}.ttf`, inter)
    }
    const countResult = await buildBrowserPreview(await browserPreviewInput(tooMany))
    expect(countResult.status).toBe('error')
    expect(countResult.diagnostics[0]?.code).toBe('browser-preview-font-count-limit')
  })

  test('rejects WOFF fonts whose declared expansion exceeds the reviewed limit', async () => {
    for (const [path, font] of [
      ['src/assets/fonts/expanded.woff2', oversizedWoff2Header()],
      ['src/assets/fonts/expanded-table.woff', oversizedWoffTable()]
    ] as const) {
      const files = compileBrowserPreviewFixture()
      files.set(path, font)
      const result = await buildBrowserPreview(await browserPreviewInput(files))
      expect(result.status).toBe('error')
      expect(result.diagnostics[0]).toMatchObject({
        code: 'browser-preview-font-invalid',
        path
      })
    }

    const aggregate = compileBrowserPreviewFixture()
    const originalLength = 40 * 1024 * 1024
    aggregate.set(
      'src/assets/fonts/expanded-aggregate-a.woff',
      compressedWoffWithOriginalLength(originalLength)
    )
    aggregate.set(
      'src/assets/fonts/expanded-aggregate-b.woff',
      compressedWoffWithOriginalLength(originalLength)
    )
    const aggregateResult = await buildBrowserPreview(await browserPreviewInput(aggregate))
    expect(aggregateResult.status).toBe('error')
    expect(aggregateResult.diagnostics[0]).toMatchObject({
      code: 'browser-preview-font-expanded-limit',
      path: 'src/assets/fonts/expanded-aggregate-b.woff'
    })
  })

  test('accepts only same-origin absolute HTTP WASM URLs in a development Worker', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'location')
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: new URL('http://localhost:4173/assets/preview-worker.js')
    })
    try {
      const sameOrigin = await browserPreviewInput(compileBrowserPreviewFixture())
      sameOrigin.wasmURL = 'http://localhost:4173/assets/esbuild.wasm'
      expect((await buildBrowserPreview(sameOrigin)).status).toBe('ready')

      const crossOrigin = await browserPreviewInput(compileBrowserPreviewFixture())
      crossOrigin.wasmURL = 'http://127.0.0.1:4173/assets/esbuild.wasm'
      const result = await buildBrowserPreview(crossOrigin)
      expect(result.status).toBe('error')
      expect(result.diagnostics[0]?.code).toBe('browser-preview-wasm-origin-invalid')

      const backslashAuthority = await browserPreviewInput(compileBrowserPreviewFixture())
      backslashAuthority.wasmURL = '/\\evil.example/esbuild.wasm'
      const backslashResult = await buildBrowserPreview(backslashAuthority)
      expect(backslashResult.status).toBe('error')
      expect(backslashResult.diagnostics[0]?.code).toBe('browser-preview-wasm-url-invalid')
    } finally {
      if (previous) Object.defineProperty(globalThis, 'location', previous)
      else Reflect.deleteProperty(globalThis, 'location')
    }
  })
})
