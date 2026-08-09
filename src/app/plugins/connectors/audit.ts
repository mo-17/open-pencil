import type { ConnectorExecutionErrorCode } from './types'

export type ConnectorAuditOutcome = 'completed' | 'failed' | 'cancelled' | 'outcome-unknown'

export interface ConnectorAuditEvent {
  readonly timestamp: number
  readonly pluginId: string
  readonly connectorId: string
  readonly adapterId: string
  readonly operationId: string
  readonly operationKind: string
  readonly outcome: ConnectorAuditOutcome
  readonly durationMs: number
  /** Whether the reviewed request crossed the host transport dispatch boundary. */
  readonly requestDispatched: boolean
  readonly requestBytes: number
  readonly responseBytes: number
  readonly httpStatus?: number
  readonly errorCode?: ConnectorExecutionErrorCode
}

export interface ConnectorAuditSink {
  record(event: ConnectorAuditEvent): void | Promise<void>
}

/** Fan out metadata-only audit events without letting one best-effort sink block another. */
export class ConnectorAuditFanout implements ConnectorAuditSink {
  readonly #sinks: readonly ConnectorAuditSink[]

  constructor(sinks: readonly ConnectorAuditSink[]) {
    if (sinks.length < 1 || sinks.length > 16) {
      throw new TypeError('Connector audit fanout requires between 1 and 16 sinks')
    }
    this.#sinks = Object.freeze([...sinks])
  }

  record(event: ConnectorAuditEvent): void {
    for (const sink of this.#sinks) {
      try {
        void Promise.resolve(sink.record(event)).catch((cause) => {
          void cause
          return undefined
        })
      } catch (cause) {
        void cause
      }
    }
  }
}

/** A bounded metadata-only audit log. It has no fields for URLs, parameters, headers, or bodies. */
export class RedactedConnectorAuditLog implements ConnectorAuditSink {
  readonly #events: ConnectorAuditEvent[] = []

  constructor(private readonly maximumEntries = 500) {
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 10_000) {
      throw new TypeError('Connector audit capacity must be between 1 and 10000')
    }
  }

  record(event: ConnectorAuditEvent): void {
    const copy = Object.freeze({ ...event })
    this.#events.push(copy)
    if (this.#events.length > this.maximumEntries) {
      this.#events.splice(0, this.#events.length - this.maximumEntries)
    }
  }

  snapshot(): readonly ConnectorAuditEvent[] {
    return Object.freeze([...this.#events])
  }

  clear(): void {
    this.#events.length = 0
  }
}
