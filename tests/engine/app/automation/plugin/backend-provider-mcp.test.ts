import { describe, expect, test } from 'bun:test'

import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import {
  createAutomationPluginMCPHandlers,
  type AutomationPluginMCPDependencies
} from '@/app/automation/bridge/plugin-mcp-handler'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createEditorStore } from '@/app/editor/session'
import { createBundledPluginCatalog } from '@/app/plugins/catalog'
import { runInstalledPluginCommand } from '@/app/plugins/host'
import {
  APP_BACKEND_PROVIDER_DOCUMENT_KEY,
  APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID,
  APP_BACKEND_PROVIDER_MCP_COMMANDS,
  APP_BACKEND_PROVIDER_REQUEST_FORMAT,
  SUPABASE_BACKEND_PROVIDER_PLUGIN_ID,
  appBackendProviderDocumentValue,
  listAppBackendProviderDescriptors
} from '@/app/plugins/host/backend-provider'
import type { AppPluginMCPToolCatalog, AppPluginMCPToolDescriptor } from '@/app/plugins/mcp'
import { createMemoryAppPluginStateStorage } from '@/app/plugins/storage'
import { createAppPluginStore } from '@/app/plugins/store'

function backendApplication(
  capabilities: BackendApplicationSpecV1['capabilities'] = []
): BackendApplicationSpecV1 {
  return {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: 'backend-provider-mcp-test',
    dataModel: { version: 1, entities: [], enums: [], relations: [] },
    auth: {
      version: 1,
      identities: [],
      roles: [],
      ownership: [],
      tenants: [],
      rowAccess: []
    },
    workflows: { version: 1, workflows: [] },
    capabilities,
    secrets: []
  }
}

function expectedDescriptor(descriptor: AppPluginMCPToolDescriptor) {
  return {
    name: descriptor.name,
    title: descriptor.title,
    pluginId: descriptor.pluginId,
    kind: descriptor.kind,
    contributionId: descriptor.contributionId,
    authority: descriptor.authority
  }
}

function strictCall(
  catalog: AppPluginMCPToolCatalog,
  descriptor: AppPluginMCPToolDescriptor,
  args: unknown
) {
  return {
    name: descriptor.name,
    pluginId: descriptor.pluginId,
    expectedCatalogRevision: catalog.revision,
    expectedDescriptor: expectedDescriptor(descriptor),
    args
  }
}

async function setup(application: BackendApplicationSpecV1 = backendApplication()) {
  const store = createAppPluginStore({
    storage: createMemoryAppPluginStateStorage(),
    catalog: createBundledPluginCatalog(),
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.0.0'
  })
  const snapshot = await store.load()
  if (snapshot.error) throw snapshot.error
  const selection = listAppBackendProviderDescriptors(store)[0]
  if (!selection) throw new Error('Expected active Backend Provider')
  const editor = createEditorStore()
  editor.graph.updateNode(editor.graph.rootId, {
    pluginData: [
      {
        pluginId: APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID,
        key: APP_BACKEND_PROVIDER_DOCUMENT_KEY,
        value: appBackendProviderDocumentValue({
          format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
          selection,
          application
        })
      }
    ]
  })
  const page = editor.graph.getNode(editor.state.currentPageId)
  if (!page) throw new Error('Expected current page')
  const target: AutomationTarget = {
    store: editor,
    documentId: 'backend-provider-mcp-test',
    documentName: 'Backend Provider MCP test',
    pageId: page.id,
    pageName: page.name
  }
  return { store, target }
}

describe('Backend Provider MCP commands', () => {
  test('does not report Vue production ready for omitted runtime capabilities', async () => {
    const { store, target } = await setup(
      backendApplication([{ capability: 'data.read', required: true }])
    )
    const dependencies: AutomationPluginMCPDependencies = {
      store,
      runCommand: (editor, plugin, contribution, args, signal) =>
        runInstalledPluginCommand(editor, plugin, contribution, undefined, args, signal)
    }
    const handlers = createAutomationPluginMCPHandlers(async () => {
      throw new Error('Backend Provider MCP must not dispatch a core mutation tool')
    }, dependencies)
    const catalog = (await handlers.handleList()).result
    const plan = catalog.tools.find(
      ({ pluginId, contributionId }) =>
        pluginId === SUPABASE_BACKEND_PROVIDER_PLUGIN_ID &&
        contributionId === APP_BACKEND_PROVIDER_MCP_COMMANDS.plan.commandId
    )
    if (!plan) throw new Error('Expected Backend Provider plan tool')

    await expect(
      handlers.handleCall(
        target,
        strictCall(catalog, plan, { target: 'vue', mode: 'production' }),
        undefined,
        { requireExpectedAuthority: true }
      )
    ).rejects.toMatchObject({
      code: 'provider-plan-failed',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'backend-capability-source-only-mode-required',
          severity: 'error'
        })
      ])
    })
  })

  test('returns bounded secret-free audit and plan summaries without an Apply path', async () => {
    const { store, target } = await setup()
    let commandDispatches = 0
    let unrelatedDispatches = 0
    let credentialReadinessRefreshes = 0
    let backendCallsStarted = false
    const dependencies: AutomationPluginMCPDependencies = {
      store,
      refreshConnectorCredentialReadiness: async () => {
        credentialReadinessRefreshes += 1
        if (backendCallsStarted) {
          throw new Error('Backend Provider MCP must not inspect connector credential readiness')
        }
      },
      runCommand: async (editor, plugin, contribution, args, signal) => {
        commandDispatches += 1
        return runInstalledPluginCommand(editor, plugin, contribution, undefined, args, signal)
      },
      runExporter: async () => {
        unrelatedDispatches += 1
        throw new Error('Backend Provider MCP must not run an exporter')
      },
      runConnector: async () => {
        unrelatedDispatches += 1
        throw new Error('Backend Provider MCP must not run a connector')
      }
    }
    const handlers = createAutomationPluginMCPHandlers(async () => {
      unrelatedDispatches += 1
      throw new Error('Backend Provider MCP must not dispatch a core mutation tool')
    }, dependencies)
    const catalog = (await handlers.handleList()).result
    expect(credentialReadinessRefreshes).toBe(1)
    backendCallsStarted = true
    const backendTools = catalog.tools.filter(
      ({ pluginId }) => pluginId === SUPABASE_BACKEND_PROVIDER_PLUGIN_ID
    )
    expect(backendTools).toHaveLength(2)

    for (const operation of ['audit', 'plan'] as const) {
      const command = APP_BACKEND_PROVIDER_MCP_COMMANDS[operation]
      const descriptor = backendTools.find(
        ({ contributionId }) => contributionId === command.commandId
      )
      if (!descriptor) throw new Error(`Expected Backend Provider ${operation} tool`)
      const response = await handlers.handleCall(
        target,
        strictCall(catalog, descriptor, { target: 'react', mode: 'production' }),
        undefined,
        { requireExpectedAuthority: true }
      )
      expect(response).toMatchObject({
        ok: true,
        result: {
          pluginId: SUPABASE_BACKEND_PROVIDER_PLUGIN_ID,
          kind: 'command',
          contributionId: command.commandId,
          status: 'completed',
          data: {
            format: 'openpencil.backend-provider-mcp-result.v1',
            operation,
            status: 'ready',
            target: 'react',
            mode: 'production',
            safety: {
              credentialResolution: 'forbidden',
              sideEffects: 'none',
              applyAvailable: false
            }
          }
        }
      })
      const serialized = JSON.stringify(response)
      expect(serialized).not.toContain('backend-provider-mcp-test')
      expect(serialized).not.toContain('adapterPlans')
      expect(serialized).not.toContain('manifestPath')
      expect(serialized).not.toContain('files')
      expect(serialized).not.toContain('.sql')
    }
    expect(commandDispatches).toBe(2)
    expect(unrelatedDispatches).toBe(0)
    expect(credentialReadinessRefreshes).toBe(1)

    const audit = backendTools.find(
      ({ contributionId }) => contributionId === APP_BACKEND_PROVIDER_MCP_COMMANDS.audit.commandId
    )
    if (!audit) throw new Error('Expected Backend Provider audit tool')
    await expect(
      handlers.handleCall(
        target,
        strictCall(catalog, audit, {
          target: 'react',
          mode: 'production',
          credential: 'credential.not-allowed'
        })
      )
    ).rejects.toThrow('not supported')
    expect(commandDispatches).toBe(2)
    expect(credentialReadinessRefreshes).toBe(1)

    expect(
      backendTools.some(({ contributionId, name }) =>
        /apply|deploy|execute-migration/i.test(`${contributionId}\n${name}`)
      )
    ).toBe(false)
    expect(
      backendTools.every(({ description }) => description.includes('without credentials'))
    ).toBe(true)
    await store.setEnabled(SUPABASE_BACKEND_PROVIDER_PLUGIN_ID, false)
    await expect(
      handlers.handleCall(
        target,
        strictCall(catalog, audit, { target: 'react', mode: 'production' }),
        undefined,
        { requireExpectedAuthority: true }
      )
    ).rejects.toThrow('is unavailable')
    expect(commandDispatches).toBe(2)
    expect(unrelatedDispatches).toBe(0)
    expect(credentialReadinessRefreshes).toBe(1)
  })
})
