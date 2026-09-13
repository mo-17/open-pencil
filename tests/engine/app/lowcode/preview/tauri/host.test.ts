import { describe, expect, test } from 'bun:test'

import { withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

import { createTauriPreviewHost } from '@/app/lowcode/preview-pane/host/tauri'
import type { TauriPreviewSidecar } from '@/app/lowcode/preview-pane/host/tauri-sidecar'

function request(generation = 1) {
  const graph = new SceneGraph()
  return {
    generation,
    graph,
    pageIds: graph.getPages().map(({ id }) => id),
    options: withDefaults({ packageName: 'openpencil-preview', target: 'react', router: 'none' }),
    refreshFonts: true
  }
}

describe('Tauri preview Host', () => {
  test('keeps compiler, font resolution, update ACK and loopback frame behind the Host', async () => {
    const updates: Array<Map<string, string | Uint8Array>> = []
    let disposed = false
    let fontRequests = 0
    const sidecar: TauriPreviewSidecar = {
      url: 'http://127.0.0.1:4567/',
      port: 4567,
      terminal: Promise.resolve({ code: 0, message: 'closed' }),
      isAlive: () => !disposed,
      async update(files) {
        updates.push(files)
      },
      async dispose() {
        disposed = true
      }
    }
    const host = await createTauriPreviewHost('react', {
      startSidecar: async () => sidecar,
      createChannelId: () => 'tauri-channel-123456',
      async resolveFonts(value) {
        fontRequests += 1
        expect(value.refreshFonts).toBe(true)
        return { faces: [] }
      },
      compileProject(input) {
        expect(input.options.target).toBe('react')
        expect(input.fontManifest).toEqual({ faces: [] })
        return {
          files: new Map([['index.html', '<main>desktop</main>']]),
          warnings: [{ code: 'review', message: 'Review desktop output.' }]
        }
      }
    })

    await expect(host.build(request())).resolves.toMatchObject({
      status: 'ready',
      diagnostics: [{ code: 'review', severity: 'warning' }],
      frame: {
        src: 'http://127.0.0.1:4567/',
        port: 4567,
        expectedMessageOrigin: 'http://127.0.0.1:4567',
        postMessageTargetOrigin: 'http://127.0.0.1:4567',
        sandbox: null,
        channelId: 'tauri-channel-123456'
      }
    })
    expect(fontRequests).toBe(1)
    expect(updates).toHaveLength(1)
    expect(host.isAlive()).toBe(true)

    await host.dispose()
    expect(disposed).toBe(true)
    expect(host.isAlive()).toBe(false)
  })

  test('does not compile an already-aborted request', async () => {
    let compiles = 0
    const sidecar: TauriPreviewSidecar = {
      url: 'http://localhost:4568/',
      port: 4568,
      terminal: new Promise((_resolve) => {
        // Intentionally remains pending like a healthy running sidecar.
        void _resolve
      }),
      isAlive: () => true,
      async update() {
        return undefined
      },
      async dispose() {
        return undefined
      }
    }
    const host = await createTauriPreviewHost('react', {
      startSidecar: async () => sidecar,
      async resolveFonts() {
        return { faces: [] }
      },
      compileProject() {
        compiles += 1
        return { files: new Map(), warnings: [] }
      }
    })
    const controller = new AbortController()
    controller.abort()

    await expect(host.build({ ...request(), signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(compiles).toBe(0)
    await host.dispose()
  })
})
