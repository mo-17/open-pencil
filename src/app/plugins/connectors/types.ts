import type {
  PluginConnectorContractV1,
  PluginConnectorCredentialSlotV1,
  PluginConnectorOperationV1,
  PluginParameterValue
} from '@open-pencil/core/plugins'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'

import type { InstalledAppPlugin } from '@/app/plugins/types'
import type { CredentialRef } from '@/app/settings/credentials'

export const CONNECTOR_EXECUTION_LIMITS = Object.freeze({
  defaultTimeoutMs: 15_000,
  maxTimeoutMs: 30_000,
  maxRequestBytes: 512 * 1024,
  maxResponseBytes: 4 * 1024 * 1024,
  maxHeaders: 32,
  maxHeaderNameLength: 128,
  maxHeaderValueLength: 8 * 1024
})

export type ConnectorExecutionErrorCode =
  | 'plugin-not-installed'
  | 'plugin-disabled'
  | 'plugin-blocked'
  | 'connector-not-declared'
  | 'authority-mismatch'
  | 'adapter-unavailable'
  | 'unauthorized'
  | 'mutation-confirmation-required'
  | 'mutation-denied'
  | 'invalid-parameters'
  | 'credential-missing'
  | 'credential-unavailable'
  | 'unsupported-credential'
  | 'adapter-failed'
  | 'request-too-large'
  | 'network-failed'
  | 'redirect-rejected'
  | 'http-error'
  | 'response-too-large'
  | 'invalid-response'
  | 'timeout'
  | 'aborted'
  | 'outcome-unknown'

export class ConnectorExecutionError extends Error {
  constructor(
    readonly code: ConnectorExecutionErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'ConnectorExecutionError'
  }
}

export interface PreparedConnectorRequest {
  /** Canonical absolute HTTPS URL. Origin and path are revalidated by the broker. */
  readonly url: string
  /** Non-sensitive headers only. Credential and cookie headers are host-reserved. */
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string | Uint8Array
}

export interface PrepareConnectorRequestContext {
  readonly contract: PluginConnectorContractV1
  readonly operation: PluginConnectorOperationV1
  readonly parameters: ConnectorParameterObject
  /** Host-owned UUID reused only when retrying the same reviewed mutation attempt. */
  readonly mutationAttemptId?: string
  readonly signal: AbortSignal
}

export type ConnectorParameterObject = Readonly<Record<string, PluginParameterValue | undefined>>

export interface ValidateConnectorCredentialContext {
  readonly contract: PluginConnectorContractV1
  readonly operation: PluginConnectorOperationV1
  readonly slot: PluginConnectorCredentialSlotV1
  /** Ephemeral runtime value. Implementations must only return a decision and never retain it. */
  readonly value: string
  readonly signal: AbortSignal
}

/** A reviewed host adapter. It never chooses credential injection or the HTTP method. */
export interface ConnectorHostAdapter {
  readonly pluginId: string
  readonly connectorId: string
  readonly adapterId: string
  readonly contract: PluginConnectorContractV1
  /**
   * Exact host-reviewed query operations that are semantically read-only even when an upstream
   * API requires POST (for example, a fixed GraphQL query). This is host code, never manifest
   * authority; mutation operations are rejected when adapters are registered.
   */
  readonly mcpReadOnlyOperationIds?: readonly string[]
  /** Optional host-owned, fail-closed credential classifier. It must not retain the value. */
  validateCredential?(context: ValidateConnectorCredentialContext): boolean | Promise<boolean>
  prepare(context: PrepareConnectorRequestContext): Promise<PreparedConnectorRequest>
  /** Host-owned mapping from bounded upstream JSON into the declared result contract. */
  transformResponse?(
    value: unknown,
    context: PrepareConnectorRequestContext
  ): PluginParameterValue | Promise<PluginParameterValue>
}

export interface ConnectorMutationConfirmation {
  readonly pluginId: string
  readonly connectorId: string
  readonly operationId: string
  readonly operationName: string
}

export interface ExecuteConnectorRequest {
  /** The exact installed entry selected from the app plugin store. */
  readonly plugin: InstalledAppPlugin | null
  /** The exact manifest-declared contract selected for this invocation. */
  readonly contract: PluginConnectorContractV1
  readonly operationId: string
  readonly parameters: PluginParameterValue
  /** Runtime-only references. Credential values never enter plugin state or documents. */
  readonly credentialRefs?: Readonly<Record<string, CredentialRef>>
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  /** Optional caller-owned UUID; the broker creates one when an internal caller omits it. */
  readonly mutationAttemptId?: string
  readonly confirmMutation?: (request: ConnectorMutationConfirmation) => boolean | Promise<boolean>
}

export interface ConnectorExecutionResult {
  readonly data: JSONValue
  readonly httpStatus: number
  readonly requestBytes: number
  readonly responseBytes: number
}

export interface ConnectorTransportLimits {
  /** Host-enforced raw response cap, before adapter transformation. */
  readonly maxResponseBytes: number
  /** Host-enforced request deadline, in addition to the broker AbortSignal. */
  readonly timeoutMs: number
}

export type ConnectorFetch = (
  input: string | URL | Request,
  init: RequestInit | undefined,
  limits: ConnectorTransportLimits,
  /**
   * MUST be called immediately before the host hands the request to its network transport.
   * A mutation failure after this boundary cannot be reported as a proven cancellation.
   */
  onDispatch: () => void
) => Promise<Response>

export interface ConnectorAuthorityIdentity {
  readonly pluginId: string
  readonly connectorId: string
  readonly adapterId: string
  readonly packageDigest: string
}
