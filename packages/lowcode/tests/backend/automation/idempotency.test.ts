/* eslint-disable max-lines -- lifecycle and hostile-data cases intentionally cover the whole contract */
import { describe, expect, test } from 'bun:test'

import {
  BACKEND_AUTOMATION_IDEMPOTENCY_CAS_PROPOSAL_FORMAT,
  BACKEND_AUTOMATION_IDEMPOTENCY_MAX_ATTEMPTS,
  BACKEND_AUTOMATION_IDEMPOTENCY_RECORD_FORMAT,
  canonicalBackendAutomationIdempotencyCASProposalBytes,
  canonicalBackendAutomationIdempotencyRecordBytes,
  createBackendAutomationIdempotencyCASProposal,
  digestBackendAutomationIdempotencyCASProposal,
  digestBackendAutomationIdempotencyRecord,
  parseBackendAutomationIdempotencyCASProposal,
  parseBackendAutomationIdempotencyRecord,
  verifyBackendAutomationIdempotencyCASProposal,
  type BackendAutomationIdempotencyRecordV1
} from '#lowcode/backend/automation/idempotency'

import { digestCanonicalManifest } from '@open-pencil/scene-graph'

const CREATED_AT = '2026-09-09T00:00:00.000Z'
const EXPIRES_AT = '2026-09-10T00:00:00.000Z'

async function digest(label: string): Promise<string> {
  return digestCanonicalManifest({ label })
}

async function initialRecord(
  overrides: Readonly<Record<string, unknown>> = {}
): Promise<Record<string, unknown>> {
  return {
    format: BACKEND_AUTOMATION_IDEMPOTENCY_RECORD_FORMAT,
    version: 1,
    automationId: 'automation-send-receipt',
    eventId: 'event-001',
    operationId: 'operation-001',
    idempotencyKeyDigest: await digest('idempotency-key'),
    causationId: 'causation-001',
    causationHop: 0,
    retentionHours: 24,
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    recordedAt: CREATED_AT,
    revision: 0,
    previousRecordDigest: null,
    attemptIds: ['attempt-001'],
    currentAttemptId: 'attempt-001',
    state: 'reserved',
    completionEvidenceDigest: null,
    knownNotDispatchedEvidenceDigest: null,
    reconciliationEvidenceDigest: null,
    hostEvidenceAuthenticated: false,
    persistenceAuthorityGranted: false,
    dispatchAuthorityGranted: false,
    ...overrides
  }
}

async function nextRecord(
  previousValue: unknown,
  overrides: Readonly<Record<string, unknown>>
): Promise<Record<string, unknown>> {
  const previous = parseBackendAutomationIdempotencyRecord(previousValue)
  const nextSecond = Number(previous.recordedAt.slice(17, 19)) + 1
  return {
    ...previous,
    recordedAt: `2026-09-09T00:00:${String(nextSecond).padStart(2, '0')}.000Z`,
    revision: previous.revision + 1,
    previousRecordDigest: await digestBackendAutomationIdempotencyRecord(previous),
    ...overrides
  }
}

async function dispatchStarted(previous: unknown): Promise<Record<string, unknown>> {
  return nextRecord(previous, { state: 'dispatch-started' })
}

async function outcomeUnknown(previous: unknown): Promise<Record<string, unknown>> {
  return nextRecord(previous, { state: 'outcome-unknown' })
}

async function knownNotDispatched(
  previous: unknown,
  reconciliationEvidenceDigest: string | null = null
): Promise<Record<string, unknown>> {
  return nextRecord(previous, {
    state: 'known-not-dispatched',
    knownNotDispatchedEvidenceDigest: await digest('known-not-dispatched'),
    reconciliationEvidenceDigest
  })
}

describe('provider-neutral Backend Automation idempotency ledger', () => {
  test('normalizes exact own data, deep-freezes it, and canonicalizes deterministically', async () => {
    const source = await initialRecord()
    const reordered = Object.fromEntries(Object.entries(source).reverse())
    const parsed = parseBackendAutomationIdempotencyRecord(source)

    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.attemptIds)).toBe(true)
    expect(parsed.hostEvidenceAuthenticated).toBe(false)
    expect(parsed.persistenceAuthorityGranted).toBe(false)
    expect(parsed.dispatchAuthorityGranted).toBe(false)
    expect(canonicalBackendAutomationIdempotencyRecordBytes(source)).toEqual(
      canonicalBackendAutomationIdempotencyRecordBytes(reordered)
    )
    expect(await digestBackendAutomationIdempotencyRecord(source)).toBe(
      await digestBackendAutomationIdempotencyRecord(reordered)
    )
  })

  test('creates a revision-zero CAS proposal without claiming Host or persistence authority', async () => {
    const source = await initialRecord()
    const candidate = await createBackendAutomationIdempotencyCASProposal(null, source)

    expect(candidate.proposal).toMatchObject({
      format: BACKEND_AUTOMATION_IDEMPOTENCY_CAS_PROPOSAL_FORMAT,
      version: 1,
      expectedRevision: null,
      expectedHeadDigest: null,
      nextRevision: 0,
      hostEvidenceAuthenticated: false,
      persistenceAuthorityGranted: false,
      dispatchAuthorityGranted: false
    })
    expect(candidate.proposal.nextRecordDigest).toBe(candidate.recordDigest)
    expect(Object.isFrozen(candidate)).toBe(true)
    expect(Object.isFrozen(candidate.proposal)).toBe(true)
    expect(parseBackendAutomationIdempotencyCASProposal(candidate.proposal)).toEqual(
      candidate.proposal
    )
    const reorderedProposal = Object.fromEntries(Object.entries(candidate.proposal).reverse())
    expect(canonicalBackendAutomationIdempotencyCASProposalBytes(candidate.proposal)).toEqual(
      canonicalBackendAutomationIdempotencyCASProposalBytes(reorderedProposal)
    )
    expect(await digestBackendAutomationIdempotencyCASProposal(candidate.proposal)).toBe(
      await digestBackendAutomationIdempotencyCASProposal(reorderedProposal)
    )
  })

  test('requires dispatch-started before success and makes success terminal', async () => {
    const initial = await initialRecord()
    const dispatched = await dispatchStarted(initial)
    await expect(
      createBackendAutomationIdempotencyCASProposal(initial, dispatched)
    ).resolves.toBeDefined()

    const succeeded = await nextRecord(dispatched, {
      state: 'succeeded',
      completionEvidenceDigest: await digest('completion')
    })
    await expect(
      createBackendAutomationIdempotencyCASProposal(dispatched, succeeded)
    ).resolves.toBeDefined()

    const forgedContinuation = await nextRecord(succeeded, {
      state: 'known-not-dispatched',
      completionEvidenceDigest: null,
      knownNotDispatchedEvidenceDigest: await digest('impossible-release')
    })
    await expect(
      createBackendAutomationIdempotencyCASProposal(succeeded, forgedContinuation)
    ).rejects.toThrow()

    const directSuccess = await nextRecord(initial, {
      state: 'succeeded',
      completionEvidenceDigest: await digest('direct-success')
    })
    await expect(
      createBackendAutomationIdempotencyCASProposal(initial, directSuccess)
    ).rejects.toThrow()
  })

  test('permits a fresh attempt only after explicit known-not-dispatched evidence', async () => {
    const initial = await initialRecord()
    const released = await knownNotDispatched(initial)
    await expect(
      createBackendAutomationIdempotencyCASProposal(initial, released)
    ).resolves.toBeDefined()

    const retry = await nextRecord(released, {
      state: 'reserved',
      attemptIds: ['attempt-001', 'attempt-002'],
      currentAttemptId: 'attempt-002',
      knownNotDispatchedEvidenceDigest: null,
      reconciliationEvidenceDigest: null
    })
    await expect(
      createBackendAutomationIdempotencyCASProposal(released, retry)
    ).resolves.toBeDefined()

    const missingEvidence = { ...released, knownNotDispatchedEvidenceDigest: null }
    expect(() => parseBackendAutomationIdempotencyRecord(missingEvidence)).toThrow()

    const duplicateAttempt = { ...retry, attemptIds: ['attempt-001', 'attempt-001'] }
    await expect(
      createBackendAutomationIdempotencyCASProposal(released, duplicateAttempt)
    ).rejects.toThrow()
  })

  test('keeps outcome-unknown fenced until positive reconciliation evidence is bound', async () => {
    const initial = await initialRecord()
    const dispatched = await dispatchStarted(initial)
    const unknown = await outcomeUnknown(dispatched)
    await expect(
      createBackendAutomationIdempotencyCASProposal(dispatched, unknown)
    ).resolves.toBeDefined()

    const replay = await nextRecord(unknown, {
      state: 'reserved',
      attemptIds: ['attempt-001', 'attempt-002'],
      currentAttemptId: 'attempt-002'
    })
    await expect(createBackendAutomationIdempotencyCASProposal(unknown, replay)).rejects.toThrow()

    const unprovedSuccess = await nextRecord(unknown, {
      state: 'succeeded',
      completionEvidenceDigest: await digest('completion')
    })
    await expect(
      createBackendAutomationIdempotencyCASProposal(unknown, unprovedSuccess)
    ).rejects.toThrow()

    const reconciledSuccess = {
      ...unprovedSuccess,
      reconciliationEvidenceDigest: await digest('positive-reconciliation')
    }
    await expect(
      createBackendAutomationIdempotencyCASProposal(unknown, reconciledSuccess)
    ).resolves.toBeDefined()
  })

  test('allows non-dispatch reconciliation after an unknown outcome, then and only then a retry', async () => {
    const initial = await initialRecord()
    const dispatched = await dispatchStarted(initial)
    const unknown = await outcomeUnknown(dispatched)
    const reconciled = await knownNotDispatched(unknown, await digest('negative-remote-lookup'))
    await expect(
      createBackendAutomationIdempotencyCASProposal(unknown, reconciled)
    ).resolves.toBeDefined()

    const retry = await nextRecord(reconciled, {
      state: 'reserved',
      attemptIds: ['attempt-001', 'attempt-002'],
      currentAttemptId: 'attempt-002',
      knownNotDispatchedEvidenceDigest: null,
      reconciliationEvidenceDigest: null
    })
    await expect(
      createBackendAutomationIdempotencyCASProposal(reconciled, retry)
    ).resolves.toBeDefined()
  })

  test('binds identity, causation, retention, attempts, revision, and previous digest', async () => {
    const initial = await initialRecord()
    expect(() =>
      parseBackendAutomationIdempotencyRecord({ ...initial, causationHop: -0 })
    ).toThrow()
    expect(() => parseBackendAutomationIdempotencyRecord({ ...initial, revision: -0 })).toThrow()
    const dispatched = await dispatchStarted(initial)
    const tamperedFields: Readonly<Record<string, unknown>>[] = [
      { automationId: 'automation-other' },
      { eventId: 'event-other' },
      { operationId: 'operation-other' },
      { idempotencyKeyDigest: await digest('other-key') },
      { causationId: 'causation-other' },
      { causationHop: 1 },
      { retentionHours: 12, expiresAt: '2026-09-09T12:00:00.000Z' },
      { attemptIds: ['attempt-other'], currentAttemptId: 'attempt-other' },
      { revision: 7 },
      { previousRecordDigest: await digest('stale-head') }
    ]
    for (const changes of tamperedFields) {
      await expect(
        createBackendAutomationIdempotencyCASProposal(initial, { ...dispatched, ...changes })
      ).rejects.toThrow()
    }
  })

  test('detects CAS proposal tampering and stale replay', async () => {
    const initial = await initialRecord()
    const initialCandidate = await createBackendAutomationIdempotencyCASProposal(null, initial)
    const dispatched = await dispatchStarted(initial)
    const candidate = await createBackendAutomationIdempotencyCASProposal(initial, dispatched)

    await expect(
      verifyBackendAutomationIdempotencyCASProposal(
        { ...candidate.proposal, expectedHeadDigest: await digest('stale') },
        initial,
        dispatched
      )
    ).rejects.toThrow()
    await expect(
      verifyBackendAutomationIdempotencyCASProposal(
        { ...candidate.proposal, nextRecordDigest: await digest('tampered') },
        initial,
        dispatched
      )
    ).rejects.toThrow()
    await expect(
      verifyBackendAutomationIdempotencyCASProposal(initialCandidate.proposal, initial, initial)
    ).rejects.toThrow()
    await expect(createBackendAutomationIdempotencyCASProposal(initial, initial)).rejects.toThrow()
  })

  test('makes concurrent proposals conflict on one expected head without selecting a winner', async () => {
    const initial = await initialRecord()
    const first = await dispatchStarted(initial)
    const second = { ...first, currentAttemptId: 'attempt-other', attemptIds: ['attempt-other'] }
    const firstCandidate = await createBackendAutomationIdempotencyCASProposal(initial, first)

    await expect(createBackendAutomationIdempotencyCASProposal(initial, second)).rejects.toThrow()

    const known = await knownNotDispatched(initial)
    const competing = await createBackendAutomationIdempotencyCASProposal(initial, known)
    expect(competing.proposal.expectedHeadDigest).toBe(firstCandidate.proposal.expectedHeadDigest)
    expect(competing.proposal.expectedRevision).toBe(firstCandidate.proposal.expectedRevision)
    expect(competing.recordDigest).not.toBe(firstCandidate.recordDigest)
    await expect(
      verifyBackendAutomationIdempotencyCASProposal(firstCandidate.proposal, initial, known)
    ).rejects.toThrow()
  })

  test('derives expiry exactly and blocks retry reservation at the retention boundary', async () => {
    const invalidExpiry = await initialRecord({ expiresAt: '2026-09-10T00:00:00.001Z' })
    expect(() => parseBackendAutomationIdempotencyRecord(invalidExpiry)).toThrow()

    const initial = await initialRecord()
    const released = await knownNotDispatched(initial)
    const expiredRetry = await nextRecord(released, {
      state: 'reserved',
      recordedAt: EXPIRES_AT,
      attemptIds: ['attempt-001', 'attempt-002'],
      currentAttemptId: 'attempt-002',
      knownNotDispatchedEvidenceDigest: null,
      reconciliationEvidenceDigest: null
    })
    await expect(
      createBackendAutomationIdempotencyCASProposal(released, expiredRetry)
    ).rejects.toThrow()

    const nearDateLimit = await initialRecord({
      createdAt: '9999-12-31T23:00:00.000Z',
      recordedAt: '9999-12-31T23:00:00.000Z',
      expiresAt: '9999-12-31T23:59:59.999Z',
      retentionHours: 1
    })
    expect(() => parseBackendAutomationIdempotencyRecord(nearDateLimit)).toThrow()

    const yearZero = await initialRecord({
      createdAt: '0000-01-01T00:00:00.000Z',
      recordedAt: '0000-01-01T00:00:00.000Z',
      expiresAt: '0000-01-02T00:00:00.000Z'
    })
    expect(() => parseBackendAutomationIdempotencyRecord(yearZero)).toThrow()
  })

  test('rejects accessors, custom prototypes, proxies, cycles, excessive nesting, and secrets', async () => {
    const source = await initialRecord()
    let getterCalls = 0
    const accessor = { ...source }
    Object.defineProperty(accessor, 'eventId', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'event-accessor'
      }
    })
    expect(() => parseBackendAutomationIdempotencyRecord(accessor)).toThrow()
    expect(getterCalls).toBe(0)

    const customPrototype = Object.assign(Object.create({ inherited: true }), source)
    expect(() => parseBackendAutomationIdempotencyRecord(customPrototype)).toThrow()

    expect(() => parseBackendAutomationIdempotencyRecord(new Proxy(source, {}))).toThrow()
    expect(() =>
      parseBackendAutomationIdempotencyRecord({
        ...source,
        attemptIds: new Proxy(['attempt-001'], {})
      })
    ).toThrow()

    const secretCanary = ['sk', 'live', 'abcdefghijklmnop'].join('_')
    const hostileProxy = new Proxy(source, {
      ownKeys() {
        throw new Error(secretCanary)
      }
    })
    let proxyMessage = ''
    try {
      parseBackendAutomationIdempotencyRecord(hostileProxy)
    } catch (cause) {
      proxyMessage = cause instanceof Error ? cause.message : String(cause)
    }
    expect(proxyMessage).not.toContain(secretCanary)

    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    expect(() =>
      parseBackendAutomationIdempotencyRecord({ ...source, currentAttemptId: cycle })
    ).toThrow()

    let deep: unknown = 'attempt-001'
    for (let index = 0; index < 100; index += 1) deep = { nested: deep }
    expect(() =>
      parseBackendAutomationIdempotencyRecord({ ...source, currentAttemptId: deep })
    ).toThrow()
    expect(() =>
      parseBackendAutomationIdempotencyRecord({ ...source, automationId: secretCanary })
    ).toThrow()
  })

  test('rejects array extensions, excess attempts, unsupported fields, and forged authority flags', async () => {
    const source = await initialRecord()
    const extendedAttempts = ['attempt-001']
    Object.defineProperty(extendedAttempts, 'extra', { enumerable: true, value: true })
    expect(() =>
      parseBackendAutomationIdempotencyRecord({ ...source, attemptIds: extendedAttempts })
    ).toThrow()

    let attemptGetterCalls = 0
    const accessorAttempts = ['attempt-001']
    Object.defineProperty(accessorAttempts, '0', {
      enumerable: true,
      get() {
        attemptGetterCalls += 1
        return 'attempt-accessor'
      }
    })
    expect(() =>
      parseBackendAutomationIdempotencyRecord({ ...source, attemptIds: accessorAttempts })
    ).toThrow()
    expect(attemptGetterCalls).toBe(0)

    const tooManyAttempts = Array.from(
      { length: BACKEND_AUTOMATION_IDEMPOTENCY_MAX_ATTEMPTS + 1 },
      (_, index) => `attempt-${index}`
    )
    const placeholderDigest = await digest('placeholder')
    expect(() =>
      parseBackendAutomationIdempotencyRecord({
        ...source,
        revision: BACKEND_AUTOMATION_IDEMPOTENCY_MAX_ATTEMPTS,
        previousRecordDigest: placeholderDigest,
        attemptIds: tooManyAttempts,
        currentAttemptId: tooManyAttempts.at(-1)
      })
    ).toThrow()
    expect(() => parseBackendAutomationIdempotencyRecord({ ...source, extra: true })).toThrow()
    expect(() =>
      parseBackendAutomationIdempotencyRecord({ ...source, hostEvidenceAuthenticated: true })
    ).toThrow()
  })

  test('rejects accessor-backed and extended CAS proposal data without invoking accessors', async () => {
    const source = await initialRecord()
    const candidate = await createBackendAutomationIdempotencyCASProposal(null, source)
    let getterCalls = 0
    const accessor = { ...candidate.proposal }
    Object.defineProperty(accessor, 'nextRecordDigest', {
      enumerable: true,
      get() {
        getterCalls += 1
        return candidate.recordDigest
      }
    })
    expect(() => parseBackendAutomationIdempotencyCASProposal(accessor)).toThrow()
    expect(getterCalls).toBe(0)
    expect(() =>
      parseBackendAutomationIdempotencyCASProposal(new Proxy(candidate.proposal, {}))
    ).toThrow()
    expect(() =>
      parseBackendAutomationIdempotencyCASProposal({ ...candidate.proposal, extra: true })
    ).toThrow()
    expect(() =>
      parseBackendAutomationIdempotencyCASProposal({
        ...candidate.proposal,
        persistenceAuthorityGranted: true
      })
    ).toThrow()
  })

  test('snapshots current, next, and proposal before the first asynchronous digest boundary', async () => {
    const initial = await initialRecord()
    const dispatched = await dispatchStarted(initial)
    const creation = createBackendAutomationIdempotencyCASProposal(initial, dispatched)

    initial.eventId = 'event-mutated-after-call'
    dispatched.operationId = 'operation-mutated-after-call'

    const candidate = await creation
    expect(candidate.record.eventId).toBe('event-001')
    expect(candidate.record.operationId).toBe('operation-001')

    const current = await initialRecord()
    const next = await dispatchStarted(current)
    const proposal = { ...candidate.proposal }
    const verification = verifyBackendAutomationIdempotencyCASProposal(proposal, current, next)

    proposal.eventId = 'event-mutated-after-call'
    current.causationId = 'causation-mutated-after-call'
    next.currentAttemptId = 'attempt-mutated-after-call'

    await expect(verification).resolves.toMatchObject({
      proposal: { eventId: 'event-001' },
      record: { causationId: 'causation-001', currentAttemptId: 'attempt-001' }
    })
  })

  test('retains exact typed output across parse boundaries', async () => {
    const source = await initialRecord()
    const parsed: BackendAutomationIdempotencyRecordV1 =
      parseBackendAutomationIdempotencyRecord(source)
    const cloned = structuredClone(parsed)
    expect(parseBackendAutomationIdempotencyRecord(cloned)).toEqual(parsed)
  })
})
