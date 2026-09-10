/* oxlint-disable eslint/max-lines -- One adversarial fixture covers the complete verifier boundary. */
import { describe, expect, test } from 'bun:test'

import {
  createBackendProviderPlanV2,
  createBackendProviderRegistryV2,
  SUPABASE_BACKEND_PROVIDER_BUNDLE_V2,
  type BackendApplicationSpecV2
} from '@open-pencil/compiler/backend'

import {
  type SupabaseBackfillLiveCatalogAuthorityV1,
  type SupabaseBackfillLiveCatalogCompilerInputV1,
  type SupabaseBackfillLiveCatalogHostTransportV1,
  type SupabaseBackfillLiveCatalogProjectAuthorityV1,
  type SupabaseBackfillLiveCatalogRequestV1
} from '@/app/plugins/host/deployment/supabase/backfill/live-inspector'
import {
  reviewSupabaseBackfillWriteBarrierV1,
  type SupabaseBackfillWriteBarrierReviewEnvelopeV1
} from '@/app/plugins/host/deployment/supabase/backfill/write-barrier/review'
import {
  consumeTrustedSupabaseBackfillWriteBarrierAbsentPreparationV1,
  consumeTrustedSupabaseBackfillWriteBarrierInstalledVerificationV1,
  rotateSupabaseBackfillWriteBarrierInstalledVerificationEpochV1,
  SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_FIXED_QUERY,
  SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_FORMAT,
  SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_PARAMETER_ORDER,
  SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_ID,
  SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_VERSION,
  SupabaseBackfillWriteBarrierVerificationError,
  verifySupabaseBackfillWriteBarrierV1,
  type SupabaseBackfillWriteBarrierStateV1,
  type SupabaseBackfillWriteBarrierVerificationErrorCode,
  type SupabaseBackfillWriteBarrierVerificationHostTransportV1,
  type SupabaseBackfillWriteBarrierVerificationRequestV1,
  type VerifySupabaseBackfillWriteBarrierOptionsV1
} from '@/app/plugins/host/deployment/supabase/backfill/write-barrier/verifier'

import {
  supabaseBackfillApplicationV2,
  supabasePrivateRealtimeSelectionV2
} from '#tests/engine/compiler/backend/supabase/v2/helpers'

const PROJECT_REF = 'abcdefghijklmnopqrst'
const ACCOUNT_ID = 'organization-1'
const GRANT_GENERATION = '123e4567-e89b-42d3-a456-426614174000'
const SNAPSHOT_MARKER = '100:200:'
const OBSERVED_AT = '2026-09-04T00:00:00.000Z'
const SECRET = 'pat-must-not-escape'

type MutableRecord = Record<PropertyKey, unknown>

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

function nestedRecord(value: MutableRecord, key: PropertyKey): MutableRecord {
  const nested = value[key]
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
    throw new Error(`Missing response object ${String(key)}`)
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

async function createReview(
  input = compilerInput(),
  authority: SupabaseBackfillLiveCatalogAuthorityV1 = AUTHORITY
): Promise<SupabaseBackfillWriteBarrierReviewEnvelopeV1> {
  const transport: SupabaseBackfillLiveCatalogHostTransportV1 = {
    async getProjectAuthority(request) {
      return {
        projectRef: request.projectRef,
        organizationId: request.accountId,
        grantGeneration: request.grantGeneration
      }
    },
    async runReadOnlyBackfillCatalogQuery(request) {
      return catalogResponse(request)
    }
  }
  return reviewSupabaseBackfillWriteBarrierV1({
    readCurrentCompilerInput: () => input,
    readCurrentAuthority: () => authority,
    transport
  })
}

function barrierInventory(state: SupabaseBackfillWriteBarrierStateV1): MutableRecord {
  if (state === 'absent') {
    return {
      totalCheckConstraintCount: 0,
      nameMatchCount: 0,
      markerMatchCount: 0,
      globalMarkerMatchCount: 0,
      definitionMatchCount: 0,
      exactMatchCount: 0,
      constraintOid: null
    }
  }
  if (state === 'installed') {
    return {
      totalCheckConstraintCount: 1,
      nameMatchCount: 1,
      markerMatchCount: 1,
      globalMarkerMatchCount: 1,
      definitionMatchCount: 1,
      exactMatchCount: 1,
      constraintOid: '50003'
    }
  }
  return {
    totalCheckConstraintCount: 1,
    nameMatchCount: 1,
    markerMatchCount: 1,
    globalMarkerMatchCount: 1,
    definitionMatchCount: 0,
    exactMatchCount: 0,
    constraintOid: null
  }
}

function verificationResponse(
  request: SupabaseBackfillWriteBarrierVerificationRequestV1,
  review: SupabaseBackfillWriteBarrierReviewEnvelopeV1,
  state: SupabaseBackfillWriteBarrierStateV1,
  serverVersionNum: string
): MutableRecord {
  const barrier = barrierInventory(state)
  return {
    subjectDigest: request.subjectDigest,
    reviewDigest: request.reviewDigest,
    projectRef: request.projectRef,
    accountId: request.accountId,
    grantGeneration: request.grantGeneration,
    queryVersion: request.queryVersion,
    queryDigest: request.queryDigest,
    accessMode: 'read-only',
    snapshotScope: 'single-statement',
    catalogOnly: true,
    serverVersionNum,
    snapshotMarker: SNAPSHOT_MARKER,
    observedAt: OBSERVED_AT,
    roles: {
      currentOid: '9000',
      currentName: 'supabase_read_only_user',
      currentSuperuser: false,
      sessionOid: '9000',
      sessionName: 'supabase_read_only_user',
      sessionSuperuser: false
    },
    settings: {
      databasePrimary: true,
      effectiveSearchPath: ['pg_catalog', 'public']
    },
    address: {
      schemaOid: review.review.address.schemaOid,
      tableOid: review.review.address.tableOid,
      tableOwnerOid: '10',
      tableOwnerName: 'postgres',
      tableRlsEnabled: true,
      tableRlsForced: true,
      tableCheckCount: barrier.totalCheckConstraintCount,
      targetSubId: review.review.address.targetSubId,
      targetTypeOid: review.review.address.targetTypeOid
    },
    barrier
  }
}

interface VerificationFixtureOptions {
  readonly compilerInputs?: readonly SupabaseBackfillLiveCatalogCompilerInputV1[]
  readonly authorities?: readonly SupabaseBackfillLiveCatalogAuthorityV1[]
  readonly state?: SupabaseBackfillWriteBarrierStateV1
  readonly serverVersionNum?: string
  readonly projectAuthority?: unknown
  readonly projectAuthorityError?: unknown
  readonly queryError?: unknown
  readonly transformResponse?: (response: MutableRecord) => unknown
}

function verificationFixture(
  review: SupabaseBackfillWriteBarrierReviewEnvelopeV1,
  input: SupabaseBackfillLiveCatalogCompilerInputV1,
  options: VerificationFixtureOptions = {}
) {
  const compilerInputs = options.compilerInputs ?? [input]
  const authorities = options.authorities ?? [AUTHORITY]
  const queryRequests: SupabaseBackfillWriteBarrierVerificationRequestV1[] = []
  let projectAuthorityCalls = 0
  const transport: SupabaseBackfillWriteBarrierVerificationHostTransportV1 = {
    async getProjectAuthority(request) {
      projectAuthorityCalls += 1
      if (options.projectAuthorityError !== undefined) throw options.projectAuthorityError
      return (options.projectAuthority ?? {
        projectRef: request.projectRef,
        organizationId: request.accountId,
        grantGeneration: request.grantGeneration
      }) as SupabaseBackfillLiveCatalogProjectAuthorityV1
    },
    async runReadOnlyWriteBarrierVerificationQuery(request) {
      queryRequests.push(request)
      if (options.queryError !== undefined) throw options.queryError
      const response = verificationResponse(
        request,
        review,
        options.state ?? 'absent',
        options.serverVersionNum ?? '170006'
      )
      return options.transformResponse?.(response) ?? response
    }
  }
  const verifyOptions: VerifySupabaseBackfillWriteBarrierOptionsV1 = {
    review,
    readCurrentCompilerInput: sequenceReader(compilerInputs),
    readCurrentAuthority: sequenceReader(authorities),
    transport
  }
  return {
    options: verifyOptions,
    queryRequests,
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

async function expectVerificationError(
  promise: Promise<unknown>,
  code: SupabaseBackfillWriteBarrierVerificationErrorCode
): Promise<SupabaseBackfillWriteBarrierVerificationError> {
  try {
    await promise
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillWriteBarrierVerificationError)
    const error = cause as SupabaseBackfillWriteBarrierVerificationError
    expect(error.code).toBe(code)
    return error
  }
  throw new Error(`Expected verification error ${code}`)
}

describe('Supabase Host backfill write-barrier verifier', () => {
  test('returns a deterministic deeply frozen absent proof bound to one exact read-only query', async () => {
    const input = compilerInput()
    const review = await createReview(input)
    const run = verificationFixture(review, input)
    const result = await verifySupabaseBackfillWriteBarrierV1(run.options)
    const request = run.queryRequests[0]
    if (!request) throw new Error('Missing verification request')

    expect(run.projectAuthorityCalls()).toBe(1)
    expect(run.queryRequests).toHaveLength(1)
    expect(request).toMatchObject({
      queryId: SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_ID,
      queryVersion: SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_VERSION,
      subjectDigest: review.review.bindings.subjectDigest,
      reviewDigest: review.reviewDigest,
      ...AUTHORITY,
      statementCount: 1,
      catalogOnly: true,
      accessMode: 'read-only',
      snapshotScope: 'single-statement'
    })
    expect(request.queryDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(Object.keys(request.parameters)).toEqual(
      SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_PARAMETER_ORDER
    )
    expect(request.parameters).toEqual({
      schema: 'public',
      table: 'accounts',
      entityMarker: 'openpencil:v1:entity:accounts',
      tableOid: review.review.address.tableOid,
      targetField: 'status',
      targetMarker: 'openpencil:v1:field:account-status',
      targetSubId: review.review.address.targetSubId,
      targetTypeOid: review.review.address.targetTypeOid,
      constraintName: review.review.barrier.constraintName,
      barrierMarker: review.review.barrier.marker,
      subjectDigest: request.subjectDigest,
      reviewDigest: review.reviewDigest,
      projectRef: PROJECT_REF,
      accountId: ACCOUNT_ID,
      grantGeneration: GRANT_GENERATION,
      queryVersion: SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_VERSION,
      queryDigest: request.queryDigest
    })
    expect(result).toMatchObject({
      format: SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_FORMAT,
      version: 1,
      providerId: 'supabase',
      reviewOnly: true,
      applyAvailable: false,
      releaseReady: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      subjectDigest: review.review.bindings.subjectDigest,
      reviewDigest: review.reviewDigest,
      authority: AUTHORITY,
      state: 'absent',
      verifiedInstalled: false,
      barrier: {
        constraintName: review.review.barrier.constraintName,
        marker: review.review.barrier.marker,
        constraintOid: null,
        totalCheckConstraintCount: 0,
        exactMatchCount: 0,
        rawDefinitionReturned: false
      },
      checks: {
        queryRoleMatchesReadOnlyEndpoint: true,
        queryRoleIsNonSuperuser: true,
        currentAndSessionRoleMatch: true,
        databaseIsPrimary: true,
        searchPathIsBounded: true,
        tableRlsIsForced: true,
        exactBarrierState: true,
        allVerificationChecksPassed: true
      },
      blockers: [
        'write-barrier-not-installed',
        'locked-high-water-not-captured',
        'database-batch-ledger-not-bound',
        'execution-runner-unavailable'
      ]
    })
    expect(result.verificationDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(result.query.digest).toBe(request.queryDigest)
    expectDeepFrozen(request)
    expectDeepFrozen(result)
    expect(SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_FIXED_QUERY).toMatchObject({
      statementCount: 1,
      catalogOnly: true,
      accessMode: 'read-only',
      snapshotScope: 'single-statement'
    })
  })

  test('requires a genuine review identity, permits read-only rechecks, and consumes one absent proof once', async () => {
    const input = compilerInput()
    const review = await createReview(input)
    const identicalReview = await createReview(input)
    const verification = await verifySupabaseBackfillWriteBarrierV1(
      verificationFixture(review, input).options
    )
    const repeatedVerification = await verifySupabaseBackfillWriteBarrierV1(
      verificationFixture(review, input).options
    )
    const clonedReview = structuredClone(review) as SupabaseBackfillWriteBarrierReviewEnvelopeV1
    const forgedRun = verificationFixture(clonedReview, input)

    expect(identicalReview).toEqual(review)
    expect(identicalReview).not.toBe(review)
    expect(repeatedVerification).toEqual(verification)
    expect(repeatedVerification).not.toBe(verification)
    expect(repeatedVerification.executionAuthorityCreated).toBe(false)
    await expectVerificationError(
      verifySupabaseBackfillWriteBarrierV1(forgedRun.options),
      'supabase-backfill-write-barrier-verification-input-invalid'
    )
    expect(forgedRun.projectAuthorityCalls()).toBe(0)
    expect(forgedRun.queryRequests).toHaveLength(0)
    expect(
      consumeTrustedSupabaseBackfillWriteBarrierAbsentPreparationV1(
        structuredClone(verification),
        review
      )
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillWriteBarrierAbsentPreparationV1(verification, identicalReview)
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillWriteBarrierAbsentPreparationV1(verification, review)
    ).toMatchObject({ verification })
    expect(
      consumeTrustedSupabaseBackfillWriteBarrierAbsentPreparationV1(repeatedVerification, review)
    ).toBeNull()
  })

  test('distinguishes installed and mismatched catalogs and requires a post-rotation installed proof', async () => {
    const input = compilerInput()
    const review = await createReview(input)
    const installedBeforeRotation = await verifySupabaseBackfillWriteBarrierV1(
      verificationFixture(review, input, { state: 'installed' }).options
    )
    let releaseInitialRead: ((value: SupabaseBackfillLiveCatalogCompilerInputV1) => void) | null =
      null
    const initialRead = new Promise<SupabaseBackfillLiveCatalogCompilerInputV1>((resolve) => {
      releaseInitialRead = resolve
    })
    let compilerReadCount = 0
    const inFlightRun = verificationFixture(review, input, { state: 'installed' })
    const startedBeforeRotation = verifySupabaseBackfillWriteBarrierV1({
      ...inFlightRun.options,
      readCurrentCompilerInput: () => {
        compilerReadCount += 1
        return compilerReadCount === 1 ? initialRead : input
      }
    })
    const mismatch = await verifySupabaseBackfillWriteBarrierV1(
      verificationFixture(review, input, { state: 'mismatch' }).options
    )
    expect(() =>
      rotateSupabaseBackfillWriteBarrierInstalledVerificationEpochV1(structuredClone(review))
    ).toThrow(SupabaseBackfillWriteBarrierVerificationError)
    const requiredEpoch = rotateSupabaseBackfillWriteBarrierInstalledVerificationEpochV1(review)
    if (!releaseInitialRead) throw new Error('Missing pending compiler-input reader')
    releaseInitialRead(input)
    const installedStartedBeforeRotation = await startedBeforeRotation
    const installed = await verifySupabaseBackfillWriteBarrierV1(
      verificationFixture(review, input, { state: 'installed' }).options
    )

    expect(installed).toMatchObject({
      state: 'installed',
      verifiedInstalled: true,
      barrier: {
        constraintOid: '50003',
        totalCheckConstraintCount: 1,
        nameMatchCount: 1,
        markerMatchCount: 1,
        globalMarkerMatchCount: 1,
        definitionMatchCount: 1,
        exactMatchCount: 1
      },
      checks: { exactBarrierState: true, allVerificationChecksPassed: true },
      blockers: [
        'locked-high-water-not-captured',
        'database-batch-ledger-not-bound',
        'execution-runner-unavailable'
      ]
    })
    expect(mismatch).toMatchObject({
      state: 'mismatch',
      verifiedInstalled: false,
      barrier: {
        constraintOid: null,
        totalCheckConstraintCount: 1,
        definitionMatchCount: 0,
        exactMatchCount: 0
      },
      checks: { exactBarrierState: false, allVerificationChecksPassed: false },
      blockers: [
        'write-barrier-catalog-mismatch',
        'locked-high-water-not-captured',
        'database-batch-ledger-not-bound',
        'execution-runner-unavailable',
        'write-barrier-verification-failed'
      ]
    })
    expect(
      consumeTrustedSupabaseBackfillWriteBarrierAbsentPreparationV1(installed, review)
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillWriteBarrierAbsentPreparationV1(mismatch, review)
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillWriteBarrierInstalledVerificationV1(
        installedBeforeRotation,
        review,
        requiredEpoch
      )
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillWriteBarrierInstalledVerificationV1(
        installedStartedBeforeRotation,
        review,
        requiredEpoch
      )
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillWriteBarrierInstalledVerificationV1(
        installed,
        review,
        requiredEpoch
      )
    ).toBe(installed)
    expect(
      consumeTrustedSupabaseBackfillWriteBarrierInstalledVerificationV1(
        installed,
        review,
        requiredEpoch
      )
    ).toBeNull()
    expectDeepFrozen(installed)
    expectDeepFrozen(mismatch)
  })

  test('accepts PostgreSQL 15, 16, and 17 server versions and fails closed for PostgreSQL 18', async () => {
    const input = compilerInput()
    const review = await createReview(input)

    for (const serverVersionNum of ['150014', '160010', '170006']) {
      const result = await verifySupabaseBackfillWriteBarrierV1(
        verificationFixture(review, input, { serverVersionNum }).options
      )
      expect(result.serverVersionNum).toBe(serverVersionNum)
      expect(result.state).toBe('absent')
    }

    const postgres18 = verificationFixture(review, input, { serverVersionNum: '180000' })
    await expectVerificationError(
      verifySupabaseBackfillWriteBarrierV1(postgres18.options),
      'supabase-backfill-write-barrier-verification-response-invalid'
    )
    expect(postgres18.queryRequests).toHaveLength(1)
  })

  test('rejects response key, descriptor, prototype, and scalar-shape deviations exactly', async () => {
    const input = compilerInput()
    const review = await createReview(input)
    let getterReads = 0
    const cases: ReadonlyArray<{
      readonly name: string
      readonly mutate: (response: MutableRecord) => void
    }> = [
      { name: 'extra root key', mutate: (response) => void (response.extra = true) },
      {
        name: 'extra root symbol',
        mutate: (response) => void (response[Symbol('untrusted')] = true)
      },
      {
        name: 'missing nested key',
        mutate: (response) => void delete nestedRecord(response, 'roles').currentName
      },
      {
        name: 'root accessor',
        mutate(response) {
          Object.defineProperty(response, 'observedAt', {
            enumerable: true,
            get() {
              getterReads += 1
              return OBSERVED_AT
            }
          })
        }
      },
      {
        name: 'custom prototype',
        mutate: (response) => void Object.setPrototypeOf(response, { polluted: true })
      },
      {
        name: 'boolean as text',
        mutate: (response) => void (nestedRecord(response, 'settings').databasePrimary = 'true')
      },
      {
        name: 'fractional count',
        mutate: (response) => void (nestedRecord(response, 'address').targetSubId = 2.5)
      },
      {
        name: 'numeric oid',
        mutate: (response) => void (nestedRecord(response, 'barrier').constraintOid = 50003)
      },
      {
        name: 'noncanonical timestamp',
        mutate: (response) => void (response.observedAt = '2026-09-04T00:00:00Z')
      },
      {
        name: 'invalid snapshot',
        mutate: (response) => void (response.snapshotMarker = 'not-a-snapshot')
      },
      {
        name: 'table CHECK count mismatch',
        mutate: (response) => void (nestedRecord(response, 'address').tableCheckCount = 1)
      },
      {
        name: 'constraint OID without exact match',
        mutate: (response) => void (nestedRecord(response, 'barrier').constraintOid = '50003')
      }
    ]

    for (const candidate of cases) {
      const run = verificationFixture(review, input, {
        transformResponse(response) {
          candidate.mutate(response)
          return response
        }
      })
      await expectVerificationError(
        verifySupabaseBackfillWriteBarrierV1(run.options),
        'supabase-backfill-write-barrier-verification-response-invalid'
      )
      expect(run.queryRequests, candidate.name).toHaveLength(1)
    }
    expect(getterReads).toBe(0)
  })

  test('separates query binding failures from response identity and catalog address failures', async () => {
    const input = compilerInput()
    const review = await createReview(input)
    const queryBindings: ReadonlyArray<(response: MutableRecord) => void> = [
      (response) => void (response.queryVersion = 'changed-query-version'),
      (response) => void (response.queryDigest = 'changed-query-digest'),
      (response) => void (response.accessMode = 'read-write'),
      (response) => void (response.snapshotScope = 'transaction'),
      (response) => void (response.catalogOnly = false)
    ]
    for (const mutate of queryBindings) {
      const run = verificationFixture(review, input, {
        transformResponse(response) {
          mutate(response)
          return response
        }
      })
      await expectVerificationError(
        verifySupabaseBackfillWriteBarrierV1(run.options),
        'supabase-backfill-write-barrier-verification-query-binding-mismatch'
      )
    }

    for (const key of [
      'subjectDigest',
      'reviewDigest',
      'projectRef',
      'accountId',
      'grantGeneration'
    ] as const) {
      const run = verificationFixture(review, input, {
        transformResponse(response) {
          response[key] = `changed-${key}`
          return response
        }
      })
      await expectVerificationError(
        verifySupabaseBackfillWriteBarrierV1(run.options),
        'supabase-backfill-write-barrier-verification-response-invalid'
      )
    }

    for (const key of [
      'schemaOid',
      'tableOid',
      'tableOwnerOid',
      'tableOwnerName',
      'tableRlsEnabled',
      'tableRlsForced',
      'targetSubId',
      'targetTypeOid'
    ] as const) {
      const run = verificationFixture(review, input, {
        transformResponse(response) {
          let changed: string | number | boolean = '60000'
          if (key === 'targetSubId') changed = 3
          if (key === 'tableOwnerName') changed = 'changed_owner'
          if (key === 'tableRlsEnabled' || key === 'tableRlsForced') changed = false
          nestedRecord(response, 'address')[key] = changed
          return response
        }
      })
      await expectVerificationError(
        verifySupabaseBackfillWriteBarrierV1(run.options),
        'supabase-backfill-write-barrier-verification-address-mismatch'
      )
    }
  })

  test('rechecks subject and authority before and after the query and rejects project authority drift', async () => {
    const input = compilerInput()
    const changedInput = compilerInput(251)
    const review = await createReview(input)
    const changedAuthority = Object.freeze({
      ...AUTHORITY,
      grantGeneration: '223e4567-e89b-42d3-a456-426614174000'
    })
    const cases: ReadonlyArray<{
      readonly compilerInputs?: readonly SupabaseBackfillLiveCatalogCompilerInputV1[]
      readonly authorities?: readonly SupabaseBackfillLiveCatalogAuthorityV1[]
      readonly expectedProjectCalls: number
      readonly expectedQueryCalls: number
    }> = [
      { compilerInputs: [changedInput], expectedProjectCalls: 0, expectedQueryCalls: 0 },
      {
        authorities: [AUTHORITY, changedAuthority],
        expectedProjectCalls: 1,
        expectedQueryCalls: 0
      },
      {
        compilerInputs: [input, input, changedInput],
        expectedProjectCalls: 1,
        expectedQueryCalls: 1
      },
      {
        authorities: [AUTHORITY, AUTHORITY, changedAuthority],
        expectedProjectCalls: 1,
        expectedQueryCalls: 1
      }
    ]
    for (const candidate of cases) {
      const run = verificationFixture(review, input, candidate)
      await expectVerificationError(
        verifySupabaseBackfillWriteBarrierV1(run.options),
        'supabase-backfill-write-barrier-verification-input-changed'
      )
      expect(run.projectAuthorityCalls()).toBe(candidate.expectedProjectCalls)
      expect(run.queryRequests).toHaveLength(candidate.expectedQueryCalls)
    }

    const projectMismatch = verificationFixture(review, input, {
      projectAuthority: {
        projectRef: PROJECT_REF,
        organizationId: 'organization-2',
        grantGeneration: GRANT_GENERATION
      }
    })
    await expectVerificationError(
      verifySupabaseBackfillWriteBarrierV1(projectMismatch.options),
      'supabase-backfill-write-barrier-verification-project-authority-mismatch'
    )
    expect(projectMismatch.projectAuthorityCalls()).toBe(1)
    expect(projectMismatch.queryRequests).toHaveLength(0)
  })

  test('maps transport and abort failures to static secret-free errors and preserves typed verifier errors', async () => {
    const input = compilerInput()
    const review = await createReview(input)
    const secretFailure = new Error(`network failed with ${SECRET}`)
    const abortFailure = new Error(`aborted with ${SECRET}`)
    abortFailure.name = 'AbortError'

    for (const candidate of [
      verificationFixture(review, input, { projectAuthorityError: secretFailure }),
      verificationFixture(review, input, { projectAuthorityError: abortFailure }),
      verificationFixture(review, input, { queryError: secretFailure }),
      verificationFixture(review, input, { queryError: abortFailure })
    ]) {
      const error = await expectVerificationError(
        verifySupabaseBackfillWriteBarrierV1(candidate.options),
        'supabase-backfill-write-barrier-verification-transport-failed'
      )
      expect(error.message).not.toContain(SECRET)
      expect(Object.hasOwn(error, 'cause')).toBe(false)
    }

    const missingMethod = verificationFixture(review, input)
    const invalidTransportOptions = {
      ...missingMethod.options,
      transport: {}
    } as VerifySupabaseBackfillWriteBarrierOptionsV1
    await expectVerificationError(
      verifySupabaseBackfillWriteBarrierV1(invalidTransportOptions),
      'supabase-backfill-write-barrier-verification-input-invalid'
    )
    expect(missingMethod.projectAuthorityCalls()).toBe(0)
    expect(missingMethod.queryRequests).toHaveLength(0)

    const sentinel = new SupabaseBackfillWriteBarrierVerificationError(
      'supabase-backfill-write-barrier-verification-digest-failed'
    )
    const typedFailure = verificationFixture(review, input)
    const typedFailureOptions = {
      ...typedFailure.options,
      readCurrentCompilerInput: () => {
        throw sentinel
      }
    }
    await expect(verifySupabaseBackfillWriteBarrierV1(typedFailureOptions)).rejects.toBe(sentinel)
    expect(typedFailure.projectAuthorityCalls()).toBe(0)
    expect(typedFailure.queryRequests).toHaveLength(0)
  })
})
