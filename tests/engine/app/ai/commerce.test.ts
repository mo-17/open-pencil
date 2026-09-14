import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { nestJSPreviewApplicationDigest } from '@open-pencil/compiler/backend'
import { ALL_TOOLS } from '@open-pencil/core/tools'

import { designSystemPromptFor } from '@/app/ai/chat/prompt-policy'
import { createAITools, getToolLogEntries } from '@/app/ai/tools'
import { COMMERCE_AI_TOOL_NAME } from '@/app/ai/tools/commerce'
import { SINGLE_SKU_SHOP_AI_TOOL_NAME } from '@/app/ai/tools/single-sku-shop'
import { createEditorStore } from '@/app/editor/session'
import { readBackendProviderDocumentRequest } from '@/app/lowcode/backend/document'
import { preparePreviewBackendProvider } from '@/app/lowcode/preview-pane/host/backend-provider'
import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage
} from '@/app/plugins'
import { prepareAppBackendProviderCompilerOptions } from '@/app/plugins/host/backend-provider'
import { NESTJS_BACKEND_PROVIDER_PLUGIN_ID } from '@/app/plugins/host/nestjs/backend-provider'

const MODES = ['single-merchant', 'multi-merchant'] as const
type Mode = (typeof MODES)[number]
interface ExecutableTool {
  inputSchema: unknown
  execute(
    args: Record<string, unknown>,
    execution?: { abortSignal?: AbortSignal }
  ): Promise<Record<string, unknown>>
}

let previousWindow: typeof globalThis.window | undefined
beforeEach(() => {
  previousWindow = globalThis.window
  Object.assign(globalThis, { window: { innerWidth: 1200, innerHeight: 800 } })
})
afterEach(() => {
  if (previousWindow) Object.assign(globalThis, { window: previousWindow })
  else Reflect.deleteProperty(globalThis, 'window')
})

async function setup() {
  const pluginStore = createAppPluginStore({
    catalog: createBundledPluginCatalog().filter(
      ({ manifest }) => manifest.plugin.id === NESTJS_BACKEND_PROVIDER_PLUGIN_ID
    ),
    storage: createMemoryAppPluginStateStorage(),
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.13.2'
  })
  await pluginStore.load()
  const editor = createEditorStore()
  editor.aiFlashDone = () => undefined
  const dependencies = { pluginStore, ready: () => Promise.resolve() }
  const tools = createAITools(editor, { commerce: dependencies, singleSkuShop: dependencies })
  return { editor, pluginStore, tools, tool: tools[COMMERCE_AI_TOOL_NAME] as ExecutableTool }
}

async function createApplication(mode: Mode) {
  const value = await setup()
  const result = await value.tool.execute({
    authentication: 'local-keycloak',
    mode,
    locale: 'zh-CN'
  })
  expect(result).toMatchObject({ status: 'created', mode, providerId: 'nestjs' })
  const request = readBackendProviderDocumentRequest(value.editor.graph)
  if (!request) throw new Error('Expected a persisted commerce application')
  return { ...value, result, request }
}

describe('merchant commerce AI authoring', () => {
  test('publishes both tools only through the Direct application facade', async () => {
    const { tools, tool } = await setup()
    expect(tool.inputSchema).toBeDefined()
    expect(tools[SINGLE_SKU_SHOP_AI_TOOL_NAME]).toBeDefined()
    for (const name of [COMMERCE_AI_TOOL_NAME, SINGLE_SKU_SHOP_AI_TOOL_NAME]) {
      expect(designSystemPromptFor('direct')).toContain(name)
      expect(designSystemPromptFor('delegated')).not.toContain(name)
      expect(ALL_TOOLS.some((entry) => entry.name === name)).toBe(false)
    }
  })

  test.each(MODES)(
    '%s preserves existing pages and undoes the complete model and page set',
    async (mode) => {
      const { editor, tool } = await setup()
      const previousPages = editor.graph.getPages().map((page) => page.id)
      const before = editor.snapshotDocument()
      const result = await tool.execute({ authentication: 'local-keycloak', mode, locale: 'zh-CN' })
      expect(result).toMatchObject({ status: 'created', mode })
      const pageIds = result.exportPageIds as string[]
      expect(pageIds).toEqual(result.pageIds)
      expect(pageIds).toHaveLength(mode === 'single-merchant' ? 5 : 7)
      expect(editor.graph.getPages().map((page) => page.id)).toEqual([...previousPages, ...pageIds])
      const paths = result.paths as Record<string, string>
      expect(paths.merchantOrders).toBeDefined()
      expect(editor.graph.getNode(String(result.shopPageId))?.lowcodeRoutePattern).toBe(paths.shop)
      if (mode === 'multi-merchant') expect(paths.stores).toBeDefined()
      const request = readBackendProviderDocumentRequest(editor.graph)
      expect(request).not.toBeNull()
      expect(getToolLogEntries(editor).at(-1)?.tool).toBe(COMMERCE_AI_TOOL_NAME)
      const after = editor.snapshotDocument()
      editor.undo.undo()
      expect(editor.documentSnapshotChanged(before)).toBe(false)
      expect(editor.undo.canUndo).toBe(false)
      editor.undo.redo()
      expect(editor.documentSnapshotChanged(after)).toBe(false)
      expect(readBackendProviderDocumentRequest(editor.graph)).toEqual(request)
    }
  )

  test('keeps the legacy tool on its original four-page application without tenants', async () => {
    const { editor, tools } = await setup()
    const result = await (tools[SINGLE_SKU_SHOP_AI_TOOL_NAME] as ExecutableTool).execute({
      authentication: 'local-keycloak'
    })
    expect(result.status).toBe('created')
    expect(result.exportPageIds).toHaveLength(4)
    expect(readBackendProviderDocumentRequest(editor.graph)?.application.auth.tenants).toEqual([])
  })

  test.each(MODES)(
    '%s reaches React and Vue source export and connected preview admission',
    async (mode) => {
      const { editor, pluginStore, result, request } = await createApplication(mode)
      const application = request.application
      expect(application.auth.roles.map((role) => role.id)).toContain(
        mode === 'single-merchant' ? 'catalog-manager' : 'merchant'
      )
      if (mode === 'multi-merchant') {
        expect(application.auth.tenants.length).toBeGreaterThan(0)
        const stores = application.dataModel.entities.find((entity) => entity.name === 'stores')
        if (!stores) throw new Error('Expected a persisted store membership entity')
        expect(application.auth.tenants).toContainEqual(
          expect.objectContaining({
            membershipEntityId: stores.id,
            membershipIdentityFieldId: 'owner_id',
            membershipTenantFieldId: 'id'
          })
        )
      } else expect(application.auth.tenants).toEqual([])
      for (const target of ['react', 'vue'] as const) {
        const options = prepareAppBackendProviderCompilerOptions(
          pluginStore,
          editor.graph,
          withDefaults({
            target,
            devMode: false,
            router: target === 'react' ? 'react-router-v6' : 'vue-router-v4'
          })
        )
        const output = compile({
          graph: editor.graph,
          pageIds: result.exportPageIds as string[],
          options
        })
        expect(output.files.get('backend/nestjs/src/command-plans.ts')).toContain('checkout')
        expect(
          output.warnings.filter((warning) => warning.code.includes('backend-command'))
        ).toEqual([])
        const preview = preparePreviewBackendProvider(
          editor.graph,
          withDefaults({
            target,
            devMode: true,
            backendPreview: {
              kind: 'nestjs-local',
              applicationDigest: nestJSPreviewApplicationDigest(application)
            }
          }),
          pluginStore
        )
        expect(preview.options.backendProvider?.application).toEqual(application)
        expect(() => preview.assertCurrent()).not.toThrow()
      }
    }
  )

  test.each(MODES)(
    '%s operations edition preserves runnable pages and provider preview admission',
    async (mode) => {
      const { editor, tool, pluginStore } = await setup()
      const result = await tool.execute({
        authentication: 'local-keycloak',
        mode,
        edition: 'operations',
        commission_basis_points: 175,
        locale: 'zh-CN'
      })
      expect(result).toMatchObject({ status: 'created', mode, edition: 'operations' })
      const pageIds = result.exportPageIds as string[]
      expect(pageIds).toHaveLength(12)
      const request = readBackendProviderDocumentRequest(editor.graph)
      if (!request) throw new Error('Missing operations document')
      expect(request.application.commerce).toMatchObject({ mode, commissionBasisPoints: 175 })
      expect(request.application.auth.roles.map((role) => role.id).sort()).toEqual([
        'commerce-operator',
        'merchant'
      ])
      expect(result.nextSteps).toContainEqual(
        expect.stringContaining('Simulated payment is disabled in production')
      )
      for (const target of ['react', 'vue'] as const) {
        const options = prepareAppBackendProviderCompilerOptions(
          pluginStore,
          editor.graph,
          withDefaults({
            target,
            devMode: false,
            router: target === 'react' ? 'react-router-v6' : 'vue-router-v4'
          })
        )
        const output = compile({ graph: editor.graph, pageIds, options })
        expect(output.warnings).toEqual([])
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
        expect(preview.options.backendProvider?.application).toEqual(request.application)
        expect(() => preview.assertCurrent()).not.toThrow()
      }
      expect(designSystemPromptFor('direct')).toContain('edition: "operations"')
      expect(designSystemPromptFor('direct')).toContain('购物车')
    }
  )

  test('rejects missing/unknown modes and invalid public configuration without document changes', async () => {
    const { editor, tool } = await setup()
    const before = editor.snapshotDocument()
    for (const args of [
      { authentication: 'local-keycloak' },
      { authentication: 'local-keycloak', mode: 'automatic' },
      { authentication: 'local-keycloak', mode: 'single-merchant', edition: 'automatic' },
      { authentication: 'local-keycloak', mode: 'single-merchant', commission_basis_points: 1 },
      {
        authentication: 'local-keycloak',
        mode: 'single-merchant',
        edition: 'operations',
        commission_basis_points: -1
      },
      {
        authentication: 'local-keycloak',
        mode: 'single-merchant',
        edition: 'operations',
        commission_basis_points: 0.5
      },
      {
        authentication: 'local-keycloak',
        mode: 'single-merchant',
        edition: 'operations',
        commission_basis_points: 10001
      },
      { authentication: 'local-keycloak', mode: 'single-merchant', locale: 'unknown' },
      { authentication: 'oidc', mode: 'multi-merchant' },
      { authentication: 'local-keycloak', mode: 'multi-merchant', issuer: 'https://example.com' },
      {
        authentication: 'oidc',
        mode: 'single-merchant',
        issuer: 'https://user:password@example.com',
        client_id: 'public'
      }
    ]) {
      expect(await tool.execute(args)).toHaveProperty('error')
      expect(editor.documentSnapshotChanged(before)).toBe(false)
    }
    expect(editor.undo.canUndo).toBe(false)
  })

  test.each(MODES)(
    '%s preserves an existing authentication or Backend declaration',
    async (mode) => {
      const { editor, tool } = await setup()
      editor.graph.updateNode(editor.graph.rootId, { lowcodeAuthRedirect: '/existing-login' })
      const protectedDocument = editor.snapshotDocument()
      expect(await tool.execute({ authentication: 'local-keycloak', mode })).toHaveProperty('error')
      expect(editor.documentSnapshotChanged(protectedDocument)).toBe(false)
      const fresh = await setup()
      expect(
        await fresh.tool.execute({
          authentication: 'oidc',
          mode,
          issuer: 'https://identity.example.com',
          client_id: 'public-commerce'
        })
      ).toMatchObject({ status: 'created', authentication: { clientId: 'public-commerce' } })
      const authored = fresh.editor.snapshotDocument()
      expect(await fresh.tool.execute({ authentication: 'local-keycloak', mode })).toHaveProperty(
        'error'
      )
      expect(fresh.editor.documentSnapshotChanged(authored)).toBe(false)
    }
  )

  test('rechecks enabled provider authority after readiness and respects cancellation', async () => {
    const { editor, pluginStore } = await setup()
    const before = editor.snapshotDocument()
    const tools = createAITools(editor, {
      commerce: {
        pluginStore,
        ready: () => pluginStore.setEnabled(NESTJS_BACKEND_PROVIDER_PLUGIN_ID, false)
      }
    })
    expect(
      await (tools[COMMERCE_AI_TOOL_NAME] as ExecutableTool).execute({
        authentication: 'local-keycloak',
        mode: 'single-merchant'
      })
    ).toHaveProperty('error')
    await pluginStore.setEnabled(NESTJS_BACKEND_PROVIDER_PLUGIN_ID, true)
    const controller = new AbortController()
    const cancelled = createAITools(editor, {
      commerce: {
        pluginStore,
        ready: async () => {
          controller.abort()
        }
      }
    })[COMMERCE_AI_TOOL_NAME] as ExecutableTool
    await expect(
      cancelled.execute(
        { authentication: 'local-keycloak', mode: 'multi-merchant' },
        {
          abortSignal: controller.signal
        }
      )
    ).rejects.toHaveProperty('name', 'AbortError')
    expect(editor.documentSnapshotChanged(before)).toBe(false)
    expect(editor.undo.canUndo).toBe(false)
  })

  test('rejects a changed provider package before either merchant template can mutate the document', async () => {
    const { editor, pluginStore } = await setup()
    const original = editor.snapshotDocument()
    const changedProvider = {
      installedBackendProviders: () =>
        pluginStore.installedBackendProviders().map((installed) => ({
          ...installed,
          plugin: {
            ...installed.plugin,
            package: { ...installed.plugin.package, digest: 'app-bundle-sha256:changed-commerce' }
          }
        }))
    }
    const tool = createAITools(editor, {
      commerce: { pluginStore: changedProvider, ready: async () => undefined }
    })[COMMERCE_AI_TOOL_NAME] as ExecutableTool
    for (const mode of MODES) {
      expect(await tool.execute({ authentication: 'local-keycloak', mode })).toHaveProperty('error')
      expect(editor.documentSnapshotChanged(original)).toBe(false)
    }
    expect(editor.undo.canUndo).toBe(false)
  })
})
