/* oxlint-disable eslint/max-lines -- One end-to-end Host matrix covers durable dispatch and proof-only settlement. */
import { describe, expect, test } from 'bun:test'

import { createMemoryBackendHostReleaseDispatchJournal } from '@/app/plugins/host/deployment/backend/release-journal'
import {
  consumeTrustedSupabaseBackfillWriteBarrierAppliedReconciliationV1,
  dispatchSupabaseBackfillWriteBarrierInstallV1,
  reconcileSupabaseBackfillWriteBarrierInstallV1,
  SupabaseBackfillWriteBarrierInstallControllerError,
  trustedSupabaseBackfillWriteBarrierAppliedReconciliationV1,
  type SupabaseBackfillWriteBarrierInstallControllerErrorCode
} from '@/app/plugins/host/deployment/supabase/backfill/write-barrier/install-controller'
import type { SupabaseBackfillWriteBarrierVerificationV1 } from '@/app/plugins/host/deployment/supabase/backfill/write-barrier/verifier'
import {
  createSupabaseManagementBackfillWriteBarrierInstallTransport,
  type SupabaseManagementBackfillWriteBarrierInstallFetch
} from '@/app/plugins/host/deployment/supabase/management/backfill/write-barrier-install-transport'

import {
  BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
  BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
  createBackfillWriteBarrierInstallFixture,
  createBackfillWriteBarrierVerificationFixture
} from './helpers'

const PAT = 'sbp_controller_write_barrier_secret_canary_1234567890'
const PROJECT_URL = `https://api.supabase.com/v1/projects/${BACKFILL_INSTALL_FIXTURE_PROJECT_REF}`
const MIGRATION_URL = `${PROJECT_URL}/database/migrations`

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

function projectResponse(url: string, accountId = BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID): Response {
  return jsonResponse(
    {
      ref: BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
      organization_id: accountId,
      name: 'Backfill staging'
    },
    200,
    url
  )
}

function clock(start = Date.parse('2026-09-04T03:00:00.000Z')): () => string {
  let current = start
  return () => {
    const result = new Date(current).toISOString()
    current += 1_000
    return result
  }
}

async function controllerError(
  operation: Promise<unknown>,
  code: SupabaseBackfillWriteBarrierInstallControllerErrorCode
): Promise<SupabaseBackfillWriteBarrierInstallControllerError> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillWriteBarrierInstallControllerError)
    const error = cause as SupabaseBackfillWriteBarrierInstallControllerError
    expect(error.code).toBe(code)
    return error
  }
  throw new TypeError(`Expected controller error ${code}`)
}

describe('Supabase backfill write-barrier durable install controller', () => {
  test('persists claim, evidence, and unknown settlement before POST, then settles only an installed proof', async () => {
    const fixture = await createBackfillWriteBarrierInstallFixture()
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    let postBoundaryObserved = false
    const fetcher: SupabaseManagementBackfillWriteBarrierInstallFetch = async (input, init) => {
      const url = String(input)
      if (init?.method === 'GET') return projectResponse(url)
      expect(url).toBe(MIGRATION_URL)
      const unresolved = await journal.listUnresolved()
      expect(unresolved).toHaveLength(1)
      expect(unresolved[0]?.outcome).toBe('outcome-unknown')
      const evidence = await journal.readEvidence(unresolved[0]?.singleFlightKey ?? '')
      expect(evidence?.phase).toBe('progress')
      expect(JSON.parse(evidence?.payload ?? '{}')).toMatchObject({
        stage: 'project-authority-confirmed',
        installDigest: fixture.context.installDigest,
        automaticRetryAllowed: false
      })
      postBoundaryObserved = true
      return jsonResponse({}, 200, url)
    }
    const transport = createSupabaseManagementBackfillWriteBarrierInstallTransport({
      personalAccessToken: PAT,
      fetcher
    })
    const dispatched = await dispatchSupabaseBackfillWriteBarrierInstallV1({
      context: fixture.context,
      transport,
      journal,
      releaseId: 'barrier-release-1',
      ownerId: 'barrier-owner-1',
      now: clock()
    })

    expect(postBoundaryObserved).toBe(true)
    expect(dispatched).toMatchObject({
      status: 'verification-required',
      automaticRetryAllowed: false,
      confirmation: {
        status: 200,
        migrationName: fixture.context.migrationName,
        installDigest: fixture.context.installDigest
      },
      claim: { outcome: 'outcome-unknown' }
    })
    const acceptedEvidence = await journal.readEvidence(dispatched.singleFlightKey)
    expect(JSON.parse(acceptedEvidence?.payload ?? '{}')).toMatchObject({
      stage: 'migration-accepted-verification-required',
      reviewDigest: fixture.context.reviewDigest,
      absentVerificationDigest: fixture.context.verificationDigest,
      installDigest: fixture.context.installDigest,
      sourceLedgerBound: false
    })

    const installed = await createBackfillWriteBarrierVerificationFixture(fixture, 'installed')
    const reconciled = await reconcileSupabaseBackfillWriteBarrierInstallV1({
      context: fixture.context,
      installedVerification: installed,
      journal,
      now: clock(Date.parse('2026-09-04T04:00:00.000Z'))
    })
    expect(reconciled).toMatchObject({
      status: 'applied',
      automaticRetryAllowed: false,
      constraintOid: '50003',
      code: null,
      claim: { outcome: 'applied', code: null }
    })
    const trustedApplied = trustedSupabaseBackfillWriteBarrierAppliedReconciliationV1(
      reconciled,
      fixture.context
    )
    expect(trustedApplied).toMatchObject({
      installedEvidence: {
        verificationDigest: installed.verificationDigest,
        constraintOid: '50003',
        snapshotMarker: installed.snapshotMarker,
        observedAt: installed.observedAt,
        serverVersionNum: installed.serverVersionNum
      }
    })
    expect(trustedApplied?.context).toBe(fixture.context)
    expect(trustedApplied?.result).toBe(reconciled)
    expect(trustedApplied?.sourceReview).toBe(fixture.review)
    expect(trustedApplied?.writeAuthority).toEqual(fixture.writeAuthority)
    expect(trustedApplied?.stagingTarget).toEqual(fixture.stagingBinding)
    expect(trustedApplied?.inspection.catalog.table.oid).toBe(
      fixture.review.review.address.tableOid
    )
    expect(trustedApplied?.subject.migration.entity.table).toBe(
      trustedApplied?.inspection.catalog.table.name
    )
    expect(trustedApplied?.subject.migration.entity.marker).toBe(
      trustedApplied?.inspection.catalog.table.marker
    )
    expect(Object.isFrozen(trustedApplied)).toBe(true)
    expect(Object.isFrozen(trustedApplied?.installedEvidence)).toBe(true)
    expect(
      trustedSupabaseBackfillWriteBarrierAppliedReconciliationV1(
        structuredClone(reconciled),
        fixture.context
      )
    ).toBeNull()
    expect(
      trustedSupabaseBackfillWriteBarrierAppliedReconciliationV1(
        reconciled,
        structuredClone(fixture.context)
      )
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillWriteBarrierAppliedReconciliationV1(reconciled, fixture.context)
    ).toBe(trustedApplied)
    expect(
      consumeTrustedSupabaseBackfillWriteBarrierAppliedReconciliationV1(reconciled, fixture.context)
    ).toBeNull()
    expect(
      trustedSupabaseBackfillWriteBarrierAppliedReconciliationV1(reconciled, fixture.context)
    ).toBe(trustedApplied)
    const finalEvidence = await journal.readEvidence(reconciled.singleFlightKey)
    expect(finalEvidence?.phase).toBe('final')
    expect(JSON.parse(finalEvidence?.payload ?? '{}')).toMatchObject({
      stage: 'installed-proof-observed',
      installedVerificationDigest: installed.verificationDigest,
      constraintOid: '50003',
      reviewDigest: fixture.review.reviewDigest,
      sqlDigest: fixture.installReview.review.artifact.digest
    })
  })

  test('settles a proven pre-POST rejection as failed and never calls the migration endpoint', async () => {
    const fixture = await createBackfillWriteBarrierInstallFixture()
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    let postCalls = 0
    const transport = createSupabaseManagementBackfillWriteBarrierInstallTransport({
      personalAccessToken: PAT,
      fetcher: async (input, init) => {
        const url = String(input)
        if (init?.method === 'POST') {
          postCalls += 1
          return jsonResponse({}, 200, url)
        }
        return projectResponse(url, 'different-organization')
      }
    })
    const result = await dispatchSupabaseBackfillWriteBarrierInstallV1({
      context: fixture.context,
      transport,
      journal,
      releaseId: 'barrier-release-2',
      ownerId: 'barrier-owner-2',
      now: clock()
    })

    expect(postCalls).toBe(0)
    expect(result).toMatchObject({
      status: 'not-dispatched',
      automaticRetryAllowed: false,
      claim: {
        outcome: 'failed',
        code: 'supabase-backfill-write-barrier-not-dispatched'
      }
    })
    const evidence = await journal.readEvidence(result.singleFlightKey)
    expect(evidence?.phase).toBe('final')
    expect(JSON.parse(evidence?.payload ?? '{}')).toMatchObject({
      stage: 'not-dispatched',
      installedVerificationDigest: null,
      constraintOid: null
    })
  })

  test('resumes a failed settlement from durable immutable not-dispatched evidence', async () => {
    const fixture = await createBackfillWriteBarrierInstallFixture()
    let rejectFailedSettlement = true
    const journal = createMemoryBackendHostReleaseDispatchJournal({
      beforeSettle() {
        if (rejectFailedSettlement) {
          rejectFailedSettlement = false
          throw new Error('simulated crash before failed settlement was persisted')
        }
      }
    })
    let fetchCalls = 0
    const firstTransport = createSupabaseManagementBackfillWriteBarrierInstallTransport({
      personalAccessToken: PAT,
      fetcher: async (input) => {
        fetchCalls += 1
        return projectResponse(String(input), 'different-organization')
      }
    })
    const first = await dispatchSupabaseBackfillWriteBarrierInstallV1({
      context: fixture.context,
      transport: firstTransport,
      journal,
      releaseId: 'barrier-release-not-dispatched-recovery-1',
      ownerId: 'barrier-owner-not-dispatched-recovery-1',
      now: clock()
    })

    expect(first.status).toBe('reconciliation-required')
    expect((await journal.read(first.singleFlightKey))?.outcome).toBe('pending')
    expect((await journal.readEvidence(first.singleFlightKey))?.phase).toBe('final')

    const restartedFixture = await createBackfillWriteBarrierInstallFixture()
    const retryTransport = createSupabaseManagementBackfillWriteBarrierInstallTransport({
      personalAccessToken: PAT,
      fetcher: async () => {
        fetchCalls += 1
        throw new TypeError('recovery must not reach transport')
      }
    })
    const recovered = await dispatchSupabaseBackfillWriteBarrierInstallV1({
      context: restartedFixture.context,
      transport: retryTransport,
      journal,
      releaseId: 'barrier-release-not-dispatched-recovery-2',
      ownerId: 'barrier-owner-not-dispatched-recovery-2',
      now: clock(Date.parse('2026-09-04T04:00:00.000Z'))
    })

    expect(recovered).toMatchObject({
      status: 'not-dispatched',
      automaticRetryAllowed: false,
      claim: { outcome: 'failed', code: 'supabase-backfill-write-barrier-not-dispatched' }
    })
    expect(fetchCalls).toBe(1)
  })

  test('keeps POST ambiguity unknown, refuses redispatch, and rejects non-genuine installed claims', async () => {
    const fixture = await createBackfillWriteBarrierInstallFixture()
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    let postCalls = 0
    const transport = createSupabaseManagementBackfillWriteBarrierInstallTransport({
      personalAccessToken: PAT,
      fetcher: async (input, init) => {
        const url = String(input)
        if (init?.method === 'GET') return projectResponse(url)
        postCalls += 1
        throw new Error(`ambiguous ${PAT}`)
      }
    })
    const first = await dispatchSupabaseBackfillWriteBarrierInstallV1({
      context: fixture.context,
      transport,
      journal,
      releaseId: 'barrier-release-3',
      ownerId: 'barrier-owner-3',
      now: clock()
    })
    expect(first).toMatchObject({
      status: 'outcome-unknown',
      automaticRetryAllowed: false,
      claim: { outcome: 'outcome-unknown' }
    })
    expect(postCalls).toBe(1)

    let redispatchFetchCalls = 0
    const neverUsedTransport = createSupabaseManagementBackfillWriteBarrierInstallTransport({
      personalAccessToken: PAT,
      fetcher: async () => {
        redispatchFetchCalls += 1
        throw new TypeError('must not redispatch')
      }
    })
    const second = await dispatchSupabaseBackfillWriteBarrierInstallV1({
      context: fixture.context,
      transport: neverUsedTransport,
      journal,
      releaseId: 'barrier-release-4',
      ownerId: 'barrier-owner-4',
      now: clock(Date.parse('2026-09-04T05:00:00.000Z'))
    })
    expect(second.status).toBe('reconciliation-required')
    expect(postCalls).toBe(1)
    expect(redispatchFetchCalls).toBe(0)

    const installed = await createBackfillWriteBarrierVerificationFixture(fixture, 'installed')
    await controllerError(
      reconcileSupabaseBackfillWriteBarrierInstallV1({
        context: fixture.context,
        installedVerification: structuredClone(
          installed
        ) as SupabaseBackfillWriteBarrierVerificationV1,
        journal,
        now: clock(Date.parse('2026-09-04T06:00:00.000Z'))
      }),
      'supabase-backfill-write-barrier-controller-installed-proof-invalid'
    )
    expect((await journal.read(first.singleFlightKey))?.outcome).toBe('outcome-unknown')
  })

  test('uses one project-wide unresolved scope even when the reviewed plan changes', async () => {
    const firstFixture = await createBackfillWriteBarrierInstallFixture({ batchSize: 250 })
    const changedFixture = await createBackfillWriteBarrierInstallFixture({ batchSize: 251 })
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    let postCalls = 0
    const transportFor = () =>
      createSupabaseManagementBackfillWriteBarrierInstallTransport({
        personalAccessToken: PAT,
        fetcher: async (input, init) => {
          const url = String(input)
          if (init?.method === 'GET') return projectResponse(url)
          postCalls += 1
          return jsonResponse({}, 200, url)
        }
      })

    const first = await dispatchSupabaseBackfillWriteBarrierInstallV1({
      context: firstFixture.context,
      transport: transportFor(),
      journal,
      releaseId: 'barrier-release-5',
      ownerId: 'barrier-owner-5',
      now: clock()
    })
    const changed = await dispatchSupabaseBackfillWriteBarrierInstallV1({
      context: changedFixture.context,
      transport: transportFor(),
      journal,
      releaseId: 'barrier-release-6',
      ownerId: 'barrier-owner-6',
      now: clock(Date.parse('2026-09-04T07:00:00.000Z'))
    })

    expect(first.status).toBe('verification-required')
    expect(changed).toMatchObject({
      status: 'reconciliation-required',
      automaticRetryAllowed: false,
      claim: null,
      code: 'supabase-backfill-write-barrier-unresolved-scope'
    })
    expect(changed.singleFlightKey).not.toBe(first.singleFlightKey)
    expect(changed.dispatchScopeKey).toBe(first.dispatchScopeKey)
    expect(postCalls).toBe(1)
  })
})
