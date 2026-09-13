import { beforeAll, describe, expect, test } from 'bun:test'

import { withDefaults } from '@open-pencil/compiler'
import { createEditor } from '@open-pencil/core/editor'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { SceneGraph } from '@open-pencil/scene-graph'
import type { ActionDef } from '@open-pencil/scene-graph'

import {
  createBackendProviderDocumentRequest,
  readBackendProviderDocumentRequest,
  upsertBackendProviderPluginData
} from '@/app/lowcode/backend/document'
import { createNestJSNotesApplication } from '@/app/lowcode/backend/nestjs-draft'
import { createPersonalNotesPages } from '@/app/lowcode/backend/notes-template'
import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage
} from '@/app/plugins'
import {
  compileAppBackendProviderDocument,
  listAppBackendProviderDescriptors
} from '@/app/plugins/host/backend-provider'

async function fixture() {
  const graph = new SceneGraph()
  const bundled = createBundledPluginCatalog().find(
    ({ manifest }) => manifest.plugin.id === 'open-pencil.nestjs-backend'
  )
  if (!bundled) throw new Error('Missing built-in NestJS provider')
  const store = createAppPluginStore({
    catalog: [bundled],
    storage: createMemoryAppPluginStateStorage(),
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.13.2'
  })
  await store.load()
  const descriptor = listAppBackendProviderDescriptors(store)[0]
  const application = createNestJSNotesApplication('notes-roundtrip')
  if (!descriptor || !application.httpApi?.browserClient) throw new Error('Missing client fixture')
  application.httpApi.browserClient.authentication.issuer = 'https://identity.example.test/'
  application.httpApi.browserClient.authentication.clientId = 'public-client'
  return { graph, store, descriptor, application }
}

describe('Backend browser flow .fig persistence', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('round-trips the reviewed public client, nested CRUD actions, auth guard and LIST binding', async () => {
    const { graph, descriptor, application } = await fixture()
    const request = createBackendProviderDocumentRequest(descriptor, application)
    const root = graph.getNode(graph.rootId)
    if (!root) throw new Error('Missing graph root')
    graph.updateNode(root.id, {
      pluginData: upsertBackendProviderPluginData(root.pluginData, request),
      lowcodeAuthRedirect: '/login'
    })
    const page = graph.getPages()[0]
    graph.updateNode(page.id, { lowcodeRequiresAuth: true, lowcodeRoutePattern: '/notes' })
    const onClick: ActionDef[] = [
      {
        id: 'create-note',
        kind: 'backendRequest',
        resourceId: 'notes',
        operation: 'create',
        payloadEntries: [{ key: 'title', valueExpr: 'titleInput' }],
        onSuccess: [{ id: 'clear', kind: 'setState', targetStateId: 'title', valueExpr: '""' }],
        onError: [{ id: 'login', kind: 'backendAuth', operation: 'signIn', returnPath: '/notes' }]
      }
    ]
    graph.createNode('BUTTON', page.id, { name: 'Create note', events: { onClick } })
    const interactiveProps = {
      dataSourceRef: {
        kind: 'backendResource',
        resourceId: 'notes',
        limit: 20,
        afterExpr: 'after',
        nextCursorTarget: 'cursor'
      },
      itemName: 'item'
    }
    graph.createNode('LIST', page.id, { name: 'Owned notes', interactiveProps })
    const bytes = await exportFigFile(graph)
    const imported = await parseFigFile(bytes.buffer)
    const nodes = [...imported.getAllNodes()]
    expect(nodes.find((node) => node.name === 'Create note')?.events).toEqual({ onClick })
    expect(nodes.find((node) => node.name === 'Owned notes')?.interactiveProps).toEqual(
      interactiveProps
    )
    expect(imported.getPages()[0]).toMatchObject({
      lowcodeRequiresAuth: true,
      lowcodeRoutePattern: '/notes'
    })
    const restored = imported.getNode(imported.rootId)
    expect(restored?.lowcodeAuthRedirect).toBe('/login')
    expect(readBackendProviderDocumentRequest(imported)).toEqual(request)
  }, 30_000)

  test('two .fig save/open cycles preserve editable notes layout in React and Vue exports', async () => {
    const { graph, store, descriptor, application } = await fixture()
    createPersonalNotesPages(createEditor({ graph }), descriptor, application)
    let imported = graph
    for (let cycle = 0; cycle < 2; cycle++) {
      const bytes = await exportFigFile(imported)
      imported = await parseFigFile(bytes.buffer)
      const nodes = [...imported.getAllNodes()]
      const list = nodes.find((node) => node.type === 'LIST')
      if (!list) throw new Error('Missing restored notes list')
      expect(list).toMatchObject({
        layoutMode: 'GRID',
        gridTemplateColumns: [{ sizing: 'FR', value: 1 }],
        gridTemplateRows: [{ sizing: 'FIXED', value: 150 }],
        gridRowGap: 12,
        clipsContent: false,
        interactiveProps: { layout: { overflowX: 'hidden', overflowY: 'auto' } }
      })
      expect(imported.getChildren(list.id)[0]).toMatchObject({
        name: 'Note',
        layoutPositioning: 'AUTO',
        height: 150
      })
      expect(nodes.find((node) => node.type === 'FORM')?.layoutMode).toBe('NONE')
      expect(nodes.find((node) => node.type === 'TEXTAREA')?.height).toBe(126)
    }
    for (const target of ['react', 'vue'] as const) {
      const result = compileAppBackendProviderDocument(store, {
        graph: imported,
        pageIds: imported
          .getPages()
          .filter((page) => page.lowcodeRoutePattern)
          .map((page) => page.id),
        options: withDefaults({
          target,
          router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6',
          devMode: false
        })
      })
      const source = String(
        result.files.get(`src/pages/personal-notes.${target === 'vue' ? 'vue' : 'tsx'}`)
      )
      const classes = [...source.matchAll(/class(?:Name)?="([^"]+)"/g)].map((match) =>
        match[1].split(/\s+/)
      )
      const listClasses = classes.find((items) => items.includes('overflow-y-auto'))
      expect(listClasses).toContain('grid')
      expect(listClasses).toContain('grid-cols-1')
      expect(listClasses).toContain('grid-rows-[150px]')
      expect(listClasses).toContain('gap-y-3')
      const cardClasses = classes.find((items) => items.includes('h-[150px]'))
      expect(cardClasses).toContain('relative')
      expect(cardClasses).not.toContain('absolute')
      const form = source.match(/<form\b[^>]*\bclass(?:Name)?="([^"]+)"/)?.[1]
      expect(form).not.toContain('flex')
      const textarea = source.match(/<textarea\b[^>]*\bclass(?:Name)?="([^"]+)"/)?.[1]
      expect(textarea).toContain('h-[126px]')
    }
  }, 30_000)
})
