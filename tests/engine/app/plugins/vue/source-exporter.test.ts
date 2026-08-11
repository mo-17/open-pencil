import { describe, expect, test } from 'bun:test'

import { unzipSync } from 'fflate'

import { compile, withDefaults } from '@open-pencil/compiler'
import { fontManager } from '@open-pencil/core/text'
import { SceneGraph } from '@open-pencil/scene-graph'

import { archiveProjectFiles } from '@/app/plugins/host/project-archive'
import {
  createVueSourceCompiler,
  type VueSourceCompilerWorkerLike
} from '@/app/plugins/host/vue/compiler/client'
import {
  VUE_SOURCE_COMPILER_WORKER_LIMITS,
  assertVueCompilerOutputWithinLimits,
  createVueSourceCompilerWorkerRequest,
  parseVueSourceCompilerWorkerResponse,
  type VueSourceCompilerWorkerRequest
} from '@/app/plugins/host/vue/compiler/protocol'
import {
  applyVueRedistributionFontPolicy,
  exportCurrentDocumentAsVueSource,
  resolveVueSourceFontManifestWithoutNetwork,
  type VueSourceExportEditor,
  type VueSourceExporterDependencies
} from '@/app/plugins/host/vue/source-exporter'

const IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1, 2, 3, 4])

class FakeWorker implements VueSourceCompilerWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false

  constructor(
    private readonly respond: (
      request: VueSourceCompilerWorkerRequest,
      worker: FakeWorker
    ) => void = () => undefined
  ) {}

  postMessage(message: unknown): void {
    this.respond(message as VueSourceCompilerWorkerRequest, this)
  }

  terminate(): void {
    this.terminated = true
  }
}

function editor(documentName = 'Vue Product', pages = 1): VueSourceExportEditor {
  const graph = new SceneGraph()
  for (let index = 1; index < pages; index += 1) graph.addPage(`Page ${index + 1}`)
  return { graph, state: { documentName } }
}

function compiledFixture(extraFiles: ReadonlyMap<string, string | Uint8Array> = new Map()) {
  return new Map<string, string | Uint8Array>([
    [
      'package.json',
      '{"name":"vue-product","private":true,"scripts":{"dev":"vite","build":"vue-tsc -b && vite build"},"dependencies":{"vue":"^3.5.0"}}\n'
    ],
    ['index.html', '<div id="app"></div>\n'],
    ['src/App.vue', '<template><main>Vue product</main></template>\n'],
    [
      'src/main.ts',
      "import { createApp } from 'vue'\nimport App from './App.vue'\ncreateApp(App).mount('#app')\n"
    ],
    ['src/index.css', '@import "tailwindcss";\n'],
    ['src/assets/hero.png', IMAGE],
    ['vite.config.ts', "import { defineConfig } from 'vite'\nexport default defineConfig({})\n"],
    ['tsconfig.json', '{}\n'],
    ...extraFiles
  ])
}

function dependencies(capture: {
  bytes?: Uint8Array
  target?: string
  router?: string
  fontCount?: number
}): VueSourceExporterDependencies {
  return {
    async chooseDestination() {
      return {
        async write(data) {
          capture.bytes = data
        }
      }
    },
    async resolveFontManifest() {
      return {
        faces: [
          {
            family: 'Review Sans',
            weight: 400,
            style: 'normal',
            format: 'woff2',
            path: 'src/assets/fonts/review.woff2',
            content: new Uint8Array([1, 2, 3])
          }
        ]
      }
    },
    compile(input) {
      capture.target = input.options.target
      capture.router = input.options.router
      capture.fontCount = input.fontManifest?.faces.length
      return {
        files: compiledFixture(),
        warnings: [
          {
            code: 'vue-review-required',
            message: 'Review behavior that is outside the Vue v1 subset.'
          }
        ]
      }
    },
    archive: archiveProjectFiles
  }
}

describe('Vue source project plugin exporter', () => {
  test('never starts remote font resolution and rejects an already-aborted request', async () => {
    const source = editor()
    const [page] = source.graph.getPages()
    source.graph.createNode('TEXT', page.id, {
      name: 'Remote font',
      text: 'Review me',
      fontFamily: 'Unresolved Online Sans'
    })
    const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
    let fetches = 0
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value() {
        fetches += 1
        return Promise.reject(new Error('Unexpected font fetch'))
      }
    })

    try {
      const manifest = await resolveVueSourceFontManifestWithoutNetwork(source, [page.id])
      expect(manifest.faces.some((face) => face.family === 'Unresolved Online Sans')).toBe(false)
      const controller = new AbortController()
      controller.abort()
      await expect(
        resolveVueSourceFontManifestWithoutNetwork(source, [page.id], controller.signal)
      ).rejects.toMatchObject({ name: 'AbortError' })
      expect(fetches).toBe(0)
    } finally {
      if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch)
      else Reflect.deleteProperty(globalThis, 'fetch')
    }
  })

  test('retains exact loaded bundled font bytes without fetching and emits a complete notice', async () => {
    const source = editor('Reviewed font')
    const [page] = source.graph.getPages()
    source.graph.createNode('TEXT', page.id, {
      name: 'Reviewed font',
      text: 'Local only',
      fontFamily: 'Inter',
      fontWeight: 400
    })
    const bytes = await Bun.file('packages/core/assets/Inter-Regular.ttf').arrayBuffer()
    fontManager.markLoaded('Inter', 'Regular', bytes)

    const manifest = await resolveVueSourceFontManifestWithoutNetwork(source, [page.id])
    const inter = manifest.faces.find(
      (face) => face.family === 'Inter' && face.weight === 400 && face.style === 'normal'
    )
    expect(inter?.content).toEqual(new Uint8Array(bytes))

    const policy = await applyVueRedistributionFontPolicy({
      faces: inter ? [inter] : []
    })
    expect(policy.manifest.faces).toHaveLength(1)
    expect(policy.warnings).toEqual([])
    expect(policy.additionalFiles?.get('FONT-LICENSES.txt')).toContain(
      'Copyright (c) 2016 The Inter Project Authors'
    )
    expect(policy.additionalFiles?.get('FONT-LICENSES.txt')).toContain(
      'SIL OPEN FONT LICENSE Version 1.1'
    )
  })

  test('compiles through the bounded Worker and terminates after a correlated result', async () => {
    const graph = editor().graph
    graph.images.set('hero-image', IMAGE)
    const worker = new FakeWorker((request, current) => {
      expect(request.options.target).toBe('vue')
      expect(request.graph.images[0]).toEqual(['hero-image', IMAGE])
      queueMicrotask(() =>
        current.onmessage?.({
          data: {
            version: 1,
            type: 'result',
            requestId: request.requestId,
            output: { files: compiledFixture(), warnings: [] }
          }
        } as MessageEvent)
      )
    })
    const compiler = createVueSourceCompiler({ workerFactory: () => worker })

    await expect(
      compiler.compile({
        graph,
        pageIds: graph.getPages().map(({ id }) => id),
        options: withDefaults({ target: 'vue', router: 'none' }),
        fontManifest: { faces: [] }
      })
    ).resolves.toMatchObject({ warnings: [] })
    expect(worker.terminated).toBe(true)
    expect(IMAGE.byteLength).toBe(12)
  })

  test('terminates Vue compilation on abort without detaching live image bytes', async () => {
    const graph = editor().graph
    graph.images.set('hero-image', IMAGE)
    const worker = new FakeWorker()
    const controller = new AbortController()
    const compiler = createVueSourceCompiler({ workerFactory: () => worker })
    const pending = compiler.compile(
      {
        graph,
        pageIds: graph.getPages().map(({ id }) => id),
        options: withDefaults({ target: 'vue', router: 'none' })
      },
      controller.signal
    )

    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminated).toBe(true)
    expect(graph.images.get('hero-image')).toBe(IMAGE)
    expect(IMAGE.byteLength).toBe(12)
  })

  test('fails before creating a Worker when the snapshot exceeds its input budget', async () => {
    const graph = editor().graph
    const oversizedBacking = new ArrayBuffer(VUE_SOURCE_COMPILER_WORKER_LIMITS.maxSnapshotBytes + 1)
    graph.images.set(
      'oversize',
      new Uint8Array(oversizedBacking, oversizedBacking.byteLength - 1, 1)
    )
    let workers = 0
    const compiler = createVueSourceCompiler({
      workerFactory() {
        workers += 1
        return new FakeWorker()
      }
    })

    await expect(
      compiler.compile({
        graph,
        pageIds: graph.getPages().map(({ id }) => id),
        options: withDefaults({ target: 'vue', router: 'none' })
      })
    ).rejects.toThrow(`exceeds ${VUE_SOURCE_COMPILER_WORKER_LIMITS.maxSnapshotBytes} bytes`)
    expect(workers).toBe(0)
  })

  test('rejects accessors, symbols and custom prototypes without invoking getters', () => {
    const compilerInput = (graph: SceneGraph) => ({
      graph,
      pageIds: graph.getPages().map(({ id }) => id),
      options: withDefaults({ target: 'vue' as const, router: 'none' as const })
    })
    const accessorGraph = editor().graph
    const accessorRoot = accessorGraph.getNode(accessorGraph.rootId)
    let getterReads = 0
    Object.defineProperty(accessorRoot, 'unsafeAccessor', {
      configurable: true,
      enumerable: true,
      get() {
        getterReads += 1
        return 'blocked'
      }
    })
    expect(() =>
      createVueSourceCompilerWorkerRequest(compilerInput(accessorGraph), 'accessor-request-1')
    ).toThrow('must not contain accessors')
    expect(getterReads).toBe(0)

    const nestedAccessorGraph = editor().graph
    const nestedRoot = nestedAccessorGraph.getNode(nestedAccessorGraph.rootId)
    if (!nestedRoot) throw new Error('Expected document root')
    const nested: unknown[] = []
    Object.defineProperty(nested, '0', {
      enumerable: true,
      get() {
        getterReads += 1
        return 'blocked'
      }
    })
    nestedRoot.overrides = { nested }
    expect(() =>
      createVueSourceCompilerWorkerRequest(compilerInput(nestedAccessorGraph), 'nested-accessor-1')
    ).toThrow('array must not contain accessors')
    expect(getterReads).toBe(0)

    const symbolGraph = editor().graph
    Object.defineProperty(symbolGraph.getNode(symbolGraph.rootId), Symbol('unsafe'), {
      enumerable: true,
      value: 'blocked'
    })
    expect(() =>
      createVueSourceCompilerWorkerRequest(compilerInput(symbolGraph), 'symbol-request-01')
    ).toThrow('must not contain symbol properties')

    const prototypeGraph = editor().graph
    Object.setPrototypeOf(prototypeGraph.getNode(prototypeGraph.rootId), { inherited: true })
    expect(() =>
      createVueSourceCompilerWorkerRequest(compilerInput(prototypeGraph), 'prototype-request')
    ).toThrow('must contain only plain records')
  })

  test('bounds Worker warnings and rejects oversized or malformed responses', () => {
    expect(() =>
      assertVueCompilerOutputWithinLimits({
        files: new Map([['src/App.vue', '<template />']]),
        warnings: Array.from(
          { length: VUE_SOURCE_COMPILER_WORKER_LIMITS.maxWarnings + 1 },
          (_, index) => ({ code: `warning-${index}`, message: 'review' })
        )
      })
    ).toThrow(`exceeds ${VUE_SOURCE_COMPILER_WORKER_LIMITS.maxWarnings} warnings`)
    expect(
      parseVueSourceCompilerWorkerResponse(
        {
          version: 1,
          type: 'error',
          requestId: 'response-request-1',
          error: 'x'.repeat(2_049)
        },
        'response-request-1'
      )
    ).toBeNull()
    expect(
      parseVueSourceCompilerWorkerResponse(
        { version: 1, type: 'result', requestId: 'response-request-1', output: null },
        'response-request-1'
      )
    ).toBeNull()

    const oversizedBacking = new ArrayBuffer(VUE_SOURCE_COMPILER_WORKER_LIMITS.maxOutputBytes + 1)
    expect(() =>
      assertVueCompilerOutputWithinLimits({
        files: new Map([
          [
            'src/assets/tiny-view.bin',
            new Uint8Array(oversizedBacking, oversizedBacking.byteLength - 1, 1)
          ]
        ]),
        warnings: []
      })
    ).toThrow(`exceeds ${VUE_SOURCE_COMPILER_WORKER_LIMITS.maxOutputBytes} bytes`)
  })

  test('fails closed on Worker errors without falling back to synchronous compilation', async () => {
    const graph = editor().graph
    const worker = new FakeWorker((request, current) => {
      queueMicrotask(() =>
        current.onmessage?.({
          data: {
            version: 1,
            type: 'error',
            requestId: request.requestId,
            error: 'compiler isolate failed'
          }
        } as MessageEvent)
      )
    })
    const compiler = createVueSourceCompiler({ workerFactory: () => worker })

    await expect(
      compiler.compile({
        graph,
        pageIds: graph.getPages().map(({ id }) => id),
        options: withDefaults({ target: 'vue', router: 'none' })
      })
    ).rejects.toThrow('compiler isolate failed')
    expect(worker.terminated).toBe(true)

    const malformedWorker = new FakeWorker((request, current) => {
      queueMicrotask(() =>
        current.onmessage?.({
          data: { version: 1, type: 'result', requestId: request.requestId, output: null }
        } as MessageEvent)
      )
    })
    const malformedCompiler = createVueSourceCompiler({
      workerFactory: () => malformedWorker
    })
    await expect(
      malformedCompiler.compile({
        graph,
        pageIds: graph.getPages().map(({ id }) => id),
        options: withDefaults({ target: 'vue', router: 'none' })
      })
    ).rejects.toThrow('invalid response')
    expect(malformedWorker.terminated).toBe(true)
  })

  test('runs the real Vue compiler for a multi-page project and retains image bytes', async () => {
    const source = editor('Real Vue', 2)
    const [page] = source.graph.getPages()
    source.graph.images.set('hero-image', IMAGE)
    source.graph.createNode('RECTANGLE', page.id, {
      name: 'Hero',
      width: 320,
      height: 180,
      fills: [
        {
          type: 'IMAGE',
          imageHash: 'hero-image',
          imageScaleMode: 'FILL',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })
    let bytes: Uint8Array | undefined
    const dependencies: VueSourceExporterDependencies = {
      async chooseDestination() {
        return {
          async write(data) {
            bytes = data
          }
        }
      },
      async resolveFontManifest() {
        return { faces: [] }
      },
      compile,
      archive: archiveProjectFiles
    }

    await exportCurrentDocumentAsVueSource(source, dependencies)
    if (!bytes) throw new Error('Expected real Vue project archive')
    const files = unzipSync(bytes)
    expect(files['src/App.vue']).toBeDefined()
    expect(files['src/router.ts']).toBeDefined()
    expect(files['src/pages/index.vue']).toBeDefined()
    expect(files['src/pages/page-2.vue']).toBeDefined()
    expect(files['src/assets/openpencil-image-hero-image.png']).toEqual(IMAGE)
    expect(new TextDecoder().decode(files['package.json'])).toContain('"vue-router"')
  })

  test('exports a source-only Vue archive with binary assets and reviewed warnings', async () => {
    const capture: {
      bytes?: Uint8Array
      target?: string
      router?: string
      fontCount?: number
    } = {}
    const result = await exportCurrentDocumentAsVueSource(editor(), dependencies(capture))
    if (!capture.bytes) throw new Error('Expected Vue archive bytes')

    const files = unzipSync(capture.bytes)
    expect(result).toMatchObject({ fileName: 'vue-product-vue.zip', saved: true })
    expect(capture).toMatchObject({ target: 'vue', router: 'none', fontCount: 0 })
    expect(files['src/App.vue']).toBeDefined()
    expect(files['src/assets/hero.png']).toEqual(IMAGE)
    expect(files['node_modules']).toBeUndefined()
    const warnings = new TextDecoder().decode(files['EXPORT_WARNINGS.md'])
    expect(warnings).toContain('# OpenPencil Vue export warnings')
    expect(warnings).toContain('vue-font-assets-omitted')
    expect(warnings).toContain('vue-font-license-unverified')
    expect(warnings).toContain('vue-review-required')
  })

  test('selects Vue Router v4 only for multi-page exports', async () => {
    const capture: { router?: string } = {}
    await exportCurrentDocumentAsVueSource(editor('Routes', 2), dependencies(capture))
    expect(capture.router).toBe('vue-router-v4')
  })

  test('stops before resolving fonts or compiling when the destination is cancelled', async () => {
    const calls: string[] = []
    const dependencies: VueSourceExporterDependencies = {
      async chooseDestination(fileName) {
        calls.push(`choose:${fileName}`)
        return null
      },
      async resolveFontManifest() {
        calls.push('fonts')
        return { faces: [] }
      },
      compile() {
        calls.push('compile')
        return { files: compiledFixture(), warnings: [] }
      },
      async archive() {
        calls.push('archive')
        return new Uint8Array()
      }
    }

    await expect(exportCurrentDocumentAsVueSource(editor(), dependencies)).resolves.toEqual({
      fileName: 'vue-product-vue.zip',
      fileCount: 0,
      warnings: [],
      saved: false
    })
    expect(calls).toEqual(['choose:vue-product-vue.zip'])
  })

  test('rejects traversal paths and the shared 64 MiB budget before writing', async () => {
    for (const files of [
      compiledFixture(new Map([['../escape.txt', 'blocked']])),
      compiledFixture(new Map([['public/oversize.bin', new Uint8Array(64 * 1024 * 1024 + 1)]]))
    ]) {
      let wrote = false
      const dependencies: VueSourceExporterDependencies = {
        async chooseDestination() {
          return {
            async write() {
              wrote = true
            }
          }
        },
        async resolveFontManifest() {
          return { faces: [] }
        },
        compile() {
          return { files, warnings: [] }
        },
        archive: archiveProjectFiles
      }

      await expect(exportCurrentDocumentAsVueSource(editor(), dependencies)).rejects.toThrow()
      expect(wrote).toBe(false)
    }
  })
})
