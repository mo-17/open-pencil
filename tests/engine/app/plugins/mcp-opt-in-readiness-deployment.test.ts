import { describe, expect, test } from 'bun:test'

import { createBundledPluginCatalog } from '@/app/plugins/catalog'
import { APPLICATION_SECURITY_READINESS_HOST_CONTRACT } from '@/app/plugins/host/application-security-readiness'
import { REVIEWED_DEPLOYMENT_PLUGINS } from '@/app/plugins/host/deployment/contract'
import {
  appPluginMcpToolName,
  listAppPluginMcpTools,
  resolveAppPluginMcpTool
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

const OPT_IN_COMMANDS = Object.freeze([
  Object.freeze({
    pluginId: APPLICATION_SECURITY_READINESS_HOST_CONTRACT.pluginId,
    commandId: APPLICATION_SECURITY_READINESS_HOST_CONTRACT.command.commandId,
    expectedTitle: 'Run application security readiness audit',
    expectedDescription: 'local, read-only static production-readiness review'
  }),
  ...REVIEWED_DEPLOYMENT_PLUGINS.map((definition) =>
    Object.freeze({
      pluginId: definition.pluginId,
      commandId: definition.mcpSafePlan.commandId,
      expectedTitle: definition.mcpSafePlan.name,
      expectedDescription: definition.mcpSafePlan.description
    })
  )
])

function toolsForPlugin(store: ReturnType<typeof createStore>, pluginId: string) {
  return listAppPluginMcpTools(store).tools.filter((tool) => tool.pluginId === pluginId)
}

describe('opt-in readiness and deployment-plan MCP tools', () => {
  test('exposes each command only while its plugin is installed and enabled', async () => {
    const store = createStore()
    await store.load()

    for (const candidate of OPT_IN_COMMANDS) {
      expect(toolsForPlugin(store, candidate.pluginId)).toEqual([])

      await store.install(candidate.pluginId)
      expect(toolsForPlugin(store, candidate.pluginId)).toEqual([])

      await store.setEnabled(candidate.pluginId, true)
      const enabledCatalog = listAppPluginMcpTools(store)
      const enabledTools = enabledCatalog.tools.filter(
        (tool) => tool.pluginId === candidate.pluginId
      )
      expect(enabledTools).toEqual([
        expect.objectContaining({
          pluginId: candidate.pluginId,
          kind: 'command',
          contributionId: candidate.commandId,
          title: candidate.expectedTitle
        })
      ])
      const [enabledTool] = enabledTools
      if (!enabledTool) throw new Error(`Expected enabled MCP tool for ${candidate.pluginId}`)
      expect(enabledTool.description).toContain(candidate.expectedDescription)
      expect(resolveAppPluginMcpTool(store, enabledTool.name, candidate.pluginId)).toMatchObject({
        kind: 'command'
      })

      await store.setEnabled(candidate.pluginId, false)
      const disabledCatalog = listAppPluginMcpTools(store)
      expect(toolsForPlugin(store, candidate.pluginId)).toEqual([])
      expect(disabledCatalog.revision).not.toBe(enabledCatalog.revision)
      expect(() => resolveAppPluginMcpTool(store, enabledTool.name, candidate.pluginId)).toThrow(
        'Plugin MCP tool is unavailable'
      )

      await store.setEnabled(candidate.pluginId, true)
      const reenabledTool = toolsForPlugin(store, candidate.pluginId)[0]
      expect(reenabledTool?.name).toBe(enabledTool.name)

      await store.uninstall(candidate.pluginId)
      expect(toolsForPlugin(store, candidate.pluginId)).toEqual([])
      expect(() => resolveAppPluginMcpTool(store, enabledTool.name, candidate.pluginId)).toThrow(
        'Plugin MCP tool is unavailable'
      )
    }
  })

  test('publishes deployment review plans but never the side-effecting deploy authority', async () => {
    const catalog = createBundledPluginCatalog()
    const store = createStore()
    await store.load()

    for (const definition of REVIEWED_DEPLOYMENT_PLUGINS) {
      const entry = catalog.find(({ manifest }) => manifest.plugin.id === definition.pluginId)
      if (!entry) throw new Error(`Missing bundled deployment plugin ${definition.pluginId}`)
      expect(entry.installedByDefault).toBe(false)
      expect(entry.enabledByDefault).toBe(false)
      expect(entry.manifest.contributions.commands).toEqual([definition.mcpSafePlan])
      expect(entry.manifest.contributions.exporters ?? []).toEqual([])
      expect(entry.manifest.contributions.connectors ?? []).toEqual([])
      expect(
        entry.manifest.contributions.commands?.some(
          (command) =>
            command.commandId === definition.contributionId ||
            command.adapterId === definition.adapterId
        )
      ).toBe(false)

      await store.install(definition.pluginId)
      await store.setEnabled(definition.pluginId, true)
      const tools = toolsForPlugin(store, definition.pluginId)
      expect(tools).toEqual([
        expect.objectContaining({
          kind: 'command',
          contributionId: definition.mcpSafePlan.commandId,
          inputSchema: definition.mcpSafePlan.parameters.schema
        })
      ])
      expect(tools.some((tool) => tool.contributionId === definition.contributionId)).toBe(false)

      const forbiddenDeployToolName = appPluginMcpToolName(
        definition.pluginId,
        'command',
        definition.contributionId
      )
      expect(() =>
        resolveAppPluginMcpTool(store, forbiddenDeployToolName, definition.pluginId)
      ).toThrow('Plugin MCP tool is unavailable')

      await store.uninstall(definition.pluginId)
    }
  })
})
