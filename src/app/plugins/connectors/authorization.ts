import {
  parsePluginConnectorContract,
  type PluginConnectorContractV1
} from '@open-pencil/core/plugins'

import { ConnectorSnapshotListenerRegistry } from './listener-registry'
import type { ConnectorAuthorityIdentity } from './types'

export interface ConnectorAuthorizationGrant extends ConnectorAuthorityIdentity {
  readonly grantedAt: number
}

export const CONNECTOR_AUTHORIZATION_LIMITS = Object.freeze({
  maxGrants: 1_024,
  maxListeners: 64
})

export type ConnectorAuthorizationListener = (
  grants: readonly ConnectorAuthorizationGrant[]
) => void

function authorityKey(identity: ConnectorAuthorityIdentity): string {
  return `${identity.pluginId}\0${identity.connectorId}`
}

function exactAuthority(
  contract: PluginConnectorContractV1,
  packageDigest: string
): ConnectorAuthorityIdentity {
  const parsed = parsePluginConnectorContract(contract)
  return {
    pluginId: parsed.pluginId,
    connectorId: parsed.connectorId,
    adapterId: parsed.adapterId,
    packageDigest
  }
}

/**
 * Process-local authorization registry for the Phase 2A broker.
 *
 * Grants bind the exact adapter and package digest, so a plugin update or authority change always
 * requires a new user authorization. Persistence can be added later without widening this API.
 */
export class ConnectorAuthorizationRegistry {
  readonly #grants = new Map<string, ConnectorAuthorizationGrant>()
  readonly #listeners = new ConnectorSnapshotListenerRegistry<
    readonly ConnectorAuthorizationGrant[]
  >(CONNECTOR_AUTHORIZATION_LIMITS.maxListeners, 'Connector authorization listener limit reached')

  authorize(
    contract: PluginConnectorContractV1,
    packageDigest: string,
    grantedAt = Date.now()
  ): ConnectorAuthorizationGrant {
    if (!packageDigest) throw new TypeError('Connector package digest is required')
    if (!Number.isFinite(grantedAt) || grantedAt < 0) {
      throw new TypeError('Connector authorization time is invalid')
    }
    const grant = Object.freeze({ ...exactAuthority(contract, packageDigest), grantedAt })
    const key = authorityKey(grant)
    if (!this.#grants.has(key) && this.#grants.size >= CONNECTOR_AUTHORIZATION_LIMITS.maxGrants) {
      throw new Error('Connector authorization registry is full')
    }
    this.#grants.set(key, grant)
    this.#emit()
    return grant
  }

  isAuthorized(contract: PluginConnectorContractV1, packageDigest: string): boolean {
    const identity = exactAuthority(contract, packageDigest)
    const grant = this.#grants.get(authorityKey(identity))
    return Boolean(
      grant &&
      grant.adapterId === identity.adapterId &&
      grant.packageDigest === identity.packageDigest
    )
  }

  revoke(pluginId: string, connectorId: string): boolean {
    const deleted = this.#grants.delete(
      authorityKey({ pluginId, connectorId, adapterId: '', packageDigest: '' })
    )
    if (deleted) this.#emit()
    return deleted
  }

  clear(): void {
    if (this.#grants.size === 0) return
    this.#grants.clear()
    this.#emit()
  }

  snapshot(): readonly ConnectorAuthorizationGrant[] {
    return Object.freeze([...this.#grants.values()])
  }

  subscribe(listener: ConnectorAuthorizationListener): () => void {
    return this.#listeners.subscribe(listener)
  }

  #emit(): void {
    this.#listeners.emit(this.snapshot())
  }
}
