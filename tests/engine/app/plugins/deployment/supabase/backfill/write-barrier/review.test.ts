/* oxlint-disable eslint/max-lines -- One adversarial live fixture covers the complete Host review boundary. */
import { describe, expect, test } from 'bun:test'

import {
  createBackendProviderPlanV2,
  createBackendProviderRegistryV2,
  createSupabaseBackfillInspectionSubjectV1,
  SUPABASE_BACKEND_PROVIDER_BUNDLE_V2,
  type BackendApplicationSpecV2
} from '@open-pencil/compiler/backend'

import {
  type SupabaseBackfillLiveCatalogAuthorityV1,
  type SupabaseBackfillLiveCatalogCompilerInputV1,
  type SupabaseBackfillLiveCatalogHostTransportV1,
  type SupabaseBackfillLiveCatalogRequestV1
} from '@/app/plugins/host/deployment/supabase/backfill/live-inspector'
import {
  reviewSupabaseBackfillWriteBarrierV1,
  SUPABASE_BACKFILL_WRITE_BARRIER_ARTIFACT_PATH,
  SUPABASE_BACKFILL_WRITE_BARRIER_EXECUTION_POLICY,
  SUPABASE_BACKFILL_WRITE_BARRIER_MARKER_PREFIX,
  SupabaseBackfillWriteBarrierReviewError,
  type ReviewSupabaseBackfillWriteBarrierOptionsV1
} from '@/app/plugins/host/deployment/supabase/backfill/write-barrier/review'

import {
  supabaseBackfillApplicationV2,
  supabasePrivateRealtimeSelectionV2
} from '#tests/engine/compiler/backend/supabase/v2/helpers'

const PROJECT_REF = 'abcdefghijklmnopqrst'
const ACCOUNT_ID = 'organization-1'
const GRANT_GENERATION = '123e4567-e89b-42d3-a456-426614174000'
const SNAPSHOT_MARKER = '100:200:'
const OBSERVED_AT = '2026-09-04T00:00:00.000Z'

type MutableRecord = Record<string, unknown>

const AUTHORITY: SupabaseBackfillLiveCatalogAuthorityV1 = Object.freeze({
  projectRef: PROJECT_REF,
  accountId: ACCOUNT_ID,
  grantGeneration: GRANT_GENERATION
})

function applicationWithBatchSize(batchSize: number): BackendApplicationSpecV2 {
  const application = supabaseBackfillApplicationV2()
  const migration = application.dataMigrations.migrations[0]
  if (!migration) throw new Error('Missing backfill fixture migration')
  return {
    ...application,
    dataMigrations: {
      ...application.dataMigrations,
      migrations: [{ ...migration, batchSize }]
    }
  }
}

function compilerInput(batchSize = 250): SupabaseBackfillLiveCatalogCompilerInputV1 {
  const registry = createBackendProviderRegistryV2([SUPABASE_BACKEND_PROVIDER_BUNDLE_V2])
  const selection = supabasePrivateRealtimeSelectionV2(SUPABASE_BACKEND_PROVIDER_BUNDLE_V2)
  const planned = createBackendProviderPlanV2(registry, {
    selection,
    application: applicationWithBatchSize(batchSize),
    target: 'react',
    mode: 'production'
  })
  if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics))
  return Object.freeze({ registry, selection, plan: planned.plan })
}

function nestedRecord(value: MutableRecord, key: string): MutableRecord {
  const nested = value[key]
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
    throw new Error(`Missing response object ${key}`)
  }
  return nested as MutableRecord
}

function zeroHazards(): MutableRecord {
  return {
    nonPrimaryUniqueOrExclusionConstraintCount: 0,
    nonPrimaryIndexCount: 0,
    partialOrExpressionIndexCount: 0,
    checkConstraintCount: 0,
    outboundForeignKeyConstraintCount: 0,
    inboundForeignKeyConstraintCount: 0,
    generatedColumnCount: 0,
    inheritanceRelationCount: 0,
    userTriggerCount: 0,
    userRuleCount: 0,
    policyCount: 0,
    publicationMembershipCount: 0,
    tableAclEntryCount: 0,
    columnAclCount: 0
  }
}

// This is the same manually hardened prerequisite schema used by the live Inspector tests.
function catalogResponse(request: SupabaseBackfillLiveCatalogRequestV1): MutableRecord {
  const parameters = request.parameters
  return {
    subjectDigest: request.subjectDigest,
    projectRef: request.projectRef,
    accountId: request.accountId,
    grantGeneration: request.grantGeneration,
    queryVersion: request.queryVersion,
    queryDigest: request.queryDigest,
    accessMode: 'read-only',
    snapshotScope: 'single-statement',
    catalogOnly: true,
    snapshotMarker: SNAPSHOT_MARKER,
    observedAt: OBSERVED_AT,
    roles: {
      currentOid: '9000',
      currentName: 'supabase_read_only_user',
      currentSuperuser: false,
      currentBypassRls: true,
      sessionOid: '9000',
      sessionName: 'supabase_read_only_user',
      sessionSuperuser: false,
      sessionBypassRls: true
    },
    settings: {
      transactionReadOnly: true,
      rowSecurity: true,
      searchPath: 'pg_catalog, public',
      effectiveSearchPath: ['pg_catalog', 'public'],
      databasePrimary: true,
      rowSecurityActiveForTable: false
    },
    schema: { oid: '2200', name: 'public' },
    table: {
      classOid: '1259',
      oid: '50000',
      schemaOid: '2200',
      name: parameters.table,
      ownerOid: '10',
      ownerName: 'postgres',
      marker: parameters.entityMarker,
      rlsEnabled: true,
      rlsForced: true
    },
    cursor: {
      classOid: '1259',
      objectOid: '50000',
      subId: 1,
      name: parameters.cursorField,
      marker: parameters.cursorMarker,
      typeOid: '20',
      typeSchema: 'pg_catalog',
      typeName: 'int8',
      typeModifier: -1,
      notNull: true,
      identityKind: 'a',
      generatedKind: ''
    },
    target: {
      classOid: '1259',
      objectOid: '50000',
      subId: 2,
      name: parameters.targetField,
      marker: parameters.targetMarker,
      typeOid: '25',
      typeSchemaOid: '11',
      typeSchema: 'pg_catalog',
      typeName: 'text',
      typeKind: 'b',
      typeModifier: -1,
      notNull: false,
      identityKind: '',
      generatedKind: '',
      hasDefault: false,
      enumMarker: null,
      enumValues: []
    },
    primaryKey: {
      classOid: '2606',
      oid: '50001',
      tableOid: '50000',
      name: 'accounts_pkey',
      marker: parameters.primaryKeyMarker,
      fieldCount: 1,
      cursorSubId: 1
    },
    sequence: {
      classOid: '1259',
      oid: '50002',
      schemaOid: '2200',
      schema: 'public',
      name: 'accounts_id_seq',
      dependencyType: 'i',
      incrementBy: '1',
      minimumValue: '0',
      maximumValue: String(Number.MAX_SAFE_INTEGER),
      cacheSize: '1',
      cycle: false,
      ownedTableOid: '50000',
      ownedSubId: 1,
      liveValueObserved: false
    },
    hazards: zeroHazards()
  }
}

function sequenceReader<T>(values: readonly T[]): () => T {
  if (values.length === 0) throw new Error('A live input sequence cannot be empty')
  let index = 0
  return () => values[Math.min(index++, values.length - 1)] as T
}

interface FixtureOptions {
  readonly compilerInputs?: readonly SupabaseBackfillLiveCatalogCompilerInputV1[]
  readonly authorities?: readonly SupabaseBackfillLiveCatalogAuthorityV1[]
  readonly transformResponse?: (response: MutableRecord) => unknown
}

function fixture(options: FixtureOptions = {}) {
  const compilerInputs = options.compilerInputs ?? [compilerInput()]
  const authorities = options.authorities ?? [AUTHORITY]
  const requests: SupabaseBackfillLiveCatalogRequestV1[] = []
  let projectAuthorityCalls = 0
  const transport: SupabaseBackfillLiveCatalogHostTransportV1 = {
    async getProjectAuthority(request) {
      projectAuthorityCalls += 1
      return {
        projectRef: request.projectRef,
        organizationId: request.accountId,
        grantGeneration: request.grantGeneration
      }
    },
    async runReadOnlyBackfillCatalogQuery(request) {
      requests.push(request)
      const response = catalogResponse(request)
      return options.transformResponse?.(response) ?? response
    }
  }
  const reviewOptions: ReviewSupabaseBackfillWriteBarrierOptionsV1 = {
    readCurrentCompilerInput: sequenceReader(compilerInputs),
    readCurrentAuthority: sequenceReader(authorities),
    transport
  }
  return {
    options: reviewOptions,
    requests,
    projectAuthorityCalls: () => projectAuthorityCalls
  }
}

function expectDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  expect(Object.isFrozen(value)).toBe(true)
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor && 'value' in descriptor) expectDeepFrozen(descriptor.value, seen)
  }
}

describe('Supabase Host backfill write-barrier review', () => {
  test('returns one deterministic deeply frozen review bound to the exact inspection and Provider subject', async () => {
    const input = compilerInput()
    const firstFixture = fixture({ compilerInputs: [input] })
    const secondFixture = fixture({ compilerInputs: [input] })
    const [first, second] = await Promise.all([
      reviewSupabaseBackfillWriteBarrierV1(firstFixture.options),
      reviewSupabaseBackfillWriteBarrierV1(secondFixture.options)
    ])
    const inspected = createSupabaseBackfillInspectionSubjectV1(input.registry, {
      plan: input.plan,
      selection: input.selection
    })
    const subject = inspected.subject

    expect(first).toEqual(second)
    expect(first.reviewDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(first.review).toMatchObject({
      format: 'openpencil.supabase-backfill-write-barrier-review.v1',
      version: 1,
      providerId: 'supabase',
      environmentIntent: 'staging',
      environmentVerified: false,
      reviewOnly: true,
      applyAvailable: false,
      releaseReady: false,
      mutationAuthorityCreated: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      bindings: {
        subjectDigest: inspected.subjectDigest,
        providerAuthorityDigest: subject.providerAuthority.digest,
        applicationDigest: subject.application.digest,
        backendPlanDigest: subject.plan.digest,
        adapterPlanDigest: subject.plan.adapterPlanDigest,
        manifestDigest: subject.emission.manifestDigest,
        migrationDigest: subject.migration.digest
      },
      authority: AUTHORITY,
      address: {
        schemaName: 'public',
        schemaOid: '2200',
        tableName: 'accounts',
        tableOid: '50000',
        cursorField: 'id',
        cursorSubId: 1,
        cursorTypeOid: '20',
        targetField: 'status',
        targetSubId: 2,
        targetTypeOid: '25',
        sequenceOid: '50002'
      },
      barrier: {
        kind: 'not-valid-check',
        predicate: 'target-is-not-null',
        installStatus: 'planned-not-installed',
        validated: false,
        inherited: false,
        effectsWhenInstalled: {
          rejectsNewNull: true,
          rejectsUpdatesLeavingNull: true,
          omittedTargetInsertRejected: true,
          validatesExistingRows: false,
          deletesLegacyNullRowsAllowed: true
        }
      },
      artifact: {
        path: SUPABASE_BACKFILL_WRITE_BARRIER_ARTIFACT_PATH,
        kind: 'database-schema-review',
        mediaType: 'application/sql; charset=utf-8',
        statementCount: 7,
        mutationStatementCount: 2,
        mutationSqlEmitted: true,
        mutationDispatched: false,
        containsDataRead: false,
        containsDml: false,
        performsSchemaChange: true,
        hostDispatchAvailable: false
      },
      executionPolicy: SUPABASE_BACKFILL_WRITE_BARRIER_EXECUTION_POLICY,
      freshness: {
        snapshotMarker: SNAPSHOT_MARKER,
        observedAt: OBSERVED_AT,
        requiresFreshCatalogAtApply: true,
        snapshotIsApplyAuthority: false
      },
      blockers: [
        'write-barrier-not-installed',
        'locked-high-water-not-captured',
        'database-batch-ledger-not-bound',
        'execution-runner-unavailable'
      ]
    })
    expect(first.review.bindings.subjectDigest).toBe(inspected.subjectDigest)
    expect(first.review.barrier.constraintName).toMatch(/^op_bf_nn_[0-9a-f]{32}$/u)
    expect(first.review.barrier.constraintName.length).toBeLessThanOrEqual(63)
    expect(first.review.barrier.marker).toBe(
      `${SUPABASE_BACKFILL_WRITE_BARRIER_MARKER_PREFIX}${first.review.bindings.markerBindingDigest}`
    )
    expect(first.review.artifact.byteLength).toBe(
      new TextEncoder().encode(first.previewSql).byteLength
    )
    expect(first.review.artifact.digest).toBe(first.review.bindings.sqlDigest)
    expect(firstFixture.projectAuthorityCalls()).toBe(1)
    expect(firstFixture.requests).toHaveLength(1)
    expectDeepFrozen(first)
  })

  test('emits only the exact ALTER ONLY barrier and its binding COMMENT inside one review transaction', async () => {
    const run = fixture()
    const result = await reviewSupabaseBackfillWriteBarrierV1(run.options)
    const { constraintName, marker } = result.review.barrier
    const expected = [
      '-- OpenPencil Supabase backfill write-barrier review v1.',
      '-- Review only. This artifact creates no Apply, execution, or Receipt authority.',
      '-- DO NOT APPLY: a fresh lock-bound reinspection and explicit authority are still required.',
      'BEGIN;',
      'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
      "SET LOCAL lock_timeout = '5s';",
      "SET LOCAL statement_timeout = '15s';",
      'ALTER TABLE ONLY "public"."accounts"',
      `  ADD CONSTRAINT "${constraintName}"`,
      '  CHECK ("status" IS NOT NULL) NO INHERIT NOT VALID;',
      `COMMENT ON CONSTRAINT "${constraintName}" ON "public"."accounts"`,
      `  IS E'${marker}';`,
      'COMMIT;',
      ''
    ].join('\n')

    expect(result.previewSql).toBe(expected)
    expect(result.previewSql.indexOf('BEGIN;')).toBeLessThan(
      result.previewSql.indexOf('ALTER TABLE ONLY')
    )
    expect(result.previewSql.indexOf('ALTER TABLE ONLY')).toBeLessThan(
      result.previewSql.indexOf('COMMENT ON CONSTRAINT')
    )
    expect(result.previewSql.indexOf('COMMENT ON CONSTRAINT')).toBeLessThan(
      result.previewSql.indexOf('COMMIT;')
    )
    expect(result.previewSql.match(/;/gu)).toHaveLength(7)
    expect(result.previewSql).not.toMatch(/\b(?:SELECT|INSERT|UPDATE|DELETE|MERGE|COPY)\b/iu)
    expect(result.previewSql).not.toContain('VALIDATE CONSTRAINT')
    expect(result.previewSql).not.toContain('ALTER COLUMN')
    expect(result.previewSql).not.toContain('MAX(')
    expect(result.previewSql).not.toContain('pending')
    expect(result.previewSql).not.toContain(PROJECT_REF)
    expect(result.previewSql).not.toContain(ACCOUNT_ID)
    expect(result.previewSql).not.toContain(GRANT_GENERATION)
    expect(result.previewSql).not.toContain('Bearer ')
    expect(Object.hasOwn(result, 'dispatch')).toBe(false)
    expect(Object.hasOwn(result.review, 'dispatch')).toBe(false)
    expect(Object.hasOwn(result.review, 'highWater')).toBe(false)
  })

  test('refuses to plan when the live catalog is not ready', async () => {
    const mutations: ReadonlyArray<(response: MutableRecord) => void> = [
      (response) => {
        nestedRecord(response, 'hazards').checkConstraintCount = 1
      },
      (response) => {
        nestedRecord(response, 'target').hasDefault = true
      }
    ]

    for (const mutate of mutations) {
      const run = fixture({
        transformResponse(response) {
          mutate(response)
          return response
        }
      })
      await expect(reviewSupabaseBackfillWriteBarrierV1(run.options)).rejects.toMatchObject({
        code: 'supabase-backfill-write-barrier-catalog-not-ready'
      })
      expect(run.projectAuthorityCalls()).toBe(1)
      expect(run.requests).toHaveLength(1)
    }
  })

  test('rechecks the Provider subject and credential grant after digest construction', async () => {
    const currentInput = compilerInput(250)
    const changedInput = compilerInput(251)
    const changedAuthority = Object.freeze({
      ...AUTHORITY,
      grantGeneration: '223e4567-e89b-42d3-a456-426614174000'
    })
    const cases = [
      {
        compilerInputs: [currentInput, currentInput, currentInput, currentInput, changedInput],
        authorities: [AUTHORITY]
      },
      {
        compilerInputs: [currentInput],
        authorities: [AUTHORITY, AUTHORITY, AUTHORITY, AUTHORITY, changedAuthority]
      }
    ] as const

    for (const candidate of cases) {
      const run = fixture(candidate)
      await expect(reviewSupabaseBackfillWriteBarrierV1(run.options)).rejects.toMatchObject({
        code: 'supabase-backfill-write-barrier-input-changed'
      })
      expect(run.projectAuthorityCalls()).toBe(1)
      expect(run.requests).toHaveLength(1)
    }
  })

  test('rejects option accessors, custom prototypes, and extra symbols without invoking them', async () => {
    let getterReads = 0
    const getterFixture = fixture()
    const accessorOptions = {
      get readCurrentCompilerInput() {
        getterReads += 1
        return getterFixture.options.readCurrentCompilerInput
      },
      readCurrentAuthority: getterFixture.options.readCurrentAuthority,
      transport: getterFixture.options.transport
    }
    const symbolFixture = fixture()
    const symbolOptions = {
      ...symbolFixture.options,
      [Symbol('untrusted-option')]: true
    }
    const sqlFixture = fixture()
    const sqlOptions = {
      ...sqlFixture.options,
      sql: 'DROP TABLE public.accounts'
    }
    const prototypeFixture = fixture()
    const prototypeOptions = Object.assign(
      Object.create({ inheritedAuthority: true }),
      prototypeFixture.options
    )

    for (const [input, run] of [
      [accessorOptions, getterFixture],
      [symbolOptions, symbolFixture],
      [sqlOptions, sqlFixture],
      [prototypeOptions, prototypeFixture]
    ] as const) {
      await expect(
        reviewSupabaseBackfillWriteBarrierV1(input as ReviewSupabaseBackfillWriteBarrierOptionsV1)
      ).rejects.toBeInstanceOf(SupabaseBackfillWriteBarrierReviewError)
      expect(run.projectAuthorityCalls()).toBe(0)
      expect(run.requests).toHaveLength(0)
    }
    expect(getterReads).toBe(0)
  })

  test('keeps the physical barrier identity stable across batch-size changes while rebinding the review', async () => {
    const first = await reviewSupabaseBackfillWriteBarrierV1(
      fixture({ compilerInputs: [compilerInput(250)] }).options
    )
    const second = await reviewSupabaseBackfillWriteBarrierV1(
      fixture({ compilerInputs: [compilerInput(251)] }).options
    )

    expect(second.review.barrier.constraintName).toBe(first.review.barrier.constraintName)
    expect(second.review.bindings.logicalScopeDigest).toBe(first.review.bindings.logicalScopeDigest)
    expect(second.review.barrier.marker).not.toBe(first.review.barrier.marker)
    expect(second.review.bindings.markerBindingDigest).not.toBe(
      first.review.bindings.markerBindingDigest
    )
    expect(second.previewSql).not.toBe(first.previewSql)
    expect(second.review.bindings.sqlDigest).not.toBe(first.review.bindings.sqlDigest)
    expect(second.review.bindings.subjectDigest).not.toBe(first.review.bindings.subjectDigest)
    expect(second.review.bindings.migrationDigest).not.toBe(first.review.bindings.migrationDigest)
    expect(second.review.bindings.catalogPreconditionDigest).not.toBe(
      first.review.bindings.catalogPreconditionDigest
    )
    expect(second.reviewDigest).not.toBe(first.reviewDigest)
  })
})
