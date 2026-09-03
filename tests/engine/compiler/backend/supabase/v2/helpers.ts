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
