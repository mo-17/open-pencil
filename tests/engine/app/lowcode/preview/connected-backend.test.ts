import { describe, expect, test } from 'bun:test'

import { compile } from '@open-pencil/compiler'

import { preparePreviewBackendProvider } from '@/app/lowcode/preview-pane/host/backend-provider'
import { createBrowserPreviewHost } from '@/app/lowcode/preview-pane/host/browser'

import { connectedBackendFixture as fixture, PLUGIN_ID } from './connected-backend/helpers'

describe('connected NestJS preview host authority', () => {
  test('resolves live bundled authority without granting server emission', async () => {
    const input = await fixture()
    const prepared = preparePreviewBackendProvider(input.graph, input.options, input.store)
    prepared.assertCurrent()
    const result = compile({
      graph: input.graph,
      pageIds: [input.login.id, input.notes.id],
      options: prepared.options
    })
    expect(result.files.has('src/lowcode-backend-auth.ts')).toBe(true)
    expect([...result.files.keys()].some((path) => path.startsWith('backend/'))).toBe(false)
    await input.store.setEnabled(PLUGIN_ID, false)
    expect(() => prepared.assertCurrent()).toThrow('no longer available')
  })

  test('rejects a stale document and a changed connection fingerprint', async () => {
    const input = await fixture()
    expect(() =>
      preparePreviewBackendProvider(
        input.graph,
        {
          ...input.options,
          backendPreview: { kind: 'nestjs-local', applicationDigest: 'stale' }
        },
        input.store
      )
    ).toThrow('backend-preview-application-changed')
    const prepared = preparePreviewBackendProvider(input.graph, input.options, input.store)
    input.graph.updateNode(input.graph.rootId, { pluginData: [] })
    expect(() => prepared.assertCurrent()).toThrow('document changed')
  })

  test('browser rejects the desktop opt-in before worker dispatch', async () => {
    const input = await fixture()
    let dispatched = 0
    const host = createBrowserPreviewHost('react', {
      client: {
        build: async () => {
          dispatched++
          throw new Error('Should not dispatch')
        },
        dispose: () => undefined
      }
    })
    expect(
      await host.build({
        generation: 1,
        graph: input.graph,
        pageIds: [input.login.id, input.notes.id],
        refreshFonts: false,
        options: input.options
      })
    ).toMatchObject({
      status: 'error',
      reason: 'Connected NestJS preview requires the desktop host.'
    })
    expect(dispatched).toBe(0)
    await host.dispose()
  })
})
