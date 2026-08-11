import { credentialKey } from '@/app/settings/credentials/reference'
import type {
  CredentialManager,
  CredentialRef,
  CredentialStatus
} from '@/app/settings/credentials/types'

import { ConnectorSnapshotListenerRegistry } from './listener-registry'

export const CONNECTOR_CREDENTIAL_READINESS_LIMITS = Object.freeze({
  credentials: 1_024,
  batchSize: 16,
  listeners: 64,
  statusTimeoutMs: 2_000
})

export interface ConnectorCredentialStatusObservation {
  readonly reference: CredentialRef
  readonly status: CredentialStatus
}

export interface ConnectorCredentialReadinessSnapshot {
  readonly revision: number
  readonly credentialCount: number
}

async function boundedCredentialStatus(
  manager: CredentialManager,
  reference: CredentialRef
): Promise<CredentialStatus> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const unavailable = new Promise<'unavailable'>((resolve) => {
    timeout = setTimeout(
      () => resolve('unavailable'),
      CONNECTOR_CREDENTIAL_READINESS_LIMITS.statusTimeoutMs
    )
  })
  try {
    return await Promise.race([
      manager.status(reference).catch(() => 'unavailable' as const),
      unavailable
    ])
  } finally {
    clearTimeout(timeout)
  }
}

/** Process-local, status-only cache used by the synchronous MCP catalog gate. */
export class ConnectorCredentialReadinessRegistry {
  readonly #statuses = new Map<string, CredentialStatus>()
  readonly #listeners = new ConnectorSnapshotListenerRegistry<ConnectorCredentialReadinessSnapshot>(
    CONNECTOR_CREDENTIAL_READINESS_LIMITS.listeners,
    'Connector credential readiness listener limit reached'
  )
  #revision = 0
  #observationGeneration = 0

  snapshot(): ConnectorCredentialReadinessSnapshot {
    return Object.freeze({ revision: this.#revision, credentialCount: this.#statuses.size })
  }

  isConfigured(reference: CredentialRef): boolean {
    return this.#statuses.get(credentialKey(reference)) === 'configured'
  }

  areConfigured(references: readonly CredentialRef[]): boolean {
    return references.every((reference) => this.isConfigured(reference))
  }

  update(observations: readonly ConnectorCredentialStatusObservation[]): boolean {
    this.#observationGeneration += 1
    return this.#apply(observations)
  }

  async observe(
    manager: CredentialManager,
    references: readonly CredentialRef[]
  ): Promise<boolean> {
    const unique = new Map<string, CredentialRef>()
    for (const reference of references) unique.set(credentialKey(reference), reference)
    if (unique.size > CONNECTOR_CREDENTIAL_READINESS_LIMITS.credentials) {
      throw new Error('Connector credential readiness observation exceeds the credential limit')
    }
    const generation = ++this.#observationGeneration
    const source = [...unique.values()]
    const observations: ConnectorCredentialStatusObservation[] = []
    for (
      let offset = 0;
      offset < source.length;
      offset += CONNECTOR_CREDENTIAL_READINESS_LIMITS.batchSize
    ) {
      const batch = source.slice(offset, offset + CONNECTOR_CREDENTIAL_READINESS_LIMITS.batchSize)
      observations.push(
        ...(await Promise.all(
          batch.map(async (reference) => ({
            reference,
            status: await boundedCredentialStatus(manager, reference)
          }))
        ))
      )
      if (generation !== this.#observationGeneration) return false
    }
    return generation === this.#observationGeneration && this.#apply(observations)
  }

  clear(): boolean {
    this.#observationGeneration += 1
    if (this.#statuses.size === 0) return false
    this.#statuses.clear()
    this.#emit()
    return true
  }

  subscribe(listener: (snapshot: ConnectorCredentialReadinessSnapshot) => void): () => void {
    return this.#listeners.subscribe(listener)
  }

  #apply(observations: readonly ConnectorCredentialStatusObservation[]): boolean {
    const normalized = new Map<string, CredentialStatus>()
    for (const observation of observations) {
      normalized.set(credentialKey(observation.reference), observation.status)
    }
    const additions = [...normalized.keys()].filter((key) => !this.#statuses.has(key)).length
    if (this.#statuses.size + additions > CONNECTOR_CREDENTIAL_READINESS_LIMITS.credentials) {
      throw new Error('Connector credential readiness cache is full')
    }
    let changed = false
    for (const [key, status] of normalized) {
      if (this.#statuses.get(key) === status) continue
      this.#statuses.set(key, status)
      changed = true
    }
    if (changed) this.#emit()
    return changed
  }

  #emit(): void {
    this.#revision += 1
    this.#listeners.emit(this.snapshot())
  }
}
