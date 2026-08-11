import { describe, expect, test } from 'bun:test'

import {
  DROPDOWN_MENU_MODULE_DEFAULT_CONFIG,
  DROPDOWN_MENU_PLUGIN_ID,
  MAP_PLUGIN_ID,
  UPLOAD_BUTTON_MODULE_DEFAULT_CONFIG,
  UPLOAD_BUTTON_PLUGIN_ID
} from '@open-pencil/core/plugins'

import {
  createAutomationPluginMcpHandlers,
  type AutomationPluginMcpDependencies
} from '@/app/automation/bridge/plugin-mcp-handler'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createEditorStore } from '@/app/editor/session'
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

describe('automation plugin MCP handler', () => {
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
    const dependencies: AutomationPluginMcpDependencies = {
      store,
      runCommand: async () => ({ status: 'completed', message: 'command' }),
      runExporter: async () => ({ status: 'completed', message: 'export' })
    }
    const handlers = createAutomationPluginMcpHandlers(handleAutomationTool, dependencies)
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
    const handlers = createAutomationPluginMcpHandlers(
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
    const handlers = createAutomationPluginMcpHandlers(
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
    const dependencies: AutomationPluginMcpDependencies = {
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
    const handlers = createAutomationPluginMcpHandlers(async () => {
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

  test('dispatches the enabled Vue exporter through MCP and revokes its cached tool name', async () => {
    const store = createStore()
    await store.load()
    await store.install(VUE_EXPORTER_PLUGIN_ID)
    const calls: string[] = []
    const dependencies: AutomationPluginMcpDependencies = {
      store,
      runCommand: async () => ({ status: 'completed', message: 'command' }),
      runExporter: async (_editor, plugin, contribution, signal, args) => {
        calls.push(
          `${plugin.package.manifest.plugin.id}:${contribution.exporterId}:${signal?.aborted === false}:${JSON.stringify(args)}`
        )
        return { status: 'completed', message: 'Vue project exported' }
      }
    }
    const handlers = createAutomationPluginMcpHandlers(async () => {
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
    const dependencies: AutomationPluginMcpDependencies = {
      store,
      runCommand: async (_editor, _plugin, _contribution, args) => {
        received.push(args)
        return { status: 'completed', message: 'audit complete' }
      },
      runExporter: async () => ({ status: 'cancelled', message: 'unused' })
    }
    const handlers = createAutomationPluginMcpHandlers(async () => {
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
    const dependencies: AutomationPluginMcpDependencies = {
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
    const handlers = createAutomationPluginMcpHandlers(async () => {
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
})
