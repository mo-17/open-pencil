import { describe, expect, test } from 'bun:test'

import type { PreviewLocalBackendConnection } from '@open-pencil/compiler/preview-local-backend'

import { createTauriPreviewHost } from '@/app/lowcode/preview-pane/host/tauri'
import type { TauriPreviewSidecar } from '@/app/lowcode/preview-pane/host/tauri-sidecar'

import { connectedBackendFixture } from '../connected-backend/helpers'

async function fixture() {
  const input = await connectedBackendFixture()
  const preview = input.options.backendPreview
  if (!preview) throw new Error('Missing connected preview fixture')
  const connection: PreviewLocalBackendConnection = {
    previewPort: 5188,
    apiPort: 3019,
    apiBasePath: '/api',
    applicationId: input.application.applicationId,
    applicationDigest: preview.applicationDigest
  }
  let updates = 0
  let disposals = 0
  const sidecar: TauriPreviewSidecar = {
    url: 'http://127.0.0.1:5188/',
    port: 5188,
    terminal: new Promise((_resolve) => {
      void _resolve
    }),
    isAlive: () => disposals === 0,
    update: async () => {
      updates += 1
    },
    dispose: async () => {
      disposals += 1
    }
  }
  const request = {
    generation: 1,
    graph: input.graph,
    pageIds: [input.login.id, input.notes.id],
    options: input.options,
    refreshFonts: false
  }
  return { input, connection, sidecar, request, updates: () => updates, disposals: () => disposals }
}

describe('connected Tauri preview process authority', () => {
  test('snapshots the connection and closes its old writable preview on document model drift', async () => {
    const item = await fixture()
    let startedConnection: PreviewLocalBackendConnection | undefined
    const host = await createTauriPreviewHost('react', {
      localBackend: item.connection,
      startSidecar: async (_target, connection) => {
        startedConnection = connection
        return item.sidecar
      },
      resolveFonts: async () => ({ faces: [] }),
      resolveBackendProviderStore: () => item.input.store
    })
    expect(Object.isFrozen(startedConnection)).toBe(true)
    Object.assign(item.connection, { apiPort: 3020 })
    expect(startedConnection?.apiPort).toBe(3019)
    expect((await host.build(item.request)).status).toBe('ready')
    expect(item.updates()).toBe(1)
    item.input.graph.updateNode(item.input.graph.rootId, { pluginData: [] })
    const result = await host.build({ ...item.request, generation: 2 })
    expect(result).toMatchObject({
      status: 'error',
      reason: expect.stringContaining('no longer matches')
    })
    expect(item.updates()).toBe(1)
    expect(item.disposals()).toBe(1)
    expect(host.isAlive()).toBe(false)
    await host.dispose()
    expect(item.disposals()).toBe(1)
  })

  test('closes its connected process when frontend compilation fails', async () => {
    const item = await fixture()
    const host = await createTauriPreviewHost('react', {
      localBackend: item.connection,
      startSidecar: async () => item.sidecar,
      resolveFonts: async () => ({ faces: [] }),
      resolveBackendProviderStore: () => item.input.store,
      compileProject: () => {
        throw new Error('Test compile failed')
      }
    })
    expect(await host.build(item.request)).toMatchObject({
      status: 'error',
      reason: 'Test compile failed'
    })
    expect(item.updates()).toBe(0)
    expect(item.disposals()).toBe(1)
    expect(host.isAlive()).toBe(false)
  })

  test('rejects a changed compiler connection before emitting or updating files', async () => {
    const item = await fixture()
    const host = await createTauriPreviewHost('react', {
      localBackend: item.connection,
      startSidecar: async () => item.sidecar,
      resolveFonts: async () => ({ faces: [] }),
      resolveBackendProviderStore: () => item.input.store
    })
    expect(
      await host.build({
        ...item.request,
        options: { ...item.request.options, backendPreview: undefined }
      })
    ).toMatchObject({ status: 'error', reason: expect.stringContaining('no longer matches') })
    expect(item.updates()).toBe(0)
    expect(item.disposals()).toBe(1)
  })
})
