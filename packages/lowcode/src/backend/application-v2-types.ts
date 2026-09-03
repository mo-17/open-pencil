import type {
  AuthPolicyIR,
  AuthPrincipalIntent,
  BackendApplicationSpecV1,
  BackendCapability,
  BackendCredentialRef,
  BackendDataFilterIR,
  BackendFieldScalarType,
  BackendLiteral,
  BackendSecretRef,
  BackendStorageIR,
  BackendWorkflowIR,
  DataModelIR
} from './types'

export const BACKEND_APPLICATION_SPEC_V2_VERSION = 2 as const
export const BACKEND_REALTIME_IR_VERSION = 1 as const
export const BACKEND_TRANSACTION_IR_VERSION = 1 as const
export const BACKEND_DATA_MIGRATION_IR_VERSION = 1 as const
export const BACKEND_AUTOMATION_IR_VERSION = 1 as const

export type BackendCapabilityV2 =
  | BackendCapability
  | 'migrations.backfill'
  | 'events.data-change'
  | 'jobs.schedule'
  | 'queues.publish'
  | 'queues.consume'
  | 'webhooks.receive'
  | 'webhooks.deliver'
  | 'workflows.idempotency'
  | 'workflows.retry'
  | 'workflows.durable-execution'
  | 'observability.logs'
  | 'observability.metrics'
  | 'observability.traces'
  | 'audit.events'
  | 'drift.detect'

export interface BackendCapabilityRequirementV2 {
  capability: BackendCapabilityV2
  required: boolean
  reason?: string
}

export type BackendRealtimeEvent = 'insert' | 'update' | 'delete'

export interface BackendRealtimeSubscriptionIR {
  id: string
  entityId: string
  events: BackendRealtimeEvent[]
  principal: AuthPrincipalIntent
  delivery: { kind: 'invalidate-query'; queryKey: string }
}

export interface BackendRealtimeIRV1 {
  version: typeof BACKEND_REALTIME_IR_VERSION
  subscriptions: BackendRealtimeSubscriptionIR[]
}

export interface BackendTransactionParameterIR {
  name: string
  type: BackendFieldScalarType
  required: boolean
}

export type BackendTransactionValueSourceIR =
  | { kind: 'parameter'; name: string }
  | { kind: 'result'; name: string; field?: string }
  | { kind: 'literal'; value: BackendLiteral }

export interface BackendTransactionFilterIR {
  field: string
  operator: BackendDataFilterIR['operator']
  value: BackendTransactionValueSourceIR
}

export interface BackendTransactionValueIR {
  field: string
  value: BackendTransactionValueSourceIR
}

export interface BackendTransactionIncrementIR {
  field: string
  by: 1
}

export type BackendTransactionAssertionIR =
  | { kind: 'result-exists'; resultName: string }
  | {
      kind: 'result-count'
      resultName: string
      operator: 'eq' | 'gte' | 'lte'
      value: number
    }

export type BackendTransactionStepIR =
  | {
      id: string
      kind: 'data.read'
      entityId: string
      resultName: string
      fields?: string[]
      filters?: BackendTransactionFilterIR[]
      single?: boolean
      limit: number
    }
  | {
      id: string
      kind: 'data.mutate'
      entityId: string
      operation: 'insert' | 'update' | 'delete' | 'upsert'
      values?: BackendTransactionValueIR[]
      increments?: BackendTransactionIncrementIR[]
      filters?: BackendTransactionFilterIR[]
      resultName: string
      maxAffectedRows: number
    }
  | { id: string; kind: 'assert'; assertion: BackendTransactionAssertionIR }

export type BackendTransactionConflictPolicyIR =
  | { kind: 'fail' }
  | {
      kind: 'expected-version'
      entityId: string
      fieldId: string
      parameter: string
    }

export interface BackendTransactionDefinitionIR {
  id: string
  name: string
  access: 'authenticated'
  principal: Exclude<AuthPrincipalIntent, { kind: 'anonymous' }>
  isolation: 'read-committed' | 'repeatable-read' | 'serializable'
  parameters: BackendTransactionParameterIR[]
  conflictPolicy: BackendTransactionConflictPolicyIR
  steps: BackendTransactionStepIR[]
}

export interface BackendTransactionIRV1 {
  version: typeof BACKEND_TRANSACTION_IR_VERSION
  transactions: BackendTransactionDefinitionIR[]
}

export type BackendDataMigrationPredicateIR = { kind: 'field-is-null'; fieldId: string }

export type BackendDataMigrationTransformIR =
  | { kind: 'set-literal'; fieldId: string; value: BackendLiteral }
  | { kind: 'copy-field'; sourceFieldId: string; targetFieldId: string }

export type BackendDataMigrationPostconditionIR =
  | { kind: 'field-not-null'; fieldId: string }
  | { kind: 'matched-row-count'; minimum: number }

export interface BackendDataMigrationDefinitionIR {
  id: string
  name: string
  entityId: string
  cursor: {
    /**
     * Provider must prove this is a non-null, single-field integer primary key backed by
     * an identity generator, and must enforce that it is immutable and append-monotonic.
     */
    kind: 'monotonic-identity-primary-key'
    fieldId: string
  }
  batchSize: number
  predicate: BackendDataMigrationPredicateIR
  transforms: BackendDataMigrationTransformIR[]
  postconditions: BackendDataMigrationPostconditionIR[]
  dryRunRequired: true
  resumePolicy: 'from-receipt'
}

export interface BackendDataMigrationIRV1 {
  version: typeof BACKEND_DATA_MIGRATION_IR_VERSION
  migrations: BackendDataMigrationDefinitionIR[]
}

export type BackendExecutionSubject = 'caller-user' | 'system'

export interface BackendQueueIR {
  id: string
  name: string
  visibility: 'private'
  delivery: 'at-least-once'
  maxPayloadBytes: number
  visibilityTimeoutSeconds: number
  retentionSeconds: number
}

export interface BackendWebhookDestinationIR {
  id: string
  name: string
  /** Host must reject redirects and revalidate every resolved A/AAAA hop against private ranges. */
  url: string
  method: 'POST'
  contentType: 'application/json'
  /** Host deterministically serializes JSON, checks this byte limit, then signs and sends it. */
  maxPayloadBytes: number
  /** Release evidence must prove a required server-scoped credential with dedicated webhook-hmac purpose. */
  signingCredentialRef: BackendCredentialRef
  signature: BackendWebhookHmacEnvelopeIR
}

export interface BackendWebhookHmacEnvelopeIR {
  kind: 'hmac-sha256'
  /**
   * Exact UTF-8 bytes are
   * `raw-body-v1\n<POST>\n<path>\n<unix-seconds>\n<idempotency-key>\n<lowercase-hex-sha256(raw-body-bytes)>`
   * with no trailing newline. Verify HMAC in constant time before parsing JSON.
   */
  canonicalEnvelope: 'raw-body-v1'
  signedComponents: ['method', 'path', 'timestamp', 'idempotency-key', 'raw-body-sha256']
  signatureEncoding: 'lowercase-hex'
  timestampFormat: 'unix-seconds'
  signatureHeaderName: 'X-OpenPencil-Signature'
  timestampHeaderName: 'X-OpenPencil-Timestamp'
  idempotencyHeaderName: 'Idempotency-Key'
}

export type BackendAutomationTriggerIR =
  | { kind: 'schedule'; cron: string; timezone: 'UTC' }
  | { kind: 'queue'; queueId: string }
  | {
      kind: 'webhook'
      method: 'POST'
      path: string
      signature: BackendWebhookHmacEnvelopeIR & {
        credentialRef: BackendCredentialRef
        maxAgeSeconds: number
      }
    }
  | { kind: 'data-change'; entityId: string; events: BackendRealtimeEvent[] }

export type BackendAutomationActionIR =
  | {
      kind: 'workflow'
      workflowId: string
      parameters: BackendAutomationParameterMappingIR[]
    }
  | {
      kind: 'transaction'
      transactionId: string
      parameters: BackendAutomationParameterMappingIR[]
    }
  | { kind: 'queue.publish'; queueId: string; payloadExpression: string }
  | {
      kind: 'webhook.deliver'
      destinationId: string
      payloadExpression: string
    }
  | { kind: 'drift.detect'; scope: 'declared-schema'; mode: 'read-only' }

export type BackendAutomationParameterSourceIR =
  | { kind: 'event-field'; path: string }
  | { kind: 'literal'; value: BackendLiteral }

export interface BackendAutomationParameterMappingIR {
  parameter: string
  source: BackendAutomationParameterSourceIR
}

export interface BackendAutomationRetryIR {
  maxAttempts: number
  initialDelayMs: number
  maxDelayMs: number
  backoff: 'fixed' | 'exponential'
  /** `full` replaces each capped delay with a value in [0, cappedDelay], never adds delay. */
  jitter: 'none' | 'full'
  deadLetterQueueId?: string
}

export type BackendAutomationIdempotencyIR =
  /** Host supplies one stable immutable identifier for each schedule firing or queue message. */
  | { kind: 'event-id'; retentionHours: number }
  | { kind: 'request-header'; headerName: 'Idempotency-Key'; retentionHours: number }
  | { kind: 'data-field'; entityId: string; fieldId: string; retentionHours: number }

export interface BackendAutomationDefinitionIR {
  id: string
  name: string
  subject: BackendExecutionSubject
  trigger: BackendAutomationTriggerIR
  action: BackendAutomationActionIR
  retry: BackendAutomationRetryIR
  idempotency: BackendAutomationIdempotencyIR
  causation: { kind: 'required'; idField: 'causationId'; maxHop: number }
}

export interface BackendOperationalTelemetryIR {
  logs: boolean
  metrics: boolean
  traces: boolean
  auditEvents: boolean
}

export interface BackendDriftDetectionIR {
  enabled: boolean
  scheduleAutomationId?: string
}

export interface BackendAutomationIRV1 {
  version: typeof BACKEND_AUTOMATION_IR_VERSION
  queues: BackendQueueIR[]
  webhookDestinations: BackendWebhookDestinationIR[]
  automations: BackendAutomationDefinitionIR[]
  telemetry: BackendOperationalTelemetryIR
  driftDetection: BackendDriftDetectionIR
}

export interface BackendApplicationSpecV2 extends Omit<
  BackendApplicationSpecV1,
  'version' | 'capabilities'
> {
  version: typeof BACKEND_APPLICATION_SPEC_V2_VERSION
  dataModel: DataModelIR
  auth: AuthPolicyIR
  workflows: BackendWorkflowIR
  storage?: BackendStorageIR
  realtime: BackendRealtimeIRV1
  transactions: BackendTransactionIRV1
  dataMigrations: BackendDataMigrationIRV1
  automations: BackendAutomationIRV1
  capabilities: BackendCapabilityRequirementV2[]
  secrets: BackendSecretRef[]
}
