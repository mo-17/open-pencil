/* oxlint-disable max-lines -- Provider boundary, artifact safety, and adversarial inert-data checks remain co-located. */
import { describe, expect, test } from 'bun:test'

import {
  backendProviderPlanDigestV2,
  createSupabaseBackfillPlanV2,
  createBackendProviderPlanV2,
  createBackendProviderRegistryV2,
  emitBackendProviderPlanV2,
  SUPABASE_ATOMIC_TRANSACTION_ACTUAL_CAPABILITIES_V2,
  SUPABASE_BACKEND_PROVIDER_ADAPTER_VERSION_V2,
  SUPABASE_BACKEND_PROVIDER_BUNDLE_V2,
  SUPABASE_BACKFILL_ACTUAL_CAPABILITIES_V2,
  SUPABASE_BACKFILL_ARTIFACT_PATHS_V2,
  SUPABASE_BACKFILL_MAX_BATCH_RECEIPTS_V2,
  SUPABASE_BACKFILL_MAX_RECEIPTS_V2,
  SUPABASE_BACKFILL_RELEASE_BLOCKERS_V2,
  type BackendProviderAdapterContextV2,
  type BackendProviderPlanV2
} from '@open-pencil/compiler'
import type { BackendApplicationSpecV2 } from '@open-pencil/lowcode/backend'

import { supabaseBackfillApplicationV2, supabasePrivateRealtimeSelectionV2 } from './helpers'

function createPlan(
  application: unknown = supabaseBackfillApplicationV2(),
  target: 'react' | 'vue' | 'flutter' = 'react',
  mode: 'production' | 'preview' = 'production'
) {
  const registry = createBackendProviderRegistryV2([SUPABASE_BACKEND_PROVIDER_BUNDLE_V2])
  const selection = supabasePrivateRealtimeSelectionV2(SUPABASE_BACKEND_PROVIDER_BUNDLE_V2)
  const result = createBackendProviderPlanV2(registry, { selection, application, target, mode })
  return { registry, selection, result }
}

function emittedArtifacts(application = supabaseBackfillApplicationV2()) {
  const planned = createPlan(application)
  expect(planned.result.ok).toBe(true)
  if (!planned.result.ok) throw new Error(JSON.stringify(planned.result.diagnostics))
  const emitted = emitBackendProviderPlanV2(planned.registry, {
    plan: planned.result.plan,
    selection: planned.selection
  })
  if (!emitted.ok) throw new Error(JSON.stringify(emitted.diagnostics))
  expect(emitted.ok).toBe(true)
  const artifact = (path: string): string => {
    const content = emitted.emission.files.get(path)
    if (typeof content !== 'string') throw new Error(`Missing text artifact: ${path}`)
    return content
  }
  return { ...planned, plan: planned.result.plan, emission: emitted.emission, artifact }
}

function directContext(
  application = supabaseBackfillApplicationV2(),
  actualCapabilities: readonly (typeof SUPABASE_BACKFILL_ACTUAL_CAPABILITIES_V2)[number][] = SUPABASE_BACKFILL_ACTUAL_CAPABILITIES_V2
): BackendProviderAdapterContextV2 {
  return {
    application,
    selection: supabasePrivateRealtimeSelectionV2(SUPABASE_BACKEND_PROVIDER_BUNDLE_V2),
    target: 'react',
    mode: 'production',
    actualCapabilities,
    capabilities: []
  }
}

function backfillAdapter() {
  const adapter = SUPABASE_BACKEND_PROVIDER_BUNDLE_V2.dataMigrations
  if (!adapter?.validate) throw new Error('Missing Supabase backfill adapter')
  return { ...adapter, validate: adapter.validate }
}

describe('Supabase Backend Provider V2 receipt-driven backfill review artifacts', () => {
  test('keeps raw resolution and SQL emission outside the public Compiler API', async () => {
    const compilerPublicAPI = await import('@open-pencil/compiler')
    expect('resolvedSupabaseBackfillV2' in compilerPublicAPI).toBe(false)
    expect('emitSupabaseBackfillReadOnlySQLV2' in compilerPublicAPI).toBe(false)
    expect('emitSupabaseBackfillReviewSQLV2' in compilerPublicAPI).toBe(false)
  })

  test('routes the exact capabilities through a deterministic 2.2.0 dataMigrations adapter', () => {
    expect(SUPABASE_BACKEND_PROVIDER_ADAPTER_VERSION_V2).toBe('2.2.0')
    expect(SUPABASE_BACKEND_PROVIDER_BUNDLE_V2.dataMigrations).toMatchObject({
      capabilities: ['migrations.backfill', 'migrations.data'],
      outputs: ['deployment-manifest', 'migration-plan', 'server-runtime']
    })
    expect(SUPABASE_BACKEND_PROVIDER_BUNDLE_V2.dataMigrations?.outputs).not.toContain(
      'client-config'
    )

    const first = emittedArtifacts()
    const second = emittedArtifacts()
    expect(first.plan.planDigest).toBe(second.plan.planDigest)
    expect(first.emission.manifestDigest).toBe(second.emission.manifestDigest)
    expect([...first.emission.files]).toEqual([...second.emission.files])
    expect(first.plan.actualCapabilities).toEqual([
      'migrations.backfill',
      'migrations.data',
      'migrations.schema'
    ])
    expect(Object.keys(first.plan.adapterPlans)).toEqual(['migrations', 'dataMigrations'])
    expect(first.plan.adapterPlans.dataMigrations).toMatchObject({
      reviewOnly: true,
      applyAvailable: false,
      releaseReady: false,
      trustedHostRequired: true,
      liveCatalogInspected: false,
      mutationSqlEmitted: false,
      execution: {
        mode: 'receipt-driven-batches',
        runnerEmitted: false,
        databaseBatchLedgerAvailable: false,
        receiptBindingAvailable: false,
        maximumReceiptCount: 10_000,
        maximumBatchReceiptCount: 9_999
      },
      migration: {
        id: 'backfill-account-status',
        batchSize: 250,
        maximumReceiptCount: 10_000,
        maximumBatchReceiptCount: 9_999,
        cursor: {
          field: 'id',
          type: 'integer',
          identityGenerationRequired: 'always',
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER
        },
        predicate: { kind: 'field-is-null', field: 'status' },
        transform: {
          kind: 'set-literal',
          field: 'status',
          expectedPostgresType: 'pg_catalog.text',
          value: 'pending'
        },
        postconditions: [
          { kind: 'field-not-null', field: 'status' },
          { kind: 'matched-row-count', minimum: 1 }
        ],
        resumePolicy: 'from-receipt'
      },
      releaseBlockers: SUPABASE_BACKFILL_RELEASE_BLOCKERS_V2
    })
    expect(first.result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'supabase-v2-backfill-trusted-host-required',
        severity: 'warning'
      })
    )

    const vue = createPlan(supabaseBackfillApplicationV2(), 'vue')
    expect(vue.result).toMatchObject({ ok: true })
  })

  test('emits only a review plan, manifest, and SELECT template for the backfill slot', () => {
    const result = emittedArtifacts()
    const ownedPaths = Object.values(SUPABASE_BACKFILL_ARTIFACT_PATHS_V2)
    for (const path of ownedPaths) expect(result.emission.files.has(path)).toBe(true)
    const ownedManifestEntries = result.emission.manifest.artifacts.filter((entry) =>
      ownedPaths.includes(entry.path as (typeof ownedPaths)[number])
    )
    expect(ownedManifestEntries).toHaveLength(3)
    expect(ownedManifestEntries.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(['migration-plan', 'deployment-manifest', 'server-runtime'])
    )
    expect(ownedManifestEntries.some((entry) => entry.kind === 'client-config')).toBe(false)

    const migrationPlan = JSON.parse(
      result.artifact(SUPABASE_BACKFILL_ARTIFACT_PATHS_V2.migrationPlan)
    )
    const review = JSON.parse(result.artifact(SUPABASE_BACKFILL_ARTIFACT_PATHS_V2.reviewManifest))
    expect(migrationPlan).toMatchObject({
      format: 'openpencil.supabase-backfill-migration-plan.v1',
      reviewOnly: true,
      applyAvailable: false,
      releaseReady: false,
      trustedHostRequired: true,
      mutationSqlEmitted: false,
      executionContract: {
        strategy: 'capture-high-water-then-scan-monotonic-cursor',
        resumeSource: 'host-accepted-receipt-head',
        maximumReceiptCount: SUPABASE_BACKFILL_MAX_RECEIPTS_V2,
        maximumBatchReceiptCount: SUPABASE_BACKFILL_MAX_BATCH_RECEIPTS_V2,
        highWaterReceiptCount: 1,
        runnerEmitted: false
      },
      releaseBlockers: SUPABASE_BACKFILL_RELEASE_BLOCKERS_V2
    })
    expect(review).toMatchObject({
      reviewOnly: true,
      applyAvailable: false,
      deployAvailable: false,
      releaseReady: false,
      trustedHostRequired: true,
      outputs: {
        clientConfig: false,
        mutationSql: false,
        migrationPlan: true,
        deploymentManifest: true,
        reviewSqlTemplate: true
      },
      catalogChecks: {
        executionStatus: 'required-live-check',
        compilerObservedLiveCatalog: false,
        identityGeneration: 'always-required',
        sequenceIncrement: 1,
        sequenceCache: 1,
        sequenceCycle: false,
        sequenceMaximumAtMost: Number.MAX_SAFE_INTEGER,
        sequenceStateReadable: 'required',
        databasePrimary: 'required',
        targetCurrentlyNullable: true,
        targetDesiredNotNull: true,
        targetLiteralDefault: 'pending',
        cursorImmutabilityAndAppendMonotonicity: 'required-independent-host-proof',
        tableAndColumnAclInventory: 'required-independent-host-proof',
        rowPolicyInventory: 'required-independent-host-proof',
        triggerRuleAndFunctionInventory: 'required-independent-host-proof'
      },
      reviewSqlTemplate: {
        containsDirectMutationStatement: false,
        databaseEnforcedReadOnly: false,
        requiresTrustedHostReadOnlyTransaction: true,
        selectMayInvokePolicyFunctions: true
      },
      receiptAuthority: {
        providerV2BindingAvailable: false,
        databaseBatchLedgerAvailable: false,
        sourceLedgerBound: false,
        artifactDigestBound: false,
        providerAuthorityBound: false,
        maximumReceiptCount: 10_000,
        maximumBatchReceiptCount: 9_999,
        highWaterReceiptCount: 1
      },
      legacyAuthority: {
        legacyPathRetired: false,
        legacyPath: 'p1-unbounded-staged-backfill'
      },
      releaseBlockers: SUPABASE_BACKFILL_RELEASE_BLOCKERS_V2
    })
    expect(review.requiredManualChecks).toContain(
      'prove-estimated-cursor-range-batches-do-not-exceed-9999'
    )
    expect(review.requiredManualChecks).toContain(
      'enforce-database-read-only-transaction-for-every-review-query'
    )
    expect(review.requiredManualChecks).toContain('retire-p1-unbounded-staged-backfill-path')
    expect(review.requiredManualChecks).toContain(
      'inspect-table-and-column-acl-for-unbounded-cursor-writes'
    )
    expect(review.releaseBlockers).toContain('p1-identity-by-default-not-upgraded-to-always')
  })

  test('emits no direct DML or DDL and exposes bounded receipt review queries', () => {
    const sql = emittedArtifacts().artifact(SUPABASE_BACKFILL_ARTIFACT_PATHS_V2.sql)
    expect(sql).toContain('OpenPencil Supabase receipt-driven backfill read-only review v1')
    expect(sql).toContain('trusted Host must enforce a database READ ONLY transaction')
    expect(sql).toContain('openpencil:v1:entity:accounts')
    expect(sql).toContain('openpencil:v1:field:account-id')
    expect(sql).toContain('openpencil:v1:field:account-status')
    expect(sql).toContain('openpencil:v1:primary-key:accounts')
    expect(sql).toContain('"attidentity" = \'a\'')
    expect(sql).toContain('"identity_is_always"')
    expect(sql).toContain('"rls_enabled_and_forced"')
    expect(sql).toContain('"identity_sequence_owned_by_cursor"')
    expect(sql).toContain('"database_is_primary"')
    expect(sql).toContain('"identity_sequence_state_readable"')
    expect(sql).toContain('"has_sequence_privilege"')
    expect(sql).toContain('"seqincrement" = 1')
    expect(sql).toContain('"seqcache" = 1')
    expect(sql).toContain('NOT "seqcycle"')
    expect(sql).toContain('"identity_sequence_current_value_safe"')
    expect(sql).toContain('"identity_sequence_not_behind_cursor"')
    expect(sql).toContain(String(Number.MAX_SAFE_INTEGER))
    expect(sql).toContain('"target_actual_default_expression"')
    expect(sql).toContain('"target_expected_literal_json"')
    expect(sql).toContain('"eligible_batch_count"')
    expect(sql).toContain('"cursor_range_batch_count"')
    expect(sql).toContain('10000::"pg_catalog"."int8" AS "maximum_total_receipt_count"')
    expect(sql).toContain('9999::"pg_catalog"."int8" AS "maximum_batch_receipt_count"')
    expect(sql).toContain('<= 9999 AS "within_receipt_count_limit"')
    expect(sql).toContain('$1::"pg_catalog"."int8" AS "captured_high_water"')
    expect(sql).toContain('$2::"pg_catalog"."int8" AS "last_processed_key"')
    expect(sql).toContain('LIMIT 250')
    expect(sql).toContain('"required_matched_row_count_from_receipts"')
    expect(sql).toContain('FROM "public"."accounts"')
    expect(sql).not.toMatch(/\b(?:ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|COMMENT)\b/iu)
    expect(sql).not.toMatch(/\b(?:UPDATE|INSERT|DELETE|MERGE|CALL|EXECUTE|DO)\b/iu)
    expect(sql).not.toMatch(/\b(?:BEGIN|COMMIT|ROLLBACK)\b/iu)
    expect(sql).not.toContain('set-literal')
    expect(sql).not.toContain("'pending'::text")
    expect(sql).not.toContain('"constraint_entry"."conname"')
  })

  test('quotes uppercase enum type identity exactly and remains valid across table or field renames', () => {
    const application = supabaseBackfillApplicationV2()
    application.dataModel.enums = [
      { id: 'account-status-type', name: 'StatusType', values: ['pending', 'active'] }
    ]
    application.dataModel.entities[0].name = 'RenamedAccounts'
    application.dataModel.entities[0].fields[0].name = 'RenamedId'
    application.dataModel.entities[0].fields[1] = {
      ...application.dataModel.entities[0].fields[1],
      type: 'enum',
      enumId: 'account-status-type'
    }
    const result = emittedArtifacts(application)
    expect(result.plan.adapterPlans.dataMigrations).toMatchObject({
      migration: {
        transform: { expectedPostgresType: '"public"."StatusType"' }
      }
    })
    const sql = result.artifact(SUPABASE_BACKFILL_ARTIFACT_PATHS_V2.sql)
    expect(sql).toContain('FROM "public"."RenamedAccounts"')
    expect(sql).toContain('MAX("RenamedId")')
    expect(sql).toContain('"pg_catalog"."to_regtype"(E\'"public"."StatusType"\')')
    expect(sql).toContain('openpencil:v1:primary-key:accounts')
    expect(sql).not.toContain('"constraint_entry"."conname"')
  })

  test('rejects non-production and non-web targets', () => {
    expect(createPlan(supabaseBackfillApplicationV2(), 'react', 'preview').result).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'supabase-v2-backfill-production-mode-required' })
      ])
    })
    expect(createPlan(supabaseBackfillApplicationV2(), 'flutter').result).toMatchObject({
      ok: false
    })
    const context = directContext()
    expect(backfillAdapter().validate({ ...context, target: 'flutter' })).toContainEqual(
      expect.objectContaining({ code: 'supabase-v2-backfill-target-unsupported' })
    )
  })

  test('rejects transforms, defaults, predicates, postconditions, and protected targets outside the exact subset', () => {
    const adapter = backfillAdapter()

    const copied = supabaseBackfillApplicationV2()
    copied.dataMigrations.migrations[0].transforms = [
      { kind: 'copy-field', sourceFieldId: 'account-status', targetFieldId: 'account-status' }
    ]
    expect(adapter.validate(directContext(copied))).toContainEqual(
      expect.objectContaining({ code: 'supabase-v2-backfill-transform-invalid' })
    )

    const nullable = supabaseBackfillApplicationV2()
    nullable.dataModel.entities[0].fields[1].nullable = true
    expect(adapter.validate(directContext(nullable))).toContainEqual(
      expect.objectContaining({ code: 'supabase-v2-backfill-target-default-invalid' })
    )

    const mismatchedDefault = supabaseBackfillApplicationV2()
    mismatchedDefault.dataModel.entities[0].fields[1].default = {
      kind: 'literal',
      value: 'active'
    }
    expect(adapter.validate(directContext(mismatchedDefault))).toContainEqual(
      expect.objectContaining({ code: 'supabase-v2-backfill-target-default-invalid' })
    )

    const predicate = supabaseBackfillApplicationV2()
    predicate.dataMigrations.migrations[0].predicate.fieldId = 'account-id'
    expect(adapter.validate(directContext(predicate))).toContainEqual(
      expect.objectContaining({ code: 'supabase-v2-backfill-predicate-invalid' })
    )

    const postconditions = supabaseBackfillApplicationV2()
    postconditions.dataMigrations.migrations[0].postconditions = [
      { kind: 'matched-row-count', minimum: 1 }
    ]
    expect(adapter.validate(directContext(postconditions))).toContainEqual(
      expect.objectContaining({ code: 'supabase-v2-backfill-postconditions-invalid' })
    )

    const onlyRequiredPostcondition = supabaseBackfillApplicationV2()
    onlyRequiredPostcondition.dataMigrations.migrations[0].postconditions = [
      { kind: 'field-not-null', fieldId: 'account-status' }
    ]
    expect(adapter.validate(directContext(onlyRequiredPostcondition))).not.toContainEqual(
      expect.objectContaining({ code: 'supabase-v2-backfill-postconditions-invalid' })
    )

    const protectedTarget = supabaseBackfillApplicationV2()
    protectedTarget.auth.ownership = [
      { id: 'account-owner', entityId: 'accounts', identityFieldId: 'account-status' }
    ]
    expect(adapter.validate(directContext(protectedTarget))).toContainEqual(
      expect.objectContaining({ code: 'supabase-v2-backfill-protected-target-forbidden' })
    )

    const foreignKeyTarget = supabaseBackfillApplicationV2()
    foreignKeyTarget.dataModel.entities[0].foreignKeys = [
      {
        id: 'status-reference',
        fields: ['account-status'],
        targetEntityId: 'accounts',
        targetFields: ['account-id'],
        onDelete: 'restrict'
      }
    ]
    expect(adapter.validate(directContext(foreignKeyTarget))).toContainEqual(
      expect.objectContaining({ code: 'supabase-v2-backfill-protected-target-forbidden' })
    )

    const cursorTarget = supabaseBackfillApplicationV2()
    cursorTarget.dataMigrations.migrations[0].predicate.fieldId = 'account-id'
    cursorTarget.dataMigrations.migrations[0].transforms = [
      { kind: 'set-literal', fieldId: 'account-id', value: 1 }
    ]
    cursorTarget.dataMigrations.migrations[0].postconditions = [
      { kind: 'field-not-null', fieldId: 'account-id' }
    ]
    expect(adapter.validate(directContext(cursorTarget))).toContainEqual(
      expect.objectContaining({ code: 'supabase-v2-backfill-protected-target-forbidden' })
    )

    const tenantTarget = supabaseBackfillApplicationV2()
    tenantTarget.auth.tenants = [
      {
        id: 'account-tenant',
        entityId: 'accounts',
        tenantFieldId: 'account-status',
        membershipEntityId: 'accounts',
        membershipIdentityFieldId: 'account-status',
        membershipTenantFieldId: 'account-status'
      }
    ]
    expect(adapter.validate(directContext(tenantTarget))).toContainEqual(
      expect.objectContaining({ code: 'supabase-v2-backfill-protected-target-forbidden' })
    )
  })

  test('rejects cursor and application shapes outside one managed identity-key migration', () => {
    const adapter = backfillAdapter()
    const invalidCursor = supabaseBackfillApplicationV2()
    invalidCursor.dataModel.entities[0].fields[0].default = {
      kind: 'literal',
      value: 0
    }
    expect(adapter.validate(directContext(invalidCursor))).toContainEqual(
      expect.objectContaining({ code: 'supabase-v2-backfill-cursor-invalid' })
    )

    const multiple = supabaseBackfillApplicationV2()
    multiple.dataMigrations.migrations.push({
      ...structuredClone(multiple.dataMigrations.migrations[0]),
      id: 'second-backfill'
    })
    expect(adapter.validate(directContext(multiple))).toContainEqual(
      expect.objectContaining({ code: 'supabase-v2-backfill-migration-count-invalid' })
    )

    const external = supabaseBackfillApplicationV2()
    external.dataModel.entities[0].management = 'external'
    expect(adapter.validate(directContext(external))).toContainEqual(
      expect.objectContaining({ code: 'supabase-v2-backfill-managed-entity-count-invalid' })
    )

    const injectedBatchSize = supabaseBackfillApplicationV2()
    Reflect.set(
      injectedBatchSize.dataMigrations.migrations[0],
      'batchSize',
      '1; DELETE FROM public.accounts; --'
    )
    expect(adapter.validate(directContext(injectedBatchSize))).toContainEqual(
      expect.objectContaining({ code: 'supabase-v2-backfill-batch-size-invalid' })
    )
    expect(() => createSupabaseBackfillPlanV2(directContext(injectedBatchSize))).toThrow()

    const injectedMinimum = supabaseBackfillApplicationV2()
    Reflect.set(
      injectedMinimum.dataMigrations.migrations[0].postconditions[1],
      'minimum',
      '0; DELETE FROM public.accounts; --'
    )
    expect(adapter.validate(directContext(injectedMinimum))).toContainEqual(
      expect.objectContaining({ code: 'supabase-v2-backfill-postconditions-invalid' })
    )
    expect(() => createSupabaseBackfillPlanV2(directContext(injectedMinimum))).toThrow()
  })

  test('rejects every unrelated capability and keeps Realtime and Atomic validators closed', () => {
    const adapter = backfillAdapter()
    const unrelated = [
      ...SUPABASE_BACKFILL_ACTUAL_CAPABILITIES_V2,
      'realtime.subscribe',
      'transactions.atomic'
    ] as const
    const context: BackendProviderAdapterContextV2 = {
      ...directContext(),
      actualCapabilities: unrelated
    }
    expect(adapter.validate(context)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'supabase-v2-backfill-capability-unsupported',
          path: '$.actualCapabilities.realtime.subscribe'
        }),
        expect.objectContaining({
          code: 'supabase-v2-backfill-capability-unsupported',
          path: '$.actualCapabilities.transactions.atomic'
        })
      ])
    )

    const realtime = SUPABASE_BACKEND_PROVIDER_BUNDLE_V2.realtime
    const transactions = SUPABASE_BACKEND_PROVIDER_BUNDLE_V2.transactions
    if (!realtime?.validate || !transactions?.validate) throw new Error('Missing V2 validators')
    expect(
      realtime.validate({
        ...context,
        actualCapabilities: [
          'auth.identity',
          'events.data-change',
          'migrations.schema',
          'policy.row-level',
          'realtime.subscribe',
          'migrations.backfill',
          'migrations.data'
        ]
      })
    ).toContainEqual(
      expect.objectContaining({ code: 'supabase-v2-private-realtime-capability-unsupported' })
    )
    expect(
      transactions.validate({
        ...context,
        actualCapabilities: [
          ...SUPABASE_ATOMIC_TRANSACTION_ACTUAL_CAPABILITIES_V2,
          'migrations.backfill',
          'migrations.data'
        ]
      })
    ).toContainEqual(expect.objectContaining({ code: 'supabase-v2-atomic-capability-unsupported' }))
  })

  test('fails closed for secret-like, accessor, and throwing proxy inputs', () => {
    const secretLike = supabaseBackfillApplicationV2()
    secretLike.dataModel.entities[0].fields[1].default = {
      kind: 'literal',
      value: ['sb_secret', 'backfill_material_must_not_pass'].join('_')
    }
    secretLike.dataMigrations.migrations[0].transforms = [
      {
        kind: 'set-literal',
        fieldId: 'account-status',
        value: ['sb_secret', 'backfill_material_must_not_pass'].join('_')
      }
    ]
    expect(createPlan(secretLike).result).toMatchObject({ ok: false })

    const accessor = supabaseBackfillApplicationV2()
    let accesses = 0
    const migrations = accessor.dataMigrations
    Object.defineProperty(accessor, 'dataMigrations', {
      enumerable: true,
      get() {
        accesses += 1
        return migrations
      }
    })
    expect(createPlan(accessor).result).toMatchObject({ ok: false })
    expect(accesses).toBe(0)

    const proxy = new Proxy(supabaseBackfillApplicationV2(), {
      ownKeys() {
        throw new Error('must remain hidden')
      }
    })
    expect(() => createPlan(proxy)).not.toThrow()
    expect(createPlan(proxy).result).toMatchObject({ ok: false })
  })

  test('rejects recomputed adapter-plan tampering before artifact emission', () => {
    const planned = createPlan()
    expect(planned.result.ok).toBe(true)
    if (!planned.result.ok) return
    const tampered = structuredClone(planned.result.plan) as BackendProviderPlanV2 & {
      planDigest: string
      adapterPlans: { dataMigrations: { trustedHostRequired: boolean } }
    }
    tampered.adapterPlans.dataMigrations.trustedHostRequired = false
    tampered.planDigest = backendProviderPlanDigestV2(tampered)
    expect(
      emitBackendProviderPlanV2(planned.registry, {
        plan: tampered,
        selection: planned.selection
      })
    ).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'backend-provider-v2-plan-stale' })
      ])
    })
  })

  test('normalizes an exact fixture instead of trusting a typed object assertion', () => {
    const application: BackendApplicationSpecV2 = supabaseBackfillApplicationV2()
    const planned = createPlan(application)
    expect(planned.result).toMatchObject({ ok: true })
    if (!planned.result.ok) return
    expect(Object.isFrozen(planned.result.plan.application)).toBe(true)
    expect(Object.isFrozen(planned.result.plan.application.dataMigrations.migrations)).toBe(true)
  })
})
