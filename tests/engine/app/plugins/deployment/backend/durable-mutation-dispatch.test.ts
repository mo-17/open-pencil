/* oxlint-disable eslint/max-lines -- The focused matrix keeps journal, crash recovery, and one-shot permit invariants visible together. */
import { describe, expect, test } from 'bun:test'

import { indexedDB as fakeIndexedDB } from 'fake-indexeddb'

import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  createHostDurableMutationDispatchKernelV1,
  HostDurableMutationDispatchError,
  type HostDurableMutationDispatchClaimInputV1,
  type HostDurableMutationDispatchErrorCode
} from '@/app/plugins/host/deployment/backend/release-controller/durable-mutation-dispatch'
import {
  createIdbBackendHostReleaseDispatchJournal,
  createMemoryBackendHostReleaseDispatchJournal
} from '@/app/plugins/host/deployment/backend/release-journal'

const CLAIMED_AT = '2026-09-07T01:00:00.000Z'
const PRECOMMITTED_AT = '2026-09-07T01:00:01.000Z'
const FINAL_AT = '2026-09-07T01:00:02.000Z'

function claimInput(
  semantic = 'mutation-a',
  overrides: Partial<HostDurableMutationDispatchClaimInputV1> = {}
): HostDurableMutationDispatchClaimInputV1 {
  return {
    singleFlightKey: `backend-release-v3:provider-a:project-a:account-a:${semantic}`,
    dispatchScopeKey: 'backend-release-dispatch-scope-v1:provider-a:project-a',
    planDigest: 'plan-digest-a',
    releaseId: 'release-a',
    ownerId: 'owner-a',
    claimedAt: CLAIMED_AT,
    ...overrides
  }
}

function progressPayload() {
  return {
    format: 'test-progress.v1',
    stage: 'authority-confirmed',
    projectRef: 'project-a',
    planDigest: 'plan-digest-a',
    nested: { attempts: 0, ready: true },
    labels: ['reviewed', 'precommitted']
  }
}

function finalPayload(stage: 'applied' | 'not-dispatched' = 'applied') {
  return {
    format: 'test-final.v1',
    stage,
    projectRef: 'project-a',
    planDigest: 'plan-digest-a',
    proofDigest: 'proof-digest-a'
  }
}

async function dispatchError(
  operation: Promise<unknown>,
  code: HostDurableMutationDispatchErrorCode
): Promise<HostDurableMutationDispatchError> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(HostDurableMutationDispatchError)
    const error = cause as HostDurableMutationDispatchError
    expect(error.code).toBe(code)
    return error
  }
  throw new TypeError(`Expected durable mutation error ${code}`)
}

async function claimedKernel(journal = createMemoryBackendHostReleaseDispatchJournal()) {
  const kernel = createHostDurableMutationDispatchKernelV1({ journal })
  const claim = await kernel.controller.claimProjectScope(claimInput())
  return { journal, kernel, claim }
}

async function precommittedKernel(journal = createMemoryBackendHostReleaseDispatchJournal()) {
  const fixture = await claimedKernel(journal)
  const precommit = await fixture.kernel.controller.precommitOutcomeUnknown({
    claim: fixture.claim,
    progress: { payload: progressPayload(), recordedAt: PRECOMMITTED_AT },
    settledAt: PRECOMMITTED_AT,
    outcomeUnknownCode: 'dispatch-outcome-unknown'
  })
  return { ...fixture, precommit }
}

function permitExpectation(precommit: Awaited<ReturnType<typeof precommittedKernel>>['precommit']) {
  return {
    singleFlightKey: precommit.claim.singleFlightKey,
    dispatchScopeKey: precommit.claim.dispatchScopeKey,
    releaseId: precommit.claim.releaseId,
    planDigest: precommit.claim.planDigest,
    progressPayloadDigest: precommit.evidence.payloadDigest
  }
}

async function dispatchStartedKernel(journal = createMemoryBackendHostReleaseDispatchJournal()) {
  const fixture = await precommittedKernel(journal)
  expect(
    await fixture.kernel.permitConsumer.consume(
      fixture.precommit.permit,
      permitExpectation(fixture.precommit)
    )
  ).toBe(true)
  const dispatchStarted = fixture.kernel.permitConsumer.markDispatchStarted(
    fixture.precommit.permit
  )
  if (!dispatchStarted) throw new TypeError('Expected a dispatch-started authority.')
  return { ...fixture, dispatchStarted }
}

async function appliedProof(
  fixture: Awaited<ReturnType<typeof dispatchStartedKernel>>,
  payload = finalPayload(),
  recordedAt = FINAL_AT
) {
  return fixture.kernel.controller.attestApplied({
    claim: fixture.claim,
    dispatchStarted: fixture.dispatchStarted,
    final: { payload, recordedAt }
  })
}

describe('Host durable mutation dispatch kernel', () => {
  test('accepts only an exact Host-factory journal and strict own-data factory options', () => {
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    expect(createHostDurableMutationDispatchKernelV1({ journal }).controller).toBeDefined()
    expect(() =>
      createHostDurableMutationDispatchKernelV1({ journal: { ...journal } } as never)
    ).toThrow('host-durable-mutation-journal-invalid')
    expect(() =>
      createHostDurableMutationDispatchKernelV1(Object.create({ journal }) as never)
    ).toThrow('host-durable-mutation-input-invalid')

    let getterCalls = 0
    const accessor = Object.defineProperty({}, 'journal', {
      enumerable: true,
      get() {
        getterCalls += 1
        return journal
      }
    })
    expect(() => createHostDurableMutationDispatchKernelV1(accessor as never)).toThrow(
      'host-durable-mutation-input-invalid'
    )
    expect(getterCalls).toBe(0)

    const { proxy, revoke } = Proxy.revocable({ journal }, {})
    revoke()
    expect(() => createHostDurableMutationDispatchKernelV1(proxy)).toThrow(
      'host-durable-mutation-input-invalid'
    )
  })

  test('claims one project-scoped flight and rejects another semantic mutation in that scope', async () => {
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    const kernel = createHostDurableMutationDispatchKernelV1({ journal })
    const first = await kernel.controller.claimProjectScope(claimInput())
    const same = await kernel.controller.claimProjectScope(
      claimInput('mutation-a', { releaseId: 'release-b', ownerId: 'owner-b' })
    )

    expect(first.created).toBe(true)
    expect(first.claim).toMatchObject({
      outcome: 'pending',
      releaseId: 'release-a',
      dispatchScopeKey: claimInput().dispatchScopeKey
    })
    expect(same.created).toBe(false)
    expect(same.claim.releaseId).toBe('release-a')
    await dispatchError(
      kernel.controller.claimProjectScope(
        claimInput('mutation-b', {
          singleFlightKey: 'backend-release-v3:provider-a:project-a:account-a:mutation-b'
        })
      ),
      'host-durable-mutation-scope-conflict'
    )
  })

  test('retains a committed claim capability when its first mandatory readback is unavailable', async () => {
    let readCalls = 0
    const journal = createMemoryBackendHostReleaseDispatchJournal({
      beforeRead() {
        readCalls += 1
        if (readCalls === 1) throw new Error('simulated claim readback failure')
      }
    })
    const kernel = createHostDurableMutationDispatchKernelV1({ journal })
    const claim = await kernel.controller.claimProjectScope(claimInput())

    expect(claim.created).toBe(true)
    expect(claim.claim.outcome).toBe('pending')
    const precommit = await kernel.controller.precommitOutcomeUnknown({
      claim,
      progress: { payload: progressPayload(), recordedAt: PRECOMMITTED_AT },
      settledAt: PRECOMMITTED_AT,
      outcomeUnknownCode: 'dispatch-outcome-unknown'
    })
    expect(precommit.claim.outcome).toBe('outcome-unknown')
    expect(readCalls).toBeGreaterThan(1)
  })

  test('persists exact progress and outcome-unknown before issuing a one-shot permit', async () => {
    const { journal, kernel, precommit } = await precommittedKernel()
    expect(precommit.claim).toMatchObject({
      outcome: 'outcome-unknown',
      code: 'dispatch-outcome-unknown',
      settledAt: PRECOMMITTED_AT
    })
    expect(precommit.evidence.phase).toBe('progress')
    expect(precommit.evidence.payload).toBe(JSON.stringify(progressPayload()))
    expect(await journal.read(precommit.claim.singleFlightKey)).toEqual(precommit.claim)
    expect(await journal.readEvidence(precommit.claim.singleFlightKey)).toEqual(precommit.evidence)

    const expectation = {
      singleFlightKey: precommit.claim.singleFlightKey,
      dispatchScopeKey: precommit.claim.dispatchScopeKey,
      releaseId: precommit.claim.releaseId,
      planDigest: precommit.claim.planDigest,
      progressPayloadDigest: precommit.evidence.payloadDigest
    }
    expect(await kernel.permitConsumer.consume(precommit.permit, expectation)).toBe(true)
    expect(await kernel.permitConsumer.consume(precommit.permit, expectation)).toBe(false)
  })

  test('burns precommit issuance synchronously so identical concurrent calls mint one permit', async () => {
    const fixture = await claimedKernel()
    const input = {
      claim: fixture.claim,
      progress: { payload: progressPayload(), recordedAt: PRECOMMITTED_AT },
      settledAt: PRECOMMITTED_AT,
      outcomeUnknownCode: 'dispatch-outcome-unknown'
    }
    const results = await Promise.allSettled([
      fixture.kernel.controller.precommitOutcomeUnknown(input),
      fixture.kernel.controller.precommitOutcomeUnknown(input)
    ])
    const fulfilled = results.filter(
      (
        result
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof fixture.kernel.controller.precommitOutcomeUnknown>>
      > => result.status === 'fulfilled'
    )
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    const rejection = rejected[0]
    if (!rejection) throw new TypeError('Expected one rejected precommit result.')
    expect(rejection.reason).toBeInstanceOf(HostDurableMutationDispatchError)
    expect((rejection.reason as HostDurableMutationDispatchError).code).toBe(
      'host-durable-mutation-state-invalid'
    )
    expect(Object.isFrozen(fixture.claim)).toBe(true)
    expect(Object.keys(fixture.claim)).toEqual(['format', 'version', 'created', 'claim'])
    expect(JSON.stringify(fixture.claim)).not.toContain('precommitIssuance')

    const precommit = fulfilled[0]?.value
    if (!precommit) throw new TypeError('Expected one fulfilled precommit result.')
    const expectation = {
      singleFlightKey: precommit.claim.singleFlightKey,
      dispatchScopeKey: precommit.claim.dispatchScopeKey,
      releaseId: precommit.claim.releaseId,
      planDigest: precommit.claim.planDigest,
      progressPayloadDigest: precommit.evidence.payloadDigest
    }
    expect(await fixture.kernel.permitConsumer.consume(precommit.permit, expectation)).toBe(true)
    expect(await fixture.kernel.permitConsumer.consume(precommit.permit, expectation)).toBe(false)
  })

  test('makes concurrent permit consumption single-winner and rejects clones, forgeries, and consumer clones', async () => {
    const first = await precommittedKernel()
    const expectation = {
      singleFlightKey: first.precommit.claim.singleFlightKey,
      dispatchScopeKey: first.precommit.claim.dispatchScopeKey,
      releaseId: first.precommit.claim.releaseId,
      planDigest: first.precommit.claim.planDigest,
      progressPayloadDigest: first.precommit.evidence.payloadDigest
    }
    const concurrent = await Promise.all([
      first.kernel.permitConsumer.consume(first.precommit.permit, expectation),
      first.kernel.permitConsumer.consume(first.precommit.permit, expectation)
    ])
    expect(concurrent.sort()).toEqual([false, true])

    const clonedPermit = await precommittedKernel()
    expect(
      await clonedPermit.kernel.permitConsumer.consume(
        { ...clonedPermit.precommit.permit },
        {
          ...expectation,
          singleFlightKey: clonedPermit.precommit.claim.singleFlightKey,
          releaseId: clonedPermit.precommit.claim.releaseId,
          progressPayloadDigest: clonedPermit.precommit.evidence.payloadDigest
        }
      )
    ).toBe(false)
    expect(
      await clonedPermit.kernel.permitConsumer.consume({ format: 'forged', version: 1 } as never, {
        ...expectation,
        singleFlightKey: clonedPermit.precommit.claim.singleFlightKey,
        releaseId: clonedPermit.precommit.claim.releaseId,
        progressPayloadDigest: clonedPermit.precommit.evidence.payloadDigest
      })
    ).toBe(false)
    const clonedConsumer = { ...clonedPermit.kernel.permitConsumer }
    expect(
      await clonedConsumer.consume(clonedPermit.precommit.permit, {
        ...expectation,
        singleFlightKey: clonedPermit.precommit.claim.singleFlightKey,
        releaseId: clonedPermit.precommit.claim.releaseId,
        progressPayloadDigest: clonedPermit.precommit.evidence.payloadDigest
      })
    ).toBe(false)
  })

  test('burns a permit on invalid expectation and detects durable progress tampering', async () => {
    const invalid = await precommittedKernel()
    const expected = {
      singleFlightKey: invalid.precommit.claim.singleFlightKey,
      dispatchScopeKey: invalid.precommit.claim.dispatchScopeKey,
      releaseId: invalid.precommit.claim.releaseId,
      planDigest: invalid.precommit.claim.planDigest,
      progressPayloadDigest: invalid.precommit.evidence.payloadDigest
    }
    expect(
      await invalid.kernel.permitConsumer.consume(invalid.precommit.permit, {
        ...expected,
        planDigest: 'wrong-plan'
      })
    ).toBe(false)
    expect(await invalid.kernel.permitConsumer.consume(invalid.precommit.permit, expected)).toBe(
      false
    )

    const tampered = await precommittedKernel()
    await tampered.journal.recordEvidence({
      ...tampered.precommit.evidence,
      payload: JSON.stringify({ ...progressPayload(), stage: 'tampered' }),
      recordedAt: '2026-09-07T01:00:01.500Z'
    })
    expect(
      await tampered.kernel.permitConsumer.consume(tampered.precommit.permit, {
        singleFlightKey: tampered.precommit.claim.singleFlightKey,
        dispatchScopeKey: tampered.precommit.claim.dispatchScopeKey,
        releaseId: tampered.precommit.claim.releaseId,
        planDigest: tampered.precommit.claim.planDigest,
        progressPayloadDigest: tampered.precommit.evidence.payloadDigest
      })
    ).toBe(false)
  })

  test('requires one sealed no-dispatch proof and burns that path at dispatch start', async () => {
    const beforeStart = await precommittedKernel()
    expect(
      await beforeStart.kernel.permitConsumer.consume(
        beforeStart.precommit.permit,
        permitExpectation(beforeStart.precommit)
      )
    ).toBe(true)
    const proof = beforeStart.kernel.permitConsumer.attestKnownNotDispatched(
      beforeStart.precommit.permit
    )
    if (!proof) throw new TypeError('Expected a known-not-dispatched proof.')
    await expect(
      beforeStart.kernel.controller.settleKnownNotDispatched({
        claim: beforeStart.claim,
        proof,
        final: { payload: finalPayload('not-dispatched'), recordedAt: FINAL_AT },
        code: 'known-not-dispatched'
      })
    ).resolves.toMatchObject({ claim: { outcome: 'failed' } })
    await dispatchError(
      beforeStart.kernel.controller.settleKnownNotDispatched({
        claim: beforeStart.claim,
        proof,
        final: { payload: finalPayload('not-dispatched'), recordedAt: FINAL_AT },
        code: 'known-not-dispatched'
      }),
      'host-durable-mutation-state-invalid'
    )

    const afterStart = await dispatchStartedKernel()
    expect(
      afterStart.kernel.permitConsumer.attestKnownNotDispatched(afterStart.precommit.permit)
    ).toBeNull()
  })

  test('binds an Applied proof to exact final evidence and consumes it on mismatch', async () => {
    const fixture = await dispatchStartedKernel()
    const proof = await appliedProof(fixture)
    await dispatchError(
      fixture.kernel.controller.settleApplied({
        claim: fixture.claim,
        proof,
        final: {
          payload: { ...finalPayload(), proofDigest: 'different-proof' },
          recordedAt: FINAL_AT
        }
      }),
      'host-durable-mutation-evidence-invalid'
    )
    await dispatchError(
      fixture.kernel.controller.settleApplied({
        claim: fixture.claim,
        proof,
        final: { payload: finalPayload(), recordedAt: FINAL_AT }
      }),
      'host-durable-mutation-state-invalid'
    )
    expect((await fixture.journal.read(fixture.claim.claim.singleFlightKey))?.outcome).toBe(
      'outcome-unknown'
    )
  })

  test('settles a known non-dispatch with exact final evidence and no mutation permit', async () => {
    const { journal, kernel, claim } = await claimedKernel()
    const proof = await kernel.controller.attestClaimKnownNotDispatched({ claim })
    const result = await kernel.controller.settleKnownNotDispatched({
      claim,
      proof,
      final: { payload: finalPayload('not-dispatched'), recordedAt: FINAL_AT },
      code: 'known-not-dispatched'
    })

    expect(result.status).toBe('settled')
    expect(result.claim).toMatchObject({
      outcome: 'failed',
      code: 'known-not-dispatched',
      settledAt: FINAL_AT
    })
    expect(result.evidence.phase).toBe('final')
    expect(await journal.readEvidence(result.claim.singleFlightKey)).toEqual(result.evidence)
    expect(JSON.stringify(result)).not.toContain('personalAccessToken')
  })

  test('settles applied only after precommit and preserves a secret-free final proof', async () => {
    const fixture = await dispatchStartedKernel()
    const proof = await appliedProof(fixture)
    const result = await fixture.kernel.controller.settleApplied({
      claim: fixture.claim,
      proof,
      final: { payload: finalPayload(), recordedAt: FINAL_AT }
    })

    expect(result.status).toBe('settled')
    expect(result.claim).toMatchObject({ outcome: 'applied', code: null, settledAt: FINAL_AT })
    expect(result.evidence).toMatchObject({
      phase: 'final',
      payload: JSON.stringify(finalPayload()),
      recordedAt: FINAL_AT
    })

    const pending = await claimedKernel()
    await dispatchError(
      pending.kernel.controller.settleApplied({
        claim: pending.claim,
        proof: { format: 'openpencil.host-durable-mutation-applied-proof.v1', version: 1 },
        final: { payload: finalPayload(), recordedAt: FINAL_AT }
      }),
      'host-durable-mutation-state-invalid'
    )
  })

  test('does not recover applied authority from serialized final evidence after settlement fails', async () => {
    let settlementCalls = 0
    let rejectApplied = true
    const journal = createMemoryBackendHostReleaseDispatchJournal({
      beforeSettle() {
        settlementCalls += 1
        if (settlementCalls > 1 && rejectApplied) throw new Error('simulated settlement crash')
      }
    })
    const fixture = await dispatchStartedKernel(journal)
    const proof = await appliedProof(fixture)
    const first = await fixture.kernel.controller.settleApplied({
      claim: fixture.claim,
      proof,
      final: { payload: finalPayload(), recordedAt: FINAL_AT }
    })

    expect(first.status).toBe('settlement-recovery-required')
    expect(first.claim.outcome).toBe('outcome-unknown')
    expect(first.evidence.phase).toBe('final')

    rejectApplied = false
    const restarted = createHostDurableMutationDispatchKernelV1({ journal })
    const recoveredClaim = await restarted.controller.claimProjectScope(
      claimInput('mutation-a', { releaseId: 'restart-release', ownerId: 'restart-owner' })
    )
    expect(recoveredClaim.created).toBe(false)
    await dispatchError(
      restarted.controller.recoverFinalSettlement({
        claim: recoveredClaim,
        final: { payload: finalPayload(), recordedAt: FINAL_AT },
        outcome: 'applied',
        code: null
      }),
      'host-durable-mutation-state-invalid'
    )
    expect((await journal.read(recoveredClaim.claim.singleFlightKey))?.outcome).toBe(
      'outcome-unknown'
    )
  })

  test('reopens IndexedDB without recreating authority from exact final evidence', async () => {
    const databaseName = `durable-mutation-reopen-${crypto.randomUUID()}`
    const firstJournal = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    const first = await precommittedKernel(firstJournal)
    expect(first.precommit.claim.outcome).toBe('outcome-unknown')

    const secondJournal = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    const secondKernel = createHostDurableMutationDispatchKernelV1({ journal: secondJournal })
    const reopened = await secondKernel.controller.claimProjectScope(
      claimInput('mutation-a', { releaseId: 'restart-release', ownerId: 'restart-owner' })
    )
    expect(reopened.created).toBe(false)
    await dispatchError(
      secondKernel.controller.precommitOutcomeUnknown({
        claim: reopened,
        progress: { payload: progressPayload(), recordedAt: PRECOMMITTED_AT },
        settledAt: PRECOMMITTED_AT,
        outcomeUnknownCode: 'dispatch-outcome-unknown'
      }),
      'host-durable-mutation-state-invalid'
    )

    const payload = finalPayload()
    await secondJournal.recordEvidence({
      singleFlightKey: reopened.claim.singleFlightKey,
      dispatchScopeKey: reopened.claim.dispatchScopeKey,
      releaseId: reopened.claim.releaseId,
      planDigest: reopened.claim.planDigest,
      phase: 'final',
      payload: JSON.stringify(payload),
      payloadDigest: await digestCanonicalManifest(payload),
      recordedAt: FINAL_AT
    })

    const thirdJournal = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    const thirdKernel = createHostDurableMutationDispatchKernelV1({ journal: thirdJournal })
    const recoveryClaim = await thirdKernel.controller.claimProjectScope(
      claimInput('mutation-a', { releaseId: 'second-restart', ownerId: 'second-owner' })
    )
    await dispatchError(
      thirdKernel.controller.recoverFinalSettlement({
        claim: recoveryClaim,
        final: { payload, recordedAt: FINAL_AT },
        outcome: 'applied',
        code: null
      }),
      'host-durable-mutation-state-invalid'
    )
    expect((await thirdJournal.read(recoveryClaim.claim.singleFlightKey))?.outcome).toBe(
      'outcome-unknown'
    )
  })

  test('recognizes a post-commit settlement crash only from the exact durable reread', async () => {
    let settlementCalls = 0
    const journal = createMemoryBackendHostReleaseDispatchJournal({
      afterSettle() {
        settlementCalls += 1
        if (settlementCalls > 1) throw new Error('simulated response loss after commit')
      }
    })
    const fixture = await dispatchStartedKernel(journal)
    const proof = await appliedProof(fixture)
    const result = await fixture.kernel.controller.settleApplied({
      claim: fixture.claim,
      proof,
      final: { payload: finalPayload(), recordedAt: FINAL_AT }
    })

    expect(result.status).toBe('settled')
    expect(result.claim.outcome).toBe('applied')
    expect((await journal.read(result.claim.singleFlightKey))?.outcome).toBe('applied')
  })

  test('never calls hostile array methods or index accessors while snapshotting evidence', async () => {
    let mapGetterCalls = 0
    const mapGetterArray = ['safe']
    Object.defineProperty(mapGetterArray, 'map', {
      enumerable: true,
      get() {
        mapGetterCalls += 1
        throw new Error('hostile map getter executed')
      }
    })
    const mapGetterFixture = await claimedKernel()
    await dispatchError(
      mapGetterFixture.kernel.controller.precommitOutcomeUnknown({
        claim: mapGetterFixture.claim,
        progress: {
          payload: { stage: 'authority-confirmed', values: mapGetterArray },
          recordedAt: PRECOMMITTED_AT
        },
        settledAt: PRECOMMITTED_AT,
        outcomeUnknownCode: 'dispatch-outcome-unknown'
      }),
      'host-durable-mutation-input-invalid'
    )
    expect(mapGetterCalls).toBe(0)

    let mapFunctionCalls = 0
    const mapFunctionArray = ['safe']
    Object.defineProperty(mapFunctionArray, 'map', {
      enumerable: true,
      value() {
        mapFunctionCalls += 1
        throw new Error('hostile map function executed')
      }
    })
    const mapFunctionFixture = await claimedKernel()
    await dispatchError(
      mapFunctionFixture.kernel.controller.precommitOutcomeUnknown({
        claim: mapFunctionFixture.claim,
        progress: {
          payload: { stage: 'authority-confirmed', values: mapFunctionArray as never },
          recordedAt: PRECOMMITTED_AT
        },
        settledAt: PRECOMMITTED_AT,
        outcomeUnknownCode: 'dispatch-outcome-unknown'
      }),
      'host-durable-mutation-input-invalid'
    )
    expect(mapFunctionCalls).toBe(0)

    let indexGetterCalls = 0
    const indexAccessorArray = ['safe']
    Object.defineProperty(indexAccessorArray, '0', {
      enumerable: true,
      get() {
        indexGetterCalls += 1
        throw new Error('hostile index getter executed')
      }
    })
    const indexFixture = await claimedKernel()
    await dispatchError(
      indexFixture.kernel.controller.precommitOutcomeUnknown({
        claim: indexFixture.claim,
        progress: {
          payload: { stage: 'authority-confirmed', values: indexAccessorArray },
          recordedAt: PRECOMMITTED_AT
        },
        settledAt: PRECOMMITTED_AT,
        outcomeUnknownCode: 'dispatch-outcome-unknown'
      }),
      'host-durable-mutation-input-invalid'
    )
    expect(indexGetterCalls).toBe(0)

    const revokedArray = Proxy.revocable(['safe'], {})
    revokedArray.revoke()
    const proxyFixture = await claimedKernel()
    await dispatchError(
      proxyFixture.kernel.controller.precommitOutcomeUnknown({
        claim: proxyFixture.claim,
        progress: {
          payload: { stage: 'authority-confirmed', values: revokedArray.proxy as never },
          recordedAt: PRECOMMITTED_AT
        },
        settledAt: PRECOMMITTED_AT,
        outcomeUnknownCode: 'dispatch-outcome-unknown'
      }),
      'host-durable-mutation-input-invalid'
    )
  })

  test('rejects final and recovery evidence that predates durable mutation authority', async () => {
    const precommitted = await dispatchStartedKernel()
    await dispatchError(
      precommitted.kernel.controller.attestApplied({
        claim: precommitted.claim,
        dispatchStarted: precommitted.dispatchStarted,
        final: { payload: finalPayload(), recordedAt: CLAIMED_AT }
      }),
      'host-durable-mutation-state-invalid'
    )
    expect(
      (await precommitted.journal.readEvidence(precommitted.claim.claim.singleFlightKey))?.phase
    ).toBe('progress')
    await dispatchError(
      precommitted.kernel.controller.recoverFinalSettlement({
        claim: precommitted.claim,
        final: { payload: finalPayload(), recordedAt: CLAIMED_AT },
        outcome: 'applied',
        code: null
      }),
      'host-durable-mutation-state-invalid'
    )

    const pending = await claimedKernel()
    const proof = await pending.kernel.controller.attestClaimKnownNotDispatched({
      claim: pending.claim
    })
    await dispatchError(
      pending.kernel.controller.settleKnownNotDispatched({
        claim: pending.claim,
        proof,
        final: {
          payload: finalPayload('not-dispatched'),
          recordedAt: '2026-09-07T00:59:59.999Z'
        },
        code: 'known-not-dispatched'
      }),
      'host-durable-mutation-input-invalid'
    )
    expect(await pending.journal.readEvidence(pending.claim.claim.singleFlightKey)).toBeNull()
  })

  test('rejects cloned claim authority, accessors, non-JSON payloads, and secret material', async () => {
    const clonedClaimFixture = await claimedKernel()
    const clonedClaimProof =
      await clonedClaimFixture.kernel.controller.attestClaimKnownNotDispatched({
        claim: clonedClaimFixture.claim
      })
    await dispatchError(
      clonedClaimFixture.kernel.controller.settleKnownNotDispatched({
        claim: structuredClone(clonedClaimFixture.claim),
        proof: clonedClaimProof,
        final: { payload: finalPayload('not-dispatched'), recordedAt: FINAL_AT },
        code: 'known-not-dispatched'
      }),
      'host-durable-mutation-claim-invalid'
    )

    let getterCalls = 0
    const accessorPayload = Object.defineProperty({}, 'stage', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'authority-confirmed'
      }
    })
    const fixture = await claimedKernel()
    await dispatchError(
      fixture.kernel.controller.precommitOutcomeUnknown({
        claim: fixture.claim,
        progress: { payload: accessorPayload as never, recordedAt: PRECOMMITTED_AT },
        settledAt: PRECOMMITTED_AT,
        outcomeUnknownCode: 'dispatch-outcome-unknown'
      }),
      'host-durable-mutation-input-invalid'
    )
    expect(getterCalls).toBe(0)
    await dispatchError(
      fixture.kernel.controller.precommitOutcomeUnknown({
        claim: fixture.claim,
        progress: { payload: progressPayload(), recordedAt: PRECOMMITTED_AT },
        settledAt: PRECOMMITTED_AT,
        outcomeUnknownCode: 'dispatch-outcome-unknown'
      }),
      'host-durable-mutation-state-invalid'
    )

    const nonJSONFixture = await claimedKernel()
    await dispatchError(
      nonJSONFixture.kernel.controller.precommitOutcomeUnknown({
        claim: nonJSONFixture.claim,
        progress: {
          payload: { stage: 'authority-confirmed', invalid: new Date() } as never,
          recordedAt: PRECOMMITTED_AT
        },
        settledAt: PRECOMMITTED_AT,
        outcomeUnknownCode: 'dispatch-outcome-unknown'
      }),
      'host-durable-mutation-input-invalid'
    )

    const secretFixture = await claimedKernel()
    await dispatchError(
      secretFixture.kernel.controller.precommitOutcomeUnknown({
        claim: secretFixture.claim,
        progress: {
          payload: {
            stage: 'authority-confirmed',
            personalAccessToken: 'sb_secret_canary_1234567890'
          },
          recordedAt: PRECOMMITTED_AT
        },
        settledAt: PRECOMMITTED_AT,
        outcomeUnknownCode: 'dispatch-outcome-unknown'
      }),
      'host-durable-mutation-journal-failed'
    )
    expect(JSON.stringify(secretFixture.claim)).not.toContain('sb_secret_canary')
  })

  test('rejects serialized recovery evidence and exact option shape drift', async () => {
    const fixture = await dispatchStartedKernel()
    const proof = await appliedProof(fixture)
    await fixture.kernel.controller.settleApplied({
      claim: fixture.claim,
      proof,
      final: { payload: finalPayload(), recordedAt: FINAL_AT }
    })
    await dispatchError(
      fixture.kernel.controller.recoverFinalSettlement({
        claim: fixture.claim,
        final: {
          payload: { ...finalPayload(), proofDigest: 'different-proof' },
          recordedAt: FINAL_AT
        },
        outcome: 'applied',
        code: null
      }),
      'host-durable-mutation-state-invalid'
    )
    await dispatchError(
      fixture.kernel.controller.recoverFinalSettlement({
        claim: fixture.claim,
        final: { payload: finalPayload(), recordedAt: FINAL_AT },
        outcome: 'applied',
        code: null,
        unexpected: true
      } as never),
      'host-durable-mutation-input-invalid'
    )
  })

  test('does not accept a forged journal typed as the Host contract', () => {
    const forged = {
      claim: async () => ({ claimed: true, record: {} }),
      settle: async () => ({}),
      read: async () => null,
      listPending: async () => [],
      listUnresolved: async () => [],
      listUnresolvedForScope: async () => [],
      recordEvidence: async () => ({}),
      readEvidence: async () => null
    }
    expect(() => createHostDurableMutationDispatchKernelV1({ journal: forged as never })).toThrow(
      'host-durable-mutation-journal-invalid'
    )
  })
})
