import { describe, expect, test } from 'bun:test'

import {
  activeBackendProviderAdapterSlotsV2,
  BACKEND_CAPABILITY_ADAPTER_SLOTS_V2,
  BACKEND_PROVIDER_ADAPTER_SLOTS_V2,
  backendCapabilityAdapterSlotV2,
  BackendProviderRegistryConfigurationErrorV2,
  createBackendProviderRegistryV2,
  negotiateBackendCapabilitiesV2,
  type BackendCapabilityDecisionV2,
  type BackendProviderAdapterSlotV2,
  type BackendProviderBundleV2
} from '@open-pencil/compiler'
import { BACKEND_CAPABILITIES_V2, type BackendCapabilityV2 } from '@open-pencil/lowcode/backend'

import { createFakeBackendProviderBundleV2 } from './helpers'

const EXPECTED_CAPABILITY_SLOTS = {
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
} as const satisfies Readonly<Record<BackendCapabilityV2, BackendProviderAdapterSlotV2>>

function capabilityBundle(
  capability: BackendCapabilityV2,
  slot: BackendProviderAdapterSlotV2
): BackendProviderBundleV2 {
  return createFakeBackendProviderBundleV2({
    slot,
    capabilities: [capability],
    outputs: ['database-schema'],
    artifacts: []
  })
}

function negotiateCapability(capability: BackendCapabilityV2, bundle: BackendProviderBundleV2) {
  return negotiateBackendCapabilitiesV2({
    requirements: [{ capability, required: true }],
    bundle,
    target: 'react',
    mode: 'production'
  })
}

function registryDiagnostics(bundle: BackendProviderBundleV2) {
  try {
    createBackendProviderRegistryV2([bundle])
  } catch (error) {
    if (error instanceof BackendProviderRegistryConfigurationErrorV2) return error.diagnostics
    throw error
  }
  throw new Error('Expected Backend Provider V2 registry configuration to fail')
}

describe('Compiler Backend Provider V2 capability routing', () => {
  test('maps every known capability to exactly one semantic adapter slot', () => {
    expect(Object.keys(BACKEND_CAPABILITY_ADAPTER_SLOTS_V2).sort()).toEqual(
      [...BACKEND_CAPABILITIES_V2].sort()
    )
    expect(BACKEND_CAPABILITY_ADAPTER_SLOTS_V2).toEqual(EXPECTED_CAPABILITY_SLOTS)

    for (const capability of BACKEND_CAPABILITIES_V2) {
      const expectedSlot = EXPECTED_CAPABILITY_SLOTS[capability]
      expect(backendCapabilityAdapterSlotV2(capability), capability).toBe(expectedSlot)
      expect(
        BACKEND_PROVIDER_ADAPTER_SLOTS_V2.filter((slot) => slot === expectedSlot),
        capability
      ).toEqual([expectedSlot])
    }
  })

  test('negotiates every capability only through its semantic adapter', () => {
    for (const capability of BACKEND_CAPABILITIES_V2) {
      const expectedSlot = EXPECTED_CAPABILITY_SLOTS[capability]
      const correct = capabilityBundle(capability, expectedSlot)
      expect(createBackendProviderRegistryV2([correct]).list(), capability).toEqual([
        expect.objectContaining({ capabilities: [capability] })
      ])
      const supported = negotiateCapability(capability, correct)
      expect(supported.diagnostics, capability).toEqual([])
      expect(supported.decisions, capability).toEqual([
        expect.objectContaining({ capability, providerSupported: true, included: true })
      ])

      const absent: BackendProviderBundleV2 = { descriptor: correct.descriptor }
      expect(registryDiagnostics(absent), capability).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'backend-provider-v2-registry-adapter-required' }),
          expect.objectContaining({ code: 'backend-provider-v2-registry-capabilities-mismatch' })
        ])
      )
      const absentResult = negotiateCapability(capability, absent)
      expect(absentResult.decisions, capability).toEqual([
        expect.objectContaining({ capability, providerSupported: false, included: false })
      ])
      expect(absentResult.diagnostics, capability).toEqual([
        expect.objectContaining({ code: 'backend-provider-v2-capability-required' })
      ])

      const wrongSlot = BACKEND_PROVIDER_ADAPTER_SLOTS_V2.find(
        (candidate) => candidate !== expectedSlot
      )
      if (!wrongSlot) throw new Error('Expected more than one Backend Provider V2 adapter slot')
      const wrongResult = negotiateCapability(capability, capabilityBundle(capability, wrongSlot))
      expect(wrongResult.decisions, capability).toEqual([
        expect.objectContaining({ capability, providerSupported: false, included: false })
      ])
      expect(wrongResult.diagnostics, capability).toEqual([
        expect.objectContaining({ code: 'backend-provider-v2-capability-required' })
      ])
    }
  })

  test('rejects wrong-slot and duplicate capability fulfillment for every capability', () => {
    for (const capability of BACKEND_CAPABILITIES_V2) {
      const expectedSlot = EXPECTED_CAPABILITY_SLOTS[capability]
      const wrongSlot = BACKEND_PROVIDER_ADAPTER_SLOTS_V2.find(
        (candidate) => candidate !== expectedSlot
      )
      if (!wrongSlot) throw new Error('Expected more than one Backend Provider V2 adapter slot')

      expect(registryDiagnostics(capabilityBundle(capability, wrongSlot)), capability).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'backend-provider-v2-registry-capability-slot-mismatch',
            path: `$.${wrongSlot}.capabilities[0]`
          })
        ])
      )

      const correct = capabilityBundle(capability, expectedSlot)
      const expectedAdapter = correct[expectedSlot]
      if (!expectedAdapter) throw new Error(`Missing ${expectedSlot} test adapter`)
      const duplicate: BackendProviderBundleV2 = {
        ...correct,
        [wrongSlot]: expectedAdapter
      }
      expect(registryDiagnostics(duplicate), capability).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'backend-provider-v2-registry-capability-slot-mismatch'
          }),
          expect.objectContaining({ code: 'backend-provider-v2-registry-capability-duplicate' })
        ])
      )

      const decision = {
        capability,
        required: true,
        providerSupported: true,
        targetStatus: 'supported',
        resolution: 'supported',
        included: true
      } satisfies BackendCapabilityDecisionV2
      expect(
        activeBackendProviderAdapterSlotsV2(duplicate, [decision], [capability]),
        capability
      ).toEqual([expectedSlot])
    }
  })

  test('fails closed for an unmapped runtime capability', () => {
    const unknownCapability = 'future.unreviewed' as BackendCapabilityV2
    expect(backendCapabilityAdapterSlotV2(unknownCapability)).toBeUndefined()

    const result = negotiateCapability(
      unknownCapability,
      capabilityBundle(unknownCapability, 'server')
    )
    expect(result).toMatchObject({
      decisions: [{ providerSupported: false, included: false }],
      diagnostics: [{ code: 'backend-provider-v2-capability-required' }]
    })
  })
})
