import type {
  PluginConnectorContractRegistry,
  PluginConnectorContractV1,
  PluginManifestPayload
} from '@open-pencil/plugin-contracts'

import type { ConnectorHostAdapter } from './types'

export type ConnectorManifestCompatibility =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: string }>

function adapterKey(pluginId: string, connectorId: string): string {
  return `${pluginId}\0${connectorId}`
}

/** Exact host adapter registry kept separate from the descriptor-only Core contract registry. */
export class ConnectorHostAdapterRegistry {
  readonly #adapters = new Map<string, ConnectorHostAdapter>()
  #frozen = false

  constructor(readonly contracts: PluginConnectorContractRegistry) {}

  register(adapter: ConnectorHostAdapter): ConnectorHostAdapter {
    if (this.#frozen) throw new Error('Connector host adapter registry is frozen')
    const compatibility = this.contracts.inspect(adapter.contract)
    if (!compatibility.ok) throw new Error(compatibility.reason)
    if (
      adapter.pluginId !== compatibility.contract.pluginId ||
      adapter.connectorId !== compatibility.contract.connectorId ||
      adapter.adapterId !== compatibility.contract.adapterId
    ) {
      throw new Error('Connector host adapter identity does not match its reviewed contract')
    }
    const mcpReadOnlyOperationIds = adapter.mcpReadOnlyOperationIds ?? []
    if (new Set(mcpReadOnlyOperationIds).size !== mcpReadOnlyOperationIds.length) {
      throw new Error('Connector host adapter MCP read-only operation IDs must be unique')
    }
    for (const operationId of mcpReadOnlyOperationIds) {
      const operation = compatibility.contract.operations.find(
        (candidate) => candidate.operationId === operationId
      )
      if (operation?.kind !== 'query' || operation.request?.method !== 'POST') {
        throw new Error(
          `Connector host adapter MCP read-only operation is not a reviewed fixed POST query: ${operationId}`
        )
      }
    }
    const key = adapterKey(adapter.pluginId, adapter.connectorId)
    if (this.#adapters.has(key)) {
      throw new Error(
        `Duplicate connector host adapter: ${adapter.pluginId}/${adapter.connectorId}`
      )
    }
    this.#adapters.set(key, adapter)
    return adapter
  }

  resolve(contract: PluginConnectorContractV1): ConnectorHostAdapter | undefined {
    const compatibility = this.contracts.inspect(contract)
    if (!compatibility.ok) return undefined
    const reviewed = compatibility.contract
    const adapter = this.#adapters.get(adapterKey(reviewed.pluginId, reviewed.connectorId))
    return adapter?.adapterId === reviewed.adapterId ? adapter : undefined
  }

  freeze(): this {
    this.#frozen = true
    return this
  }
}

/**
 * Pure activation-policy helper. V1 manifests have no connector surface and remain compatible;
 * every V2 connector must match reviewed contract authority and an exact host adapter.
 */
export function inspectConnectorManifestCompatibility(
  manifest: PluginManifestPayload,
  adapters: ConnectorHostAdapterRegistry
): ConnectorManifestCompatibility {
  if (manifest.schemaVersion === 1 || !manifest.contributions.connectors) {
    return Object.freeze({ ok: true })
  }
  for (const contract of manifest.contributions.connectors) {
    const compatibility = adapters.contracts.inspect(contract)
    if (!compatibility.ok) return Object.freeze({ ok: false, reason: compatibility.reason })
    if (contract.operations.some((operation) => !operation.request)) {
      return Object.freeze({
        ok: false,
        reason: `Connector operation request authority is unavailable: ${contract.pluginId}/${contract.connectorId}`
      })
    }
    if (contract.credentialSlots.some((slot) => slot.kind === 'api-key' && !slot.injection)) {
      return Object.freeze({
        ok: false,
        reason: `Connector API key injection policy is unavailable: ${contract.pluginId}/${contract.connectorId}`
      })
    }
    if (!adapters.resolve(compatibility.contract)) {
      return Object.freeze({
        ok: false,
        reason: `Connector host adapter is unavailable: ${contract.adapterId}`
      })
    }
  }
  return Object.freeze({ ok: true })
}
