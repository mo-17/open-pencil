import { describe, expect, test } from 'bun:test'

import { MAP_PLUGIN_ID } from '@open-pencil/core/plugins'

import {
  createAutomationPluginMcpHandlers,
  type AutomationPluginMcpDependencies
} from '@/app/automation/bridge/plugin-mcp-handler'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createEditorStore } from '@/app/editor/session'
import { createBundledPluginCatalog } from '@/app/plugins/catalog'
import { CLIPBOARD_TOOLKIT_PLUGIN_ID, TAURI_REACT_EXPORTER_PLUGIN_ID } from '@/app/plugins/host/ids'
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
    const descriptor = handlers.handleList().result.tools[0]

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

  test('routes command and exporter tools only through trusted host executors', async () => {
    const store = createStore()
    await store.load()
    await store.install(CLIPBOARD_TOOLKIT_PLUGIN_ID)
    await store.setEnabled(CLIPBOARD_TOOLKIT_PLUGIN_ID, true)
    await store.install(TAURI_REACT_EXPORTER_PLUGIN_ID)
    await store.setEnabled(TAURI_REACT_EXPORTER_PLUGIN_ID, true)
    const executions: string[] = []
    const controller = new AbortController()
    let exporterSignal: AbortSignal | undefined
    const dependencies: AutomationPluginMcpDependencies = {
      store,
      runCommand: async (_editor, plugin, contribution) => {
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
    const tools = handlers.handleList().result.tools
    const command = tools.find((tool) => tool.pluginId === CLIPBOARD_TOOLKIT_PLUGIN_ID)
    const exporter = tools.find((tool) => tool.pluginId === TAURI_REACT_EXPORTER_PLUGIN_ID)
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
      await handlers.handleCall(target(), {
        name: command.name,
        pluginId: command.pluginId,
        args: {}
      })
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
})
