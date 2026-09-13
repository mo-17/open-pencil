import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { nestJSPreviewApplicationDigest } from '@open-pencil/compiler/backend'
import { ALL_TOOLS } from '@open-pencil/core/tools'

import { designSystemPromptFor } from '@/app/ai/chat/prompt-policy'
import { createAITools, getToolLogEntries } from '@/app/ai/tools'
import { SINGLE_SKU_SHOP_AI_TOOL_NAME } from '@/app/ai/tools/single-sku-shop'
import { createEditorStore } from '@/app/editor/session'
import { readBackendProviderDocumentRequest } from '@/app/lowcode/backend/document'
import { preparePreviewBackendProvider } from '@/app/lowcode/preview-pane/host/backend-provider'
import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage
} from '@/app/plugins'
import {
  appBackendProviderDocumentValue,
  listAppBackendProviderDescriptors,
  prepareAppBackendProviderCompilerOptions,
  SUPABASE_BACKEND_PROVIDER_PLUGIN_ID
} from '@/app/plugins/host/backend-provider'
import { NESTJS_BACKEND_PROVIDER_PLUGIN_ID } from '@/app/plugins/host/nestjs/backend-provider'

let previousWindow: typeof globalThis.window | undefined
beforeEach(() => {
  previousWindow = globalThis.window
  Object.assign(globalThis, { window: { innerWidth: 1200, innerHeight: 800 } })
})
afterEach(() => {
  if (previousWindow) Object.assign(globalThis, { window: previousWindow })
  else Reflect.deleteProperty(globalThis, 'window')
})

interface AppAITool {
  inputSchema: unknown
  execute(
    args: Record<string, unknown>,
    execution?: { abortSignal?: AbortSignal }
  ): Promise<Record<string, unknown>>
}

async function fixture() {
  const catalog = createBundledPluginCatalog().filter(({ manifest }) =>
    [NESTJS_BACKEND_PROVIDER_PLUGIN_ID, SUPABASE_BACKEND_PROVIDER_PLUGIN_ID].includes(
      manifest.plugin.id
    )
  )
  const pluginStore = createAppPluginStore({
    catalog,
    storage: createMemoryAppPluginStateStorage(),
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.13.2'
  })
  await pluginStore.load()
  const editor = createEditorStore()
  editor.aiFlashDone = () => undefined
  const tools = createAITools(editor, {
    singleSkuShop: { pluginStore, ready: () => Promise.resolve() }
  })
  return { editor, pluginStore, tools, tool: tools[SINGLE_SKU_SHOP_AI_TOOL_NAME] as AppAITool }
}

async function createShop() {
  const setup = await fixture()
  const result = await setup.tool.execute({ authentication: 'local-keycloak', locale: 'zh-CN' })
  expect(result.status).toBe('created')
  const request = readBackendProviderDocumentRequest(setup.editor.graph)
  if (!request) throw new Error('Expected persisted Backend request')
  return { ...setup, result, request }
}

describe('single-SKU shop built-in AI authoring and admission', () => {
  test('is discoverable only in Direct app tools and creates the shared template in one undo step', async () => {
    const { editor, tool } = await fixture()
    const before = editor.snapshotDocument()
    const oldPages = editor.graph.getPages().map((page) => page.id)
    expect(tool.inputSchema).toBeDefined()
    expect(designSystemPromptFor('direct')).toContain(SINGLE_SKU_SHOP_AI_TOOL_NAME)
    expect(designSystemPromptFor('delegated')).not.toContain(SINGLE_SKU_SHOP_AI_TOOL_NAME)
    expect(ALL_TOOLS.some((entry) => entry.name === SINGLE_SKU_SHOP_AI_TOOL_NAME)).toBe(false)
    const result = await tool.execute({ authentication: 'local-keycloak', locale: 'zh-CN' })
    expect(result.status).toBe('created')
    expect(result.exportPageIds).toEqual(result.pageIds)
    expect(result.pageIds).toHaveLength(4)
    expect(editor.graph.getPages()).toHaveLength(oldPages.length + 4)
    expect(editor.graph.getNode(String(result.shopPageId))?.name).toBe('商品')
    const request = readBackendProviderDocumentRequest(editor.graph)
    expect(request?.application.commands?.commands.map((command) => command.id)).toEqual([
      'cancel-order',
      'checkout',
      'restock-product'
    ])
    expect(
      request?.application.auth.rowAccess.find((rule) => rule.id === 'own-orders')?.operations
    ).toEqual(['select'])
    expect(getToolLogEntries(editor).at(-1)?.tool).toBe(SINGLE_SKU_SHOP_AI_TOOL_NAME)
    const after = editor.snapshotDocument()
    editor.undo.undo()
    expect(editor.documentSnapshotChanged(before)).toBe(false)
    expect(editor.undo.canUndo).toBe(false)
    editor.undo.redo()
    expect(editor.documentSnapshotChanged(after)).toBe(false)
    expect(readBackendProviderDocumentRequest(editor.graph)).toEqual(request)
  })

  test.each(['react', 'vue'] as const)(
    'admits the actual AI-authored commands through %s export and connected preview',
    async (target) => {
      const { editor, pluginStore, result, request } = await createShop()
      const options = prepareAppBackendProviderCompilerOptions(
        pluginStore,
        editor.graph,
        withDefaults({
          target,
          devMode: false,
          router: target === 'react' ? 'react-router-v6' : 'vue-router-v4'
        })
      )
      expect(options.backendProvider?.application.commands).toEqual(request.application.commands)
      const output = compile({
        graph: editor.graph,
        pageIds: result.exportPageIds as string[],
        options
      })
      expect(output.files.get('backend/nestjs/src/command-plans.ts')).toContain('checkout')
      expect(output.files.get('backend/nestjs/src/command-plans.ts')).toContain('cancel-order')
      expect(output.warnings.some((warning) => warning.code.includes('backend-command'))).toBe(
        false
      )
      const preview = preparePreviewBackendProvider(
        editor.graph,
        withDefaults({
          target,
          devMode: true,
          backendPreview: {
            kind: 'nestjs-local',
            applicationDigest: nestJSPreviewApplicationDigest(request.application)
          }
        }),
        pluginStore
      )
      expect(preview.options.backendProvider?.application.commands).toEqual(
        request.application.commands
      )
      expect(() => preview.assertCurrent()).not.toThrow()
    }
  )

  test('retains commands through the actual AI eval document roundtrip and rejects malformed readmission', async () => {
    const { editor, pluginStore, tools, request } = await createShop()
    const tool = tools.eval as AppAITool
    const before = editor.snapshotDocument()
    const result = await tool.execute({
      code: `const key = 'lowcode/backendProvider.v1'; const request = JSON.parse(figma.root.getPluginData(key)); request.application.commands.commands[0].name = 'Cancel safely'; figma.root.setPluginData(key, JSON.stringify(request)); return request.application.commands;`
    })
    expect(result).toMatchObject({ version: 1, commands: expect.any(Array) })
    const changed = readBackendProviderDocumentRequest(editor.graph)
    expect(changed?.application.commands?.commands[0].name).toBe('Cancel safely')
    expect(changed?.application.commands?.commands[0].steps).toEqual(
      request.application.commands?.commands[0].steps
    )
    expect(() =>
      prepareAppBackendProviderCompilerOptions(
        pluginStore,
        editor.graph,
        withDefaults({ target: 'react', devMode: false })
      )
    ).not.toThrow()
    editor.undo.undo()
    expect(editor.documentSnapshotChanged(before)).toBe(false)
    const invalid = structuredClone(request)
    const command = invalid.application.commands?.commands[0]
    if (!command) throw new Error('Missing command')
    Reflect.set(command.steps[0], 'sql', 'DROP TABLE products')
    expect(() => appBackendProviderDocumentValue(invalid)).toThrow('Backend application is invalid')
    expect(readBackendProviderDocumentRequest(editor.graph)).toEqual(request)
  })

  test('unsupported providers fail closed at both export and preview admission', async () => {
    const { editor, pluginStore, request } = await createShop()
    const descriptor = listAppBackendProviderDescriptors(pluginStore).find(
      (entry) => entry.providerId === 'supabase'
    )
    if (!descriptor) throw new Error('Missing Supabase fixture')
    const value = appBackendProviderDocumentValue({ ...request, selection: descriptor })
    editor.graph.updateNode(editor.graph.rootId, {
      pluginData: [{ pluginId: 'open-pencil', key: 'lowcode/backendProvider.v1', value }]
    })
    expect(() =>
      prepareAppBackendProviderCompilerOptions(
        pluginStore,
        editor.graph,
        withDefaults({ target: 'react', devMode: false })
      )
    ).toThrow('backend-command-provider-unimplemented')
    expect(() =>
      preparePreviewBackendProvider(
        editor.graph,
        withDefaults({ target: 'react', devMode: true }),
        pluginStore
      )
    ).toThrow('backend-command-provider-unimplemented')
    expect(() =>
      preparePreviewBackendProvider(
        editor.graph,
        withDefaults({
          target: 'react',
          devMode: true,
          backendPreview: {
            kind: 'nestjs-local',
            applicationDigest: nestJSPreviewApplicationDigest(request.application)
          }
        }),
        pluginStore
      )
    ).toThrow('failed closed')
  })

  test('accepts public OIDC settings and preserves existing Backend/authentication flows', async () => {
    const { editor, tool } = await fixture()
    expect(
      await tool.execute({
        authentication: 'oidc',
        issuer: 'https://identity.example.com',
        client_id: 'public-shop',
        locale: 'en'
      })
    ).toMatchObject({ status: 'created' })
    expect(
      readBackendProviderDocumentRequest(editor.graph)?.application.httpApi?.browserClient
        ?.authentication
    ).toMatchObject({ issuer: 'https://identity.example.com', clientId: 'public-shop' })
    const before = editor.snapshotDocument()
    expect(await tool.execute({ authentication: 'local-keycloak' })).toHaveProperty('error')
    expect(editor.documentSnapshotChanged(before)).toBe(false)
    editor.undo.undo()
    editor.graph.updateNode(editor.graph.rootId, { lowcodeAuthRedirect: '/existing-login' })
    const authenticated = editor.snapshotDocument()
    expect(await tool.execute({ authentication: 'local-keycloak' })).toHaveProperty('error')
    expect(editor.documentSnapshotChanged(authenticated)).toBe(false)
  })

  test('rejects bad public settings and disabled or changed provider packages without mutation', async () => {
    const { editor, pluginStore, tool } = await fixture()
    const before = editor.snapshotDocument()
    for (const input of [
      { authentication: 'oidc' },
      { authentication: 'oidc', issuer: 'https://user:password@example.com', client_id: 'public' },
      { authentication: 'oidc', issuer: 'http://identity.example.com', client_id: 'public' },
      { authentication: 'local-keycloak', issuer: 'https://identity.example.com' },
      { authentication: 'local-keycloak', locale: 'unknown' }
    ])
      expect(await tool.execute(input)).toHaveProperty('error')
    await pluginStore.setEnabled(NESTJS_BACKEND_PROVIDER_PLUGIN_ID, false)
    expect(await tool.execute({ authentication: 'local-keycloak' })).toHaveProperty('error')
    await pluginStore.setEnabled(NESTJS_BACKEND_PROVIDER_PLUGIN_ID, true)
    const changed = createAITools(editor, {
      singleSkuShop: {
        ready: () => Promise.resolve(),
        pluginStore: {
          installedBackendProviders: () =>
            pluginStore.installedBackendProviders().map((entry) => ({
              ...entry,
              plugin: {
                ...entry.plugin,
                package: { ...entry.plugin.package, digest: 'app-bundle-sha256:unreviewed' }
              }
            }))
        }
      }
    })[SINGLE_SKU_SHOP_AI_TOOL_NAME] as AppAITool
    expect(await changed.execute({ authentication: 'local-keycloak' })).toHaveProperty('error')
    expect(editor.documentSnapshotChanged(before)).toBe(false)
  })

  test('readiness revocation and cancellation cannot create pages or undo entries', async () => {
    const { editor, pluginStore } = await fixture()
    const before = editor.snapshotDocument()
    const tool = createAITools(editor, {
      singleSkuShop: {
        pluginStore,
        ready: async () => {
          await pluginStore.setEnabled(NESTJS_BACKEND_PROVIDER_PLUGIN_ID, false)
        }
      }
    })[SINGLE_SKU_SHOP_AI_TOOL_NAME] as AppAITool
    expect(await tool.execute({ authentication: 'local-keycloak' })).toHaveProperty('error')
    const controller = new AbortController()
    const cancelled = createAITools(editor, {
      singleSkuShop: {
        pluginStore,
        ready: async () => {
          controller.abort()
        }
      }
    })[SINGLE_SKU_SHOP_AI_TOOL_NAME] as AppAITool
    await expect(
      cancelled.execute({ authentication: 'local-keycloak' }, { abortSignal: controller.signal })
    ).rejects.toHaveProperty('name', 'AbortError')
    expect(editor.documentSnapshotChanged(before)).toBe(false)
    expect(editor.undo.canUndo).toBe(false)
  })
})
