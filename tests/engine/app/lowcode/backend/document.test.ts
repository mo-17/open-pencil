import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'

import { collectServerWorkflowOptions } from '@/app/lowcode/action/server-workflow-options'
import {
  BackendDocumentValidationError,
  clearBackendProviderDocumentRequest,
  commitBackendProviderDocumentRequest,
  createBackendProviderDocumentRequest,
  createEmptyBackendApplication,
  readBackendProviderDocumentRequest,
  removeBackendProviderPluginData,
  upsertBackendProviderPluginData
} from '@/app/lowcode/backend/document'
import { addBackendEntity } from '@/app/lowcode/backend/draft'
import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage,
  type AppBundlePluginCatalogEntry
} from '@/app/plugins'
import {
  SUPABASE_BACKEND_PROVIDER_ID,
  SUPABASE_BACKEND_PROVIDER_PLUGIN_ID,
  listAppBackendProviderDescriptors,
  type AppBackendProviderDescriptor
} from '@/app/plugins/host/backend-provider'

function bundledBackendProvider(): AppBundlePluginCatalogEntry {
  const entry = createBundledPluginCatalog().find(
    ({ manifest }) => manifest.plugin.id === SUPABASE_BACKEND_PROVIDER_PLUGIN_ID
  )
  if (entry?.trustSource !== 'app-bundle') {
    throw new Error('Missing bundled Supabase Backend Provider')
  }
  return entry
}

async function activeDescriptor(): Promise<AppBackendProviderDescriptor> {
  const store = createAppPluginStore({
    storage: createMemoryAppPluginStateStorage(),
    catalog: [bundledBackendProvider()],
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.13.2'
  })
  await store.load()
  expect(
    store.backendProvider(SUPABASE_BACKEND_PROVIDER_PLUGIN_ID, SUPABASE_BACKEND_PROVIDER_ID)
  ).not.toBeNull()
  const descriptors = listAppBackendProviderDescriptors(store)
  if (descriptors.length !== 1) throw new Error('Expected one active Backend Provider')
  return descriptors[0]
}

describe('Backend document adapter', () => {
  test('exactly upserts and removes the owned root pluginData key', async () => {
    const descriptor = await activeDescriptor()
    const request = createBackendProviderDocumentRequest(
      descriptor,
      createEmptyBackendApplication('visual-backend')
    )
    const other = { pluginId: 'example.plugin', key: 'keep', value: 'untouched' }
    const stale = {
      pluginId: 'open-pencil',
      key: 'lowcode/backendProvider.v1',
      value: 'stale'
    }
    const next = upsertBackendProviderPluginData([other, stale, stale], request)

    expect(next[0]).toEqual(other)
    expect(
      next.filter(
        (entry) => entry.pluginId === 'open-pencil' && entry.key === 'lowcode/backendProvider.v1'
      )
    ).toHaveLength(1)
    expect(JSON.parse(next[1].value)).toEqual(request)
    expect(removeBackendProviderPluginData(next)).toEqual([other])
  })

  test('commits one atomic undo entry and restores it with undo/redo', async () => {
    const descriptor = await activeDescriptor()
    const editor = createEditor()
    editor.graph.updateNode(editor.graph.rootId, {
      pluginData: [{ pluginId: 'example.plugin', key: 'keep', value: 'untouched' }]
    })
    const before = structuredClone(editor.graph.getNode(editor.graph.rootId)?.pluginData)
    const application = createEmptyBackendApplication('visual-backend')
    addBackendEntity(application, (prefix) => `${prefix}:stable`)

    const request = commitBackendProviderDocumentRequest(editor, descriptor, application)
    expect(readBackendProviderDocumentRequest(editor.graph)).toEqual(request)
    expect(editor.graph.getNode(editor.graph.rootId)?.pluginData[0]).toEqual(before?.[0])

    editor.undo.undo()
    expect(editor.graph.getNode(editor.graph.rootId)?.pluginData).toEqual(before)
    editor.undo.redo()
    expect(readBackendProviderDocumentRequest(editor.graph)).toEqual(request)

    expect(clearBackendProviderDocumentRequest(editor)).toBe(true)
    expect(readBackendProviderDocumentRequest(editor.graph)).toBeNull()
    editor.undo.undo()
    expect(readBackendProviderDocumentRequest(editor.graph)).toEqual(request)
  })

  test('invalid or secret-like drafts never mutate the graph', async () => {
    const descriptor = await activeDescriptor()
    const editor = createEditor()
    const before = structuredClone(editor.graph.getNode(editor.graph.rootId)?.pluginData)
    const application = createEmptyBackendApplication('sk_live_backend_canary')

    expect(() => commitBackendProviderDocumentRequest(editor, descriptor, application)).toThrow(
      BackendDocumentValidationError
    )
    expect(editor.graph.getNode(editor.graph.rootId)?.pluginData).toEqual(before)
    expect(readBackendProviderDocumentRequest(editor.graph)).toBeNull()
  })

  test('uses explicit Backend workflows as the action selector authority', async () => {
    const descriptor = await activeDescriptor()
    const editor = createEditor()
    editor.graph.updateNode(editor.graph.rootId, {
      lowcodeServerWorkflows: [
        {
          id: 'legacy-only',
          name: 'Legacy only',
          trigger: { kind: 'http', method: 'POST', auth: 'supabase-user' },
          params: [],
          actions: [{ id: 'return', kind: 'return', status: 204 }]
        }
      ]
    })
    expect(collectServerWorkflowOptions(editor.graph).map((workflow) => workflow.id)).toEqual([
      'legacy-only'
    ])

    const application = createEmptyBackendApplication('workflow-selector-authority')
    application.auth.identities = [{ id: 'user', kind: 'user' }]
    application.workflows.workflows = [
      {
        id: 'explicit-only',
        name: 'Explicit only',
        trigger: { kind: 'http', method: 'POST', access: 'authenticated' },
        parameters: ['message'],
        steps: [{ id: 'respond', kind: 'respond', value: 'message', status: 200 }]
      }
    ]
    application.capabilities = [
      { capability: 'auth.identity', required: true },
      { capability: 'server.functions', required: true },
      { capability: 'server.http', required: true }
    ]
    commitBackendProviderDocumentRequest(editor, descriptor, application)

    expect(collectServerWorkflowOptions(editor.graph)).toEqual([
      { id: 'explicit-only', name: 'Explicit only', parameters: ['message'] }
    ])
  })
})
