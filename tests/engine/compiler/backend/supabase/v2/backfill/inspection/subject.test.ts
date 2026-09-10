import { describe, expect, test } from 'bun:test'

import {
  backendProviderPlanDigestV2,
  createBackendProviderPlanV2,
  createBackendProviderRegistryV2,
  createSupabaseBackfillInspectionSubjectV1,
  emitBackendProviderPlanV2,
  SUPABASE_BACKEND_PROVIDER_BUNDLE_V2,
  SUPABASE_BACKFILL_ARTIFACT_PATHS_V2,
  type BackendProviderPlanV2
} from '@open-pencil/compiler'

import {
  supabaseBackfillApplicationV2,
  supabasePrivateRealtimeSelectionV2
} from '#tests/engine/compiler/backend/supabase/v2/helpers'

function emittedBackfill() {
  const registry = createBackendProviderRegistryV2([SUPABASE_BACKEND_PROVIDER_BUNDLE_V2])
  const selection = supabasePrivateRealtimeSelectionV2(SUPABASE_BACKEND_PROVIDER_BUNDLE_V2)
  const planned = createBackendProviderPlanV2(registry, {
    selection,
    application: supabaseBackfillApplicationV2(),
    target: 'react',
    mode: 'production'
  })
  if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics))
  const emitted = emitBackendProviderPlanV2(registry, { plan: planned.plan, selection })
  if (!emitted.ok) throw new Error(JSON.stringify(emitted.diagnostics))
  return { registry, selection, plan: planned.plan, emission: emitted.emission }
}

describe('Supabase V2 backfill inspection subject', () => {
  test('binds normalized migration identity to the exact plan and emitted review artifacts', () => {
    const first = emittedBackfill()
    const second = emittedBackfill()
    const firstSubject = createSupabaseBackfillInspectionSubjectV1(first.registry, {
      plan: first.plan,
      selection: first.selection
    })
    const secondSubject = createSupabaseBackfillInspectionSubjectV1(second.registry, {
      plan: second.plan,
      selection: second.selection
    })

    expect(firstSubject).toEqual(secondSubject)
    expect(firstSubject.subjectDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(firstSubject.subject).toMatchObject({
      format: 'openpencil.supabase-backfill-inspection-subject.v1',
      version: 1,
      providerId: 'supabase',
      reviewOnly: true,
      applyAvailable: false,
      releaseReady: false,
      executionAuthorityCreated: false,
      application: {
        id: 'test.supabase-receipt-backfill',
        digest: first.plan.applicationDigest
      },
      plan: {
        digest: first.plan.planDigest,
        target: 'react',
        mode: 'production'
      },
      emission: {
        manifestDigest: first.emission.manifestDigest,
        artifacts: {
          migrationPlan: {
            path: SUPABASE_BACKFILL_ARTIFACT_PATHS_V2.migrationPlan
          },
          reviewManifest: {
            path: SUPABASE_BACKFILL_ARTIFACT_PATHS_V2.reviewManifest
          },
          reviewSqlTemplate: {
            path: SUPABASE_BACKFILL_ARTIFACT_PATHS_V2.sql
          }
        }
      },
      migration: {
        id: 'backfill-account-status',
        entity: {
          id: 'accounts',
          table: 'accounts',
          marker: 'openpencil:v1:entity:accounts'
        },
        cursor: {
          fieldId: 'account-id',
          field: 'id',
          marker: 'openpencil:v1:field:account-id',
          primaryKeyMarker: 'openpencil:v1:primary-key:accounts',
          postgresType: 'pg_catalog.int8',
          identityGeneration: 'always',
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER
        },
        target: {
          fieldId: 'account-status',
          field: 'status',
          marker: 'openpencil:v1:field:account-status',
          postgresType: 'pg_catalog.text',
          desiredNullable: false,
          expectedLiteral: 'pending',
          enum: null
        },
        batchSize: 250,
        maximumReceiptCount: 10_000,
        maximumBatchReceiptCount: 9_999,
        requiredMatchedRowCount: 1
      },
      inspection: {
        queryFamily: 'openpencil.supabase-backfill-catalog-inspection.v1',
        catalogOnly: true,
        generatedReviewSqlIsAuthority: false,
        observedHighWaterIsLockedCapture: false,
        mayCreateReceipt: false
      }
    })
  })

  test('binds exact enum identity and ordered values without weakening review-only state', () => {
    const source = supabaseBackfillApplicationV2()
    source.dataModel.enums = [
      { id: 'account-status-type', name: 'StatusType', values: ['pending', 'active'] }
    ]
    source.dataModel.entities[0].fields[1] = {
      ...source.dataModel.entities[0].fields[1],
      type: 'enum',
      enumId: 'account-status-type'
    }
    const registry = createBackendProviderRegistryV2([SUPABASE_BACKEND_PROVIDER_BUNDLE_V2])
    const selection = supabasePrivateRealtimeSelectionV2(SUPABASE_BACKEND_PROVIDER_BUNDLE_V2)
    const planned = createBackendProviderPlanV2(registry, {
      selection,
      application: source,
      target: 'vue',
      mode: 'production'
    })
    if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics))
    const emitted = emitBackendProviderPlanV2(registry, { plan: planned.plan, selection })
    if (!emitted.ok) throw new Error(JSON.stringify(emitted.diagnostics))

    expect(
      createSupabaseBackfillInspectionSubjectV1(registry, {
        plan: planned.plan,
        selection
      }).subject
    ).toMatchObject({
      reviewOnly: true,
      applyAvailable: false,
      releaseReady: false,
      migration: {
        target: {
          postgresType: '"public"."StatusType"',
          enum: {
            id: 'account-status-type',
            name: 'StatusType',
            marker: 'openpencil:v1:enum:account-status-type',
            orderedValues: ['pending', 'active']
          }
        }
      }
    })
  })

  test('rejects a recomputed foreign adapter plan and stale package authority', () => {
    const { registry, selection, plan } = emittedBackfill()
    const tampered = structuredClone(plan) as BackendProviderPlanV2 & {
      planDigest: string
      adapterPlans: { dataMigrations: { migration: { table: string } } }
    }
    tampered.adapterPlans.dataMigrations.migration.table = 'foreign_accounts'
    tampered.planDigest = backendProviderPlanDigestV2(tampered)
    expect(() =>
      createSupabaseBackfillInspectionSubjectV1(registry, {
        plan: tampered,
        selection
      })
    ).toThrow('trusted Provider registry')

    const staleSelection = {
      ...selection,
      packageDigest: `sha256:${'B'.repeat(43)}`
    }
    expect(() =>
      createSupabaseBackfillInspectionSubjectV1(registry, {
        plan,
        selection: staleSelection
      })
    ).toThrow('trusted Provider registry')

    const forgedAuthority = structuredClone(plan) as BackendProviderPlanV2 & {
      planDigest: string
      authority: { pluginId: string; contractVersion: number; capabilities: string[] }
    }
    forgedAuthority.authority.pluginId = 'evil.provider'
    forgedAuthority.authority.contractVersion = 99
    forgedAuthority.authority.capabilities = []
    forgedAuthority.planDigest = backendProviderPlanDigestV2(forgedAuthority)
    expect(() =>
      createSupabaseBackfillInspectionSubjectV1(registry, {
        plan: forgedAuthority,
        selection
      })
    ).toThrow('trusted Provider registry')
  })

  test('rejects accessors and throwing proxies without invoking application data', () => {
    const { registry, selection, plan } = emittedBackfill()
    let accesses = 0
    const accessorPlan = { ...plan }
    Object.defineProperty(accessorPlan, 'application', {
      enumerable: true,
      get() {
        accesses += 1
        return plan.application
      }
    })
    expect(() =>
      createSupabaseBackfillInspectionSubjectV1(registry, {
        plan: accessorPlan,
        selection
      })
    ).toThrow('inert data')
    expect(accesses).toBe(0)

    const proxy = new Proxy(plan, {
      ownKeys() {
        throw new Error('must remain hidden')
      }
    })
    expect(() =>
      createSupabaseBackfillInspectionSubjectV1(registry, {
        plan: proxy,
        selection
      })
    ).toThrow('inert data')
  })
})
