/* oxlint-disable eslint/max-lines -- Focused red tests preserve the cross-layer dispatch invariants before the controller is hardened. */
import { describe, expect, test } from 'bun:test'

import { createMemoryBackendHostReleaseDispatchJournal } from '@/app/plugins/host/deployment/backend/release-journal'
import {
  consumeTrustedSupabaseBackfillWriteBarrierAppliedReconciliationV1,
  dispatchSupabaseBackfillWriteBarrierInstallV1,
  reconcileSupabaseBackfillWriteBarrierInstallV1,
  SupabaseBackfillWriteBarrierInstallControllerError,
  trustedSupabaseBackfillWriteBarrierAppliedReconciliationV1
} from '@/app/plugins/host/deployment/supabase/backfill/write-barrier/install-controller'
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

const PAT = 'sbp_backfill_barrier_red_test_canary_1234567890'

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

function successfulFetcher(
  onPost: () => void = () => undefined
): SupabaseManagementBackfillWriteBarrierInstallFetch {
  return async (input, init) => {
    const url = String(input)
    if (init?.method === 'GET') {
      return jsonResponse(
        {
          ref: BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
          organization_id: BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
          name: 'Backfill staging'
        },
        200,
        url
      )
    }
    onPost()
    return jsonResponse({}, 200, url)
  }
}

function transport(onPost: () => void = () => undefined) {
  return createSupabaseManagementBackfillWriteBarrierInstallTransport({
    personalAccessToken: PAT,
    fetcher: successfulFetcher(onPost)
  })
}

function clock(start = Date.parse('2026-09-04T10:00:00.000Z')): () => string {
  let current = start
  return () => {
    const result = new Date(current).toISOString()
    current += 1_000
    return result
  }
}

describe('Supabase backfill write-barrier install controller security red tests', () => {
  test('does not let a bare authorization context reach the migration POST without a journal-bound permit', async () => {
    const fixture = await createBackfillWriteBarrierInstallFixture()
    let postCalls = 0
    let rejected = false

    try {
      const prepared = await transport(() => {
        postCalls += 1
      }).prepareMigration(fixture.context)
      await prepared.dispatch()
    } catch {
      rejected = true
    }

    expect(rejected).toBe(true)
    expect(postCalls).toBe(0)
  })

  test('rejects a fingerprint-changed but otherwise valid journal state before the second GET or POST', async () => {
    const fixture = await createBackfillWriteBarrierInstallFixture()
    const journalHolder: {
      current: ReturnType<typeof createMemoryBackendHostReleaseDispatchJournal> | null
    } = { current: null }
    let evidenceChanged = false
    const journal = createMemoryBackendHostReleaseDispatchJournal({
      async afterSettle() {
        if (evidenceChanged) return
        const currentJournal = journalHolder.current
        if (!currentJournal) return
        const [claim] = await currentJournal.listUnresolved()
        if (!claim || claim.outcome !== 'outcome-unknown' || claim.settledAt === null) return
        const evidence = await currentJournal.readEvidence(claim.singleFlightKey)
        if (!evidence || evidence.phase !== 'progress') return
        evidenceChanged = true
        await currentJournal.recordEvidence({
          singleFlightKey: evidence.singleFlightKey,
          dispatchScopeKey: evidence.dispatchScopeKey,
          releaseId: evidence.releaseId,
          planDigest: evidence.planDigest,
          phase: evidence.phase,
          payload: evidence.payload,
          payloadDigest: evidence.payloadDigest,
          recordedAt: claim.settledAt
        })
      }
    })
    journalHolder.current = journal
    let getCalls = 0
    let postCalls = 0
    const installTransport = createSupabaseManagementBackfillWriteBarrierInstallTransport({
      personalAccessToken: PAT,
      fetcher: async (input, init) => {
        const url = String(input)
        if (init?.method === 'GET') {
          getCalls += 1
          return jsonResponse(
            {
              ref: BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
              organization_id: BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
              name: 'Backfill staging'
            },
            200,
            url
          )
        }
        postCalls += 1
        return jsonResponse({}, 200, url)
      }
    })

    const result = await dispatchSupabaseBackfillWriteBarrierInstallV1({
      context: fixture.context,
      transport: installTransport,
      journal,
      releaseId: 'red-fingerprint-change-release',
      ownerId: 'red-fingerprint-change-owner',
      now: clock()
    })

    expect(evidenceChanged).toBe(true)
    expect(result).toMatchObject({
      status: 'not-dispatched',
      code: 'supabase-backfill-write-barrier-not-dispatched',
      claim: { outcome: 'failed' }
    })
    expect(getCalls).toBe(1)
    expect(postCalls).toBe(0)
  })

  test('settles not-dispatched when the pre-POST unknown commit succeeds but its return is lost', async () => {
    const fixture = await createBackfillWriteBarrierInstallFixture()
    let settlementReturns = 0
    const journal = createMemoryBackendHostReleaseDispatchJournal({
      afterSettle() {
        settlementReturns += 1
        if (settlementReturns === 1) {
          throw new Error('simulated crash after pre-POST unknown settlement commit')
        }
      }
    })
    let getCalls = 0
    let postCalls = 0
    const installTransport = createSupabaseManagementBackfillWriteBarrierInstallTransport({
      personalAccessToken: PAT,
      fetcher: async (input, init) => {
        const url = String(input)
        if (init?.method === 'GET') {
          getCalls += 1
          return jsonResponse(
            {
              ref: BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
              organization_id: BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
              name: 'Backfill staging'
            },
            200,
            url
          )
        }
        postCalls += 1
        return jsonResponse({}, 200, url)
      }
    })

    const result = await dispatchSupabaseBackfillWriteBarrierInstallV1({
      context: fixture.context,
      transport: installTransport,
      journal,
      releaseId: 'red-pre-post-commit-gap-release',
      ownerId: 'red-pre-post-commit-gap-owner',
      now: clock()
    })

    expect(result).toMatchObject({
      status: 'not-dispatched',
      code: 'supabase-backfill-write-barrier-not-dispatched',
      claim: { outcome: 'failed' }
    })
    expect(await journal.readEvidence(result.singleFlightKey)).toMatchObject({ phase: 'final' })
    expect(getCalls).toBe(1)
    expect(postCalls).toBe(0)
  })

  test('does not settle applied from a genuine installed proof minted before the durable dispatch claim', async () => {
    const fixture = await createBackfillWriteBarrierInstallFixture()
    const proofBeforeDispatch = await createBackfillWriteBarrierVerificationFixture(
      fixture,
      'installed'
    )
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    const dispatched = await dispatchSupabaseBackfillWriteBarrierInstallV1({
      context: fixture.context,
      transport: transport(),
      journal,
      releaseId: 'red-stale-proof-release',
      ownerId: 'red-stale-proof-owner',
      now: clock()
    })

    expect(Date.parse(proofBeforeDispatch.observedAt)).toBeLessThan(
      Date.parse(dispatched.claim?.claimedAt ?? '')
    )

    let reconciliationStatus: string = 'rejected'
    try {
      reconciliationStatus = (
        await reconcileSupabaseBackfillWriteBarrierInstallV1({
          context: fixture.context,
          installedVerification: proofBeforeDispatch,
          journal,
          now: clock(Date.parse('2026-09-04T11:00:00.000Z'))
        })
      ).status
    } catch {
      // Rejecting a pre-dispatch proof is a valid fail-closed result.
      reconciliationStatus = 'rejected'
    }

    expect(reconciliationStatus).not.toBe('applied')
    expect((await journal.read(dispatched.singleFlightKey))?.outcome).toBe('outcome-unknown')
  })

  test('recovers an applied settlement after the durable commit succeeded but its return was lost', async () => {
    const fixture = await createBackfillWriteBarrierInstallFixture()
    let settlementReturns = 0
    const journal = createMemoryBackendHostReleaseDispatchJournal({
      afterSettle() {
        settlementReturns += 1
        if (settlementReturns === 2) {
          throw new Error('simulated crash after applied settlement was committed')
        }
      }
    })
    const dispatched = await dispatchSupabaseBackfillWriteBarrierInstallV1({
      context: fixture.context,
      transport: transport(),
      journal,
      releaseId: 'red-final-evidence-release',
      ownerId: 'red-final-evidence-owner',
      now: clock()
    })
    const firstProof = await createBackfillWriteBarrierVerificationFixture(fixture, 'installed')
    const first = await reconcileSupabaseBackfillWriteBarrierInstallV1({
      context: fixture.context,
      installedVerification: firstProof,
      journal,
      now: clock(Date.parse('2026-09-04T11:00:00.000Z'))
    })

    expect(first.status).toBe('outcome-unknown')
    expect(
      trustedSupabaseBackfillWriteBarrierAppliedReconciliationV1(first, fixture.context)
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillWriteBarrierAppliedReconciliationV1(first, fixture.context)
    ).toBeNull()
    expect((await journal.readEvidence(dispatched.singleFlightKey))?.phase).toBe('final')
    expect((await journal.read(dispatched.singleFlightKey))?.outcome).toBe('applied')

    const restartedFixture = await createBackfillWriteBarrierInstallFixture()
    const freshProof = await createBackfillWriteBarrierVerificationFixture(
      restartedFixture,
      'installed'
    )
    const retry = await reconcileSupabaseBackfillWriteBarrierInstallV1({
      context: restartedFixture.context,
      installedVerification: freshProof,
      journal,
      now: clock(Date.parse('2026-09-04T12:00:00.000Z'))
    })

    expect(retry).toMatchObject({ status: 'applied', code: null })
    const recoveredAuthority = trustedSupabaseBackfillWriteBarrierAppliedReconciliationV1(
      retry,
      restartedFixture.context
    )
    expect(recoveredAuthority?.context).toBe(restartedFixture.context)
    expect(recoveredAuthority?.result).toBe(retry)
    expect(recoveredAuthority?.sourceReview).toBe(restartedFixture.review)
    expect(recoveredAuthority?.writeAuthority).toEqual(restartedFixture.writeAuthority)
    expect(recoveredAuthority?.stagingTarget).toEqual(restartedFixture.stagingBinding)
    expect(recoveredAuthority?.installedEvidence).toMatchObject({
      verificationDigest: firstProof.verificationDigest,
      constraintOid: '50003',
      snapshotMarker: firstProof.snapshotMarker,
      observedAt: firstProof.observedAt,
      serverVersionNum: firstProof.serverVersionNum
    })
    expect(
      trustedSupabaseBackfillWriteBarrierAppliedReconciliationV1(
        structuredClone(retry),
        restartedFixture.context
      )
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillWriteBarrierAppliedReconciliationV1(
        structuredClone(retry),
        restartedFixture.context
      )
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillWriteBarrierAppliedReconciliationV1(
        retry,
        restartedFixture.context
      )
    ).toBe(recoveredAuthority)
    expect(
      consumeTrustedSupabaseBackfillWriteBarrierAppliedReconciliationV1(
        retry,
        restartedFixture.context
      )
    ).toBeNull()
    expect((await journal.read(dispatched.singleFlightKey))?.outcome).toBe('applied')
  })

  test('recovers durable final installed evidence with a recreated context after settlement failed', async () => {
    const fixture = await createBackfillWriteBarrierInstallFixture()
    let settlementAttempts = 0
    const journal = createMemoryBackendHostReleaseDispatchJournal({
      beforeSettle() {
        settlementAttempts += 1
        if (settlementAttempts === 2) {
          throw new Error('simulated crash before applied settlement commit')
        }
      }
    })
    const dispatched = await dispatchSupabaseBackfillWriteBarrierInstallV1({
      context: fixture.context,
      transport: transport(),
      journal,
      releaseId: 'red-final-evidence-restart-release',
      ownerId: 'red-final-evidence-restart-owner',
      now: clock()
    })
    const firstProof = await createBackfillWriteBarrierVerificationFixture(fixture, 'installed')
    const first = await reconcileSupabaseBackfillWriteBarrierInstallV1({
      context: fixture.context,
      installedVerification: firstProof,
      journal,
      now: clock(Date.parse('2026-09-04T11:00:00.000Z'))
    })

    expect(first).toMatchObject({
      status: 'outcome-unknown',
      code: 'supabase-backfill-write-barrier-final-settlement-failed'
    })
    expect((await journal.readEvidence(dispatched.singleFlightKey))?.phase).toBe('final')
    expect((await journal.read(dispatched.singleFlightKey))?.outcome).toBe('outcome-unknown')

    const restartedFixture = await createBackfillWriteBarrierInstallFixture()
    const freshProof = await createBackfillWriteBarrierVerificationFixture(
      restartedFixture,
      'installed'
    )
    const recovered = await reconcileSupabaseBackfillWriteBarrierInstallV1({
      context: restartedFixture.context,
      installedVerification: freshProof,
      journal,
      now: clock(Date.parse('2026-09-04T12:00:00.000Z'))
    })

    expect(recovered).toMatchObject({
      status: 'applied',
      code: null,
      claim: { outcome: 'applied', code: null }
    })
  })

  test('rejects every malformed controller option shape before journal or network effects', async () => {
    const observations: Array<
      Readonly<{
        kind: string
        networkCalls: number
        journalCalls: number
        getterReads: number
        code: string | null
      }>
    > = []

    for (const kind of ['accessor', 'prototype', 'symbol', 'scalar', 'missing', 'extra'] as const) {
      const fixture = await createBackfillWriteBarrierInstallFixture()
      let journalCalls = 0
      const journalEffect = () => {
        journalCalls += 1
        throw new TypeError('malformed options must not reach the journal')
      }
      const journal = {
        claim: journalEffect,
        settle: journalEffect,
        read: journalEffect,
        listPending: journalEffect,
        listUnresolved: journalEffect,
        listUnresolvedForScope: journalEffect,
        recordEvidence: journalEffect,
        readEvidence: journalEffect
      }
      let networkCalls = 0
      let getterReads = 0
      const fetcher = successfulFetcher()
      const base = {
        context: fixture.context,
        transport: createSupabaseManagementBackfillWriteBarrierInstallTransport({
          personalAccessToken: PAT,
          fetcher: async (...args) => {
            networkCalls += 1
            return fetcher(...args)
          }
        }),
        journal,
        releaseId: `red-options-${kind}-release`,
        ownerId: `red-options-${kind}-owner`,
        now: clock()
      }
      let candidate: unknown
      if (kind === 'accessor') {
        const { context: _context, ...rest } = base
        candidate = { ...rest }
        Object.defineProperty(candidate, 'context', {
          enumerable: true,
          get() {
            getterReads += 1
            return fixture.context
          }
        })
      } else if (kind === 'prototype') {
        candidate = Object.assign(Object.create({ inheritedAuthority: true }), base)
      } else if (kind === 'symbol') {
        candidate = { ...base, [Symbol('unexpected-authority')]: true }
      } else if (kind === 'scalar') {
        candidate = 'invalid-options'
      } else if (kind === 'missing') {
        const { ownerId: _ownerId, ...missing } = base
        candidate = missing
      } else {
        candidate = { ...base, unexpectedAuthority: true }
      }

      let code: string | null = null
      try {
        await dispatchSupabaseBackfillWriteBarrierInstallV1(candidate as never)
      } catch (cause) {
        code =
          cause instanceof SupabaseBackfillWriteBarrierInstallControllerError ? cause.code : null
      }
      observations.push({ kind, networkCalls, journalCalls, getterReads, code })
    }

    expect(observations.map(({ kind }) => kind)).toEqual([
      'accessor',
      'prototype',
      'symbol',
      'scalar',
      'missing',
      'extra'
    ])
    expect(observations.every(({ networkCalls }) => networkCalls === 0)).toBe(true)
    expect(observations.every(({ journalCalls }) => journalCalls === 0)).toBe(true)
    expect(observations.every(({ getterReads }) => getterReads === 0)).toBe(true)
    expect(
      observations.every(
        ({ code }) => code === 'supabase-backfill-write-barrier-controller-input-invalid'
      )
    ).toBe(true)
  })

  test('rejects a structurally compatible injected transport before journal or network effects', async () => {
    const fixture = await createBackfillWriteBarrierInstallFixture()
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    let prepareCalls = 0
    const forgedTransport = {
      async prepareMigration() {
        prepareCalls += 1
        throw new TypeError('forged transport reached')
      }
    } as ReturnType<typeof transport>

    let code: string | null = null
    try {
      await dispatchSupabaseBackfillWriteBarrierInstallV1({
        context: fixture.context,
        transport: forgedTransport,
        journal,
        releaseId: 'red-forged-transport-release',
        ownerId: 'red-forged-transport-owner',
        now: clock()
      })
    } catch (cause) {
      code = cause instanceof SupabaseBackfillWriteBarrierInstallControllerError ? cause.code : null
    }

    expect(code).toBe('supabase-backfill-write-barrier-controller-input-invalid')
    expect(prepareCalls).toBe(0)
    expect(await journal.listUnresolved()).toHaveLength(0)
  })

  test('rejects a structurally compatible injected journal before transport or journal effects', async () => {
    const fixture = await createBackfillWriteBarrierInstallFixture()
    let journalCalls = 0
    let networkCalls = 0
    const journalEffect = () => {
      journalCalls += 1
      throw new TypeError('forged journal reached')
    }
    const forgedJournal = {
      claim: journalEffect,
      settle: journalEffect,
      read: journalEffect,
      listPending: journalEffect,
      listUnresolved: journalEffect,
      listUnresolvedForScope: journalEffect,
      recordEvidence: journalEffect,
      readEvidence: journalEffect
    }
    const installTransport = createSupabaseManagementBackfillWriteBarrierInstallTransport({
      personalAccessToken: PAT,
      fetcher: async (...args) => {
        networkCalls += 1
        return successfulFetcher()(...args)
      }
    })

    let code: string | null = null
    try {
      await dispatchSupabaseBackfillWriteBarrierInstallV1({
        context: fixture.context,
        transport: installTransport,
        journal: forgedJournal as never,
        releaseId: 'red-forged-journal-release',
        ownerId: 'red-forged-journal-owner',
        now: clock()
      })
    } catch (cause) {
      code = cause instanceof SupabaseBackfillWriteBarrierInstallControllerError ? cause.code : null
    }

    expect(code).toBe('supabase-backfill-write-barrier-controller-input-invalid')
    expect(journalCalls).toBe(0)
    expect(networkCalls).toBe(0)
  })
})
