import { describe, expect, test } from 'bun:test'

import {
  DROPDOWN_MENU_MODULE_DEFAULT_CONFIG,
  DROPDOWN_MENU_PLUGIN_ID,
  MAP_PLUGIN_ID,
  UPLOAD_BUTTON_MODULE_DEFAULT_CONFIG,
  UPLOAD_BUTTON_PLUGIN_ID
} from '@open-pencil/core/plugins'

import {
  createAutomationPluginMCPHandlers,
  type AutomationPluginMCPDependencies
} from '@/app/automation/bridge/plugin-mcp-handler'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createEditorStore } from '@/app/editor/session'
import type { ThirdPartyPluginAIContributionGrant } from '@/app/plugins/ai-authorization'
import { createBundledPluginCatalog } from '@/app/plugins/catalog'
import {
  AIRTABLE_LIST_RECORDS_OPERATION_ID,
  AIRTABLE_RECORDS_PLUGIN_ID
} from '@/app/plugins/connectors/airtable-records'
import {
  ACCESSIBILITY_AUDIT_PLUGIN_ID,
  CLIPBOARD_TOOLKIT_PLUGIN_ID,
  DESIGN_TOKENS_EXPORTER_PLUGIN_ID,
  VUE_EXPORTER_PLUGIN_ID
} from '@/app/plugins/host/ids'
import type {
  AppPluginMCPStore,
  AppPluginMCPToolCatalog,
  AppPluginMCPToolDescriptor
} from '@/app/plugins/mcp'
import { createMemoryAppPluginStateStorage } from '@/app/plugins/storage'
import { createAppPluginStore } from '@/app/plugins/store'

function createStore() {
  return createAppPluginStore({
    storage: createMemoryAppPluginStateStorage(),
    catalog: createBundledPluginCatalog(),
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.0.0'
  })
}

function target(): AutomationTarget {
  const store = createEditorStore()
  const page = store.graph.getNode(store.state.currentPageId)
  if (!page) throw new Error('Expected current page')
  return {
    store,
    documentId: 'plugin-mcp-test',
    documentName: 'Plugin MCP test',
    pageId: page.id,
    pageName: page.name
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
  args: unknown = {}
) {
  return {
    name: descriptor.name,
    pluginId: descriptor.pluginId,
    expectedCatalogRevision: catalog.revision,
    expectedDescriptor: expectedDescriptor(descriptor),
    args
  }
}

describe('automation plugin MCP handler', () => {
  test('checkpoints publisher trust before listing or dispatching plugin tools', async () => {
    const store = createStore()
    await store.load()
    let checkpointFailure: Error | null = null
    let dispatches = 0
    const handlers = createAutomationPluginMCPHandlers(
      async () => {
        dispatches += 1
        return { ok: true }
      },
      {
        store,
        async checkpointPublisherTrust() {
          if (checkpointFailure) throw checkpointFailure
        },
        runCommand: async () => ({ status: 'completed', message: 'command' }),
        runExporter: async () => ({ status: 'completed', message: 'export' })
      }
    )
    const listed = await handlers.handleList()
    const descriptor = listed.result.tools.find(({ pluginId }) => pluginId === MAP_PLUGIN_ID)
    if (!descriptor) throw new Error('Expected Map MCP descriptor')
    checkpointFailure = new Error('publisher state changed in another window')

    await expect(handlers.handleList()).rejects.toBe(checkpointFailure)
    await expect(
      handlers.handleCall(target(), {
        name: descriptor.name,
        pluginId: descriptor.pluginId,
        args: {}
      })
    ).rejects.toBe(checkpointFailure)
    expect(dispatches).toBe(0)
  })

  test('dispatches a module through the trusted core tool with fixed identity', async () => {
    const store = createStore()
    await store.load()
    const dispatches: unknown[] = []
    const handleAutomationTool = async (
      _target: AutomationTarget,
      args: unknown
    ): Promise<unknown> => {
      dispatches.push(args)
      return { ok: true, result: { created: true } }
    }
    const dependencies: AutomationPluginMCPDependencies = {
      store,
      runCommand: async () => ({ status: 'completed', message: 'command' }),
      runExporter: async () => ({ status: 'completed', message: 'export' })
    }
    const handlers = createAutomationPluginMCPHandlers(handleAutomationTool, dependencies)
    const descriptor = (await handlers.handleList()).result.tools[0]

    const response = await handlers.handleCall(target(), {
      name: descriptor.name,
      pluginId: MAP_PLUGIN_ID,
      args: {
        x: 24,
        y: 32,
        width: 480,
        name: 'MCP map',
        config: { center: [116.4074, 39.9042], zoom: 10 }
      }
    })
    expect(response).toEqual({ ok: true, result: { created: true } })
    expect(dispatches).toEqual([
      {
        name: 'create_module',
        args: {
          x: 24,
          y: 32,
          width: 480,
          name: 'MCP map',
          config: { center: [116.4074, 39.9042], zoom: 10 },
          plugin_id: MAP_PLUGIN_ID,
          module_type: descriptor.contributionId
        }
      }
    ])

    const approvedDispatches: Record<string, unknown>[] = []
    const approvedResponse = await handlers.handleCall(
      target(),
      {
        name: descriptor.name,
        pluginId: MAP_PLUGIN_ID,
        args: { x: 40, config: { zoom: 8 } }
      },
      undefined,
      {
        executeModule: async (args) => {
          approvedDispatches.push(args)
          return { ok: true, result: { approved: true } }
        }
      }
    )
    expect(approvedResponse).toEqual({ ok: true, result: { approved: true } })
    expect(approvedDispatches).toEqual([
      {
        x: 40,
        config: { zoom: 8 },
        plugin_id: MAP_PLUGIN_ID,
        module_type: descriptor.contributionId
      }
    ])
    expect(dispatches).toHaveLength(1)

    await expect(
      handlers.handleCall(target(), {
        name: descriptor.name,
        pluginId: MAP_PLUGIN_ID,
        args: { plugin_id: 'attacker.plugin' }
      })
    ).rejects.toThrow('unsupported field')
    await expect(
      handlers.handleCall(target(), {
        name: descriptor.name,
        pluginId: 'attacker.plugin',
        args: {}
      })
    ).rejects.toThrow('does not belong')

    let getterCalled = false
    const accessorRequest: Record<string, unknown> = {
      pluginId: MAP_PLUGIN_ID,
      args: {}
    }
    Object.defineProperty(accessorRequest, 'name', {
      enumerable: true,
      get() {
        getterCalled = true
        return descriptor.name
      }
    })
    await expect(handlers.handleCall(target(), accessorRequest)).rejects.toThrow(
      'enumerable data field'
    )
    expect(getterCalled).toBe(false)
    await expect(
      handlers.handleCall(target(), {
        name: descriptor.name,
        pluginId: MAP_PLUGIN_ID,
        args: { config: JSON.parse('{"__proto__":{"polluted":true}}') }
      })
    ).rejects.toThrow('unsafe key')
    await expect(
      handlers.handleCall(target(), {
        name: descriptor.name,
        pluginId: MAP_PLUGIN_ID,
        args: { config: { payload: 'x'.repeat(70_000) } }
      })
    ).rejects.toThrow('byte limit')

    await store.setEnabled(MAP_PLUGIN_ID, false)
    await expect(
      handlers.handleCall(target(), {
        name: descriptor.name,
        pluginId: MAP_PLUGIN_ID,
        args: {}
      })
    ).rejects.toThrow('is unavailable')
    expect(dispatches).toHaveLength(1)
  })

  test('dispatches Dropdown Menu only through its live installed-and-enabled MCP authority', async () => {
    const store = createStore()
    await store.load()
    const dispatches: unknown[] = []
    const handlers = createAutomationPluginMCPHandlers(
      async (_target, args) => {
        dispatches.push(args)
        return { ok: true, result: { created: true } }
      },
      {
        store,
        runCommand: async () => ({ status: 'completed', message: 'unused' }),
        runExporter: async () => ({ status: 'completed', message: 'unused' })
      }
    )

    expect(
      (await handlers.handleList()).result.tools.some(
        (tool) => tool.pluginId === DROPDOWN_MENU_PLUGIN_ID
      )
    ).toBe(false)
    await store.install(DROPDOWN_MENU_PLUGIN_ID)
    expect(
      (await handlers.handleList()).result.tools.some(
        (tool) => tool.pluginId === DROPDOWN_MENU_PLUGIN_ID
      )
    ).toBe(false)

    await store.setEnabled(DROPDOWN_MENU_PLUGIN_ID, true)
    const descriptor = (await handlers.handleList()).result.tools.find(
      (tool) => tool.pluginId === DROPDOWN_MENU_PLUGIN_ID
    )
    if (!descriptor) throw new Error('Expected Dropdown Menu MCP descriptor')
    const config = {
      ...structuredClone(DROPDOWN_MENU_MODULE_DEFAULT_CONFIG),
      triggerLabel: 'Open account menu'
    }
    await expect(
      handlers.handleCall(target(), {
        name: descriptor.name,
        pluginId: DROPDOWN_MENU_PLUGIN_ID,
        args: { x: 48, y: 64, name: 'Account menu', config }
      })
    ).resolves.toEqual({ ok: true, result: { created: true } })
    expect(dispatches).toEqual([
      {
        name: 'create_module',
        args: {
          x: 48,
          y: 64,
          name: 'Account menu',
          config,
          plugin_id: DROPDOWN_MENU_PLUGIN_ID,
          module_type: descriptor.contributionId
        }
      }
    ])

    await store.setEnabled(DROPDOWN_MENU_PLUGIN_ID, false)
    await expect(
      handlers.handleCall(target(), {
        name: descriptor.name,
        pluginId: DROPDOWN_MENU_PLUGIN_ID,
        args: { config }
      })
    ).rejects.toThrow('is unavailable')
    expect(dispatches).toHaveLength(1)
  })

  test('dispatches only declarative Upload Button config and revokes stale authority', async () => {
    const store = createStore()
    await store.load()
    const dispatches: unknown[] = []
    const handlers = createAutomationPluginMCPHandlers(
      async (_target, args) => {
        dispatches.push(args)
        return { ok: true, result: { created: true } }
      },
      {
        store,
        runCommand: async () => ({ status: 'completed', message: 'unused' }),
        runExporter: async () => ({ status: 'completed', message: 'unused' })
      }
    )

    expect(
      (await handlers.handleList()).result.tools.some(
        (tool) => tool.pluginId === UPLOAD_BUTTON_PLUGIN_ID
      )
    ).toBe(false)
    await store.install(UPLOAD_BUTTON_PLUGIN_ID)
    expect(
      (await handlers.handleList()).result.tools.some(
        (tool) => tool.pluginId === UPLOAD_BUTTON_PLUGIN_ID
      )
    ).toBe(false)
    await store.setEnabled(UPLOAD_BUTTON_PLUGIN_ID, true)
    const descriptor = (await handlers.handleList()).result.tools.find(
      (tool) => tool.pluginId === UPLOAD_BUTTON_PLUGIN_ID
    )
    if (!descriptor) throw new Error('Expected Upload Button MCP descriptor')

    const config = {
      ...structuredClone(UPLOAD_BUTTON_MODULE_DEFAULT_CONFIG),
      triggerLabel: 'Choose local images',
      accept: ['image/*'],
      multiple: true,
      maxFiles: 3
    }
    const response = await handlers.handleCall(target(), {
      name: descriptor.name,
      pluginId: UPLOAD_BUTTON_PLUGIN_ID,
      args: { x: 48, y: 64, name: 'Local image picker', config }
    })
    expect(response).toEqual({ ok: true, result: { created: true } })
    expect(dispatches).toEqual([
      {
        name: 'create_module',
        args: {
          x: 48,
          y: 64,
          name: 'Local image picker',
          config,
          plugin_id: UPLOAD_BUTTON_PLUGIN_ID,
          module_type: descriptor.contributionId
        }
      }
    ])
    expect(JSON.stringify(dispatches)).not.toContain('fileNames')
    expect(JSON.stringify(dispatches)).not.toContain('fileBytes')
    expect(JSON.stringify(response)).not.toContain('fileNames')
    expect(JSON.stringify(response)).not.toContain('fileBytes')

    for (const forbidden of [
      { fileNames: ['private.png'] },
      { fileBytes: 'cHJpdmF0ZQ==' },
      { selectedFiles: [{ name: 'private.png' }] }
    ]) {
      await expect(
        handlers.handleCall(target(), {
          name: descriptor.name,
          pluginId: UPLOAD_BUTTON_PLUGIN_ID,
          args: { config: { ...config, ...forbidden } }
        })
      ).rejects.toThrow('must contain exactly')
    }
    expect(dispatches).toHaveLength(1)

    await store.setEnabled(UPLOAD_BUTTON_PLUGIN_ID, false)
    await expect(
      handlers.handleCall(target(), {
        name: descriptor.name,
        pluginId: UPLOAD_BUTTON_PLUGIN_ID,
        args: { config }
      })
    ).rejects.toThrow('is unavailable')

    await store.setEnabled(UPLOAD_BUTTON_PLUGIN_ID, true)
    await store.uninstall(UPLOAD_BUTTON_PLUGIN_ID)
    await expect(
      handlers.handleCall(target(), {
        name: descriptor.name,
        pluginId: UPLOAD_BUTTON_PLUGIN_ID,
        args: { config }
      })
    ).rejects.toThrow('is unavailable')
    expect(dispatches).toHaveLength(1)
  })

  test('routes command and exporter tools only through trusted host executors', async () => {
    const store = createStore()
    await store.load()
    await store.install(CLIPBOARD_TOOLKIT_PLUGIN_ID)
    await store.setEnabled(CLIPBOARD_TOOLKIT_PLUGIN_ID, true)
    await store.install(DESIGN_TOKENS_EXPORTER_PLUGIN_ID)
    await store.setEnabled(DESIGN_TOKENS_EXPORTER_PLUGIN_ID, true)
    const executions: string[] = []
    const controller = new AbortController()
    let commandSignal: AbortSignal | undefined
    let exporterSignal: AbortSignal | undefined
    const dependencies: AutomationPluginMCPDependencies = {
      store,
      runCommand: async (_editor, plugin, contribution, _args, signal) => {
        commandSignal = signal
        executions.push(`command:${plugin.package.manifest.plugin.id}:${contribution.commandId}`)
        return { status: 'completed', message: 'Copied' }
      },
      runExporter: async (_editor, plugin, contribution, signal) => {
        exporterSignal = signal
        executions.push(`exporter:${plugin.package.manifest.plugin.id}:${contribution.exporterId}`)
        return { status: 'cancelled', message: 'Export cancelled' }
      }
    }
    const handlers = createAutomationPluginMCPHandlers(async () => {
      throw new Error('Host contribution must not dispatch a core module tool')
    }, dependencies)
    const tools = (await handlers.handleList()).result.tools
    const command = tools.find((tool) => tool.pluginId === CLIPBOARD_TOOLKIT_PLUGIN_ID)
    const exporter = tools.find((tool) => tool.pluginId === DESIGN_TOKENS_EXPORTER_PLUGIN_ID)
    if (!command || !exporter) throw new Error('Expected command and exporter descriptors')

    await expect(
      handlers.handleCall(target(), {
        name: command.name,
        pluginId: command.pluginId,
        args: { arbitrary: true }
      })
    ).rejects.toThrow('unsupported field')
    expect(executions).toEqual([])

    expect(
      await handlers.handleCall(
        target(),
        {
          name: command.name,
          pluginId: command.pluginId,
          args: {}
        },
        { signal: controller.signal }
      )
    ).toMatchObject({
      ok: true,
      result: {
        pluginId: command.pluginId,
        kind: 'command',
        contributionId: command.contributionId,
        status: 'completed'
      }
    })
    expect(
      await handlers.handleCall(
        target(),
        {
          name: exporter.name,
          pluginId: exporter.pluginId,
          args: {}
        },
        { signal: controller.signal }
      )
    ).toMatchObject({
      ok: true,
      result: {
        pluginId: exporter.pluginId,
        kind: 'exporter',
        contributionId: exporter.contributionId,
        status: 'cancelled'
      }
    })
    expect(executions).toEqual([
      `command:${command.pluginId}:${command.contributionId}`,
      `exporter:${exporter.pluginId}:${exporter.contributionId}`
    ])
    expect(commandSignal).toBe(controller.signal)
    expect(exporterSignal).toBe(controller.signal)

    await store.setEnabled(CLIPBOARD_TOOLKIT_PLUGIN_ID, false)
    await expect(
      handlers.handleCall(target(), {
        name: command.name,
        pluginId: command.pluginId,
        args: {}
      })
    ).rejects.toThrow('is unavailable')
  })

  test('binds publisher commands to an exact AI grant and fails closed for missing or changed authority', async () => {
    const store = createStore()
    await store.load()
    await store.install(ACCESSIBILITY_AUDIT_PLUGIN_ID)
    await store.setEnabled(ACCESSIBILITY_AUDIT_PLUGIN_ID, true)
    const installed = store
      .installedCommands()
      .find(({ plugin }) => plugin.package.manifest.plugin.id === ACCESSIBILITY_AUDIT_PLUGIN_ID)
    if (!installed) throw new Error('Expected accessibility audit command')
    const publisherCommand = {
      ...installed,
      plugin: {
        ...installed.plugin,
        package: {
          ...installed.plugin.package,
          trustSource: 'publisher-signature' as const,
          digest: 'P'.repeat(43)
        }
      }
    }
    const publisherStore: AppPluginMCPStore = {
      installedModules: () => [],
      installedCommands: () => [publisherCommand],
      installedExporters: () => [],
      installedConnectors: () => []
    }
    const mcpOptions = { publisherContributionExposure: () => true }
    const events: string[] = []
    let resolvedGrant: ThirdPartyPluginAIContributionGrant | null = null
    const handlers = createAutomationPluginMCPHandlers(
      async () => {
        throw new Error('Publisher command must not dispatch a core module tool')
      },
      {
        store: publisherStore,
        mcpOptions,
        runCommand: async () => {
          events.push('run')
          return { status: 'completed', message: 'Audit complete' }
        },
        runExporter: async () => ({ status: 'cancelled', message: 'unused' }),
        resolvePublisherAIGrant: () => resolvedGrant
      }
    )
    const catalog = (await handlers.handleList()).result
    const descriptor = catalog.tools.find(
      ({ pluginId }) => pluginId === ACCESSIBILITY_AUDIT_PLUGIN_ID
    )
    if (!descriptor || descriptor.kind !== 'command') {
      throw new Error('Expected Publisher accessibility command descriptor')
    }
    const authority = descriptor.authority
    resolvedGrant = Object.freeze({
      pluginId: descriptor.pluginId,
      kind: 'command',
      contributionId: descriptor.contributionId,
      adapterId: authority.adapterId,
      packageDigest: authority.packageDigest,
      pluginVersion: authority.pluginVersion,
      publisherId: authority.publisherId,
      publisherKeyId: authority.publisherKeyId,
      grantId: 'publisher-command-grant',
      grantedAt: 1
    })
    const bindings: unknown[] = []

    await expect(
      handlers.handleCall(
        target(),
        strictCall(catalog, descriptor),
        {
          onPluginMCPResolved(boundDescriptor, publisherGrantId) {
            events.push('bind')
            bindings.push({ descriptor: boundDescriptor, publisherGrantId })
          }
        },
        { requireExpectedAuthority: true }
      )
    ).resolves.toMatchObject({
      ok: true,
      result: {
        pluginId: descriptor.pluginId,
        kind: 'command',
        contributionId: descriptor.contributionId,
        status: 'completed'
      }
    })
    expect(bindings).toEqual([
      {
        descriptor: expectedDescriptor(descriptor),
        publisherGrantId: resolvedGrant.grantId
      }
    ])
    expect(events).toEqual(['bind', 'run'])

    for (const unavailableGrant of [
      null,
      Object.freeze({ ...resolvedGrant, publisherKeyId: 'replacement-publisher-key' })
    ]) {
      let dispatches = 0
      let binds = 0
      const rejectingHandlers = createAutomationPluginMCPHandlers(
        async () => {
          throw new Error('Publisher command must not dispatch a core module tool')
        },
        {
          store: publisherStore,
          mcpOptions,
          runCommand: async () => {
            dispatches += 1
            return { status: 'completed', message: 'unexpected' }
          },
          runExporter: async () => ({ status: 'cancelled', message: 'unused' }),
          resolvePublisherAIGrant: () => unavailableGrant
        }
      )

      await expect(
        rejectingHandlers.handleCall(
          target(),
          strictCall(catalog, descriptor),
          {
            onPluginMCPResolved() {
              binds += 1
            }
          },
          { requireExpectedAuthority: true }
        )
      ).rejects.toThrow('grant authority changed')
      expect(binds).toBe(0)
      expect(dispatches).toBe(0)
    }
  })

  test('dispatches the enabled Vue exporter through MCP and revokes its cached tool name', async () => {
    const store = createStore()
    await store.load()
    await store.install(VUE_EXPORTER_PLUGIN_ID)
    const calls: string[] = []
    const dependencies: AutomationPluginMCPDependencies = {
      store,
      runCommand: async () => ({ status: 'completed', message: 'command' }),
      runExporter: async (_editor, plugin, contribution, signal, args) => {
        calls.push(
          `${plugin.package.manifest.plugin.id}:${contribution.exporterId}:${signal?.aborted === false}:${JSON.stringify(args)}`
        )
        return { status: 'completed', message: 'Vue project exported' }
      }
    }
    const handlers = createAutomationPluginMCPHandlers(async () => {
      throw new Error('Vue export must not dispatch a core module tool')
    }, dependencies)

    expect(
      (await handlers.handleList()).result.tools.some(
        ({ pluginId }) => pluginId === VUE_EXPORTER_PLUGIN_ID
      )
    ).toBe(false)
    await store.setEnabled(VUE_EXPORTER_PLUGIN_ID, true)
    const descriptor = (await handlers.handleList()).result.tools.find(
      ({ pluginId }) => pluginId === VUE_EXPORTER_PLUGIN_ID
    )
    if (!descriptor) throw new Error('Expected enabled Vue exporter MCP descriptor')
    const controller = new AbortController()

    await expect(
      handlers.handleCall(
        target(),
        { name: descriptor.name, pluginId: VUE_EXPORTER_PLUGIN_ID, args: {} },
        { signal: controller.signal }
      )
    ).resolves.toMatchObject({
      ok: true,
      result: {
        pluginId: VUE_EXPORTER_PLUGIN_ID,
        kind: 'exporter',
        contributionId: 'vue-source',
        status: 'completed'
      }
    })
    expect(calls).toEqual([`${VUE_EXPORTER_PLUGIN_ID}:vue-source:true:{}`])

    await store.setEnabled(VUE_EXPORTER_PLUGIN_ID, false)
    await expect(
      handlers.handleCall(target(), {
        name: descriptor.name,
        pluginId: VUE_EXPORTER_PLUGIN_ID,
        args: {}
      })
    ).rejects.toThrow('is unavailable')
    expect(calls).toHaveLength(1)
  })

  test('revalidates v2 arguments, forwards the normalized object, and observes live disable', async () => {
    const store = createStore()
    await store.load()
    await store.install(ACCESSIBILITY_AUDIT_PLUGIN_ID)
    await store.setEnabled(ACCESSIBILITY_AUDIT_PLUGIN_ID, true)
    const received: unknown[] = []
    const dependencies: AutomationPluginMCPDependencies = {
      store,
      runCommand: async (_editor, _plugin, _contribution, args) => {
        received.push(args)
        return { status: 'completed', message: 'audit complete' }
      },
      runExporter: async () => ({ status: 'cancelled', message: 'unused' })
    }
    const handlers = createAutomationPluginMCPHandlers(async () => {
      throw new Error('Command must not dispatch a core module tool')
    }, dependencies)
    const descriptor = (await handlers.handleList()).result.tools.find(
      (tool) => tool.pluginId === ACCESSIBILITY_AUDIT_PLUGIN_ID
    )
    if (!descriptor) throw new Error('Expected accessibility MCP descriptor')

    await expect(
      handlers.handleCall(target(), {
        name: descriptor.name,
        pluginId: descriptor.pluginId,
        args: {}
      })
    ).resolves.toMatchObject({
      ok: true,
      result: { kind: 'command', status: 'completed' }
    })
    expect(received).toEqual([{}])
    await expect(
      handlers.handleCall(target(), {
        name: descriptor.name,
        pluginId: descriptor.pluginId,
        args: { elevated: true }
      })
    ).rejects.toThrow('not supported')
    await expect(
      handlers.handleCall(target(), {
        name: descriptor.name,
        pluginId: descriptor.pluginId,
        args: null
      })
    ).rejects.toThrow('must be an object')
    expect(received).toHaveLength(1)

    await store.setEnabled(ACCESSIBILITY_AUDIT_PLUGIN_ID, false)
    await expect(
      handlers.handleCall(target(), {
        name: descriptor.name,
        pluginId: descriptor.pluginId,
        args: {}
      })
    ).rejects.toThrow('is unavailable')
    expect(received).toHaveLength(1)
  })

  test('routes an authorized connector query through the broker dependency and revokes live', async () => {
    const store = createStore()
    await store.load()
    await store.install(AIRTABLE_RECORDS_PLUGIN_ID)
    await store.setEnabled(AIRTABLE_RECORDS_PLUGIN_ID, true)
    let authorized = true
    const received: unknown[] = []
    const controller = new AbortController()
    const dependencies: AutomationPluginMCPDependencies = {
      store,
      mcpOptions: { connectorExposure: () => authorized },
      runCommand: async () => ({ status: 'cancelled', message: 'unused' }),
      runExporter: async () => ({ status: 'cancelled', message: 'unused' }),
      runConnector: async (connector, operation, args, signal) => {
        received.push({ connectorId: connector.contribution.connectorId, operation, args, signal })
        return {
          data: { records: [], hasMore: false },
          httpStatus: 200,
          requestBytes: 0,
          responseBytes: 32
        }
      }
    }
    const handlers = createAutomationPluginMCPHandlers(async () => {
      throw new Error('Connector query must not dispatch a core module tool')
    }, dependencies)
    const descriptor = (await handlers.handleList()).result.tools.find(
      (tool) => tool.pluginId === AIRTABLE_RECORDS_PLUGIN_ID
    )
    if (!descriptor) throw new Error('Expected Airtable connector MCP descriptor')

    await expect(
      handlers.handleCall(
        target(),
        {
          name: descriptor.name,
          pluginId: descriptor.pluginId,
          args: { baseId: 'app1234', tableId: 'tbl5678', pageSize: 25 }
        },
        { signal: controller.signal }
      )
    ).resolves.toMatchObject({
      ok: true,
      result: {
        pluginId: AIRTABLE_RECORDS_PLUGIN_ID,
        kind: 'connector',
        httpStatus: 200,
        data: { records: [], hasMore: false }
      }
    })
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({
      operation: { operationId: AIRTABLE_LIST_RECORDS_OPERATION_ID },
      args: { baseId: 'app1234', tableId: 'tbl5678', pageSize: 25 },
      signal: controller.signal
    })

    await expect(
      handlers.handleCall(target(), {
        name: descriptor.name,
        pluginId: descriptor.pluginId,
        args: { baseId: 'app1234', tableId: 'tbl5678', secret: 'forbidden' }
      })
    ).rejects.toThrow('not supported')
    expect(received).toHaveLength(1)

    authorized = false
    await expect(
      handlers.handleCall(target(), {
        name: descriptor.name,
        pluginId: descriptor.pluginId,
        args: { baseId: 'app1234', tableId: 'tbl5678' }
      })
    ).rejects.toThrow('is unavailable')
    expect(received).toHaveLength(1)
  })

  test('requires and compares the exact catalog authority on the cross-process call boundary', async () => {
    const store = createStore()
    await store.load()
    const map = store
      .installedModules()
      .find(({ plugin }) => plugin.package.manifest.plugin.id === MAP_PLUGIN_ID)
    if (!map) throw new Error('Expected installed Map module')
    let packageDigest = map.plugin.package.digest
    let pluginVersion = map.plugin.package.manifest.plugin.version
    let publisherKeyId = map.plugin.package.manifest.publisher.keyId
    const adapterId = map.contribution.adapterId
    const authorityStore: AppPluginMCPStore = {
      installedModules: () => [
        {
          plugin: {
            ...map.plugin,
            package: {
              ...map.plugin.package,
              digest: packageDigest,
              manifest: {
                ...map.plugin.package.manifest,
                plugin: { ...map.plugin.package.manifest.plugin, version: pluginVersion },
                publisher: { ...map.plugin.package.manifest.publisher, keyId: publisherKeyId }
              }
            }
          },
          contribution: { ...map.contribution, adapterId }
        }
      ],
      installedCommands: () => [],
      installedExporters: () => [],
      installedConnectors: () => []
    }
    const dispatches: unknown[] = []
    const handlers = createAutomationPluginMCPHandlers(
      async (_target, args) => {
        dispatches.push(args)
        return { ok: true, result: { created: true } }
      },
      {
        store: authorityStore,
        runCommand: async () => ({ status: 'cancelled', message: 'unused' }),
        runExporter: async () => ({ status: 'cancelled', message: 'unused' })
      }
    )
    const catalog = (await handlers.handleList()).result
    const descriptor = catalog.tools.find(({ pluginId }) => pluginId === MAP_PLUGIN_ID)
    if (!descriptor) throw new Error('Expected Map MCP descriptor')
    const strictOptions = { requireExpectedAuthority: true }

    await expect(
      handlers.handleCall(target(), strictCall(catalog, descriptor), undefined, strictOptions)
    ).resolves.toEqual({ ok: true, result: { created: true } })
    expect(dispatches).toHaveLength(1)

    await expect(
      handlers.handleCall(
        target(),
        { name: descriptor.name, pluginId: descriptor.pluginId, args: {} },
        undefined,
        strictOptions
      )
    ).rejects.toThrow('must include expectedCatalogRevision and expectedDescriptor')

    const staleRevision = strictCall(catalog, descriptor)
    staleRevision.expectedCatalogRevision = `${catalog.revision}-stale`
    await expect(
      handlers.handleCall(target(), staleRevision, undefined, strictOptions)
    ).rejects.toThrow('catalog authority changed')

    const authorityReplacements = [
      {
        packageDigest: `app-bundle-sha256:${'B'.repeat(43)}`
      },
      { pluginVersion: '9.0.0' },
      { publisherId: 'replacement-publisher' },
      { publisherKeyId: 'replacement-key-v2' },
      { adapterId: 'replacement.map-adapter' },
      {
        trustSource: 'publisher-signature' as const,
        packageDigest: 'C'.repeat(43)
      }
    ]
    for (const replacement of authorityReplacements) {
      const stale = strictCall(catalog, descriptor)
      stale.expectedDescriptor = {
        ...stale.expectedDescriptor,
        authority: { ...stale.expectedDescriptor.authority, ...replacement }
      }
      await expect(handlers.handleCall(target(), stale, undefined, strictOptions)).rejects.toThrow(
        'catalog authority changed'
      )
    }

    for (const replacement of [
      { title: 'Replacement Map Tool' },
      { kind: 'command' as const },
      { contributionId: 'replacement-map' }
    ]) {
      const stale = strictCall(catalog, descriptor)
      stale.expectedDescriptor = { ...stale.expectedDescriptor, ...replacement }
      await expect(handlers.handleCall(target(), stale, undefined, strictOptions)).rejects.toThrow(
        'catalog authority changed'
      )
    }
    expect(dispatches).toHaveLength(1)

    const staleCatalogCall = strictCall(catalog, descriptor)
    packageDigest = `app-bundle-sha256:${'D'.repeat(43)}`
    pluginVersion = '2.0.0'
    publisherKeyId = 'app-bundle-v2'
    const replacementCatalog = (await handlers.handleList()).result
    const replacementDescriptor = replacementCatalog.tools[0]
    if (!replacementDescriptor) throw new Error('Expected replacement Map MCP descriptor')
    expect(replacementDescriptor.name).toBe(descriptor.name)
    expect(replacementCatalog.revision).not.toBe(catalog.revision)
    await expect(
      handlers.handleCall(target(), staleCatalogCall, undefined, strictOptions)
    ).rejects.toThrow('catalog authority changed')
    await expect(
      handlers.handleCall(
        target(),
        strictCall(replacementCatalog, replacementDescriptor),
        undefined,
        strictOptions
      )
    ).resolves.toEqual({ ok: true, result: { created: true } })
    expect(dispatches).toHaveLength(2)
  })
})
