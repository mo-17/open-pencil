import { describe, expect, test } from 'bun:test'

import {
  createBackendProviderPlanV2,
  createBackendProviderRegistryV2,
  SUPABASE_BACKEND_PROVIDER_BUNDLE_V2,
  type BackendApplicationSpecV2
} from '@open-pencil/compiler/backend'

import {
  inspectSupabaseBackfillLiveCatalogV1,
  SUPABASE_BACKFILL_LIVE_CATALOG_SQL,
  SupabaseBackfillLiveCatalogInspectionError,
  type SupabaseBackfillLiveCatalogAuthorityV1,
  type SupabaseBackfillLiveCatalogCompilerInputV1,
  type SupabaseBackfillLiveCatalogHostTransportV1,
  type SupabaseBackfillLiveCatalogProjectAuthorityV1,
  type SupabaseBackfillLiveCatalogRequestV1
} from '@/app/plugins/host/deployment/supabase/backfill/live-inspector'

import {
  supabaseBackfillApplicationV2,
  supabasePrivateRealtimeSelectionV2
} from '#tests/engine/compiler/backend/supabase/v2/helpers'

const PROJECT_REF = 'abcdefghijklmnopqrst'
const ACCOUNT_ID = 'organization-1'
const GRANT_GENERATION = '123e4567-e89b-42d3-a456-426614174000'
const SNAPSHOT_MARKER = '100:200:'
const OBSERVED_AT = '2026-09-04T00:00:00.000Z'
const RAW_DEFAULT_CANARY = 'raw-default-expression-must-not-escape'

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

// Represents a manually hardened live prerequisite schema. The compiler's current
// BY DEFAULT identity/default bigint MAXVALUE output intentionally remains blocked.
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

interface ScenarioOptions {
  readonly compilerInputs?: readonly SupabaseBackfillLiveCatalogCompilerInputV1[]
  readonly authorities?: readonly SupabaseBackfillLiveCatalogAuthorityV1[]
  readonly projectAuthority?: Partial<SupabaseBackfillLiveCatalogProjectAuthorityV1>
  readonly transformResponse?: (response: MutableRecord) => unknown
}

function scenario(options: ScenarioOptions = {}) {
  const initialCompilerInput = compilerInput()
  const compilerInputs = options.compilerInputs ?? [initialCompilerInput]
  const authorities = options.authorities ?? [AUTHORITY]
  const requests: SupabaseBackfillLiveCatalogRequestV1[] = []
  let projectAuthorityCalls = 0
  const transport: SupabaseBackfillLiveCatalogHostTransportV1 = {
    async getProjectAuthority(request) {
      projectAuthorityCalls += 1
      return {
        projectRef: request.projectRef,
        organizationId: request.accountId,
        grantGeneration: request.grantGeneration,
        ...options.projectAuthority
      }
    },
    async runReadOnlyBackfillCatalogQuery(request) {
      requests.push(request)
      const response = catalogResponse(request)
      return options.transformResponse?.(response) ?? response
    }
  }
  const operation = inspectSupabaseBackfillLiveCatalogV1({
    readCurrentCompilerInput: sequenceReader(compilerInputs),
    readCurrentAuthority: sequenceReader(authorities),
    transport
  })
  return {
    operation,
    requests,
    projectAuthorityCalls: () => projectAuthorityCalls
  }
}

describe('Supabase backfill live catalog inspector', () => {
  test('returns one compiler-bound snapshot that remains review-only', async () => {
    const run = scenario()
    const result = await run.operation

    expect(result).toMatchObject({
      format: 'openpencil.supabase-backfill-live-catalog-inspection.v1',
      providerId: 'supabase',
      reviewOnly: true,
      applyAvailable: false,
      releaseReady: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      snapshotMarker: SNAPSHOT_MARKER,
      highWater: { status: 'not-observed', observedCandidate: null, lockedCapture: false },
      receipt: { mayCreate: false, signed: false },
      checks: { allCatalogChecksPassed: true }
    })
    expect(result.blockers).toEqual([
      'write-barrier-not-installed',
      'locked-high-water-not-captured',
      'database-batch-ledger-not-bound',
      'execution-runner-unavailable'
    ])
    expect(run.projectAuthorityCalls()).toBe(1)
    expect(run.requests).toHaveLength(1)
    expect(result.query).toMatchObject({
      statementCount: 1,
      catalogOnly: true,
      accessMode: 'read-only',
      snapshotScope: 'single-statement'
    })
    expect(result.authority).toEqual(AUTHORITY)
  })

  test('exposes only a typed fixed-query request, never caller SQL or parameter order', async () => {
    const run = scenario()
    const result = await run.operation
    const request = run.requests[0]
    if (!request) throw new Error('Missing captured catalog request')

    expect(Object.hasOwn(request, 'sql')).toBe(false)
    expect(Object.hasOwn(request, 'parameterOrder')).toBe(false)
    expect(JSON.stringify(request)).not.toContain(SUPABASE_BACKFILL_LIVE_CATALOG_SQL)
    expect(SUPABASE_BACKFILL_LIVE_CATALOG_SQL).not.toContain('pg_get_expr')
    expect(SUPABASE_BACKFILL_LIVE_CATALOG_SQL).not.toContain('defaultExpression')
    expect(Object.hasOwn(result.catalog.target, 'defaultExpression')).toBe(false)
    expect(JSON.stringify(result)).not.toContain(RAW_DEFAULT_CANARY)
  })

  test('rejects live subject or credential authority changes before and after the query', async () => {
    const firstCompilerInput = compilerInput(250)
    const changedCompilerInput = compilerInput(251)
    const changedAuthority = Object.freeze({
      ...AUTHORITY,
      grantGeneration: '223e4567-e89b-42d3-a456-426614174000'
    })
    const cases = [
      {
        compilerInputs: [firstCompilerInput, changedCompilerInput],
        authorities: [AUTHORITY],
        expectedQueries: 0
      },
      {
        compilerInputs: [firstCompilerInput, firstCompilerInput, changedCompilerInput],
        authorities: [AUTHORITY],
        expectedQueries: 1
      },
      {
        compilerInputs: [firstCompilerInput],
        authorities: [AUTHORITY, changedAuthority],
        expectedQueries: 0
      },
      {
        compilerInputs: [firstCompilerInput],
        authorities: [AUTHORITY, AUTHORITY, changedAuthority],
        expectedQueries: 1
      }
    ] as const

    for (const candidate of cases) {
      const run = scenario(candidate)
      await expect(run.operation).rejects.toMatchObject({
        code: 'supabase-backfill-live-catalog-input-changed'
      })
      expect(run.requests).toHaveLength(candidate.expectedQueries)
    }
  })

  test('rejects a remote project authority mismatch before the catalog query', async () => {
    for (const projectAuthority of [
      { projectRef: 'different-project' },
      { organizationId: 'different-organization' },
      { grantGeneration: 'different-grant' }
    ]) {
      const run = scenario({ projectAuthority })
      await expect(run.operation).rejects.toMatchObject({
        code: 'supabase-backfill-live-catalog-project-authority-mismatch'
      })
      expect(run.requests).toHaveLength(0)
    }
  })

  test('records transaction state and blocks unsafe role, primary, RLS, search path, sequence, and hazards', async () => {
    const run = scenario({
      transformResponse(response) {
        Object.assign(nestedRecord(response, 'roles'), {
          currentOid: '10',
          currentName: 'postgres',
          currentSuperuser: true,
          currentBypassRls: true,
          sessionOid: '10',
          sessionName: 'postgres',
          sessionSuperuser: true,
          sessionBypassRls: true
        })
        Object.assign(nestedRecord(response, 'settings'), {
          transactionReadOnly: false,
          rowSecurity: false,
          effectiveSearchPath: ['pg_catalog', 'public', 'extensions'],
          databasePrimary: false,
          rowSecurityActiveForTable: false
        })
        Object.assign(nestedRecord(response, 'table'), {
          rlsEnabled: false,
          rlsForced: false
        })
        nestedRecord(response, 'sequence').maximumValue = '9007199254740992'
        nestedRecord(response, 'hazards').generatedColumnCount = 1
        return response
      }
    })
    const result = await run.operation

    expect(result.settings.transactionReadOnly).toBe(false)
    expect(result.checks.allCatalogChecksPassed).toBe(false)
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        'unexpected-read-only-query-role',
        'privileged-query-role',
        'database-not-primary',
        'search-path-not-bounded',
        'table-rls-not-forced',
        'identity-sequence-shape-mismatch',
        'table-write-hazards-present'
      ])
    )
    expect(result).toMatchObject({
      reviewOnly: true,
      applyAvailable: false,
      releaseReady: false,
      highWater: { lockedCapture: false },
      receipt: { mayCreate: false }
    })
  })

  test('rejects inconsistent catalog OID graphs instead of producing blockers', async () => {
    const mutations = [
      (response: MutableRecord) => {
        nestedRecord(response, 'table').schemaOid = '2201'
      },
      (response: MutableRecord) => {
        nestedRecord(response, 'cursor').classOid = '2606'
      },
      (response: MutableRecord) => {
        nestedRecord(response, 'primaryKey').tableOid = '50001'
      },
      (response: MutableRecord) => {
        nestedRecord(response, 'sequence').ownedSubId = 2
      }
    ]

    for (const mutate of mutations) {
      const run = scenario({
        transformResponse(response) {
          mutate(response)
          return response
        }
      })
      await expect(run.operation).rejects.toMatchObject({
        code: 'supabase-backfill-live-catalog-address-mismatch'
      })
    }
  })

  test('rejects getters, custom prototypes, extra fields, and raw default expressions', async () => {
    let getterReads = 0
    const responses: Array<(response: MutableRecord) => unknown> = [
      (response) => {
        Object.defineProperty(nestedRecord(response, 'target'), 'hasDefault', {
          configurable: true,
          enumerable: true,
          get() {
            getterReads += 1
            return false
          }
        })
        return response
      },
      (response) => Object.assign(Object.create({ inherited: true }), response),
      (response) => {
        response.unexpected = true
        return response
      },
      (response) => {
        nestedRecord(response, 'target').defaultExpression = RAW_DEFAULT_CANARY
        return response
      }
    ]

    for (const transformResponse of responses) {
      const run = scenario({ transformResponse })
      let error: Error | undefined
      try {
        await run.operation
      } catch (cause) {
        if (cause instanceof Error) error = cause
      }
      expect(error).toBeInstanceOf(SupabaseBackfillLiveCatalogInspectionError)
      expect((error as SupabaseBackfillLiveCatalogInspectionError).code).toBe(
        'supabase-backfill-live-catalog-response-invalid'
      )
      expect(error?.message).not.toContain(RAW_DEFAULT_CANARY)
    }
    expect(getterReads).toBe(0)
  })
})
