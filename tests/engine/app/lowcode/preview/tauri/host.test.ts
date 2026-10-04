import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

import { applicationPageSessionSignature } from '@/app/lowcode/preview-pane/application-session/cache'
import { createTauriPreviewHost } from '@/app/lowcode/preview-pane/host/tauri'
import type { TauriPreviewSidecar } from '@/app/lowcode/preview-pane/host/tauri-sidecar'
import { parsePreviewInboundMessage } from '@/app/lowcode/preview-pane/iframe/messages'

import { applicationSessionFixture } from '#tests/helpers/compiler/application-session/fixture'

import { connectedBackendFixture } from '../connected-backend/helpers'

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
    let channelCalls = 0
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
      createChannelId: () => {
        channelCalls += 1
        return `tauri-channel-${channelCalls === 1 ? '123456' : 'unexpected-rotation'}`
      },
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

    const result = await host.build(request())
    expect(result).toMatchObject({
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
    if (result.status !== 'ready') throw new Error('Expected ready desktop preview')
    expect(result.frame).not.toHaveProperty('pageSessionSource')
    expect(fontRequests).toBe(1)
    expect(updates).toHaveLength(1)
    expect(host.isAlive()).toBe(true)
    const next = await host.build(request(2))
    if (next.status !== 'ready') throw new Error('Expected next legacy desktop preview')
    expect(next.frame.channelId).toBe(result.frame.channelId)
    expect(next.frame).not.toHaveProperty('pageSessionSource')
    expect(channelCalls).toBe(1)

    await host.dispose()
    expect(disposed).toBe(true)
    expect(host.isAlive()).toBe(false)
  })

  test.each(['react', 'vue'] as const)(
    '%s renews a guard-only runtime without requiring preserved page sessions',
    async (target) => {
      const { graph, products } = applicationSessionFixture('reset')
      const policy = products.lowcodeApplicationPage
      if (!policy) throw new Error('Missing application page')
      graph.updateNode(products.id, {
        lowcodeApplicationPage: {
          ...structuredClone(policy),
          leaveConfirm: { dirtyExpr: 'detailDraft !== ""', message: 'Leave this draft?' }
        }
      })
      const signature = applicationPageSessionSignature(graph)
      expect(signature).not.toBeNull()
      let channelSequence = 0
      const sidecar: TauriPreviewSidecar = {
        url: 'http://localhost:4574/',
        port: 4574,
        terminal: Promise.resolve({ code: 0, message: 'closed' }),
        isAlive: () => true,
        update: async () => undefined,
        dispose: async () => undefined
      }
      const host = await createTauriPreviewHost(target, {
        startSidecar: async () => sidecar,
        createChannelId: () => `guard-only-channel-${++channelSequence}`,
        resolveFonts: async () => ({ faces: [] }),
        compileProject: compile
      })
      const input = {
        generation: 1,
        graph,
        pageIds: graph.getPages().map(({ id }) => id),
        options: withDefaults({
          target,
          router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6'
        }),
        refreshFonts: false
      }
      try {
        const first = await host.build(input)
        const second = await host.build({ ...input, generation: 2 })
        if (first.status !== 'ready' || second.status !== 'ready')
          throw new Error('Expected ready guard-only previews')
        expect(first.frame.pageSessionSource?.signature).toBe(signature)
        expect(second.frame.channelId).not.toBe(first.frame.channelId)
        expect(
          parsePreviewInboundMessage(
            { source: 'op-lowcode-preview', channel: first.frame.channelId, type: 'ready' },
            second.frame.channelId
          )
        ).toBeNull()
      } finally {
        await host.dispose()
      }
    }
  )

  test.each(['react', 'vue'] as const)(
    '%s retains compile-bound authority across a delayed ACK and rejects messages from the previous runtime',
    async (target) => {
      const { graph, products } = applicationSessionFixture()
      graph.updateNode(products.id, {
        state: [
          { id: 'detailDraft', name: 'detailDraft', type: 'string', defaultValue: 'Captured draft' }
        ]
      })
      const before = applicationPageSessionSignature(graph)
      expect(before).not.toBeNull()
      let acknowledge = (): void => undefined
      let didUpdate = (): void => undefined
      const ack = new Promise<void>((resolve) => {
        acknowledge = resolve
      })
      const updated = new Promise<void>((resolve) => {
        didUpdate = resolve
      })
      let posted: Map<string, string | Uint8Array> = new Map()
      let channelSequence = 0
      const sidecar: TauriPreviewSidecar = {
        url: 'http://localhost:4570/',
        port: 4570,
        terminal: Promise.resolve({ code: 0, message: 'closed' }),
        isAlive: () => true,
        async update(files) {
          posted = files
          didUpdate()
          await ack
        },
        async dispose() {
          return undefined
        }
      }
      const host = await createTauriPreviewHost(target, {
        startSidecar: async () => sidecar,
        createChannelId: () => `attested-sidecar-channel-${++channelSequence}`,
        resolveFonts: async () => ({ faces: [] }),
        compileProject: compile
      })
      const input = {
        generation: 1,
        graph,
        pageIds: graph.getPages().map(({ id }) => id),
        options: withDefaults({
          target,
          router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6'
        }),
        refreshFonts: false
      }
      try {
        const build = host.build(input)
        await updated
        expect(
          [...posted.values()].some(
            (value) => typeof value === 'string' && value.includes('Captured draft')
          )
        ).toBe(true)
        expect(
          [...posted.values()].some(
            (value) => typeof value === 'string' && value.includes('pageSessionSource')
          )
        ).toBe(false)
        graph.updateNode(products.id, {
          state: [
            { id: 'detailDraft', name: 'detailDraft', type: 'string', defaultValue: 'Latest draft' }
          ]
        })
        const after = applicationPageSessionSignature(graph)
        expect(after).not.toBe(before)
        acknowledge()
        const first = await build
        if (first.status !== 'ready') throw new Error('Expected captured desktop result')
        expect(first.frame.pageSessionSource?.signature).toBe(before)
        expect(first.frame.pageSessionSource?.signature).not.toBe(after)
        expect(first.frame.pageSessionSource?.graph).toBe(graph)
        const second = await host.build({ ...input, generation: 2 })
        if (second.status !== 'ready') throw new Error('Expected latest desktop result')
        expect(second.frame.pageSessionSource?.signature).toBe(after)
        expect(second.frame.channelId).not.toBe(first.frame.channelId)
        expect(second.frame).not.toBe(first.frame)
        const message = {
          source: 'op-lowcode-preview',
          channel: first.frame.channelId,
          type: 'pageSession',
          snapshot: { version: 1, entries: [] }
        }
        expect(parsePreviewInboundMessage(message, second.frame.channelId)).toBeNull()
        expect(
          parsePreviewInboundMessage(
            { ...message, channel: second.frame.channelId },
            second.frame.channelId
          )
        ).toMatchObject({ type: 'pageSession', channel: second.frame.channelId })
      } finally {
        acknowledge()
        await host.dispose()
      }
    }
  )

  test.each(['react', 'vue'] as const)(
    '%s keeps linked local-backend HMR channels when the document declares preserve',
    async (target) => {
      const input = await connectedBackendFixture()
      const preview = input.options.backendPreview
      if (!preview) throw new Error('Expected linked backend fixture')
      input.graph.updateNode(input.graph.rootId, {
        lowcodeApplication: { version: 1, enabled: true, startPageId: input.login.id }
      })
      for (const page of [input.login, input.notes]) {
        const entry = input.graph.createNode('FRAME', page.id, {
          name: `${page.name} application entry`,
          width: 360,
          height: 640
        })
        input.graph.updateNode(page.id, {
          lowcodeApplicationPage: {
            version: 1,
            role: 'application',
            entryNodeId: entry.id,
            stateRetention: 'preserve'
          }
        })
      }
      expect(applicationPageSessionSignature(input.graph)).not.toBeNull()
      let channelCalls = 0
      let updates = 0
      const sidecar: TauriPreviewSidecar = {
        url: 'http://localhost:4571/',
        port: 4571,
        terminal: new Promise((resolve) => {
          void resolve
        }),
        isAlive: () => true,
        async update() {
          updates += 1
        },
        async dispose() {
          return undefined
        }
      }
      const host = await createTauriPreviewHost(target, {
        localBackend: {
          previewPort: sidecar.port,
          apiPort: 3019,
          apiBasePath: '/api',
          applicationId: input.application.applicationId,
          applicationDigest: preview.applicationDigest
        },
        startSidecar: async () => sidecar,
        createChannelId: () => `linked-backend-channel-${++channelCalls}`,
        resolveFonts: async () => ({ faces: [] }),
        resolveBackendProviderStore: () => input.store,
        compileProject: compile
      })
      const value = {
        generation: 1,
        graph: input.graph,
        pageIds: [input.login.id, input.notes.id],
        options: withDefaults({
          ...input.options,
          target,
          router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6'
        }),
        refreshFonts: false
      }
      try {
        const first = await host.build(value)
        const second = await host.build({ ...value, generation: 2 })
        expect(first.status).toBe('ready')
        expect(second.status).toBe('ready')
        if (first.status !== 'ready' || second.status !== 'ready') {
          throw new Error('Expected linked local-backend results')
        }
        expect(first.frame).not.toHaveProperty('pageSessionSource')
        expect(second.frame).not.toHaveProperty('pageSessionSource')
        expect(first.frame.channelId).toBe('linked-backend-channel-1')
        expect(second.frame.channelId).toBe(first.frame.channelId)
        expect(channelCalls).toBe(1)
        expect(updates).toBe(2)
      } finally {
        await host.dispose()
      }
    }
  )

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
