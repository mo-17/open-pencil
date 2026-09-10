/* eslint-disable max-lines -- Canonical Supabase V2 fixtures share one selection and trust-boundary helper. */
import {
  SUPABASE_BACKEND_PROVIDER_DESCRIPTOR_V2,
  type BackendProviderBundleV2
} from '@open-pencil/compiler'
import type { BackendApplicationSpecV2 } from '@open-pencil/lowcode/backend'

export const SUPABASE_V2_TEST_PACKAGE_DIGEST = `sha256:${'A'.repeat(43)}`

export function supabasePrivateRealtimeApplicationV2(): BackendApplicationSpecV2 {
  return {
    format: 'openpencil.backend-application',
    version: 2,
    applicationId: 'test.supabase-private-realtime',
    dataModel: {
      version: 1,
      entities: [
        {
          id: 'tasks',
          name: 'tasks',
          management: 'managed',
          fields: [
            {
              id: 'task-id',
              name: 'id',
              type: 'uuid',
              nullable: false,
              default: { kind: 'generated', generator: 'uuid' }
            },
            { id: 'task-owner-id', name: 'owner_id', type: 'uuid', nullable: false },
            { id: 'task-title', name: 'title', type: 'string', nullable: false }
          ],
          primaryKey: { fields: ['task-id'] }
        }
      ],
      enums: [],
      relations: []
    },
    auth: {
      version: 1,
      identities: [{ id: 'supabase-user', kind: 'user' }],
      roles: [],
      ownership: [{ id: 'task-owner', entityId: 'tasks', identityFieldId: 'task-owner-id' }],
      tenants: [],
      rowAccess: [
        {
          id: 'task-owner-select',
          entityId: 'tasks',
          effect: 'allow',
          operations: ['select'],
          principal: { kind: 'owner', ownershipId: 'task-owner' }
        }
      ]
    },
    workflows: { version: 1, workflows: [] },
    realtime: {
      version: 1,
      subscriptions: [
        {
          id: 'task-list-invalidation',
          entityId: 'tasks',
          events: ['delete', 'insert', 'update'],
          principal: { kind: 'owner', ownershipId: 'task-owner' },
          delivery: { kind: 'invalidate-query', queryKey: 'tasks' }
        }
      ]
    },
    transactions: { version: 1, transactions: [] },
    dataMigrations: { version: 1, migrations: [] },
    automations: {
      version: 1,
      queues: [],
      webhookDestinations: [],
      automations: [],
      telemetry: { logs: false, metrics: false, traces: false, auditEvents: false },
      driftDetection: { enabled: false }
    },
    capabilities: [
      { capability: 'auth.identity', required: true },
      { capability: 'events.data-change', required: true },
      { capability: 'migrations.schema', required: true },
      { capability: 'policy.row-level', required: true },
      { capability: 'realtime.subscribe', required: true }
    ],
    secrets: []
  }
}

export function supabaseAtomicTransactionApplicationV2(): BackendApplicationSpecV2 {
  return {
    format: 'openpencil.backend-application',
    version: 2,
    applicationId: 'test.supabase-atomic-transaction',
    dataModel: {
      version: 1,
      entities: [
        {
          id: 'tasks',
          name: 'tasks',
          management: 'managed',
          fields: [
            {
              id: 'task-id',
              name: 'id',
              type: 'uuid',
              nullable: false,
              default: { kind: 'generated', generator: 'uuid' }
            },
            { id: 'task-owner-id', name: 'owner_id', type: 'uuid', nullable: false },
            { id: 'task-score', name: 'score', type: 'number', nullable: true },
            {
              id: 'task-version',
              name: 'version',
              type: 'integer',
              nullable: false,
              default: { kind: 'literal', value: 0 }
            },
            { id: 'task-title', name: 'title', type: 'string', nullable: false }
          ],
          primaryKey: { fields: ['task-id'] }
        }
      ],
      enums: [],
      relations: []
    },
    auth: {
      version: 1,
      identities: [{ id: 'supabase-user', kind: 'user' }],
      roles: [],
      ownership: [{ id: 'task-owner', entityId: 'tasks', identityFieldId: 'task-owner-id' }],
      tenants: [],
      rowAccess: [
        {
          id: 'task-owner-select-update',
          entityId: 'tasks',
          effect: 'allow',
          operations: ['select', 'update'],
          principal: { kind: 'owner', ownershipId: 'task-owner' }
        }
      ]
    },
    workflows: { version: 1, workflows: [] },
    realtime: { version: 1, subscriptions: [] },
    transactions: {
      version: 1,
      transactions: [
        {
          id: 'update-task-title',
          name: 'Update task title',
          access: 'authenticated',
          principal: { kind: 'owner', ownershipId: 'task-owner' },
          isolation: 'serializable',
          parameters: [
            { name: 'expectedVersion', type: 'integer', required: true },
            { name: 'score', type: 'number', required: true },
            { name: 'taskId', type: 'uuid', required: true },
            { name: 'title', type: 'string', required: true }
          ],
          conflictPolicy: {
            kind: 'expected-version',
            entityId: 'tasks',
            fieldId: 'task-version',
            parameter: 'expectedVersion'
          },
          steps: [
            {
              id: 'read-task',
              kind: 'data.read',
              entityId: 'tasks',
              resultName: 'currentTask',
              fields: ['task-id', 'task-version'],
              filters: [
                {
                  field: 'task-id',
                  operator: 'eq',
                  value: { kind: 'parameter', name: 'taskId' }
                }
              ],
              single: true,
              limit: 1
            },
            {
              id: 'assert-task-exists',
              kind: 'assert',
              assertion: { kind: 'result-exists', resultName: 'currentTask' }
            },
            {
              id: 'update-task',
              kind: 'data.mutate',
              entityId: 'tasks',
              operation: 'update',
              values: [
                {
                  field: 'task-score',
                  value: { kind: 'parameter', name: 'score' }
                },
                {
                  field: 'task-title',
                  value: { kind: 'parameter', name: 'title' }
                }
              ],
              increments: [{ field: 'task-version', by: 1 }],
              filters: [
                {
                  field: 'task-id',
                  operator: 'eq',
                  value: { kind: 'parameter', name: 'taskId' }
                },
                {
                  field: 'task-version',
                  operator: 'eq',
                  value: { kind: 'parameter', name: 'expectedVersion' }
                }
              ],
              resultName: 'updatedTask',
              maxAffectedRows: 1
            },
            {
              id: 'assert-one-update',
              kind: 'assert',
              assertion: {
                kind: 'result-count',
                resultName: 'updatedTask',
                operator: 'eq',
                value: 1
              }
            }
          ]
        }
      ]
    },
    dataMigrations: { version: 1, migrations: [] },
    automations: {
      version: 1,
      queues: [],
      webhookDestinations: [],
      automations: [],
      telemetry: { logs: false, metrics: false, traces: false, auditEvents: false },
      driftDetection: { enabled: false }
    },
    capabilities: [
      { capability: 'auth.identity', required: true },
      { capability: 'data.read', required: true },
      { capability: 'data.write', required: true },
      { capability: 'migrations.schema', required: true },
      { capability: 'policy.row-level', required: true },
      { capability: 'transactions.atomic', required: true }
    ],
    secrets: []
  }
}

export function supabaseBackfillApplicationV2(): BackendApplicationSpecV2 {
  return {
    format: 'openpencil.backend-application',
    version: 2,
    applicationId: 'test.supabase-receipt-backfill',
    dataModel: {
      version: 1,
      entities: [
        {
          id: 'accounts',
          name: 'accounts',
          management: 'managed',
          fields: [
            {
              id: 'account-id',
              name: 'id',
              type: 'integer',
              nullable: false,
              default: { kind: 'generated', generator: 'identity' }
            },
            {
              id: 'account-status',
              name: 'status',
              type: 'string',
              nullable: false,
              default: { kind: 'literal', value: 'pending' }
            }
          ],
          primaryKey: { fields: ['account-id'] }
        }
      ],
      enums: [],
      relations: []
    },
    auth: {
      version: 1,
      identities: [],
      roles: [],
      ownership: [],
      tenants: [],
      rowAccess: []
    },
    workflows: { version: 1, workflows: [] },
    realtime: { version: 1, subscriptions: [] },
    transactions: { version: 1, transactions: [] },
    dataMigrations: {
      version: 1,
      migrations: [
        {
          id: 'backfill-account-status',
          name: 'Backfill account status',
          entityId: 'accounts',
          cursor: { kind: 'monotonic-identity-primary-key', fieldId: 'account-id' },
          batchSize: 250,
          predicate: { kind: 'field-is-null', fieldId: 'account-status' },
          transforms: [{ kind: 'set-literal', fieldId: 'account-status', value: 'pending' }],
          postconditions: [
            { kind: 'field-not-null', fieldId: 'account-status' },
            { kind: 'matched-row-count', minimum: 1 }
          ],
          dryRunRequired: true,
          resumePolicy: 'from-receipt'
        }
      ]
    },
    automations: {
      version: 1,
      queues: [],
      webhookDestinations: [],
      automations: [],
      telemetry: { logs: false, metrics: false, traces: false, auditEvents: false },
      driftDetection: { enabled: false }
    },
    capabilities: [
      { capability: 'migrations.backfill', required: true },
      { capability: 'migrations.data', required: true },
      { capability: 'migrations.schema', required: true }
    ],
    secrets: []
  }
}

export function supabaseAutomationApplicationV2(): BackendApplicationSpecV2 {
  const signature = {
    kind: 'hmac-sha256' as const,
    canonicalEnvelope: 'raw-body-v1' as const,
    signedComponents: ['method', 'path', 'timestamp', 'idempotency-key', 'raw-body-sha256'] as [
      'method',
      'path',
      'timestamp',
      'idempotency-key',
      'raw-body-sha256'
    ],
    signatureEncoding: 'lowercase-hex' as const,
    timestampFormat: 'unix-seconds' as const,
    signatureHeaderName: 'X-OpenPencil-Signature' as const,
    timestampHeaderName: 'X-OpenPencil-Timestamp' as const,
    idempotencyHeaderName: 'Idempotency-Key' as const
  }
  return {
    format: 'openpencil.backend-application',
    version: 2,
    applicationId: 'test.supabase-automations',
    dataModel: {
      version: 1,
      entities: [
        {
          id: 'events',
          name: 'events',
          management: 'managed',
          fields: [
            {
              id: 'event-id',
              name: 'id',
              type: 'uuid',
              nullable: false,
              default: { kind: 'generated', generator: 'uuid' }
            },
            { id: 'event-kind', name: 'kind', type: 'string', nullable: false }
          ],
          primaryKey: { fields: ['event-id'] }
        }
      ],
      enums: [],
      relations: []
    },
    auth: { version: 1, identities: [], roles: [], ownership: [], tenants: [], rowAccess: [] },
    workflows: { version: 1, workflows: [] },
    realtime: { version: 1, subscriptions: [] },
    transactions: { version: 1, transactions: [] },
    dataMigrations: { version: 1, migrations: [] },
    automations: {
      version: 1,
      queues: [
        {
          id: 'events',
          name: 'Events',
          visibility: 'private',
          delivery: 'at-least-once',
          maxPayloadBytes: 65_536,
          visibilityTimeoutSeconds: 60,
          retentionSeconds: 86_400
        },
        {
          id: 'dead-letter',
          name: 'Dead letter',
          visibility: 'private',
          delivery: 'at-least-once',
          maxPayloadBytes: 65_536,
          visibilityTimeoutSeconds: 60,
          retentionSeconds: 604_800
        }
      ],
      webhookDestinations: [
        {
          id: 'audit-endpoint',
          name: 'Audit endpoint',
          endpointCredentialRef: 'credential.00000000-0000-4000-8000-000000000002',
          method: 'POST',
          contentType: 'application/json',
          maxPayloadBytes: 65_536,
          signingCredentialRef: 'credential.00000000-0000-4000-8000-000000000003',
          signature
        }
      ],
      automations: [
        {
          id: 'scheduled-publish',
          name: 'Scheduled publish',
          subject: 'system',
          trigger: { kind: 'schedule', cron: '0 * * * *', timezone: 'UTC' },
          action: { kind: 'queue.publish', queueId: 'events', payloadExpression: 'input' },
          retry: {
            maxAttempts: 3,
            initialDelayMs: 1_000,
            maxDelayMs: 10_000,
            backoff: 'exponential',
            jitter: 'full',
            deadLetterQueueId: 'dead-letter'
          },
          idempotency: { kind: 'event-id', retentionHours: 24 },
          causation: { kind: 'required', idField: 'causationId', maxHop: 8 }
        },
        {
          id: 'event-delivery',
          name: 'Event delivery',
          subject: 'system',
          trigger: { kind: 'queue', queueId: 'events' },
          action: {
            kind: 'webhook.deliver',
            destinationId: 'audit-endpoint',
            payloadExpression: 'input'
          },
          retry: {
            maxAttempts: 5,
            initialDelayMs: 1_000,
            maxDelayMs: 60_000,
            backoff: 'exponential',
            jitter: 'full',
            deadLetterQueueId: 'dead-letter'
          },
          idempotency: { kind: 'event-id', retentionHours: 72 },
          causation: { kind: 'required', idField: 'causationId', maxHop: 8 }
        },
        {
          id: 'webhook-ingress',
          name: 'Webhook ingress',
          subject: 'system',
          trigger: {
            kind: 'webhook',
            method: 'POST',
            path: '/hooks/events',
            signature: {
              ...signature,
              credentialRef: 'credential.00000000-0000-4000-8000-000000000001',
              maxAgeSeconds: 300
            }
          },
          action: { kind: 'queue.publish', queueId: 'events', payloadExpression: 'input' },
          retry: {
            maxAttempts: 3,
            initialDelayMs: 1_000,
            maxDelayMs: 10_000,
            backoff: 'fixed',
            jitter: 'none',
            deadLetterQueueId: 'dead-letter'
          },
          idempotency: {
            kind: 'request-header',
            headerName: 'Idempotency-Key',
            retentionHours: 24
          },
          causation: { kind: 'required', idField: 'causationId', maxHop: 8 }
        }
      ],
      telemetry: { logs: false, metrics: false, traces: false, auditEvents: false },
      driftDetection: { enabled: false }
    },
    capabilities: [
      { capability: 'jobs.schedule', required: true },
      { capability: 'migrations.schema', required: true },
      { capability: 'queues.consume', required: true },
      { capability: 'queues.publish', required: true },
      { capability: 'server.functions', required: true },
      { capability: 'webhooks.deliver', required: true },
      { capability: 'webhooks.receive', required: true },
      { capability: 'workflows.durable-execution', required: true },
      { capability: 'workflows.idempotency', required: true },
      { capability: 'workflows.retry', required: true }
    ],
    secrets: [
      {
        kind: 'credential',
        credentialRef: 'credential.00000000-0000-4000-8000-000000000001',
        name: 'WEBHOOK_INGRESS_HMAC',
        exposure: 'server',
        required: true
      },
      {
        kind: 'credential',
        credentialRef: 'credential.00000000-0000-4000-8000-000000000002',
        name: 'WEBHOOK_EGRESS_ENDPOINT',
        exposure: 'server',
        required: true
      },
      {
        kind: 'credential',
        credentialRef: 'credential.00000000-0000-4000-8000-000000000003',
        name: 'WEBHOOK_EGRESS_HMAC',
        exposure: 'server',
        required: true
      }
    ]
  }
}

export function supabaseObservabilityApplicationV2(): BackendApplicationSpecV2 {
  const application = supabaseAutomationApplicationV2()
  return {
    ...application,
    applicationId: 'test.supabase-observability',
    automations: {
      ...application.automations,
      automations: [
        ...application.automations.automations,
        {
          id: 'schema-drift-check',
          name: 'Schema drift check',
          subject: 'system',
          trigger: { kind: 'schedule', cron: '15 3 * * *', timezone: 'UTC' },
          action: { kind: 'drift.detect', scope: 'declared-schema', mode: 'read-only' },
          retry: {
            maxAttempts: 3,
            initialDelayMs: 1_000,
            maxDelayMs: 10_000,
            backoff: 'exponential',
            jitter: 'full'
          },
          idempotency: { kind: 'event-id', retentionHours: 24 },
          causation: { kind: 'required', idField: 'causationId', maxHop: 4 }
        }
      ],
      telemetry: { logs: true, metrics: true, traces: true, auditEvents: true },
      driftDetection: { enabled: true, scheduleAutomationId: 'schema-drift-check' }
    },
    capabilities: [
      { capability: 'audit.events', required: true },
      { capability: 'drift.detect', required: true },
      { capability: 'jobs.schedule', required: true },
      { capability: 'migrations.schema', required: true },
      { capability: 'observability.logs', required: true },
      { capability: 'observability.metrics', required: true },
      { capability: 'observability.traces', required: true },
      { capability: 'queues.consume', required: true },
      { capability: 'queues.publish', required: true },
      { capability: 'server.functions', required: true },
      { capability: 'webhooks.deliver', required: true },
      { capability: 'webhooks.receive', required: true },
      { capability: 'workflows.durable-execution', required: true },
      { capability: 'workflows.idempotency', required: true },
      { capability: 'workflows.retry', required: true }
    ],
    secrets: application.secrets
  }
}

export function supabasePrivateRealtimeSelectionV2(bundle: BackendProviderBundleV2) {
  return {
    descriptor: bundle.descriptor,
    packageDigest: SUPABASE_V2_TEST_PACKAGE_DIGEST,
    enabled: true
  } as const
}

export function supabasePrivateRealtimeDescriptorSelectionV2() {
  return {
    descriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR_V2,
    packageDigest: SUPABASE_V2_TEST_PACKAGE_DIGEST,
    enabled: true
  } as const
}
