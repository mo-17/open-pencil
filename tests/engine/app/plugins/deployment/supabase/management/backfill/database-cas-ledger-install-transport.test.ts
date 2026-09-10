/* oxlint-disable eslint/max-lines -- One threat matrix keeps the fixed CAS-ledger preparation transport auditable. */

import { describe, expect, spyOn, test } from 'bun:test'

import {
  SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL,
  SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL,
  SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL,
  setSupabaseManagementDatabaseWritePat
} from '@/app/lowcode/supabase/credentials'
import {
  createSupabaseManagementDatabaseWriteCredentialLeaseIssuerForTestingV1,
  issueSupabaseManagementDatabaseWriteCredentialLeaseV1,
  type SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1,
  type SupabaseManagementDatabaseWriteCredentialLeaseV1
} from '@/app/lowcode/supabase/management-database-write-credential-lease'
import { createMemoryBackendHostReleaseDispatchJournal } from '@/app/plugins/host/deployment/backend/release-journal'
import {
  deriveSupabaseBackfillDatabaseCASLedgerInstallCredentialLeaseBindingV1,
  type SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/install'
import { createSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingV1 } from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/install-durable-authority'
import {
  consumeSupabaseManagementBackfillDatabaseCASLedgerInstallKnownNotDispatchedProofV1,
  createSupabaseManagementBackfillDatabaseCASLedgerInstallTransportForTestingV1,
  isTestingSupabaseManagementBackfillDatabaseCASLedgerInstallTransportV1,
  SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_LIMITS,
  SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError,
  type CreateSupabaseManagementBackfillDatabaseCASLedgerInstallTransportForTestingOptionsV1,
  type SupabaseManagementBackfillDatabaseCASLedgerInstallFetch
} from '@/app/plugins/host/deployment/supabase/management/backfill/database-cas-ledger-install-transport'
import { MemoryCredentialStore } from '@/app/settings/credentials/memory'
import { createCredentialServices } from '@/app/settings/credentials/services'

import {
  BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT,
  BACKFILL_DATABASE_CAS_LEDGER_INSTALL_WRITE_GRANT,
  createBackfillDatabaseCASLedgerInstallFixtureV1
} from '#tests/engine/app/plugins/deployment/supabase/backfill/database/cas-ledger/helpers'
import {
  BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
  BACKFILL_INSTALL_FIXTURE_PROJECT_REF
} from '#tests/engine/app/plugins/deployment/supabase/backfill/write-barrier/helpers'
import type { RecordedRequest } from '#tests/engine/app/plugins/deployment/supabase/management/helpers'

const PROJECT_URL =
  `https://api.supabase.com/v1/projects/${BACKFILL_INSTALL_FIXTURE_PROJECT_REF}` as const
const MIGRATION_URL = `${PROJECT_URL}/database/migrations` as const
const WRITE_CREDENTIAL_INCARNATION = '623e4567-e89b-42d3-a456-426614174000'
const CLAIMED_AT = '2026-09-07T10:00:00.000Z'
const PROGRESS_RECORDED_AT = '2026-09-07T10:01:00.000Z'
const OUTCOME_UNKNOWN_AT = '2026-09-07T10:02:00.000Z'
const NOT_DISPATCHED_RECORDED_AT = '2026-09-07T10:03:00.000Z'

function withURL(response: Response, url: string): Response {
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function jsonResponse(
  value: unknown,
  status: number,
  url = '',
  contentType = 'application/json; charset=utf-8'
): Response {
  const response = new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': contentType }
  })
  return url ? withURL(response, url) : response
}

function projectResponse(
  url: string = PROJECT_URL,
  overrides: Readonly<Record<string, unknown>> = {}
): Response {
  return jsonResponse(
    {
      ref: BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
      organization_id: BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
      name: 'CAS ledger staging',
      ...overrides
    },
    200,
    url
  )
}

function successfulFetcher(
  requests: RecordedRequest[] = []
): SupabaseManagementBackfillDatabaseCASLedgerInstallFetch {
  return async (input, init, maximum, timeout) => {
    const url = String(input)
    requests.push({ url, init: init ?? {}, maximum, timeout })
    return projectResponse(url)
  }
}

async function createCredentialHarness() {
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
  return Object.freeze({
    services,
    issuer: createSupabaseManagementDatabaseWriteCredentialLeaseIssuerForTestingV1(services)
  })
}

async function createTestingTransport(
  fetcher: SupabaseManagementBackfillDatabaseCASLedgerInstallFetch,
  overrides: Readonly<Record<string, unknown>> = {}
) {
  const credentials = await createCredentialHarness()
  const durable = createSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingV1({
    journal: createMemoryBackendHostReleaseDispatchJournal()
  })
  const transport = createSupabaseManagementBackfillDatabaseCASLedgerInstallTransportForTestingV1({
    personalAccessToken: BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT,
    writeGrantGeneration: BACKFILL_DATABASE_CAS_LEDGER_INSTALL_WRITE_GRANT,
    fetcher,
    permitConsumer: durable.permitConsumer,
    credentialIssuer: credentials.issuer,
    ...overrides
  } as CreateSupabaseManagementBackfillDatabaseCASLedgerInstallTransportForTestingOptionsV1)
  return Object.freeze({ credentials, durable, transport })
}

async function issueCredentialLease(
  context: SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1,
  credentials: Awaited<ReturnType<typeof createCredentialHarness>>
) {
  const binding = deriveSupabaseBackfillDatabaseCASLedgerInstallCredentialLeaseBindingV1(context)
  if (!binding) throw new TypeError('Expected a genuine install credential binding')
  return issueSupabaseManagementDatabaseWriteCredentialLeaseV1({
    issuer: credentials.issuer,
    binding
  })
}

async function claimDispatchAttempt(
  durable: ReturnType<
    typeof createSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingV1
  >,
  context: SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1,
  releaseId = 'cas-ledger-install-transport-test'
) {
  const result = await durable.authority.claim({
    context,
    releaseId,
    ownerId: 'transport-test-host',
    claimedAt: CLAIMED_AT
  })
  if (result.status !== 'claimed' || !result.attempt) {
    throw new TypeError('Expected a fresh durable install attempt')
  }
  return result.attempt
}

async function precommitDispatchAttempt(
  durable: ReturnType<
    typeof createSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingV1
  >,
  attempt: Awaited<ReturnType<typeof claimDispatchAttempt>>,
  credentialIssuer: SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1,
  credentialLease: SupabaseManagementDatabaseWriteCredentialLeaseV1
) {
  return durable.authority.precommit({
    attempt,
    credentialIssuer,
    credentialLease,
    progressRecordedAt: PROGRESS_RECORDED_AT,
    outcomeUnknownAt: OUTCOME_UNKNOWN_AT
  })
}

async function createPreparedDispatchHarness(
  fetcher: SupabaseManagementBackfillDatabaseCASLedgerInstallFetch,
  releaseId = 'cas-ledger-install-transport-test'
) {
  const fixture = await createBackfillDatabaseCASLedgerInstallFixtureV1()
  const harness = await createTestingTransport(fetcher)
  const credentialLease = await issueCredentialLease(fixture.context, harness.credentials)
  const attempt = await claimDispatchAttempt(harness.durable, fixture.context, releaseId)
  const prepared = await harness.transport.prepareMigration(fixture.context)
  const precommit = await precommitDispatchAttempt(
    harness.durable,
    attempt,
    harness.credentials.issuer,
    credentialLease
  )
  return Object.freeze({ ...harness, fixture, credentialLease, attempt, prepared, precommit })
}

async function transportError(
  operation: Promise<unknown>
): Promise<SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError> {
  try {
    await operation
  } catch (cause) {
    if (cause instanceof SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError) {
      return cause
    }
  }
  throw new TypeError('Expected a typed CAS-ledger migration transport error')
}

describe('Supabase Management backfill database CAS ledger install transport', () => {
  test('accepts only a genuine one-shot context and prepares one exact project authority check', async () => {
    const forgedFixture = await createBackfillDatabaseCASLedgerInstallFixtureV1()
    const clone = structuredClone(forgedFixture.context)
    let forgedFetchCalls = 0
    const { transport: forgedTransport } = await createTestingTransport(async () => {
      forgedFetchCalls += 1
      return projectResponse()
    })
    expect(await transportError(forgedTransport.prepareMigration(clone))).toMatchObject({
      code: 'invalid-request',
      outcome: 'not-dispatched'
    })
    expect(forgedFetchCalls).toBe(0)

    const fixture = await createBackfillDatabaseCASLedgerInstallFixtureV1()
    const requests: RecordedRequest[] = []
    const { transport } = await createTestingTransport(successfulFetcher(requests))
    const prepared = await transport.prepareMigration(fixture.context)

    expect(Object.keys(transport)).toEqual(['prepareMigration'])
    expect(Object.isFrozen(transport)).toBe(true)
    expect(isTestingSupabaseManagementBackfillDatabaseCASLedgerInstallTransportV1(transport)).toBe(
      true
    )
    expect(Object.keys(prepared)).toEqual(['projectAuthority', 'migration', 'dispatch', 'dispose'])
    expect(Object.isFrozen(prepared)).toBe(true)
    expect(prepared.projectAuthority).toEqual({
      projectRef: BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
      organizationId: BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
      writeGrantGeneration: BACKFILL_DATABASE_CAS_LEDGER_INSTALL_WRITE_GRANT
    })
    expect(Object.isFrozen(prepared.projectAuthority)).toBe(true)
    expect(prepared.migration).toEqual({
      endpoint: MIGRATION_URL,
      name: fixture.installReview.review.migration.name,
      baseSqlDigest: fixture.sourceReview.review.bindings.sqlDigest,
      marker: fixture.installReview.review.installationMarker.marker,
      markerBindingDigest: fixture.installReview.review.bindings.markerBindingDigest,
      installSqlDigest: fixture.installReview.review.bindings.installSqlDigest,
      sqlByteLength: new TextEncoder().encode(fixture.installReview.installSql).byteLength,
      exactReviewedSql: true,
      requestBodyKeys: ['query', 'name'],
      journalPermitRequired: true,
      journalPermitAvailable: true
    })
    expect(prepared.migration).not.toHaveProperty('sqlDigest')
    expect(Object.isFrozen(prepared.migration)).toBe(true)
    expect(Object.isFrozen(prepared.migration.requestBodyKeys)).toBe(true)
    expect(requests.map(({ url }) => url)).toEqual([PROJECT_URL])
    expect(requests.map(({ init }) => init.method)).toEqual(['GET'])
    expect(requests[0]?.init.credentials).toBe('omit')
    expect(requests[0]?.init.redirect).toBe('error')
    expect(requests[0]?.maximum).toBe(
      SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_LIMITS.maxProjectResponseBytes
    )
    expect(requests[0]?.timeout).toBe(
      SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_LIMITS.requestTimeoutMs
    )
    expect(new Headers(requests[0]?.init.headers).get('authorization')).toBe(
      `Bearer ${BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT}`
    )

    expect(prepared.dispose()).toBe(true)
    expect(prepared.dispose()).toBe(false)
    expect(requests.map(({ url }) => url)).toEqual([PROJECT_URL])
    expect(requests.some(({ url }) => url === MIGRATION_URL)).toBe(false)
    expect(requests.some(({ init }) => init.method === 'POST')).toBe(false)

    let replayFetchCalls = 0
    const { transport: replayTransport } = await createTestingTransport(async () => {
      replayFetchCalls += 1
      return projectResponse()
    })
    expect(await transportError(replayTransport.prepareMigration(fixture.context))).toMatchObject({
      code: 'invalid-request',
      outcome: 'not-dispatched'
    })
    expect(replayFetchCalls).toBe(0)
  })

  test('consumes one durable permit and current credential lease before one fixed migration POST', async () => {
    const fixture = await createBackfillDatabaseCASLedgerInstallFixtureV1()
    const requests: RecordedRequest[] = []
    const fetcher: SupabaseManagementBackfillDatabaseCASLedgerInstallFetch = async (
      input,
      init,
      maximum,
      timeout
    ) => {
      const url = String(input)
      requests.push({ url, init: init ?? {}, maximum, timeout })
      return init?.method === 'POST' ? jsonResponse({}, 200, url) : projectResponse(url)
    }
    const harness = await createTestingTransport(fetcher)
    const credentialLease = await issueCredentialLease(fixture.context, harness.credentials)
    const attempt = await claimDispatchAttempt(harness.durable, fixture.context)
    const prepared = await harness.transport.prepareMigration(fixture.context)
    const precommit = await precommitDispatchAttempt(
      harness.durable,
      attempt,
      harness.credentials.issuer,
      credentialLease
    )
    const accepted = await prepared.dispatch({
      permit: precommit.permit,
      credentialLease
    })

    expect(accepted).toMatchObject({
      status: 'verification-required',
      httpStatus: 200,
      managementRequestReturned200: true,
      migrationName: fixture.installReview.review.migration.name,
      installReviewDigest: fixture.installReview.installReviewDigest,
      sourceReviewDigest: fixture.sourceReview.reviewDigest,
      baseSqlDigest: fixture.sourceReview.review.bindings.sqlDigest,
      marker: fixture.installReview.review.installationMarker.marker,
      markerBindingDigest: fixture.installReview.review.bindings.markerBindingDigest,
      installSqlDigest: fixture.installReview.review.bindings.installSqlDigest,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false
    })
    expect(accepted).not.toHaveProperty('migrationAccepted')
    expect(requests.map(({ url }) => url)).toEqual([PROJECT_URL, PROJECT_URL, MIGRATION_URL])
    expect(requests.map(({ init }) => init.method)).toEqual(['GET', 'GET', 'POST'])
    const post = requests[2]
    expect(post?.init.credentials).toBe('omit')
    expect(post?.init.redirect).toBe('error')
    expect(post?.maximum).toBe(
      SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_LIMITS.maxMigrationResponseBytes
    )
    expect(new Headers(post?.init.headers)).toEqual(
      new Headers({
        accept: 'application/json',
        authorization: `Bearer ${BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT}`,
        'content-type': 'application/json'
      })
    )
    const body: unknown = JSON.parse(String(post?.init.body))
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new TypeError('Expected the fixed migration body object')
    }
    expect(Object.keys(body)).toEqual(['query', 'name'])
    expect(body).toEqual({
      query: fixture.installReview.installSql,
      name: fixture.installReview.review.migration.name
    })
    expect(JSON.stringify(body)).not.toContain(BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT)
    expect(prepared.dispose()).toBe(false)
  })

  test('rejects an A permit cross-wired into a distinct B install snapshot before GET2 or POST', async () => {
    const fixtureA = await createBackfillDatabaseCASLedgerInstallFixtureV1()
    const fixtureB = await createBackfillDatabaseCASLedgerInstallFixtureV1()
    expect(fixtureA.installReview.review.bindings.installSqlDigest).not.toBe(
      fixtureB.installReview.review.bindings.installSqlDigest
    )
    const requests: RecordedRequest[] = []
    const harness = await createTestingTransport(successfulFetcher(requests))
    const leaseA = await issueCredentialLease(fixtureA.context, harness.credentials)
    const leaseB = await issueCredentialLease(fixtureB.context, harness.credentials)
    const attemptA = await claimDispatchAttempt(
      harness.durable,
      fixtureA.context,
      'cas-ledger-install-cross-wire-a'
    )
    const preparedB = await harness.transport.prepareMigration(fixtureB.context)
    const precommitA = await precommitDispatchAttempt(
      harness.durable,
      attemptA,
      harness.credentials.issuer,
      leaseA
    )

    expect(
      await transportError(
        preparedB.dispatch({ permit: precommitA.permit, credentialLease: leaseB })
      )
    ).toMatchObject({ code: 'journal-permit-invalid', outcome: 'not-dispatched' })
    expect(requests.map(({ url }) => url)).toEqual([PROJECT_URL])
    expect(requests.some(({ init }) => init.method === 'POST')).toBe(false)
  })

  test('rejects a cloned durable permit before GET2 or POST', async () => {
    const requests: RecordedRequest[] = []
    const current = await createPreparedDispatchHarness(
      successfulFetcher(requests),
      'cloned-durable-permit'
    )
    expect(
      await transportError(
        current.prepared.dispatch({
          permit: structuredClone(current.precommit.permit),
          credentialLease: current.credentialLease
        })
      )
    ).toMatchObject({ code: 'journal-permit-invalid', outcome: 'not-dispatched' })
    expect(requests.map(({ init }) => init.method)).toEqual(['GET'])
  })

  test('rejects cloned or forged permit consumers at the testing factory boundary', async () => {
    const credentials = await createCredentialHarness()
    const durable = createSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingV1({
      journal: createMemoryBackendHostReleaseDispatchJournal()
    })
    const base = {
      personalAccessToken: BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT,
      writeGrantGeneration: BACKFILL_DATABASE_CAS_LEDGER_INSTALL_WRITE_GRANT,
      fetcher: successfulFetcher(),
      credentialIssuer: credentials.issuer
    }
    expect(() =>
      createSupabaseManagementBackfillDatabaseCASLedgerInstallTransportForTestingV1({
        ...base,
        permitConsumer: { ...durable.permitConsumer }
      })
    ).toThrow(SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError)
    expect(() =>
      createSupabaseManagementBackfillDatabaseCASLedgerInstallTransportForTestingV1({
        ...base,
        permitConsumer: {
          format: durable.permitConsumer.format,
          version: 1,
          provenance: 'testing',
          consume: async () => true
        }
      } as CreateSupabaseManagementBackfillDatabaseCASLedgerInstallTransportForTestingOptionsV1)
    ).toThrow(SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError)
  })

  test('treats async rejection, HTTP failure, and malformed 200 as outcome unknown', async () => {
    const scenarios = [
      {
        expectedCode: 'network-failed',
        post: (_url: string) => Promise.reject(new Error(BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT))
      },
      {
        expectedCode: 'http-error',
        post: (url: string) => Promise.resolve(jsonResponse({}, 403, url))
      },
      {
        expectedCode: 'invalid-response',
        post: (url: string) => Promise.resolve(jsonResponse({ accepted: true }, 200, url))
      },
      {
        expectedCode: 'http-error',
        post: (_url: string) => Promise.resolve(jsonResponse({}, 200))
      }
    ] as const

    for (const [index, scenario] of scenarios.entries()) {
      const requests: RecordedRequest[] = []
      const fetcher = ((input, init, maximum, timeout) => {
        const url = String(input)
        requests.push({ url, init: init ?? {}, maximum, timeout })
        return init?.method === 'POST' ? scenario.post(url) : Promise.resolve(projectResponse(url))
      }) satisfies SupabaseManagementBackfillDatabaseCASLedgerInstallFetch
      const current = await createPreparedDispatchHarness(fetcher, `post-failure-${index}`)
      const error = await transportError(
        current.prepared.dispatch({
          permit: current.precommit.permit,
          credentialLease: current.credentialLease
        })
      )
      expect(error).toMatchObject({
        code: scenario.expectedCode,
        outcome: 'outcome-unknown'
      })
      expect(requests.map(({ init }) => init.method)).toEqual(['GET', 'GET', 'POST'])
      expect(
        consumeSupabaseManagementBackfillDatabaseCASLedgerInstallKnownNotDispatchedProofV1(error)
      ).toBeNull()
      expect(String(error)).not.toContain(BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT)
      expect(JSON.stringify(error)).not.toContain(BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT)
    }
  })

  test('treats a synchronous injected POST throw as outcome unknown and burns replay', async () => {
    const requests: RecordedRequest[] = []
    const fetcher = ((input, init, maximum, timeout) => {
      const url = String(input)
      requests.push({ url, init: init ?? {}, maximum, timeout })
      if (init?.method === 'POST') throw new Error(BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT)
      return Promise.resolve(projectResponse(url))
    }) satisfies SupabaseManagementBackfillDatabaseCASLedgerInstallFetch
    const current = await createPreparedDispatchHarness(fetcher, 'sync-post-throw')
    expect(
      await transportError(
        current.prepared.dispatch({
          permit: current.precommit.permit,
          credentialLease: current.credentialLease
        })
      )
    ).toMatchObject({ code: 'network-failed', outcome: 'outcome-unknown' })
    expect(requests.map(({ init }) => init.method)).toEqual(['GET', 'GET', 'POST'])
    expect(
      await transportError(
        current.prepared.dispatch({
          permit: current.precommit.permit,
          credentialLease: current.credentialLease
        })
      )
    ).toMatchObject({ code: 'dispatch-already-used', outcome: 'outcome-unknown' })
    expect(requests.map(({ init }) => init.method)).toEqual(['GET', 'GET', 'POST'])
  })

  test('treats a side-effecting non-Promise POST return as outcome unknown', async () => {
    const requests: RecordedRequest[] = []
    const fetcher = ((
      input: RequestInfo | URL,
      init: RequestInit | undefined,
      maximum: number,
      timeout: number
    ) => {
      const url = String(input)
      requests.push({ url, init: init ?? {}, maximum, timeout })
      if (init?.method === 'POST') return jsonResponse({}, 200, url)
      return Promise.resolve(projectResponse(url))
    }) as SupabaseManagementBackfillDatabaseCASLedgerInstallFetch
    const current = await createPreparedDispatchHarness(fetcher, 'non-promise-post')
    expect(
      await transportError(
        current.prepared.dispatch({
          permit: current.precommit.permit,
          credentialLease: current.credentialLease
        })
      )
    ).toMatchObject({ code: 'invalid-response', outcome: 'outcome-unknown' })
    expect(requests.map(({ init }) => init.method)).toEqual(['GET', 'GET', 'POST'])
  })

  test('drops the probe and releases the credential gate while the POST promise is pending', async () => {
    let resolvePost: ((response: Response) => void) | null = null
    let reportPostStarted: (() => void) | null = null
    const postStarted = new Promise<void>((resolve) => {
      reportPostStarted = resolve
    })
    const pendingPost = new Promise<Response>((resolve) => {
      resolvePost = resolve
    })
    const requests: RecordedRequest[] = []
    const fetcher: SupabaseManagementBackfillDatabaseCASLedgerInstallFetch = (
      input,
      init,
      maximum,
      timeout
    ) => {
      const url = String(input)
      requests.push({ url, init: init ?? {}, maximum, timeout })
      if (init?.method === 'POST') {
        reportPostStarted?.()
        return pendingPost
      }
      return Promise.resolve(projectResponse(url))
    }
    const current = await createPreparedDispatchHarness(fetcher, 'pending-post')
    const dispatch = current.prepared.dispatch({
      permit: current.precommit.permit,
      credentialLease: current.credentialLease
    })
    await postStarted

    await setSupabaseManagementDatabaseWritePat(
      'sbp_rotated_while_post_pending_000003',
      current.credentials.services
    )
    expect(
      await transportError(
        current.prepared.dispatch({
          permit: current.precommit.permit,
          credentialLease: current.credentialLease
        })
      )
    ).toMatchObject({ code: 'dispatch-already-used', outcome: 'outcome-unknown' })
    expect(requests.map(({ init }) => init.method)).toEqual(['GET', 'GET', 'POST'])

    resolvePost?.(jsonResponse({}, 200, MIGRATION_URL))
    expect(await dispatch).toMatchObject({
      status: 'verification-required',
      managementRequestReturned200: true
    })
  })

  test('rejects GET2 project drift and credential rotation before POST', async () => {
    let reads = 0
    const driftRequests: RecordedRequest[] = []
    const driftFetcher: SupabaseManagementBackfillDatabaseCASLedgerInstallFetch = async (
      input,
      init,
      maximum,
      timeout
    ) => {
      const url = String(input)
      driftRequests.push({ url, init: init ?? {}, maximum, timeout })
      reads += 1
      return reads === 1
        ? projectResponse(url)
        : projectResponse(url, { organization_id: 'different-organization' })
    }
    const drift = await createPreparedDispatchHarness(driftFetcher, 'project-drift')
    const driftError = await transportError(
      drift.prepared.dispatch({
        permit: drift.precommit.permit,
        credentialLease: drift.credentialLease
      })
    )
    expect(driftError).toMatchObject({ code: 'invalid-authority', outcome: 'not-dispatched' })
    expect(driftRequests.map(({ init }) => init.method)).toEqual(['GET', 'GET'])
    const proof =
      consumeSupabaseManagementBackfillDatabaseCASLedgerInstallKnownNotDispatchedProofV1(driftError)
    expect(proof).not.toBeNull()
    expect(JSON.stringify(driftError)).not.toContain('proof')
    expect(
      consumeSupabaseManagementBackfillDatabaseCASLedgerInstallKnownNotDispatchedProofV1(driftError)
    ).toBeNull()
    if (!proof) throw new TypeError('Expected a durable known-not-dispatched proof')
    expect(
      await drift.durable.authority.settleKnownNotDispatched({
        attempt: drift.attempt,
        proof,
        recordedAt: NOT_DISPATCHED_RECORDED_AT
      })
    ).toMatchObject({
      status: 'not-dispatched',
      automaticRetryAllowed: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false
    })

    const rotatedRequests: RecordedRequest[] = []
    const rotated = await createPreparedDispatchHarness(
      successfulFetcher(rotatedRequests),
      'credential-rotated'
    )
    await setSupabaseManagementDatabaseWritePat(
      'sbp_rotated_write_token_canary_000002',
      rotated.credentials.services
    )
    expect(
      await transportError(
        rotated.prepared.dispatch({
          permit: rotated.precommit.permit,
          credentialLease: rotated.credentialLease
        })
      )
    ).toMatchObject({ code: 'invalid-authority', outcome: 'not-dispatched' })
    expect(rotatedRequests.map(({ init }) => init.method)).toEqual(['GET', 'GET'])
  })

  test('rejects a cloned testing credential issuer at factory construction', async () => {
    const credentials = await createCredentialHarness()
    const durable = createSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingV1({
      journal: createMemoryBackendHostReleaseDispatchJournal()
    })
    const requests: RecordedRequest[] = []
    expect(
      await transportError(
        Promise.resolve().then(() =>
          createSupabaseManagementBackfillDatabaseCASLedgerInstallTransportForTestingV1({
            personalAccessToken: BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT,
            writeGrantGeneration: BACKFILL_DATABASE_CAS_LEDGER_INSTALL_WRITE_GRANT,
            fetcher: successfulFetcher(requests),
            permitConsumer: durable.permitConsumer,
            credentialIssuer: structuredClone(credentials.issuer)
          })
        )
      )
    ).toMatchObject({ code: 'invalid-authority', outcome: 'not-dispatched' })
    expect(requests).toEqual([])
  })

  test('rejects cloned, accessor-backed, or digest-tampered dispatch data before GET', async () => {
    const clonedFixture = await createBackfillDatabaseCASLedgerInstallFixtureV1()
    const tamperedClone = {
      ...structuredClone(clonedFixture.context),
      baseSqlDigest: clonedFixture.context.installSqlDigest
    }
    let cloneFetchCalls = 0
    const { transport: cloneTransport } = await createTestingTransport(async () => {
      cloneFetchCalls += 1
      return projectResponse()
    })
    expect(await transportError(cloneTransport.prepareMigration(tamperedClone))).toMatchObject({
      code: 'invalid-request',
      outcome: 'not-dispatched'
    })
    expect(cloneFetchCalls).toBe(0)

    const accessorFixture = await createBackfillDatabaseCASLedgerInstallFixtureV1()
    let accessorReads = 0
    const accessorContext = Object.create(null) as typeof accessorFixture.context
    Object.defineProperty(accessorContext, 'marker', {
      enumerable: true,
      get: () => {
        accessorReads += 1
        return accessorFixture.context.marker
      }
    })
    const { transport: accessorTransport } = await createTestingTransport(successfulFetcher())
    expect(await transportError(accessorTransport.prepareMigration(accessorContext))).toMatchObject(
      { code: 'invalid-request', outcome: 'not-dispatched' }
    )
    expect(accessorReads).toBe(0)

    const digestFixture = await createBackfillDatabaseCASLedgerInstallFixtureV1()
    let digestFetchCalls = 0
    const { transport: digestTransport } = await createTestingTransport(async () => {
      digestFetchCalls += 1
      return projectResponse()
    })
    const digestSpy = spyOn(crypto.subtle, 'digest').mockImplementation(
      async () => new Uint8Array(32).buffer
    )
    try {
      expect(
        await transportError(digestTransport.prepareMigration(digestFixture.context))
      ).toMatchObject({ code: 'invalid-request', outcome: 'not-dispatched' })
    } finally {
      digestSpy.mockRestore()
    }
    expect(digestFetchCalls).toBe(0)
  })

  test('binds the operation credential generation before the first network request', async () => {
    const fixture = await createBackfillDatabaseCASLedgerInstallFixtureV1()
    let fetchCalls = 0
    const { transport } = await createTestingTransport(
      async () => {
        fetchCalls += 1
        return projectResponse()
      },
      { writeGrantGeneration: '523e4567-e89b-42d3-a456-426614174000' }
    )

    expect(await transportError(transport.prepareMigration(fixture.context))).toMatchObject({
      code: 'invalid-authority',
      outcome: 'not-dispatched'
    })
    expect(fetchCalls).toBe(0)
  })

  test('rejects caller endpoint or SQL lookalikes without reading accessors or leaking the PAT', async () => {
    const credentials = await createCredentialHarness()
    const durable = createSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingV1({
      journal: createMemoryBackendHostReleaseDispatchJournal()
    })
    let endpointReads = 0
    let sqlReads = 0
    const options = {
      personalAccessToken: BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT,
      writeGrantGeneration: BACKFILL_DATABASE_CAS_LEDGER_INSTALL_WRITE_GRANT,
      fetcher: successfulFetcher(),
      permitConsumer: durable.permitConsumer,
      credentialIssuer: credentials.issuer,
      get endpoint() {
        endpointReads += 1
        throw new TypeError('Caller endpoint must remain unread')
      },
      get sql() {
        sqlReads += 1
        throw new TypeError('Caller SQL must remain unread')
      }
    }
    let error: unknown
    try {
      createSupabaseManagementBackfillDatabaseCASLedgerInstallTransportForTestingV1(
        options as CreateSupabaseManagementBackfillDatabaseCASLedgerInstallTransportForTestingOptionsV1
      )
    } catch (cause) {
      error = cause
    }
    expect(error).toBeInstanceOf(SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError)
    expect(endpointReads).toBe(0)
    expect(sqlReads).toBe(0)
    expect(JSON.stringify(error)).not.toContain(BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT)
    expect(String(error)).not.toContain(BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT)
  })

  test('snapshots only own data options and never evaluates authority accessors', async () => {
    const credentials = await createCredentialHarness()
    const durable = createSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingV1({
      journal: createMemoryBackendHostReleaseDispatchJournal()
    })
    let tokenGetterReads = 0
    const accessorOptions = {
      get personalAccessToken() {
        tokenGetterReads += 1
        return BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT
      },
      writeGrantGeneration: BACKFILL_DATABASE_CAS_LEDGER_INSTALL_WRITE_GRANT,
      fetcher: successfulFetcher(),
      permitConsumer: durable.permitConsumer,
      credentialIssuer: credentials.issuer
    } as CreateSupabaseManagementBackfillDatabaseCASLedgerInstallTransportForTestingOptionsV1

    expect(() =>
      createSupabaseManagementBackfillDatabaseCASLedgerInstallTransportForTestingV1(accessorOptions)
    ).toThrow(SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError)
    expect(tokenGetterReads).toBe(0)

    const inherited = Object.create({
      personalAccessToken: BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT
    }) as CreateSupabaseManagementBackfillDatabaseCASLedgerInstallTransportForTestingOptionsV1
    Object.assign(inherited, {
      writeGrantGeneration: BACKFILL_DATABASE_CAS_LEDGER_INSTALL_WRITE_GRANT,
      fetcher: successfulFetcher(),
      permitConsumer: durable.permitConsumer,
      credentialIssuer: credentials.issuer
    })
    expect(() =>
      createSupabaseManagementBackfillDatabaseCASLedgerInstallTransportForTestingV1(inherited)
    ).toThrow(SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError)
  })

  test('bounds authority responses and classifies every pre-POST failure as not dispatched', async () => {
    expect(
      await transportError(
        createTestingTransport(successfulFetcher(), { personalAccessToken: 'short' })
      )
    ).toMatchObject({
      code: 'invalid-authority',
      outcome: 'not-dispatched'
    })

    const oversizedFixture = await createBackfillDatabaseCASLedgerInstallFixtureV1()
    const { transport: oversized } = await createTestingTransport(async (input) =>
      withURL(
        new Response('{}', {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'content-length': String(
              SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_LIMITS.maxProjectResponseBytes +
                1
            )
          }
        }),
        String(input)
      )
    )
    expect(
      await transportError(oversized.prepareMigration(oversizedFixture.context))
    ).toMatchObject({
      code: 'response-too-large',
      outcome: 'not-dispatched'
    })

    const transferredFixture = await createBackfillDatabaseCASLedgerInstallFixtureV1()
    const { transport: transferred } = await createTestingTransport(async (input) =>
      projectResponse(String(input), { organization_id: 'different-organization' })
    )
    expect(
      await transportError(transferred.prepareMigration(transferredFixture.context))
    ).toMatchObject({ code: 'invalid-authority', outcome: 'not-dispatched' })

    const abortedFixture = await createBackfillDatabaseCASLedgerInstallFixtureV1()
    const controller = new AbortController()
    controller.abort()
    let fetchCalls = 0
    const { transport: aborted } = await createTestingTransport(
      async () => {
        fetchCalls += 1
        return projectResponse()
      },
      { signal: controller.signal }
    )
    expect(await transportError(aborted.prepareMigration(abortedFixture.context))).toMatchObject({
      code: 'aborted',
      outcome: 'not-dispatched'
    })
    expect(fetchCalls).toBe(0)
  })
})
