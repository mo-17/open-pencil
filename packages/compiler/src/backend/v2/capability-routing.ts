import type { BackendCapabilityV2 } from '@open-pencil/lowcode/backend'

import type { BackendProviderAdapterSlotV2 } from './contracts'

/**
 * Every Backend V2 capability has exactly one semantic adapter owner. This table is deliberately
 * exhaustive so extending the capability union cannot silently route new authority through an
 * unrelated adapter slot.
 */
export const BACKEND_CAPABILITY_ADAPTER_SLOTS_V2 = Object.freeze({
  'data.read': 'data',
  'data.write': 'data',
  'auth.identity': 'auth',
  'auth.roles': 'auth',
  'policy.row-level': 'securityPolicy',
  'server.functions': 'server',
  'server.http': 'server',
  'storage.objects': 'data',
  'migrations.schema': 'migrations',
  'migrations.data': 'dataMigrations',
  'migrations.backfill': 'dataMigrations',
  'realtime.subscribe': 'realtime',
  'events.data-change': 'realtime',
  'transactions.atomic': 'transactions',
  'jobs.schedule': 'automations',
  'queues.publish': 'automations',
  'queues.consume': 'automations',
  'webhooks.receive': 'automations',
  'webhooks.deliver': 'automations',
  'workflows.idempotency': 'automations',
  'workflows.retry': 'automations',
  'workflows.durable-execution': 'automations',
  'observability.logs': 'observability',
  'observability.metrics': 'observability',
  'observability.traces': 'observability',
  'audit.events': 'observability',
  'drift.detect': 'observability'
} as const satisfies Readonly<Record<BackendCapabilityV2, BackendProviderAdapterSlotV2>>)

/** Returns no slot for unknown runtime input so negotiation and registry validation fail closed. */
export function backendCapabilityAdapterSlotV2(
  capability: unknown
): BackendProviderAdapterSlotV2 | undefined {
  if (
    typeof capability !== 'string' ||
    !Object.hasOwn(BACKEND_CAPABILITY_ADAPTER_SLOTS_V2, capability)
  ) {
    return undefined
  }
  return BACKEND_CAPABILITY_ADAPTER_SLOTS_V2[
    capability as keyof typeof BACKEND_CAPABILITY_ADAPTER_SLOTS_V2
  ]
}
