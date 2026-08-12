import { afterEach, describe, expect, test } from 'bun:test'

import { createBundledPluginCatalog } from '@/app/plugins/catalog'
import {
  appConnectorAuthorization,
  appConnectorCredentialReadiness,
  appConnectorHostAdapters,
  isAppConnectorMCPExposed
} from '@/app/plugins/connectors/app'
import { connectorOperationHelp } from '@/app/plugins/connectors/operation/help'
import { REVIEWED_EXTERNAL_SERVICE_CATALOG } from '@/app/plugins/connectors/services'
import { pluginConnectorControls } from '@/app/plugins/connectors/settings-controls-model'
import { listAppPluginMCPTools, resolveAppPluginMCPTool } from '@/app/plugins/mcp'
import { createMemoryAppPluginStateStorage } from '@/app/plugins/storage'
import { createAppPluginStore } from '@/app/plugins/store'
import { createCredentialServices } from '@/app/settings/credentials'
import { MemoryCredentialStore } from '@/app/settings/credentials/memory'

const EXPOSURE = Object.freeze({
  connectorExposure: isAppConnectorMCPExposed,
  connectorNonGetReadOnlyExposure: isAppConnectorMCPExposed
})

function descriptor(key: string) {
  const result = REVIEWED_EXTERNAL_SERVICE_CATALOG.find((candidate) => candidate.key === key)
  if (!result) throw new Error(`Missing reviewed service descriptor: ${key}`)
  return result
}

function createStore() {
  return createAppPluginStore({
    storage: createMemoryAppPluginStateStorage(),
    catalog: createBundledPluginCatalog(),
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.0.0'
  })
}

afterEach(() => {
  for (const grant of appConnectorAuthorization.snapshot()) {
    appConnectorAuthorization.revoke(grant.pluginId, grant.connectorId)
  }
  appConnectorCredentialReadiness.clear()
})

describe('reviewed external service MCP lifecycle', () => {
  test('registers every reviewed service in the frozen app host registry', () => {
    for (const reviewed of REVIEWED_EXTERNAL_SERVICE_CATALOG) {
      expect(appConnectorHostAdapters.resolve(reviewed.connector.contract)).toBe(
        reviewed.connector.adapter
      )
    }
  })

  test('surfaces the host-reviewed setup and example in the connector form', async () => {
    const reviewed = descriptor('linear-issues')
    const operation = reviewed.connector.contract.operations[0]
    if (!operation) throw new Error('Missing reviewed Linear operation')
    const help = connectorOperationHelp(reviewed.connector.contract.pluginId, operation, 'en-US')
    expect(help.exampleJson).toBe(
      JSON.stringify(reviewed.connector.metadata.operations[0]?.example, null, 2)
    )

    const store = createStore()
    await store.load()
    await store.install(reviewed.connector.contract.pluginId)
    await store.setEnabled(reviewed.connector.contract.pluginId, true)
    const installed = store
      .snapshot()
      .installed.find(
        (plugin) => plugin.package.manifest.plugin.id === reviewed.connector.contract.pluginId
      )
    if (!installed) throw new Error('Missing installed Linear plugin')
    const [control] = pluginConnectorControls(installed, appConnectorAuthorization, 'en-US')
    expect(control?.manualSetup).toEqual({
      note: reviewed.manualSetup.note,
      scopes: reviewed.manualSetup.scopes
    })
  })

  for (const key of ['neon-projects', 'linear-issues']) {
    test(`${key} requires install, enable, configured credentials, and session authorization`, async () => {
      const reviewed = descriptor(key)
      const { contract } = reviewed.connector
      const store = createStore()
      await store.load()

      expect(
        listAppPluginMCPTools(store, EXPOSURE).tools.some(
          (tool) => tool.pluginId === contract.pluginId
        )
      ).toBe(false)

      await store.install(contract.pluginId)
      expect(store.installedConnectors()).toEqual([])
      expect(
        listAppPluginMCPTools(store, EXPOSURE).tools.some(
          (tool) => tool.pluginId === contract.pluginId
        )
      ).toBe(false)

      await store.setEnabled(contract.pluginId, true)
      const installed = store.connector(contract.pluginId, contract.connectorId)
      if (!installed) throw new Error(`Missing installed reviewed connector: ${key}`)
      expect(
        listAppPluginMCPTools(store, EXPOSURE).tools.some(
          (tool) => tool.pluginId === contract.pluginId
        )
      ).toBe(false)

      appConnectorAuthorization.authorize(contract, installed.plugin.package.digest)
      expect(
        listAppPluginMCPTools(store, EXPOSURE).tools.some(
          (tool) => tool.pluginId === contract.pluginId
        )
      ).toBe(false)

      const requiredSlot = contract.credentialSlots.find((slot) => slot.required)
      if (!requiredSlot) throw new Error(`Missing required reviewed credential: ${key}`)
      const reference = reviewed.connector.credentialRefs()[requiredSlot.slotId]
      if (!reference) throw new Error(`Missing reviewed credential reference: ${key}`)
      const credentials = createCredentialServices(new MemoryCredentialStore())
      await credentials.manager.set(reference, 'test-credential')
      await appConnectorCredentialReadiness.observe(credentials.manager, [reference])

      const exposed = listAppPluginMCPTools(store, EXPOSURE)
      const tool = exposed.tools.find((candidate) => candidate.pluginId === contract.pluginId)
      expect(tool).toMatchObject({
        kind: 'connector',
        pluginId: contract.pluginId,
        description: expect.stringContaining('untrusted external data')
      })
      if (!tool) throw new Error(`Missing authorized reviewed connector MCP tool: ${key}`)
      expect(resolveAppPluginMCPTool(store, tool.name, contract.pluginId, EXPOSURE).kind).toBe(
        'connector'
      )

      await credentials.manager.clear(reference)
      await appConnectorCredentialReadiness.observe(credentials.manager, [reference])
      expect(
        appConnectorAuthorization.isAuthorized(contract, installed.plugin.package.digest)
      ).toBe(true)
      expect(
        listAppPluginMCPTools(store, EXPOSURE).tools.some(
          (candidate) => candidate.pluginId === contract.pluginId
        )
      ).toBe(false)
      expect(() => resolveAppPluginMCPTool(store, tool.name, contract.pluginId, EXPOSURE)).toThrow(
        'is unavailable'
      )

      await credentials.manager.set(reference, 'replacement-credential')
      await appConnectorCredentialReadiness.observe(credentials.manager, [reference])
      expect(
        listAppPluginMCPTools(store, EXPOSURE).tools.some(
          (candidate) => candidate.pluginId === contract.pluginId
        )
      ).toBe(true)

      await store.setEnabled(contract.pluginId, false)
      expect(
        listAppPluginMCPTools(store, EXPOSURE).tools.some(
          (candidate) => candidate.pluginId === contract.pluginId
        )
      ).toBe(false)
      expect(() => resolveAppPluginMCPTool(store, tool.name, contract.pluginId, EXPOSURE)).toThrow(
        'is unavailable'
      )

      appConnectorAuthorization.revoke(contract.pluginId, contract.connectorId)
      await store.uninstall(contract.pluginId)
      expect(
        listAppPluginMCPTools(store, EXPOSURE).tools.some(
          (candidate) => candidate.pluginId === contract.pluginId
        )
      ).toBe(false)
    })
  }
})
