import type { ConnectorAuditEvent, ConnectorAuditSink } from './audit'
import { ConnectorSnapshotListenerRegistry } from './listener-registry'

export const CONNECTOR_OUTCOME_NOTICE_LIMITS = Object.freeze({
  defaultEntries: 50,
  maxEntries: 500,
  maxListeners: 32,
  maxIdentityLength: 256
})

export interface ConnectorOutcomeUnknownNotice {
  readonly id: string
  readonly timestamp: number
  readonly pluginId: string
  readonly connectorId: string
  readonly operationId: string
}

export type ConnectorOutcomeUnknownNoticeListener = (
  notices: readonly ConnectorOutcomeUnknownNotice[]
) => void

function boundedIdentity(value: string): string {
  return value.length > 0 &&
    value.length <= CONNECTOR_OUTCOME_NOTICE_LIMITS.maxIdentityLength &&
    !/\p{Cc}/u.test(value)
    ? value
    : 'unknown'
}

/**
 * Session-only, metadata-only notices for dispatched mutations whose remote outcome is unknown.
 * It intentionally has no fields for URLs, parameters, headers, bodies, results, or credentials.
 */
export class ConnectorOutcomeUnknownNoticeStore implements ConnectorAuditSink {
  readonly #notices: ConnectorOutcomeUnknownNotice[] = []
  readonly #listeners = new ConnectorSnapshotListenerRegistry<
    readonly ConnectorOutcomeUnknownNotice[]
  >(CONNECTOR_OUTCOME_NOTICE_LIMITS.maxListeners, 'Connector outcome notice listener limit reached')
  #sequence = 0

  constructor(
    private readonly maximumEntries: number = CONNECTOR_OUTCOME_NOTICE_LIMITS.defaultEntries
  ) {
    if (
      !Number.isSafeInteger(maximumEntries) ||
      maximumEntries < 1 ||
      maximumEntries > CONNECTOR_OUTCOME_NOTICE_LIMITS.maxEntries
    ) {
      throw new TypeError(
        `Connector outcome notice capacity must be between 1 and ${CONNECTOR_OUTCOME_NOTICE_LIMITS.maxEntries}`
      )
    }
  }

  record(event: ConnectorAuditEvent): void {
    if (event.outcome !== 'outcome-unknown' || event.operationKind !== 'mutation') return
    const timestamp = Number.isFinite(event.timestamp) && event.timestamp >= 0 ? event.timestamp : 0
    const notice = Object.freeze({
      id: `${timestamp}:${this.#sequence++}`,
      timestamp,
      pluginId: boundedIdentity(event.pluginId),
      connectorId: boundedIdentity(event.connectorId),
      operationId: boundedIdentity(event.operationId)
    })
    this.#notices.push(notice)
    if (this.#notices.length > this.maximumEntries) {
      this.#notices.splice(0, this.#notices.length - this.maximumEntries)
    }
    this.#emit()
  }

  snapshot(): readonly ConnectorOutcomeUnknownNotice[] {
    return Object.freeze([...this.#notices])
  }

  dismiss(id: string): boolean {
    const index = this.#notices.findIndex((notice) => notice.id === id)
    if (index === -1) return false
    this.#notices.splice(index, 1)
    this.#emit()
    return true
  }

  clear(): void {
    if (this.#notices.length === 0) return
    this.#notices.length = 0
    this.#emit()
  }

  subscribe(listener: ConnectorOutcomeUnknownNoticeListener): () => void {
    const unsubscribe = this.#listeners.subscribe(listener)
    listener(this.snapshot())
    return unsubscribe
  }

  #emit(): void {
    this.#listeners.emit(this.snapshot())
  }
}
