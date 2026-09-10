import { describe, expect, test } from 'bun:test'

import { ref, shallowRef } from 'vue'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'
import { SceneGraph } from '@open-pencil/scene-graph'

import { watchPreviewBackendProvider } from '@/app/lowcode/preview-pane/backend-provider-watch'
import {
  createBrowserPreviewWorkerRequest,
  validateBrowserPreviewWorkerRequest,
  type BrowserPreviewWorkerBuildResult
} from '@/app/lowcode/preview-pane/browser-worker/protocol'
import { createBrowserPreviewHost } from '@/app/lowcode/preview-pane/host/browser'
import { createTauriPreviewHost } from '@/app/lowcode/preview-pane/host/tauri'
import type { PreviewHostBuildRequest } from '@/app/lowcode/preview-pane/host/types'
import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage
} from '@/app/plugins'
import {
  APP_BACKEND_PROVIDER_REQUEST_FORMAT,
  SUPABASE_BACKEND_PROVIDER_PLUGIN_ID,
  appBackendProviderDocumentValue,
  listAppBackendProviderDescriptors,
  prepareAppBackendProviderCompilerOptions,
  type AppBackendProviderDescriptor
} from '@/app/plugins/host/backend-provider'
import { restoreVueCompilerGraph } from '@/app/plugins/host/vue/compiler/protocol'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function application(): BackendApplicationSpecV1 {
  return {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: 'preview-backend-test',
    dataModel: { version: 1, entities: [], enums: [], relations: [] },
    auth: {
      version: 1,
      identities: [{ id: 'user', kind: 'user' }],
      roles: [],
      ownership: [],
      tenants: [],
      rowAccess: []
    },
    workflows: { version: 1, workflows: [] },
    storage: {
      version: 1,
      buckets: [
        {
          id: 'avatars',
          name: 'avatars',
          access: 'private',
          maxObjectBytes: 1_048_576,
          allowedMimeTypes: ['image/png'],
          pathRules: [
            {
              id: 'owner-files',
              prefix: ['users'],
              principal: { kind: 'owner' },
              operations: ['read', 'create', 'update', 'delete', 'upsert']
            }
          ]
        }
      ]
    },
    capabilities: [
      { capability: 'auth.identity', required: true },
      { capability: 'storage.objects', required: true },
      { capability: 'policy.row-level', required: true }
    ],
    secrets: []
  }
}

function declareBackend(
  graph: SceneGraph,
  selection: AppBackendProviderDescriptor,
  app: BackendApplicationSpecV1
) {
  graph.updateNode(graph.rootId, {
    pluginData: [
      {
        pluginId: 'open-pencil',
        key: 'lowcode/backendProvider.v1',
        value: appBackendProviderDocumentValue({
          format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
          selection,
          application: app
        })
      }
    ]
  })
}

async function fixture(bucket = 'avatars') {
  const catalog = createBundledPluginCatalog().filter(
    ({ manifest }) => manifest.plugin.id === SUPABASE_BACKEND_PROVIDER_PLUGIN_ID
  )
  const store = createAppPluginStore({
    storage: createMemoryAppPluginStateStorage(),
    catalog,
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.13.2'
  })
  await store.load()
  const descriptor = listAppBackendProviderDescriptors(store)[0]
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const app = application()
  declareBackend(graph, descriptor, app)
  graph.updateNode(graph.rootId, {
    lowcodeSupabaseConfig: {
      url: 'https://example.supabase.co',
      anonKey: 'local-public-placeholder',
      schema: 'public'
    },
    lowcodeDocumentState: [{ id: 'd1', name: 'avatarUrl', type: 'string', defaultValue: '' }]
  })
  graph.createNode('INPUT', pageId, {
    name: 'Avatar',
    interactiveProps: { upload: { bucket, resultTarget: 'avatarUrl' } }
  })
  const request: PreviewHostBuildRequest = {
    generation: 1,
    graph,
    pageIds: [pageId],
    refreshFonts: false,
    options: withDefaults({ packageName: 'openpencil-preview', target: 'react', router: 'none' })
  }
  return { store, descriptor, app, request }
}

function sidecar(update: (files: Map<string, string | Uint8Array>) => Promise<void>) {
  return {
    url: 'http://127.0.0.1:4567/',
    port: 4567,
    terminal: new Promise<{ code: number | null; message: string }>((_resolve) => {
      void _resolve
    }),
    isAlive: () => true,
    update,
    dispose: async () => undefined
  }
}

function workerResult(html = '<main>compiled</main>'): BrowserPreviewWorkerBuildResult {
  return {
    status: 'ready',
    html,
    diagnostics: [],
    metrics: {
      compileMs: 1,
      bundleMs: 1,
      totalMs: 2,
      inputBytes: 1,
      outputBytes: html.length,
      fileCount: 1,
      dependencyCount: 0
    }
  }
}

describe('Preview Backend Provider integration', () => {
  test('desktop React and Vue compile private Storage from the current Host declaration', async () => {
    for (const target of ['react', 'vue'] as const) {
      const { store, request } = await fixture()
      request.options = withDefaults({ packageName: 'openpencil-preview', target, router: 'none' })
      let source = ''
      const host = await createTauriPreviewHost(target, {
        resolveBackendProviderStore: () => store,
        resolveFonts: async () => ({ faces: [] }),
        startSidecar: async () =>
          sidecar(async (files) => {
            source = String(files.get(target === 'react' ? 'src/App.tsx' : 'src/pages/index.vue'))
          })
      })
      expect(await host.build(request)).toMatchObject({ status: 'ready' })
      expect(source).toContain('.upload(')
      expect(source).not.toContain('.getPublicUrl(')
      expect(source).toContain(
        target === 'react'
          ? 'setDocState("avatarUrl", __path)'
          : '__setDocState("avatarUrl", __opPath)'
      )
      await host.dispose()
    }
  })

  test('browser passes only normalized data through the real Worker schema and Compiler', async () => {
    for (const bucket of ['avatars', 'undeclared']) {
      const { store, request } = await fixture(bucket)
      let compiled = ''
      const host = createBrowserPreviewHost('react', {
        resolveBackendProviderStore: () => store,
        createObjectURL: () => 'blob:backend-preview',
        revokeObjectURL: () => undefined,
        client: {
          async build(input, channelId) {
            const snapshot = structuredClone(
              createBrowserPreviewWorkerRequest(input, 'backend-request-1234567890', channelId)
            )
            validateBrowserPreviewWorkerRequest(snapshot)
            expect(Object.keys(snapshot.options.backendProvider ?? {}).sort()).toEqual([
              'application',
              'selection'
            ])
            const output = compile({
              graph: restoreVueCompilerGraph(snapshot.graph),
              pageIds: snapshot.pageIds,
              options: snapshot.options,
              fontManifest: { faces: [] }
            })
            compiled = String(output.files.get('src/App.tsx'))
            return workerResult()
          },
          dispose: () => undefined
        }
      })
      expect(await host.build(request)).toMatchObject({ status: 'ready' })
      if (bucket === 'avatars') expect(compiled).toContain('setDocState("avatarUrl", __path)')
      else expect(compiled).not.toContain('.upload(')
      expect(compiled).not.toContain('.getPublicUrl(')
      await host.dispose()
    }
  })

  test('undeclared Storage buckets are disabled by the actual desktop Compiler', async () => {
    const { store, request } = await fixture('undeclared')
    let source = ''
    const host = await createTauriPreviewHost('react', {
      resolveBackendProviderStore: () => store,
      resolveFonts: async () => ({ faces: [] }),
      startSidecar: async () =>
        sidecar(async (files) => {
          source = String(files.get('src/App.tsx'))
        })
    })
    expect(await host.build(request)).toMatchObject({
      status: 'ready',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'upload-backend-bucket-unavailable' })
      ])
    })
    expect(source).not.toContain('.upload(')
    await host.dispose()
  })

  test('required explicit server workflows fail closed before browser dispatch or desktop update', async () => {
    const { store, request, descriptor, app } = await fixture()
    app.workflows.workflows = [
      {
        id: 'health-check',
        name: 'Health check',
        trigger: { kind: 'http', method: 'POST', access: 'authenticated' },
        parameters: [],
        steps: [{ id: 'return', kind: 'respond', value: 'true', status: 200 }]
      }
    ]
    app.capabilities.push(
      { capability: 'server.functions', required: true },
      { capability: 'server.http', required: true }
    )
    declareBackend(request.graph, descriptor, app)
    let dispatched = 0
    const desktop = await createTauriPreviewHost('react', {
      resolveBackendProviderStore: () => store,
      resolveFonts: async () => ({ faces: [] }),
      startSidecar: async () =>
        sidecar(async () => {
          dispatched++
        })
    })
    const browser = createBrowserPreviewHost('react', {
      resolveBackendProviderStore: () => store,
      client: {
        build: async () => {
          dispatched++
          return workerResult()
        },
        dispose: () => undefined
      }
    })
    for (const host of [desktop, browser]) {
      expect(await host.build(request)).toMatchObject({
        status: 'error',
        reason: expect.stringContaining('backend-preview-server-capability-unavailable')
      })
      await host.dispose()
    }
    expect(dispatched).toBe(0)
  })

  test('desktop resolves the live plugin after asynchronous font preparation', async () => {
    const { store, request } = await fixture()
    let compiles = 0
    const host = await createTauriPreviewHost('react', {
      resolveBackendProviderStore: () => store,
      resolveFonts: async () => {
        await store.setEnabled(SUPABASE_BACKEND_PROVIDER_PLUGIN_ID, false)
        return { faces: [] }
      },
      compileProject: () => {
        compiles++
        return { files: new Map(), warnings: [] }
      },
      startSidecar: async () => sidecar(async () => undefined)
    })
    expect(await host.build(request)).toMatchObject({ status: 'error' })
    expect(compiles).toBe(0)
    await host.dispose()
  })

  test('desktop does not publish a ready result after document mutation during update ACK', async () => {
    const { store, request } = await fixture()
    const host = await createTauriPreviewHost('react', {
      resolveBackendProviderStore: () => store,
      resolveFonts: async () => ({ faces: [] }),
      startSidecar: async () =>
        sidecar(async () => {
          request.graph.updateNode(request.graph.rootId, { pluginData: [] })
        })
    })
    expect(await host.build(request)).toMatchObject({
      status: 'error',
      reason: expect.stringContaining('document changed')
    })
    await host.dispose()
  })

  test('browser discards output after disable, package drift, or document replacement while Worker awaits', async () => {
    for (const change of ['disable', 'digest', 'document'] as const) {
      const { store, request } = await fixture()
      const started = deferred<boolean>()
      const result = deferred<BrowserPreviewWorkerBuildResult>()
      let drifted = false
      let published = 0
      const host = createBrowserPreviewHost('react', {
        resolveBackendProviderStore: () => ({
          installedBackendProviders: () =>
            store.installedBackendProviders().map((entry) => {
              const clone = structuredClone(entry)
              if (drifted)
                return {
                  ...clone,
                  plugin: {
                    ...clone.plugin,
                    package: {
                      ...clone.plugin.package,
                      digest: `app-bundle-sha256:${'B'.repeat(43)}`
                    }
                  }
                }
              return clone
            })
        }),
        createObjectURL: () => {
          published++
          return 'blob:stale-backend'
        },
        client: {
          build: () => {
            started.resolve(true)
            return result.promise
          },
          dispose: () => undefined
        }
      })
      const build = host.build(request)
      await started.promise
      if (change === 'disable') await store.setEnabled(SUPABASE_BACKEND_PROVIDER_PLUGIN_ID, false)
      if (change === 'digest') drifted = true
      if (change === 'document') request.graph.updateNode(request.graph.rootId, { pluginData: [] })
      result.resolve(workerResult())
      expect(await build).toMatchObject({ status: 'error' })
      expect(published).toBe(0)
      await host.dispose()
    }
  })

  test('Worker request rejects extra authority, altered adapters, production mode, accessors and budget overflow', async () => {
    const { store, request } = await fixture()
    const snapshot = createBrowserPreviewWorkerRequest(
      {
        ...request,
        options: prepareAppBackendProviderCompilerOptions(store, request.graph, request.options),
        fontProviders: []
      },
      'backend-request-1234567890',
      'backend-channel-1234567890'
    )
    const backend = snapshot.options.backendProvider
    if (!backend) throw new Error('Expected a normalized Backend Provider request')
    for (const value of [
      { ...backend, authority: 'not-allowed' },
      { ...backend, selection: { ...backend.selection, enabled: false } },
      {
        ...backend,
        selection: {
          ...backend.selection,
          descriptor: { ...backend.selection.descriptor, adapterId: 'unreviewed' }
        }
      }
    ]) {
      expect(() =>
        validateBrowserPreviewWorkerRequest({
          ...snapshot,
          options: { ...snapshot.options, backendProvider: value }
        })
      ).toThrow()
    }
    expect(() =>
      validateBrowserPreviewWorkerRequest({
        ...snapshot,
        options: { ...snapshot.options, backendCompilationMode: 'production' }
      })
    ).toThrow('fields are invalid')
    const accessor = { ...backend }
    Object.defineProperty(accessor, 'application', {
      enumerable: true,
      get: () => backend.application
    })
    expect(() =>
      validateBrowserPreviewWorkerRequest({
        ...snapshot,
        options: { ...snapshot.options, backendProvider: accessor }
      })
    ).toThrow('must not contain accessors')
    expect(() =>
      validateBrowserPreviewWorkerRequest({
        ...snapshot,
        options: {
          ...snapshot.options,
          backendProvider: { ...backend, extra: new Uint8Array(33 * 1024 * 1024) }
        }
      })
    ).toThrow()
  })

  test('plugin changes and declaration removal invalidate visible Backend previews synchronously, including Manual mode', async () => {
    const { request } = await fixture()
    const graph = shallowRef(request.graph)
    const sceneVersion = ref(0)
    const snapshot = shallowRef({ revision: 1 })
    let invalidated = 0
    const stop = watchPreviewBackendProvider({
      graph: () => graph.value,
      sceneVersion: () => sceneVersion.value,
      providerSnapshot: () => snapshot.value,
      invalidate: () => {
        invalidated++
      }
    })
    sceneVersion.value++
    expect(invalidated).toBe(0)
    snapshot.value = { revision: 2 }
    expect(invalidated).toBe(1)
    graph.value.updateNode(graph.value.rootId, { pluginData: [] })
    sceneVersion.value++
    expect(invalidated).toBe(2)
    snapshot.value = { revision: 3 }
    expect(invalidated).toBe(2)
    stop()
  })
})
