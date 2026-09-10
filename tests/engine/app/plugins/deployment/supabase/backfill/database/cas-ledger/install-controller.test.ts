/* oxlint-disable eslint/max-lines -- One focused controller matrix keeps the claim, prepare, POST, proof, and reconciliation boundaries auditable together. */

import { describe, expect, test } from 'bun:test'

import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL,
  SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL,
  SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL
} from '@/app/lowcode/supabase/credentials'
import { createSupabaseManagementDatabaseWriteCredentialLeaseIssuerForTestingV1 } from '@/app/lowcode/supabase/management-database-write-credential-lease'
import {
  createMemoryBackendHostReleaseDispatchJournal,
  type BackendHostReleaseDispatchJournal
} from '@/app/plugins/host/deployment/backend/release-journal'
import {
  createSupabaseBackfillDatabaseCASLedgerInstallControllerForTestingV1,
  SupabaseBackfillDatabaseCASLedgerInstallControllerError,
  type SupabaseBackfillDatabaseCASLedgerInstallControllerV1,
  type SupabaseBackfillDatabaseCASLedgerInstallReconciliationHandleV1
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/install-controller'
import { createSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingV1 } from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/install-durable-authority'
import {
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1,
  verifySupabaseBackfillDatabaseCASLedgerV1,
  type SupabaseBackfillDatabaseCASLedgerVerificationHostTransportV1,
  type SupabaseBackfillDatabaseCASLedgerVerificationRequestV1,
  type SupabaseBackfillDatabaseCASLedgerVerificationV1
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/verifier'
import {
  createSupabaseManagementBackfillDatabaseCASLedgerInstallTransportForTestingV1,
  type SupabaseManagementBackfillDatabaseCASLedgerInstallFetch
} from '@/app/plugins/host/deployment/supabase/management/backfill/database-cas-ledger-install-transport'
import { MemoryCredentialStore } from '@/app/settings/credentials/memory'
import { createCredentialServices } from '@/app/settings/credentials/services'

import {
  BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
  BACKFILL_INSTALL_FIXTURE_PROJECT_REF
} from '#tests/engine/app/plugins/deployment/supabase/backfill/write-barrier/helpers'

import {
  BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT,
  BACKFILL_DATABASE_CAS_LEDGER_INSTALL_WRITE_GRANT,
  createBackfillDatabaseCASLedgerInstallFixtureV1,
  type BackfillDatabaseCASLedgerInstallFixtureV1
} from './helpers'

const PROJECT_URL =
  `https://api.supabase.com/v1/projects/${BACKFILL_INSTALL_FIXTURE_PROJECT_REF}` as const
const MIGRATION_URL = `${PROJECT_URL}/database/migrations` as const
const WRITE_CREDENTIAL_INCARNATION = '623e4567-e89b-42d3-a456-426614174000'
const INSTALLED_OBSERVED_AT = '2026-09-07T10:20:00.000Z'
const INSTALLED_SNAPSHOT_MARKER = '910:911:'

interface RecordedRequest {
  readonly url: string
  readonly method: string
  readonly body: string | null
  readonly authorization: string | null
}

interface ControllerHarness {
  readonly fixture: BackfillDatabaseCASLedgerInstallFixtureV1
  readonly journal: BackendHostReleaseDispatchJournal
  readonly controller: SupabaseBackfillDatabaseCASLedgerInstallControllerV1
  readonly requests: RecordedRequest[]
}

type MutableRecord = Record<string, unknown>

function withURL(response: Response, url: string): Response {
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function jsonResponse(value: unknown, status: number, url: string): Response {
  return withURL(
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    }),
    url
  )
}

function projectResponse(url: string, overrides: Readonly<Record<string, unknown>> = {}): Response {
  return jsonResponse(
    {
      ref: BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
      organization_id: BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
      name: 'CAS ledger controller staging',
      ...overrides
    },
    200,
    url
  )
}

function migrationResponse(url: string): Response {
  return jsonResponse({}, 200, url)
}

function monotonicClock(start = Date.parse('2026-09-07T10:00:00.000Z')): () => string {
  let current = start
  return () => {
    const value = new Date(current).toISOString()
    current += 30_000
    return value
  }
}

async function createCredentialIssuer() {
  const services = createCredentialServices(new MemoryCredentialStore())
  await services.manager.set(
    SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL,
    BACKFILL_DATABASE_CAS_LEDGER_INSTALL_WRITE_GRANT
  )
  await services.manager.set(
    SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL,
    WRITE_CREDENTIAL_INCARNATION
  )
  await services.manager.set(
    SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL,
    BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT
  )
  return createSupabaseManagementDatabaseWriteCredentialLeaseIssuerForTestingV1(services)
}

async function createControllerDependencies(
  fetcher: SupabaseManagementBackfillDatabaseCASLedgerInstallFetch,
  journal = createMemoryBackendHostReleaseDispatchJournal(),
  now = monotonicClock()
) {
  const credentialIssuer = await createCredentialIssuer()
  const durable = createSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingV1({
    journal
  })
  const transport = createSupabaseManagementBackfillDatabaseCASLedgerInstallTransportForTestingV1({
    personalAccessToken: BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT,
    writeGrantGeneration: BACKFILL_DATABASE_CAS_LEDGER_INSTALL_WRITE_GRANT,
    fetcher,
    permitConsumer: durable.permitConsumer,
    credentialIssuer
  })
  return Object.freeze({
    journal,
    now,
    credentialIssuer,
    durable,
    transport
  })
}

function createController(
  dependencies: Awaited<ReturnType<typeof createControllerDependencies>>
): SupabaseBackfillDatabaseCASLedgerInstallControllerV1 {
  return createSupabaseBackfillDatabaseCASLedgerInstallControllerForTestingV1({
    authority: dependencies.durable.authority,
    transport: dependencies.transport,
    credentialIssuer: dependencies.credentialIssuer,
    now: dependencies.now
  })
}

function recordingFetcher(
  requests: RecordedRequest[],
  respond: (request: RecordedRequest, index: number) => Response | Promise<Response> = (request) =>
    request.method === 'POST' ? migrationResponse(request.url) : projectResponse(request.url)
): SupabaseManagementBackfillDatabaseCASLedgerInstallFetch {
  return async (input, init) => {
    const request = Object.freeze({
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : null,
      authorization: new Headers(init?.headers).get('authorization')
    })
    requests.push(request)
    return respond(request, requests.length - 1)
  }
}

async function controllerHarness(
  respond?: (request: RecordedRequest, index: number) => Response | Promise<Response>,
  now = monotonicClock(),
  journal = createMemoryBackendHostReleaseDispatchJournal()
): Promise<ControllerHarness> {
  const fixture = await createBackfillDatabaseCASLedgerInstallFixtureV1()
  const requests: RecordedRequest[] = []
  const dependencies = await createControllerDependencies(
    recordingFetcher(requests, respond),
    journal,
    now
  )
  return Object.freeze({
    fixture,
    journal: dependencies.journal,
    controller: createController(dependencies),
    requests
  })
}

function dispatch(harness: ControllerHarness, releaseId = 'cas-ledger-controller-release-1') {
  return harness.controller.dispatch({
    context: harness.fixture.context,
    releaseId,
    ownerId: 'cas-ledger-controller-test-host'
  })
}

async function controllerError(
  operation: Promise<unknown>
): Promise<SupabaseBackfillDatabaseCASLedgerInstallControllerError> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillDatabaseCASLedgerInstallControllerError)
    return cause as SupabaseBackfillDatabaseCASLedgerInstallControllerError
  }
  throw new TypeError('Expected a typed CAS-ledger install controller error.')
}

function installedTables(): MutableRecord[] {
  return [
    {
      tableName: 'backfill_executions_v1',
      tableOid: '70001',
      ownerOid: '10',
      ownerName: 'postgres',
      relationKind: 'r',
      persistence: 'p',
      isPartition: false,
      replicaIdentity: 'd',
      rlsEnabled: true,
      rlsForced: false,
      comment: 'openpencil:release-ledger:backfill-executions:v1',
      nonOwnerPrivilegeCount: 0,
      policyCount: 0
    },
    {
      tableName: 'backfill_receipts_v2',
      tableOid: '70002',
      ownerOid: '10',
      ownerName: 'postgres',
      relationKind: 'r',
      persistence: 'p',
      isPartition: false,
      replicaIdentity: 'd',
      rlsEnabled: true,
      rlsForced: false,
      comment: 'openpencil:release-ledger:backfill-receipts:v2',
      nonOwnerPrivilegeCount: 0,
      policyCount: 0
    },
    {
      tableName: 'backfill_heads_v1',
      tableOid: '70003',
      ownerOid: '10',
      ownerName: 'postgres',
      relationKind: 'r',
      persistence: 'p',
      isPartition: false,
      replicaIdentity: 'd',
      rlsEnabled: true,
      rlsForced: false,
      comment: 'openpencil:release-ledger:backfill-heads:v1',
      nonOwnerPrivilegeCount: 0,
      policyCount: 0
    }
  ]
}

function installedCatalog(marker: string): MutableRecord {
  return {
    schemaCount: 1,
    schemaOid: '70000',
    schemaOwnerOid: '10',
    schemaOwnerName: 'postgres',
    schemaComment: 'openpencil:release-ledger:v1',
    installMarkerConstraintComment: marker,
    schemaInstallMarkerPrefixCount: 1,
    ownerRoleMemberCount: 0,
    ownerDefaultNonOwnerPrivilegeCount: 0,
    schemaNonOwnerPrivilegeCount: 0,
    relationCount: 3,
    unexpectedIndexCount: 0,
    unexpectedTriggerCount: 0,
    unexpectedRuleCount: 0,
    unexpectedConstraintCount: 0,
    inheritanceRelationCount: 0,
    publicationExposureCount: 0,
    droppedColumnCount: 0,
    policyCount: 0,
    tables: installedTables(),
    columns: structuredClone(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1),
    constraints: structuredClone(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1)
  }
}

function installedResponse(
  request: SupabaseBackfillDatabaseCASLedgerVerificationRequestV1,
  marker: string
): MutableRecord {
  return {
    reviewDigest: request.reviewDigest,
    ledgerShapeDigest: request.ledgerShapeDigest,
    sqlDigest: request.sqlDigest,
    projectRef: request.projectRef,
    accountId: request.accountId,
    grantGeneration: request.grantGeneration,
    queryVersion: request.queryVersion,
    queryDigest: request.queryDigest,
    accessMode: 'read-only',
    snapshotScope: 'single-statement',
    catalogOnly: true,
    managedDataRead: false,
    serverVersionNum: '170000',
    snapshotMarker: INSTALLED_SNAPSHOT_MARKER,
    observedAt: INSTALLED_OBSERVED_AT,
    roles: {
      currentOid: '9000',
      currentName: 'supabase_read_only_user',
      currentSuperuser: false,
      currentBypassRls: true,
      currentHasEffectivePgReadAllData: true,
      sessionOid: '9000',
      sessionName: 'supabase_read_only_user',
      sessionSuperuser: false,
      sessionBypassRls: true,
      sessionHasEffectivePgReadAllData: true
    },
    settings: {
      databasePrimary: true,
      transactionReadOnly: true,
      effectiveSearchPath: ['pg_catalog', 'public']
    },
    catalog: installedCatalog(marker)
  }
}

function installedTransport(
  marker: string
): SupabaseBackfillDatabaseCASLedgerVerificationHostTransportV1 {
  return {
    async getProjectAuthority(request) {
      return {
        projectRef: request.projectRef,
        organizationId: request.accountId,
        grantGeneration: request.grantGeneration
      }
    },
    async runReadOnlyDatabaseCASLedgerVerificationQuery(request) {
      return installedResponse(request, marker)
    }
  }
}

function verifyInstalled(
  fixture: BackfillDatabaseCASLedgerInstallFixtureV1
): Promise<SupabaseBackfillDatabaseCASLedgerVerificationV1> {
  return verifySupabaseBackfillDatabaseCASLedgerV1({
    review: fixture.sourceReview,
    readCurrentAuthority: () => fixture.readAuthority,
    transport: installedTransport(fixture.context.marker)
  })
}

function expectOpaqueReconciliationHandle(
  value: SupabaseBackfillDatabaseCASLedgerInstallReconciliationHandleV1 | null
): asserts value is SupabaseBackfillDatabaseCASLedgerInstallReconciliationHandleV1 {
  expect(value).not.toBeNull()
  expect(Object.keys(value ?? {})).toEqual([])
  expect(Object.isFrozen(value)).toBe(true)
  expect(JSON.stringify(value)).toBe('{}')
}

async function expectedSingleFlightKey(
  fixture: BackfillDatabaseCASLedgerInstallFixtureV1
): Promise<string> {
  const planDigest = await digestCanonicalManifest({
    format: 'openpencil.supabase-backfill-database-cas-ledger-install-plan.v1',
    version: 1,
    providerId: 'supabase',
    environment: 'staging',
    projectRef: fixture.context.projectRef,
    accountId: fixture.context.accountId,
    readGrantGeneration: fixture.readAuthority.grantGeneration,
    writeGrantGeneration: fixture.writeAuthority.grantGeneration,
    migrationName: fixture.context.migrationName,
    installReviewDigest: fixture.context.installReviewDigest,
    sourceReviewDigest: fixture.context.sourceReviewDigest,
    verificationDigest: fixture.context.verificationDigest,
    ledgerShapeDigest: fixture.context.ledgerShapeDigest,
    baseSqlDigest: fixture.context.sqlDigest,
    marker: fixture.context.marker,
    markerBindingDigest: fixture.context.markerBindingDigest,
    installSqlDigest: fixture.context.installSqlDigest,
    verificationQueryDigest: fixture.context.verificationQueryDigest
  })
  return [
    'backend-release-v3',
    'supabase',
    fixture.context.projectRef,
    fixture.context.accountId,
    'backfill-database-cas-ledger-install',
    planDigest
  ]
    .map((part) => encodeURIComponent(part))
    .join(':')
}

async function journalRecord(harness: ControllerHarness) {
  return harness.journal.read(await expectedSingleFlightKey(harness.fixture))
}

describe('Supabase backfill database CAS ledger install controller', () => {
  test('accepts only exact testing dependencies and does not invoke accessor-backed options', async () => {
    const requests: RecordedRequest[] = []
    const dependencies = await createControllerDependencies(recordingFetcher(requests))
    const controller = createController(dependencies)
    expect(Object.keys(controller)).toEqual([
      'format',
      'version',
      'provenance',
      'dispatch',
      'reconcile',
      'resumeSettlement'
    ])
    expect(controller.provenance).toBe('testing')
    expect(Object.isFrozen(controller)).toBe(true)

    expect(() =>
      createSupabaseBackfillDatabaseCASLedgerInstallControllerForTestingV1({
        authority: { ...dependencies.durable.authority },
        transport: dependencies.transport,
        credentialIssuer: dependencies.credentialIssuer,
        now: dependencies.now
      } as never)
    ).toThrow(SupabaseBackfillDatabaseCASLedgerInstallControllerError)

    const customPrototype = Object.assign(Object.create({ inherited: true }), {
      authority: dependencies.durable.authority,
      transport: dependencies.transport,
      credentialIssuer: dependencies.credentialIssuer,
      now: dependencies.now
    })
    expect(() =>
      createSupabaseBackfillDatabaseCASLedgerInstallControllerForTestingV1(customPrototype)
    ).toThrow(SupabaseBackfillDatabaseCASLedgerInstallControllerError)

    let getterCalls = 0
    const accessor = {
      transport: dependencies.transport,
      credentialIssuer: dependencies.credentialIssuer,
      now: dependencies.now
    }
    Object.defineProperty(accessor, 'authority', {
      enumerable: true,
      get() {
        getterCalls += 1
        return dependencies.durable.authority
      }
    })
    expect(() =>
      createSupabaseBackfillDatabaseCASLedgerInstallControllerForTestingV1(accessor as never)
    ).toThrow(SupabaseBackfillDatabaseCASLedgerInstallControllerError)
    expect(getterCalls).toBe(0)
    expect(requests).toEqual([])

    const otherRequests: RecordedRequest[] = []
    const other = await createControllerDependencies(recordingFetcher(otherRequests))
    expect(() =>
      createSupabaseBackfillDatabaseCASLedgerInstallControllerForTestingV1({
        authority: dependencies.durable.authority,
        transport: other.transport,
        credentialIssuer: dependencies.credentialIssuer,
        now: dependencies.now
      })
    ).toThrow(SupabaseBackfillDatabaseCASLedgerInstallControllerError)
    expect(() =>
      createSupabaseBackfillDatabaseCASLedgerInstallControllerForTestingV1({
        authority: dependencies.durable.authority,
        transport: dependencies.transport,
        credentialIssuer: { ...dependencies.credentialIssuer },
        now: dependencies.now
      } as never)
    ).toThrow(SupabaseBackfillDatabaseCASLedgerInstallControllerError)
    expect(requests).toEqual([])
    expect(otherRequests).toEqual([])
  })

  test('treats Management API HTTP 200 only as verification-required and keeps results secret-free', async () => {
    const harness = await controllerHarness()
    const result = await dispatch(harness)

    expect(result).toMatchObject({
      status: 'verification-required',
      automaticRetryAllowed: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false,
      acceptance: {
        status: 'verification-required',
        httpStatus: 200,
        managementRequestReturned200: true,
        databaseLedgerBound: false,
        sourceLedgerBound: false,
        releaseReady: false
      }
    })
    expectOpaqueReconciliationHandle(result.reconciliation)
    expect(harness.requests.map(({ method }) => method)).toEqual(['GET', 'GET', 'POST'])
    expect(harness.requests.map(({ url }) => url)).toEqual([
      PROJECT_URL,
      PROJECT_URL,
      MIGRATION_URL
    ])
    expect(harness.requests[2]?.body).toBe(
      JSON.stringify({
        query: harness.fixture.installReview.installSql,
        name: harness.fixture.context.migrationName
      })
    )

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT)
    expect(serialized).not.toContain(harness.fixture.installReview.installSql)
    expect(serialized).not.toMatch(/personalAccessToken|authorization|bearer|permit|attempt/iu)
    expect(Object.keys(result)).not.toContain('credentialLease')
    expect(Object.keys(result)).not.toContain('sql')
  })

  test('settles a failed GET prepare before precommit and never reaches POST', async () => {
    const harness = await controllerHarness((request) =>
      projectResponse(request.url, { organization_id: 'different-organization' })
    )
    const result = await dispatch(harness, 'cas-ledger-controller-prepare-failure')

    expect(result).toMatchObject({
      status: 'not-dispatched',
      reconciliation: null,
      acceptance: null,
      automaticRetryAllowed: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false
    })
    expect(harness.requests.map(({ method }) => method)).toEqual(['GET'])
    expect(harness.requests.some(({ method }) => method === 'POST')).toBe(false)
    expect(await journalRecord(harness)).toMatchObject({
      outcome: 'failed',
      code: 'supabase-backfill-database-cas-ledger-install-not-dispatched'
    })
  })

  test('settles an opaque-proven pre-POST dispatch failure and never emits a migration request', async () => {
    let getCalls = 0
    const harness = await controllerHarness((request) => {
      if (request.method === 'POST') return migrationResponse(request.url)
      getCalls += 1
      return getCalls === 1
        ? projectResponse(request.url)
        : projectResponse(request.url, { organization_id: 'different-organization' })
    })
    const result = await dispatch(harness, 'cas-ledger-controller-pre-post-failure')

    expect(result).toMatchObject({
      status: 'not-dispatched',
      reconciliation: null,
      acceptance: null,
      automaticRetryAllowed: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false
    })
    expect(harness.requests.map(({ method }) => method)).toEqual(['GET', 'GET'])
    expect(harness.requests.some(({ method }) => method === 'POST')).toBe(false)
    expect(await journalRecord(harness)).toMatchObject({
      outcome: 'failed',
      code: 'supabase-backfill-database-cas-ledger-install-not-dispatched'
    })
  })

  test('keeps every failure after POST start reconciliation-required and never automatically retries', async () => {
    let postCalls = 0
    const harness = await controllerHarness(async (request) => {
      if (request.method !== 'POST') return projectResponse(request.url)
      postCalls += 1
      throw new Error(`ambiguous migration response ${BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT}`)
    })
    const first = await dispatch(harness, 'cas-ledger-controller-post-failure')

    expect(first).toMatchObject({
      status: 'reconciliation-required',
      acceptance: null,
      automaticRetryAllowed: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false
    })
    expectOpaqueReconciliationHandle(first.reconciliation)
    expect(postCalls).toBe(1)
    expect(harness.requests.map(({ method }) => method)).toEqual(['GET', 'GET', 'POST'])

    const replay = await dispatch(harness, 'cas-ledger-controller-post-failure-replay')
    expect(replay).toMatchObject({
      status: 'reconciliation-required',
      automaticRetryAllowed: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false
    })
    expect(postCalls).toBe(1)
    expect(harness.requests.map(({ method }) => method)).toEqual(['GET', 'GET', 'POST'])
    expect((await journalRecord(harness))?.outcome).toBe('outcome-unknown')
  })

  test('allows only one concurrent dispatch and one POST for an exact operation', async () => {
    const harness = await controllerHarness()
    const [left, right] = await Promise.all([
      dispatch(harness, 'cas-ledger-controller-concurrent-left'),
      dispatch(harness, 'cas-ledger-controller-concurrent-right')
    ])

    expect([left.status, right.status].sort((a, b) => a.localeCompare(b, 'en'))).toEqual([
      'reconciliation-required',
      'verification-required'
    ])
    expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(1)
    expect(harness.requests.filter(({ method }) => method === 'GET')).toHaveLength(2)
    const ready = left.status === 'verification-required' ? left : right
    expectOpaqueReconciliationHandle(ready.reconciliation)
    expect(JSON.stringify({ left, right })).not.toMatch(/personalAccessToken|permit|attempt/iu)
  })

  test('uses the last accepted clock value to settle a pre-POST clock regression', async () => {
    const timestamps = [
      '2026-09-07T10:00:00.000Z',
      '2026-09-07T10:01:00.000Z',
      '2026-09-07T09:59:00.000Z'
    ]
    let clockCalls = 0
    const harness = await controllerHarness(undefined, () => {
      const value = timestamps[clockCalls]
      clockCalls += 1
      if (!value) throw new TypeError('Unexpected extra clock read')
      return value
    })
    const result = await dispatch(harness, 'cas-ledger-controller-clock-regression')

    expect(result).toMatchObject({
      status: 'not-dispatched',
      reconciliation: null,
      acceptance: null,
      automaticRetryAllowed: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false,
      code: 'supabase-backfill-database-cas-ledger-install-not-dispatched'
    })
    expect(clockCalls).toBe(4)
    expect(harness.requests.map(({ method }) => method)).toEqual(['GET'])
    expect(await journalRecord(harness)).toMatchObject({
      outcome: 'failed',
      code: 'supabase-backfill-database-cas-ledger-install-not-dispatched'
    })
    expect(
      await harness.journal.readEvidence(await expectedSingleFlightKey(harness.fixture))
    ).toMatchObject({ phase: 'final', recordedAt: '2026-09-07T10:01:00.000Z' })
  })

  test('uses the last accepted clock value when settlement time acquisition throws', async () => {
    let clockCalls = 0
    const harness = await controllerHarness(
      (request) => projectResponse(request.url, { organization_id: 'different-organization' }),
      () => {
        clockCalls += 1
        if (clockCalls === 1) return '2026-09-07T10:00:00.000Z'
        throw new Error(`clock unavailable ${BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT}`)
      }
    )
    const result = await dispatch(harness, 'cas-ledger-controller-clock-throw')

    expect(result).toMatchObject({
      status: 'not-dispatched',
      reconciliation: null,
      acceptance: null,
      automaticRetryAllowed: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false,
      code: 'supabase-backfill-database-cas-ledger-install-not-dispatched'
    })
    expect(clockCalls).toBe(2)
    expect(harness.requests.map(({ method }) => method)).toEqual(['GET'])
    expect(await journalRecord(harness)).toMatchObject({
      outcome: 'failed',
      code: 'supabase-backfill-database-cas-ledger-install-not-dispatched'
    })
    expect(JSON.stringify(result)).not.toContain(BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT)
  })

  test('does not lose a known-not-dispatched proof when the post-prepare clock throws', async () => {
    let getCalls = 0
    let clockCalls = 0
    const timestamps = [
      '2026-09-07T10:00:00.000Z',
      '2026-09-07T10:00:30.000Z',
      '2026-09-07T10:01:00.000Z'
    ]
    const harness = await controllerHarness(
      (request) => {
        if (request.method === 'POST') return migrationResponse(request.url)
        getCalls += 1
        return getCalls === 1
          ? projectResponse(request.url)
          : projectResponse(request.url, { organization_id: 'different-organization' })
      },
      () => {
        const value = timestamps[clockCalls]
        clockCalls += 1
        if (!value) throw new Error('clock unavailable after known pre-POST failure')
        return value
      }
    )

    const result = await dispatch(harness, 'cas-ledger-controller-known-proof-clock-throw')

    expect(result).toMatchObject({
      status: 'not-dispatched',
      reconciliation: null,
      acceptance: null,
      code: 'supabase-backfill-database-cas-ledger-install-not-dispatched'
    })
    expect(clockCalls).toBe(4)
    expect(harness.requests.map(({ method }) => method)).toEqual(['GET', 'GET'])
    expect(await journalRecord(harness)).toMatchObject({
      outcome: 'failed',
      code: 'supabase-backfill-database-cas-ledger-install-not-dispatched'
    })
  })

  test('keeps a partially persisted precommit failure active without reconstructing proof', async () => {
    let settlementCalls = 0
    const journal = createMemoryBackendHostReleaseDispatchJournal({
      beforeSettle() {
        settlementCalls += 1
        if (settlementCalls === 1) throw new Error('simulated precommit settlement failure')
      }
    })
    const harness = await controllerHarness(undefined, monotonicClock(), journal)

    const result = await dispatch(harness, 'cas-ledger-controller-precommit-journal-failure')

    expect(result).toMatchObject({
      status: 'reconciliation-required',
      acceptance: null,
      code: 'supabase-backfill-database-cas-ledger-install-final-settlement-required',
      automaticRetryAllowed: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false
    })
    expectOpaqueReconciliationHandle(result.reconciliation)
    expect(settlementCalls).toBe(1)
    expect(harness.requests.map(({ method }) => method)).toEqual(['GET'])
    expect(await journalRecord(harness)).toMatchObject({ outcome: 'pending' })
  })

  test('continues only after exact reread when the committed claim readback fails once', async () => {
    let readCalls = 0
    const journal = createMemoryBackendHostReleaseDispatchJournal({
      beforeRead() {
        readCalls += 1
        if (readCalls === 1) throw new Error('simulated committed claim readback failure')
      }
    })
    const harness = await controllerHarness(undefined, monotonicClock(), journal)

    const result = await dispatch(harness, 'cas-ledger-controller-claim-readback-recovery')

    expect(result.status).toBe('verification-required')
    expectOpaqueReconciliationHandle(result.reconciliation)
    expect(harness.requests.map(({ method }) => method)).toEqual(['GET', 'GET', 'POST'])
    expect(await journalRecord(harness)).toMatchObject({ outcome: 'outcome-unknown' })
  })

  test('keeps failed claim and precommit readbacks active without issuing a POST', async () => {
    let readCalls = 0
    const journal = createMemoryBackendHostReleaseDispatchJournal({
      beforeRead() {
        readCalls += 1
        if (readCalls <= 2) throw new Error('simulated early journal read failure')
      }
    })
    const harness = await controllerHarness(undefined, monotonicClock(), journal)

    const result = await dispatch(harness, 'cas-ledger-controller-early-read-recovery')

    expect(result).toMatchObject({
      status: 'reconciliation-required',
      acceptance: null,
      code: 'supabase-backfill-database-cas-ledger-install-final-settlement-required',
      automaticRetryAllowed: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false
    })
    expectOpaqueReconciliationHandle(result.reconciliation)
    expect(harness.requests.map(({ method }) => method)).toEqual(['GET'])
    expect(await journalRecord(harness)).toMatchObject({ outcome: 'pending' })
  })

  test('retains a fail-closed handle after early journal reads recover', async () => {
    let rejectReads = true
    const journal = createMemoryBackendHostReleaseDispatchJournal({
      beforeRead() {
        if (rejectReads) throw new Error('simulated persistent journal read failure')
      }
    })
    const harness = await controllerHarness(undefined, monotonicClock(), journal)

    const unavailable = await dispatch(harness, 'cas-ledger-controller-early-read-handle')
    expect(unavailable).toMatchObject({
      status: 'reconciliation-required',
      acceptance: null,
      automaticRetryAllowed: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false
    })
    expectOpaqueReconciliationHandle(unavailable.reconciliation)
    expect(harness.requests.map(({ method }) => method)).toEqual(['GET'])

    rejectReads = false
    const recovered = await harness.controller.resumeSettlement({
      reconciliation: unavailable.reconciliation
    })
    expect(recovered).toMatchObject({
      status: 'reconciliation-required',
      code: 'supabase-backfill-database-cas-ledger-install-final-settlement-required',
      automaticRetryAllowed: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false
    })
    expect(harness.requests.map(({ method }) => method)).toEqual(['GET'])
    expect(await journalRecord(harness)).toMatchObject({ outcome: 'pending' })
  })

  test('keeps a permit-validation read failure unknown without a sealed no-dispatch proof', async () => {
    let readCalls = 0
    const journal = createMemoryBackendHostReleaseDispatchJournal({
      beforeRead() {
        readCalls += 1
        if (readCalls === 7) throw new Error('simulated permit-validation read failure')
      }
    })
    const harness = await controllerHarness(undefined, monotonicClock(), journal)

    const result = await dispatch(harness, 'cas-ledger-controller-permit-read-recovery')

    expect(result).toMatchObject({
      status: 'reconciliation-required',
      acceptance: null,
      code: 'supabase-backfill-database-cas-ledger-install-journal-permit-invalid',
      automaticRetryAllowed: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false
    })
    expectOpaqueReconciliationHandle(result.reconciliation)
    expect(harness.requests.map(({ method }) => method)).toEqual(['GET'])
    expect(await journalRecord(harness)).toMatchObject({ outcome: 'outcome-unknown' })
  })

  test('retains one opaque handle without recreating a consumed no-dispatch proof', async () => {
    let settlementCalls = 0
    let rejectFinalSettlement = true
    let getCalls = 0
    const journal = createMemoryBackendHostReleaseDispatchJournal({
      beforeSettle() {
        settlementCalls += 1
        if (settlementCalls > 1 && rejectFinalSettlement) {
          throw new Error('simulated persistent final settlement failure')
        }
      }
    })
    const harness = await controllerHarness(
      (request) => {
        if (request.method === 'POST') return migrationResponse(request.url)
        getCalls += 1
        return getCalls === 1
          ? projectResponse(request.url)
          : projectResponse(request.url, { organization_id: 'different-organization' })
      },
      monotonicClock(),
      journal
    )

    const dispatched = await dispatch(harness, 'cas-ledger-controller-known-settlement-recovery')
    expect(dispatched).toMatchObject({
      status: 'reconciliation-required',
      acceptance: null,
      automaticRetryAllowed: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false
    })
    expectOpaqueReconciliationHandle(dispatched.reconciliation)
    expect(settlementCalls).toBe(2)
    expect(harness.requests.map(({ method }) => method)).toEqual(['GET', 'GET'])

    await controllerError(
      harness.controller.resumeSettlement({
        reconciliation: structuredClone(dispatched.reconciliation)
      })
    )
    expect(settlementCalls).toBe(2)

    const concurrentResumes = await Promise.allSettled([
      harness.controller.resumeSettlement({ reconciliation: dispatched.reconciliation }),
      harness.controller.resumeSettlement({ reconciliation: dispatched.reconciliation })
    ])
    expect(concurrentResumes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(concurrentResumes.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    const stillUnavailable = concurrentResumes.find(
      (
        candidate
      ): candidate is PromiseFulfilledResult<
        Awaited<ReturnType<typeof harness.controller.resumeSettlement>>
      > => candidate.status === 'fulfilled'
    )?.value
    expect(stillUnavailable).toMatchObject({
      status: 'reconciliation-required',
      code: 'supabase-backfill-database-cas-ledger-install-final-settlement-required',
      automaticRetryAllowed: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false
    })
    expect(settlementCalls).toBe(2)
    expect(harness.requests.map(({ method }) => method)).toEqual(['GET', 'GET'])

    rejectFinalSettlement = false
    const recovered = await harness.controller.resumeSettlement({
      reconciliation: dispatched.reconciliation
    })
    expect(recovered).toMatchObject({
      status: 'reconciliation-required',
      code: 'supabase-backfill-database-cas-ledger-install-final-settlement-required',
      automaticRetryAllowed: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false
    })
    expect(settlementCalls).toBe(2)
    expect(harness.requests.map(({ method }) => method)).toEqual(['GET', 'GET'])
    expect(await journalRecord(harness)).toMatchObject({ outcome: 'outcome-unknown' })
    const stillBlocked = await harness.controller.resumeSettlement({
      reconciliation: dispatched.reconciliation
    })
    expect(stillBlocked).toMatchObject({
      status: 'reconciliation-required',
      automaticRetryAllowed: false
    })
    expect(harness.requests.some(({ method }) => method === 'POST')).toBe(false)
  })

  test('retains the handle without reconstructing a consumed Applied proof', async () => {
    let settlementCalls = 0
    let rejectFinalSettlement = true
    const journal = createMemoryBackendHostReleaseDispatchJournal({
      beforeSettle() {
        settlementCalls += 1
        if (settlementCalls > 1 && rejectFinalSettlement) {
          throw new Error('simulated persistent applied settlement failure')
        }
      }
    })
    const harness = await controllerHarness(undefined, monotonicClock(), journal)
    const dispatched = await dispatch(harness, 'cas-ledger-controller-applied-settlement-recovery')
    expect(dispatched.status).toBe('verification-required')
    expectOpaqueReconciliationHandle(dispatched.reconciliation)
    const installedVerification = await verifyInstalled(harness.fixture)

    const unavailable = await harness.controller.reconcile({
      reconciliation: dispatched.reconciliation,
      installedVerification
    })
    expect(unavailable).toMatchObject({
      status: 'reconciliation-required',
      code: 'supabase-backfill-database-cas-ledger-install-applied-settlement-required',
      automaticRetryAllowed: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false
    })
    expect(settlementCalls).toBe(2)
    expect(harness.requests.map(({ method }) => method)).toEqual(['GET', 'GET', 'POST'])

    rejectFinalSettlement = false
    const recovered = await harness.controller.resumeSettlement({
      reconciliation: dispatched.reconciliation
    })
    expect(recovered).toMatchObject({
      status: 'reconciliation-required',
      code: 'supabase-backfill-database-cas-ledger-install-final-settlement-required',
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false,
      automaticRetryAllowed: false
    })
    expect(settlementCalls).toBe(2)
    expect(harness.requests.map(({ method }) => method)).toEqual(['GET', 'GET', 'POST'])
    expect(await journalRecord(harness)).toMatchObject({ outcome: 'outcome-unknown' })
    const stillBlocked = await harness.controller.resumeSettlement({
      reconciliation: dispatched.reconciliation
    })
    expect(stillBlocked).toMatchObject({
      status: 'reconciliation-required',
      automaticRetryAllowed: false
    })
    expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(1)
  })

  test('rejects cloned, accessor-backed, and custom-prototype dispatch inputs before side effects', async () => {
    const cloned = await controllerHarness()
    await controllerError(
      cloned.controller.dispatch({
        context: structuredClone(cloned.fixture.context),
        releaseId: 'cas-ledger-controller-cloned-context',
        ownerId: 'cas-ledger-controller-test-host'
      })
    )
    expect(cloned.requests).toEqual([])
    expect(await cloned.journal.listPending()).toEqual([])
    expect(await cloned.journal.listUnresolved()).toEqual([])

    const accessor = await controllerHarness()
    let getterCalls = 0
    const accessorInput = {
      releaseId: 'cas-ledger-controller-accessor',
      ownerId: 'cas-ledger-controller-test-host'
    }
    Object.defineProperty(accessorInput, 'context', {
      enumerable: true,
      get() {
        getterCalls += 1
        return accessor.fixture.context
      }
    })
    await controllerError(accessor.controller.dispatch(accessorInput as never))
    expect(getterCalls).toBe(0)
    expect(accessor.requests).toEqual([])
    expect(await accessor.journal.listPending()).toEqual([])
    expect(await accessor.journal.listUnresolved()).toEqual([])

    const custom = await controllerHarness()
    const customPrototype = Object.assign(Object.create({ inherited: true }), {
      context: custom.fixture.context,
      releaseId: 'cas-ledger-controller-custom-prototype',
      ownerId: 'cas-ledger-controller-test-host'
    })
    await controllerError(custom.controller.dispatch(customPrototype))
    expect(custom.requests).toEqual([])
    expect(await custom.journal.listPending()).toEqual([])
    expect(await custom.journal.listUnresolved()).toEqual([])
  })

  test('rejects a pre-POST installed proof and applies only an exact fresh post-POST proof', async () => {
    const staleHarness = await controllerHarness()
    const staleVerification = await verifyInstalled(staleHarness.fixture)
    const staleDispatch = await dispatch(
      staleHarness,
      'cas-ledger-controller-stale-installed-proof'
    )
    expect(staleDispatch.status).toBe('verification-required')
    expectOpaqueReconciliationHandle(staleDispatch.reconciliation)
    await controllerError(
      staleHarness.controller.reconcile({
        reconciliation: staleDispatch.reconciliation,
        installedVerification: staleVerification
      })
    )
    expect((await journalRecord(staleHarness))?.outcome).toBe('outcome-unknown')
    const freshAfterStale = await verifyInstalled(staleHarness.fixture)
    const appliedAfterStale = await staleHarness.controller.reconcile({
      reconciliation: staleDispatch.reconciliation,
      installedVerification: freshAfterStale
    })
    expect(appliedAfterStale.status).toBe('applied')

    const freshHarness = await controllerHarness()
    const dispatched = await dispatch(freshHarness, 'cas-ledger-controller-fresh-installed-proof')
    expect(dispatched.status).toBe('verification-required')
    expectOpaqueReconciliationHandle(dispatched.reconciliation)
    const installedVerification = await verifyInstalled(freshHarness.fixture)
    const applied = await freshHarness.controller.reconcile({
      reconciliation: dispatched.reconciliation,
      installedVerification
    })

    expect(applied).toMatchObject({
      format: 'openpencil.supabase-backfill-database-cas-ledger-install-applied.v1',
      version: 1,
      providerId: 'supabase',
      environment: 'staging',
      status: 'applied',
      projectRef: freshHarness.fixture.context.projectRef,
      accountId: freshHarness.fixture.context.accountId,
      installedVerificationDigest: installedVerification.verificationDigest,
      observedAt: installedVerification.observedAt,
      snapshotMarker: installedVerification.snapshotMarker,
      databaseLedgerBound: true,
      sourceLedgerBound: false,
      releaseReady: false,
      automaticRetryAllowed: false
    })
    expect(JSON.stringify(applied)).not.toMatch(
      /personalAccessToken|authorization|permit|attempt/iu
    )
    expect(await journalRecord(freshHarness)).toMatchObject({ outcome: 'applied', code: null })
  })

  test('does not burn a genuine installed proof or reconciliation handle on a cloned proof', async () => {
    const harness = await controllerHarness()
    const dispatched = await dispatch(harness, 'cas-ledger-controller-cloned-installed-proof')
    expect(dispatched.status).toBe('verification-required')
    expectOpaqueReconciliationHandle(dispatched.reconciliation)
    const installedVerification = await verifyInstalled(harness.fixture)

    await controllerError(
      harness.controller.reconcile({
        reconciliation: dispatched.reconciliation,
        installedVerification: structuredClone(installedVerification)
      })
    )
    expect((await journalRecord(harness))?.outcome).toBe('outcome-unknown')

    const applied = await harness.controller.reconcile({
      reconciliation: dispatched.reconciliation,
      installedVerification
    })
    expect(applied).toMatchObject({
      status: 'applied',
      installedVerificationDigest: installedVerification.verificationDigest,
      databaseLedgerBound: true,
      sourceLedgerBound: false,
      releaseReady: false
    })
    expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(1)
  })

  test('rejects cloned reconciliation handles without burning the genuine handle', async () => {
    const harness = await controllerHarness()
    const dispatched = await dispatch(harness, 'cas-ledger-controller-forged-handle')
    expect(dispatched.status).toBe('verification-required')
    expectOpaqueReconciliationHandle(dispatched.reconciliation)
    const installedVerification = await verifyInstalled(harness.fixture)

    await controllerError(
      harness.controller.reconcile({
        reconciliation: structuredClone(dispatched.reconciliation),
        installedVerification
      })
    )
    const applied = await harness.controller.reconcile({
      reconciliation: dispatched.reconciliation,
      installedVerification
    })
    expect(applied.status).toBe('applied')

    await controllerError(
      harness.controller.reconcile({
        reconciliation: dispatched.reconciliation,
        installedVerification
      })
    )
    expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(1)
  })
})
