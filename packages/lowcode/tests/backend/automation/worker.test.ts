/* eslint-disable max-lines -- queue lifecycle, hostile-data, timing, and evidence cases are one focused contract suite */
import { describe, expect, test } from 'bun:test'

import {
  BACKEND_AUTOMATION_EXECUTION_INPUT_FORMAT,
  planBackendAutomationExecutionDisposition,
  type BackendAutomationExecutionDispositionV1
} from '#lowcode/backend/automation/execution'
import {
  BACKEND_AUTOMATION_IDEMPOTENCY_RECORD_FORMAT,
  createBackendAutomationIdempotencyCASProposal,
  digestBackendAutomationIdempotencyCASProposal,
  digestBackendAutomationIdempotencyRecord,
  parseBackendAutomationIdempotencyRecord
} from '#lowcode/backend/automation/idempotency'
import {
  BACKEND_AUTOMATION_QUEUE_LEASE_FORMAT,
  BACKEND_AUTOMATION_QUEUE_MESSAGE_FORMAT,
  BACKEND_AUTOMATION_QUEUE_MUTATION_PROPOSAL_FORMAT,
  BACKEND_AUTOMATION_WORKER_CAS_PROPOSAL_FORMAT,
  BACKEND_AUTOMATION_WORKER_MAX_PAYLOAD_BYTES,
  BACKEND_AUTOMATION_WORKER_MAX_VISIBILITY_EXTENSIONS,
  BACKEND_AUTOMATION_WORKER_RECORD_FORMAT,
  canonicalBackendAutomationQueueLeaseObservationBytes,
  canonicalBackendAutomationQueueMessageEnvelopeBytes,
  canonicalBackendAutomationQueueMutationProposalBytes,
  canonicalBackendAutomationWorkerCASProposalBytes,
  canonicalBackendAutomationWorkerRecordBytes,
  createBackendAutomationWorkerDeduplicationCASProposal,
  createBackendAutomationWorkerCASProposal,
  digestBackendAutomationQueueLeaseObservation,
  digestBackendAutomationQueueMessageEnvelope,
  digestBackendAutomationQueueMutationProposal,
  digestBackendAutomationWorkerCASProposal,
  digestBackendAutomationWorkerRecord,
  parseBackendAutomationQueueLeaseObservation,
  parseBackendAutomationQueueMessageEnvelope,
  parseBackendAutomationQueueMutationProposal,
  parseBackendAutomationWorkerRecord,
  planBackendAutomationQueueMutation,
  verifyBackendAutomationQueueLeaseObservation,
  verifyBackendAutomationWorkerDeduplicationCASProposal,
  verifyBackendAutomationWorkerCASProposal,
  type BackendAutomationWorkerDeduplicationInputV1
} from '#lowcode/backend/automation/worker'

import { digestCanonicalManifest } from '@open-pencil/scene-graph'

const ENQUEUED_AT = '2026-09-09T00:00:00.000000000Z'
const RETENTION_DEADLINE = '2026-09-09T01:00:00.000000000Z'
const RECEIVED_AT = '2026-09-09T00:00:01.000000000Z'
const VISIBILITY_DEADLINE = '2026-09-09T00:01:01.000000000Z'

const NO_AUTHORITY = Object.freeze({
  hostEvidenceAuthenticated: false,
  persistenceAuthorityGranted: false,
  dispatchAuthorityGranted: false,
  ackAuthorityGranted: false,
  releaseAuthorityGranted: false
} as const)

async function digest(label: string): Promise<string> {
  return digestCanonicalManifest({ label })
}

async function message(
  overrides: Readonly<Record<string, unknown>> = {}
): Promise<Record<string, unknown>> {
  return {
    format: BACKEND_AUTOMATION_QUEUE_MESSAGE_FORMAT,
    version: 1,
    queueId: 'queue-orders',
    messageId: 'message-001',
    automationId: 'automation-orders',
    eventId: 'event-001',
    operationId: 'operation-001',
    idempotencyKeyDigest: await digest('idempotency-key'),
    causationId: 'causation-001',
    causationHop: 1,
    causationMaxHop: 8,
    payloadDigest: await digest('payload'),
    payloadByteLength: 128,
    maxPayloadBytes: 1_024,
    visibilityTimeoutSeconds: 60,
    retentionSeconds: 3_600,
    enqueuedAt: ENQUEUED_AT,
    retentionDeadline: RETENTION_DEADLINE,
    payloadIncluded: false,
    ...NO_AUTHORITY,
    ...overrides
  }
}

async function lease(
  messageValue: unknown,
  overrides: Readonly<Record<string, unknown>> = {}
): Promise<Record<string, unknown>> {
  const parsedMessage = parseBackendAutomationQueueMessageEnvelope(messageValue)
  return {
    format: BACKEND_AUTOMATION_QUEUE_LEASE_FORMAT,
    version: 1,
    messageEnvelopeDigest: await digestBackendAutomationQueueMessageEnvelope(parsedMessage),
    queueId: parsedMessage.queueId,
    messageId: parsedMessage.messageId,
    leaseId: 'lease-001',
    deliveryId: 'delivery-001',
    deliveryAttempt: 1,
    attemptId: 'attempt-001',
    receivedAt: RECEIVED_AT,
    observedAt: RECEIVED_AT,
    visibilityDeadline: VISIBILITY_DEADLINE,
    extensionCount: 0,
    leaseEvidenceDigest: await digest('lease-evidence'),
    ...NO_AUTHORITY,
    ...overrides
  }
}

async function receivedWorker(
  messageValue: unknown,
  leaseValue: unknown,
  overrides: Readonly<Record<string, unknown>> = {}
): Promise<Record<string, unknown>> {
  const parsedMessage = parseBackendAutomationQueueMessageEnvelope(messageValue)
  const parsedLease = parseBackendAutomationQueueLeaseObservation(leaseValue)
  return {
    format: BACKEND_AUTOMATION_WORKER_RECORD_FORMAT,
    version: 1,
    messageEnvelopeDigest: await digestBackendAutomationQueueMessageEnvelope(parsedMessage),
    leaseObservationDigest: await digestBackendAutomationQueueLeaseObservation(parsedLease),
    queueId: parsedMessage.queueId,
    messageId: parsedMessage.messageId,
    leaseId: parsedLease.leaseId,
    deliveryId: parsedLease.deliveryId,
    deliveryAttempt: parsedLease.deliveryAttempt,
    automationId: parsedMessage.automationId,
    eventId: parsedMessage.eventId,
    operationId: parsedMessage.operationId,
    idempotencyKeyDigest: parsedMessage.idempotencyKeyDigest,
    causationId: parsedMessage.causationId,
    causationHop: parsedMessage.causationHop,
    causationMaxHop: parsedMessage.causationMaxHop,
    attemptId: parsedLease.attemptId,
    state: 'received',
    revision: 0,
    previousRecordDigest: null,
    recordedAt: parsedLease.observedAt,
    transitionEvidenceDigest: parsedLease.leaseEvidenceDigest,
    idempotencyCASDigest: null,
    idempotencyRecordDigest: null,
    idempotencyState: null,
    reconciliationEvidenceDigest: null,
    ...NO_AUTHORITY,
    ...overrides
  }
}

async function nextWorker(
  previousValue: unknown,
  overrides: Readonly<Record<string, unknown>>
): Promise<Record<string, unknown>> {
  const previous = parseBackendAutomationWorkerRecord(previousValue)
  const nextRevision = previous.revision + 1
  return {
    ...previous,
    revision: nextRevision,
    previousRecordDigest: await digestBackendAutomationWorkerRecord(previous),
    recordedAt: `2026-09-09T00:00:01.${String(nextRevision).padStart(9, '0')}Z`,
    transitionEvidenceDigest: await digest(`worker-transition-${nextRevision}`),
    ...overrides
  }
}

async function preDispatchWorker(previous: unknown): Promise<Record<string, unknown>> {
  return nextWorker(previous, {
    state: 'pre-dispatch-outcome-unknown',
    idempotencyCASDigest: await digest('idempotency-pre-cas'),
    idempotencyRecordDigest: await digest('idempotency-pre-record'),
    idempotencyState: 'dispatch-started',
    reconciliationEvidenceDigest: null
  })
}

async function terminalWorker(
  previous: unknown,
  state: 'succeeded' | 'known-not-dispatched',
  reconciliationEvidenceDigest?: string | null
): Promise<Record<string, unknown>> {
  const reconciliation =
    reconciliationEvidenceDigest === undefined && state === 'known-not-dispatched'
      ? await digest('known-not-dispatched-reconciliation')
      : (reconciliationEvidenceDigest ?? null)
  return nextWorker(previous, {
    state,
    idempotencyCASDigest: await digest(`${state}-cas`),
    idempotencyRecordDigest: await digest(`${state}-record`),
    idempotencyState: state,
    reconciliationEvidenceDigest: reconciliation
  })
}

async function unknownWorker(previous: unknown): Promise<Record<string, unknown>> {
  return nextWorker(previous, {
    state: 'outcome-unknown',
    idempotencyCASDigest: await digest('outcome-unknown-cas'),
    idempotencyRecordDigest: await digest('outcome-unknown-record'),
    idempotencyState: 'outcome-unknown',
    reconciliationEvidenceDigest: null
  })
}

async function disposition(
  workerValue: unknown,
  options: Readonly<{ maxAttempts?: number; deadLetterQueueId?: string | null }> = {}
): Promise<BackendAutomationExecutionDispositionV1> {
  const worker = parseBackendAutomationWorkerRecord(workerValue)
  return planBackendAutomationExecutionDisposition({
    format: BACKEND_AUTOMATION_EXECUTION_INPUT_FORMAT,
    version: 1,
    automationId: worker.automationId,
    operationId: worker.operationId,
    attemptId: worker.attemptId,
    eventId: worker.eventId,
    idempotencyDigest: worker.idempotencyKeyDigest,
    causation: {
      id: worker.causationId,
      hop: worker.causationHop,
      maxHop: worker.causationMaxHop
    },
    attemptNumber: worker.deliveryAttempt,
    retryPolicy: {
      maxAttempts: options.maxAttempts ?? 3,
      initialDelayMs: 1_000,
      maxDelayMs: 8_000,
      backoff: 'fixed',
      jitter: 'none',
      deadLetterQueueId: options.deadLetterQueueId ?? null
    },
    observedOutcome: {
      kind: 'retryable-failure',
      stableCode: 'temporary-unavailable',
      evidenceDigest: worker.transitionEvidenceDigest
    },
    jitterUint32: null
  })
}

function mutationRequest(
  kind: 'ack' | 'archive' | 'retry' | 'extend-visibility',
  overrides: Readonly<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    kind,
    proposedAt: '2026-09-09T00:00:10.000000000Z',
    nextVisibilityDeadline: null,
    terminalCASVerificationEvidenceDigest: null,
    executionDisposition: null,
    deadLetterState: null,
    deadLetterMessageEnvelopeDigest: null,
    deadLetterPublishedRecordDigest: null,
    deadLetterCASDigest: null,
    deadLetterPublishVerificationEvidenceDigest: null,
    ...overrides
  }
}

async function reservedIdempotencyRecord(
  messageValue: unknown,
  attemptId: string
): Promise<Record<string, unknown>> {
  const parsedMessage = parseBackendAutomationQueueMessageEnvelope(messageValue)
  return {
    format: BACKEND_AUTOMATION_IDEMPOTENCY_RECORD_FORMAT,
    version: 1,
    automationId: parsedMessage.automationId,
    eventId: parsedMessage.eventId,
    operationId: parsedMessage.operationId,
    idempotencyKeyDigest: parsedMessage.idempotencyKeyDigest,
    causationId: parsedMessage.causationId,
    causationHop: parsedMessage.causationHop,
    retentionHours: 24,
    createdAt: '2026-09-09T00:00:00.000Z',
    expiresAt: '2026-09-10T00:00:00.000Z',
    recordedAt: '2026-09-09T00:00:00.000Z',
    revision: 0,
    previousRecordDigest: null,
    attemptIds: [attemptId],
    currentAttemptId: attemptId,
    state: 'reserved',
    completionEvidenceDigest: null,
    knownNotDispatchedEvidenceDigest: null,
    reconciliationEvidenceDigest: null,
    hostEvidenceAuthenticated: false,
    persistenceAuthorityGranted: false,
    dispatchAuthorityGranted: false
  }
}

async function nextIdempotencyRecord(
  previousValue: unknown,
  overrides: Readonly<Record<string, unknown>>
): Promise<Record<string, unknown>> {
  const previous = parseBackendAutomationIdempotencyRecord(previousValue)
  const nextRevision = previous.revision + 1
  return {
    ...previous,
    revision: nextRevision,
    previousRecordDigest: await digestBackendAutomationIdempotencyRecord(previous),
    recordedAt: `2026-09-09T00:00:${String(nextRevision).padStart(2, '0')}.000Z`,
    ...overrides
  }
}

async function idempotencyBinding(
  current: unknown,
  next: unknown
): Promise<Readonly<{ casDigest: string; recordDigest: string; state: string }>> {
  const candidate = await createBackendAutomationIdempotencyCASProposal(current, next)
  return Object.freeze({
    casDigest: await digestBackendAutomationIdempotencyCASProposal(candidate.proposal),
    recordDigest: candidate.recordDigest,
    state: candidate.record.state
  })
}

async function successfulReplayEvidence(
  messageValue: unknown
): Promise<BackendAutomationWorkerDeduplicationInputV1> {
  const parsedMessage = parseBackendAutomationQueueMessageEnvelope(messageValue)
  const reserved = await reservedIdempotencyRecord(messageValue, 'attempt-original')
  const dispatchStarted = await nextIdempotencyRecord(reserved, { state: 'dispatch-started' })
  const succeeded = await nextIdempotencyRecord(dispatchStarted, {
    state: 'succeeded',
    completionEvidenceDigest: await digest('original-completion-evidence')
  })
  const candidate = await createBackendAutomationIdempotencyCASProposal(dispatchStarted, succeeded)
  return {
    succeededIdempotencyRecord: candidate.record,
    succeededIdempotencyCASProposal: candidate.proposal,
    succeededMessageEnvelopeDigest:
      await digestBackendAutomationQueueMessageEnvelope(parsedMessage),
    succeededPayloadDigest: parsedMessage.payloadDigest,
    persistedHeadRevision: candidate.record.revision,
    persistedHeadDigest: candidate.recordDigest,
    terminalCASVerificationEvidenceDigest: await digest('dedup-terminal-head-verification'),
    recordedAt: '2026-09-09T00:00:03.000000000Z',
    transitionEvidenceDigest: await digest('dedup-worker-transition'),
    ...NO_AUTHORITY
  }
}

describe('provider-neutral Backend Automation queue worker contract', () => {
  test('normalizes digest-only bounded envelopes and canonicalizes them deterministically', async () => {
    const source = await message()
    const reordered = Object.fromEntries(Object.entries(source).reverse())
    const parsed = parseBackendAutomationQueueMessageEnvelope(source)

    expect(Object.isFrozen(parsed)).toBe(true)
    expect(parsed.payloadIncluded).toBe(false)
    expect('payload' in parsed).toBe(false)
    expect(parsed.hostEvidenceAuthenticated).toBe(false)
    expect(parsed.persistenceAuthorityGranted).toBe(false)
    expect(parsed.dispatchAuthorityGranted).toBe(false)
    expect(parsed.ackAuthorityGranted).toBe(false)
    expect(parsed.releaseAuthorityGranted).toBe(false)
    expect(canonicalBackendAutomationQueueMessageEnvelopeBytes(source)).toEqual(
      canonicalBackendAutomationQueueMessageEnvelopeBytes(reordered)
    )
    expect(await digestBackendAutomationQueueMessageEnvelope(source)).toBe(
      await digestBackendAutomationQueueMessageEnvelope(reordered)
    )

    expect(() =>
      parseBackendAutomationQueueMessageEnvelope({ ...source, payload: 'inline' })
    ).toThrow()
    expect(() =>
      parseBackendAutomationQueueMessageEnvelope({
        ...source,
        payloadByteLength: BACKEND_AUTOMATION_WORKER_MAX_PAYLOAD_BYTES + 1,
        maxPayloadBytes: BACKEND_AUTOMATION_WORKER_MAX_PAYLOAD_BYTES
      })
    ).toThrow()
    expect(() =>
      parseBackendAutomationQueueMessageEnvelope({ ...source, payloadByteLength: -0 })
    ).toThrow()
    expect(
      parseBackendAutomationQueueMessageEnvelope({
        ...source,
        payloadByteLength: BACKEND_AUTOMATION_WORKER_MAX_PAYLOAD_BYTES,
        maxPayloadBytes: BACKEND_AUTOMATION_WORKER_MAX_PAYLOAD_BYTES
      }).payloadByteLength
    ).toBe(BACKEND_AUTOMATION_WORKER_MAX_PAYLOAD_BYTES)
  })

  test('rejects hostile own-data shapes without invoking accessors or leaking attacker text', async () => {
    const source = await message()
    const inherited = Object.assign(Object.create({ inherited: true }), source)
    expect(() => parseBackendAutomationQueueMessageEnvelope(inherited)).toThrow(
      'Backend Automation queue message envelope is invalid.'
    )

    let getterCalls = 0
    const accessor = { ...source }
    Object.defineProperty(accessor, 'queueId', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'queue-attacker'
      }
    })
    expect(() => parseBackendAutomationQueueMessageEnvelope(accessor)).toThrow()
    expect(getterCalls).toBe(0)

    const proxied = new Proxy(source, {
      ownKeys() {
        throw new Error('sb_secret_do-not-reflect-this')
      }
    })
    expect(() => parseBackendAutomationQueueMessageEnvelope(proxied)).toThrow(
      'Backend Automation queue message envelope is invalid.'
    )
    expect(() => parseBackendAutomationQueueMessageEnvelope(new Proxy(source, {}))).toThrow(
      'Backend Automation queue message envelope is invalid.'
    )

    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => parseBackendAutomationQueueMessageEnvelope({ ...source, extra: cyclic })).toThrow()

    let deep: unknown = 'leaf'
    for (let index = 0; index < 1_000; index += 1) deep = { deep }
    expect(() => parseBackendAutomationQueueMessageEnvelope({ ...source, queueId: deep })).toThrow()
    expect(() =>
      parseBackendAutomationQueueMessageEnvelope({
        ...source,
        queueId: 'sb_secret_hidden-credential'
      })
    ).toThrow('Backend Automation queue message envelope is invalid.')
  })

  test('binds a Host lease observation to one message, delivery, attempt, and nanosecond window', async () => {
    const source = await message()
    const observed = await lease(source)
    const binding = await verifyBackendAutomationQueueLeaseObservation(source, observed)
    const reordered = Object.fromEntries(Object.entries(observed).reverse())

    expect(Object.isFrozen(binding)).toBe(true)
    expect(Object.isFrozen(binding.message)).toBe(true)
    expect(Object.isFrozen(binding.lease)).toBe(true)
    expect(canonicalBackendAutomationQueueLeaseObservationBytes(observed)).toEqual(
      canonicalBackendAutomationQueueLeaseObservationBytes(reordered)
    )
    expect(await digestBackendAutomationQueueLeaseObservation(observed)).toBe(
      await digestBackendAutomationQueueLeaseObservation(reordered)
    )

    await expect(
      verifyBackendAutomationQueueLeaseObservation(source, {
        ...observed,
        queueId: 'queue-other'
      })
    ).rejects.toThrow()
    await expect(
      verifyBackendAutomationQueueLeaseObservation(source, {
        ...observed,
        messageEnvelopeDigest: await digest('other-envelope')
      })
    ).rejects.toThrow()
    await expect(
      verifyBackendAutomationQueueLeaseObservation(source, {
        ...observed,
        visibilityDeadline: '2026-09-09T00:01:01.000000001Z'
      })
    ).rejects.toThrow()
    expect(() =>
      parseBackendAutomationQueueLeaseObservation({ ...observed, extensionCount: -0 })
    ).toThrow()
  })

  test('persists received then pre-dispatch unknown before settling success, which is immutable', async () => {
    const source = await message()
    const observed = await lease(source)
    const received = await receivedWorker(source, observed)
    const initialCandidate = await createBackendAutomationWorkerCASProposal(
      source,
      observed,
      null,
      received
    )
    expect(initialCandidate.proposal).toMatchObject({
      format: BACKEND_AUTOMATION_WORKER_CAS_PROPOSAL_FORMAT,
      expectedRevision: null,
      expectedHeadDigest: null,
      nextRevision: 0,
      ...NO_AUTHORITY
    })
    expect(initialCandidate.proposal.nextRecordDigest).toBe(initialCandidate.recordDigest)
    expect(Object.isFrozen(initialCandidate)).toBe(true)
    expect(Object.isFrozen(initialCandidate.proposal)).toBe(true)

    const preDispatch = await preDispatchWorker(received)
    await expect(
      createBackendAutomationWorkerCASProposal(source, observed, received, preDispatch)
    ).resolves.toBeDefined()
    const expiredPreDispatch = await nextWorker(received, {
      state: 'pre-dispatch-outcome-unknown',
      recordedAt: VISIBILITY_DEADLINE,
      idempotencyCASDigest: await digest('expired-dispatch-cas'),
      idempotencyRecordDigest: await digest('expired-dispatch-record'),
      idempotencyState: 'dispatch-started'
    })
    await expect(
      createBackendAutomationWorkerCASProposal(source, observed, received, expiredPreDispatch)
    ).rejects.toThrow()
    const succeeded = await terminalWorker(preDispatch, 'succeeded')
    const terminal = await createBackendAutomationWorkerCASProposal(
      source,
      observed,
      preDispatch,
      succeeded
    )
    expect(terminal.record.state).toBe('succeeded')

    const continuation = await nextWorker(succeeded, {
      state: 'known-not-dispatched',
      idempotencyCASDigest: await digest('impossible-cas'),
      idempotencyRecordDigest: await digest('impossible-record'),
      idempotencyState: 'known-not-dispatched'
    })
    await expect(
      createBackendAutomationWorkerCASProposal(source, observed, succeeded, continuation)
    ).rejects.toThrow()

    const directSuccess = await nextWorker(received, {
      state: 'succeeded',
      idempotencyCASDigest: await digest('direct-cas'),
      idempotencyRecordDigest: await digest('direct-record'),
      idempotencyState: 'succeeded'
    })
    await expect(
      createBackendAutomationWorkerCASProposal(source, observed, received, directSuccess)
    ).rejects.toThrow()
  })

  test('models an exact Host-verified succeeded replay as terminal deduplicated and ack-only', async () => {
    const source = await message()
    const observed = await lease(source, {
      leaseId: 'lease-replay',
      deliveryId: 'delivery-replay',
      deliveryAttempt: 2,
      attemptId: 'attempt-replay'
    })
    const received = await receivedWorker(source, observed)
    const replay = await successfulReplayEvidence(source)
    const candidate = await createBackendAutomationWorkerDeduplicationCASProposal(
      source,
      observed,
      received,
      replay
    )

    expect(candidate.record).toMatchObject({
      state: 'deduplicated',
      idempotencyState: 'succeeded',
      idempotencyRecordDigest: replay.persistedHeadDigest,
      reconciliationEvidenceDigest: replay.terminalCASVerificationEvidenceDigest,
      revision: 1,
      ...NO_AUTHORITY
    })
    expect(Object.isFrozen(candidate)).toBe(true)
    expect(Object.isFrozen(candidate.record)).toBe(true)
    expect(Object.isFrozen(candidate.proposal)).toBe(true)
    expect(candidate.proposal).toMatchObject(NO_AUTHORITY)
    expect(canonicalBackendAutomationWorkerRecordBytes(candidate.record)).toEqual(
      canonicalBackendAutomationWorkerRecordBytes(
        Object.fromEntries(Object.entries(candidate.record).reverse())
      )
    )
    await expect(
      verifyBackendAutomationWorkerDeduplicationCASProposal(
        candidate.proposal,
        source,
        observed,
        received,
        candidate.record,
        replay
      )
    ).resolves.toEqual(candidate)

    // Generic lifecycle entry points cannot turn opaque digest claims into a deduplicated record.
    await expect(
      createBackendAutomationWorkerCASProposal(source, observed, received, candidate.record)
    ).rejects.toThrow()
    await expect(
      verifyBackendAutomationWorkerCASProposal(
        candidate.proposal,
        source,
        observed,
        received,
        candidate.record
      )
    ).rejects.toThrow()

    const ack = await planBackendAutomationQueueMutation(
      source,
      observed,
      candidate.record,
      mutationRequest('ack', {
        terminalCASVerificationEvidenceDigest: replay.terminalCASVerificationEvidenceDigest
      })
    )
    expect(ack).toMatchObject({
      kind: 'ack',
      workerState: 'deduplicated',
      terminalCASVerificationEvidenceDigest: replay.terminalCASVerificationEvidenceDigest,
      ...NO_AUTHORITY
    })

    for (const request of [
      mutationRequest('extend-visibility', {
        nextVisibilityDeadline: '2026-09-09T00:01:10.000000000Z'
      }),
      mutationRequest('retry'),
      mutationRequest('archive')
    ]) {
      await expect(
        planBackendAutomationQueueMutation(source, observed, candidate.record, request)
      ).rejects.toThrow()
    }

    const continuation = await nextWorker(candidate.record, {
      state: 'succeeded',
      idempotencyCASDigest: await digest('continued-cas'),
      idempotencyRecordDigest: await digest('continued-record'),
      idempotencyState: 'succeeded',
      reconciliationEvidenceDigest: null
    })
    await expect(
      createBackendAutomationWorkerCASProposal(source, observed, candidate.record, continuation)
    ).rejects.toThrow()
  })

  test('rejects forged, cross-bound, stale, or reused succeeded replay evidence', async () => {
    const source = await message()
    const observed = await lease(source, {
      leaseId: 'lease-replay',
      deliveryId: 'delivery-replay',
      deliveryAttempt: 2,
      attemptId: 'attempt-replay'
    })
    const received = await receivedWorker(source, observed)
    const replay = await successfulReplayEvidence(source)
    const record = replay.succeededIdempotencyRecord
    const proposal = replay.succeededIdempotencyCASProposal

    for (const [field, value] of [
      ['automationId', 'automation-other'],
      ['eventId', 'event-other'],
      ['operationId', 'operation-other'],
      ['idempotencyKeyDigest', await digest('idempotency-other')],
      ['causationId', 'causation-other']
    ] as const) {
      await expect(
        createBackendAutomationWorkerDeduplicationCASProposal(source, observed, received, {
          ...replay,
          succeededIdempotencyRecord: { ...record, [field]: value }
        })
      ).rejects.toThrow()
    }
    for (const [field, value] of [
      ['automationId', 'automation-other'],
      ['eventId', 'event-other'],
      ['operationId', 'operation-other'],
      ['idempotencyKeyDigest', await digest('idempotency-other')]
    ] as const) {
      await expect(
        createBackendAutomationWorkerDeduplicationCASProposal(source, observed, received, {
          ...replay,
          succeededIdempotencyCASProposal: { ...proposal, [field]: value }
        })
      ).rejects.toThrow()
    }

    for (const override of [
      { succeededMessageEnvelopeDigest: await digest('other-succeeded-envelope') },
      { succeededPayloadDigest: await digest('other-succeeded-payload') },
      { persistedHeadRevision: Number(replay.persistedHeadRevision) + 1 },
      { persistedHeadDigest: await digest('stale-persisted-head') },
      {
        succeededIdempotencyCASProposal: {
          ...proposal,
          nextRecordDigest: await digest('forged-next-record')
        }
      },
      { succeededIdempotencyRecord: { ...record, state: 'reserved' } },
      { dispatchAuthorityGranted: true }
    ]) {
      await expect(
        createBackendAutomationWorkerDeduplicationCASProposal(source, observed, received, {
          ...replay,
          ...override
        })
      ).rejects.toThrow()
    }

    const changedPayloadMessage = {
      ...source,
      payloadDigest: await digest('changed-replay-payload')
    }
    const changedPayloadLease = await lease(changedPayloadMessage, {
      leaseId: 'lease-changed-payload',
      deliveryId: 'delivery-changed-payload',
      deliveryAttempt: 2,
      attemptId: 'attempt-changed-payload'
    })
    const changedPayloadReceived = await receivedWorker(changedPayloadMessage, changedPayloadLease)
    await expect(
      createBackendAutomationWorkerDeduplicationCASProposal(
        changedPayloadMessage,
        changedPayloadLease,
        changedPayloadReceived,
        replay
      )
    ).rejects.toThrow()

    const casDigest = await digestBackendAutomationIdempotencyCASProposal(proposal)
    const completionEvidenceDigest = record.completionEvidenceDigest
    const receivedHeadDigest = await digestBackendAutomationWorkerRecord(received)
    const messageEnvelopeDigest = await digestBackendAutomationQueueMessageEnvelope(source)
    const payloadDigest = parseBackendAutomationQueueMessageEnvelope(source).payloadDigest
    for (const reused of [
      casDigest,
      replay.persistedHeadDigest,
      replay.transitionEvidenceDigest,
      completionEvidenceDigest,
      receivedHeadDigest,
      messageEnvelopeDigest,
      payloadDigest,
      parseBackendAutomationWorkerRecord(received).transitionEvidenceDigest
    ]) {
      await expect(
        createBackendAutomationWorkerDeduplicationCASProposal(source, observed, received, {
          ...replay,
          terminalCASVerificationEvidenceDigest: reused
        })
      ).rejects.toThrow()
    }
    for (const reused of [
      casDigest,
      replay.persistedHeadDigest,
      replay.terminalCASVerificationEvidenceDigest,
      completionEvidenceDigest,
      receivedHeadDigest,
      messageEnvelopeDigest,
      payloadDigest,
      parseBackendAutomationWorkerRecord(received).transitionEvidenceDigest
    ]) {
      await expect(
        createBackendAutomationWorkerDeduplicationCASProposal(source, observed, received, {
          ...replay,
          transitionEvidenceDigest: reused
        })
      ).rejects.toThrow()
    }

    const candidate = await createBackendAutomationWorkerDeduplicationCASProposal(
      source,
      observed,
      received,
      replay
    )
    await expect(
      planBackendAutomationQueueMutation(
        source,
        observed,
        candidate.record,
        mutationRequest('ack', {
          terminalCASVerificationEvidenceDigest: await digest('different-terminal-verification')
        })
      )
    ).rejects.toThrow()

    const preDispatch = await preDispatchWorker(received)
    const unknown = await unknownWorker(preDispatch)
    await expect(
      createBackendAutomationWorkerDeduplicationCASProposal(source, observed, unknown, replay)
    ).rejects.toThrow()
  })

  test('binds worker stages to CAS digests from the legal idempotency ledger chain', async () => {
    const source = await message()
    const observed = await lease(source)
    const parsedLease = parseBackendAutomationQueueLeaseObservation(observed)
    const received = await receivedWorker(source, observed)
    const reserved = await reservedIdempotencyRecord(source, parsedLease.attemptId)
    await expect(
      createBackendAutomationIdempotencyCASProposal(null, reserved)
    ).resolves.toBeDefined()

    const dispatchRecord = await nextIdempotencyRecord(reserved, { state: 'dispatch-started' })
    const dispatchBinding = await idempotencyBinding(reserved, dispatchRecord)
    const preDispatch = await nextWorker(received, {
      state: 'pre-dispatch-outcome-unknown',
      idempotencyCASDigest: dispatchBinding.casDigest,
      idempotencyRecordDigest: dispatchBinding.recordDigest,
      idempotencyState: dispatchBinding.state
    })
    await expect(
      createBackendAutomationWorkerCASProposal(source, observed, received, preDispatch)
    ).resolves.toBeDefined()

    const unknownRecord = await nextIdempotencyRecord(dispatchRecord, {
      state: 'outcome-unknown'
    })
    const unknownBinding = await idempotencyBinding(dispatchRecord, unknownRecord)
    const unknown = await nextWorker(preDispatch, {
      state: 'outcome-unknown',
      idempotencyCASDigest: unknownBinding.casDigest,
      idempotencyRecordDigest: unknownBinding.recordDigest,
      idempotencyState: unknownBinding.state
    })
    await expect(
      createBackendAutomationWorkerCASProposal(source, observed, preDispatch, unknown)
    ).resolves.toBeDefined()

    const reconciliation = await digest('idempotency-negative-reconciliation')
    const knownRecord = await nextIdempotencyRecord(unknownRecord, {
      state: 'known-not-dispatched',
      knownNotDispatchedEvidenceDigest: await digest('idempotency-known-not-dispatched'),
      reconciliationEvidenceDigest: reconciliation
    })
    const knownBinding = await idempotencyBinding(unknownRecord, knownRecord)
    const known = await nextWorker(unknown, {
      state: 'known-not-dispatched',
      idempotencyCASDigest: knownBinding.casDigest,
      idempotencyRecordDigest: knownBinding.recordDigest,
      idempotencyState: knownBinding.state,
      reconciliationEvidenceDigest: reconciliation
    })
    await expect(
      createBackendAutomationWorkerCASProposal(source, observed, unknown, known)
    ).resolves.toBeDefined()

    const successRecord = await nextIdempotencyRecord(dispatchRecord, {
      state: 'succeeded',
      completionEvidenceDigest: await digest('idempotency-completion')
    })
    const successBinding = await idempotencyBinding(dispatchRecord, successRecord)
    const succeeded = await nextWorker(preDispatch, {
      state: 'succeeded',
      idempotencyCASDigest: successBinding.casDigest,
      idempotencyRecordDigest: successBinding.recordDigest,
      idempotencyState: successBinding.state
    })
    await expect(
      createBackendAutomationWorkerCASProposal(source, observed, preDispatch, succeeded)
    ).resolves.toBeDefined()
  })

  test('keeps outcome-unknown fenced from ack, retry, and archive until reconciliation', async () => {
    const source = await message()
    const observed = await lease(source)
    const received = await receivedWorker(source, observed)
    const preDispatch = await preDispatchWorker(received)
    const unprovedNonDispatch = await terminalWorker(preDispatch, 'known-not-dispatched', null)
    await expect(
      createBackendAutomationWorkerCASProposal(source, observed, preDispatch, unprovedNonDispatch)
    ).rejects.toThrow()
    const unknown = await unknownWorker(preDispatch)
    await expect(
      createBackendAutomationWorkerCASProposal(source, observed, preDispatch, unknown)
    ).resolves.toBeDefined()
    const parsedPreDispatch = parseBackendAutomationWorkerRecord(preDispatch)
    await expect(
      createBackendAutomationWorkerCASProposal(source, observed, preDispatch, {
        ...unknown,
        idempotencyCASDigest: parsedPreDispatch.idempotencyCASDigest,
        idempotencyRecordDigest: parsedPreDispatch.idempotencyRecordDigest
      })
    ).rejects.toThrow()
    const partialPairReplay = await nextWorker(unknown, {
      state: 'outcome-unknown',
      idempotencyCASDigest: await digest('partial-reconciliation-cas'),
      reconciliationEvidenceDigest: await digest('fresh-unknown-reconciliation')
    })
    await expect(
      createBackendAutomationWorkerCASProposal(source, observed, unknown, partialPairReplay)
    ).rejects.toThrow()
    const oldUnknownEvidence = await nextWorker(unknown, {
      state: 'outcome-unknown',
      reconciliationEvidenceDigest:
        parseBackendAutomationWorkerRecord(unknown).transitionEvidenceDigest
    })
    await expect(
      createBackendAutomationWorkerCASProposal(source, observed, unknown, oldUnknownEvidence)
    ).rejects.toThrow()
    const planned = await disposition(unknown)
    const terminalEvidence = await digest('terminal-verification')

    for (const request of [
      mutationRequest('ack', { terminalCASVerificationEvidenceDigest: terminalEvidence }),
      mutationRequest('retry', {
        terminalCASVerificationEvidenceDigest: terminalEvidence,
        executionDisposition: planned,
        nextVisibilityDeadline: '2026-09-09T00:00:11.000000000Z'
      }),
      mutationRequest('archive', {
        terminalCASVerificationEvidenceDigest: terminalEvidence,
        executionDisposition: planned
      })
    ]) {
      await expect(
        planBackendAutomationQueueMutation(source, observed, unknown, request)
      ).rejects.toThrow()
    }

    const reconciled = await terminalWorker(
      unknown,
      'known-not-dispatched',
      await digest('negative-reconciliation')
    )
    await expect(
      createBackendAutomationWorkerCASProposal(source, observed, unknown, reconciled)
    ).resolves.toBeDefined()
  })

  test('binds CAS concurrency proposals and rejects tampering or stale replay', async () => {
    const source = await message()
    const observed = await lease(source)
    const received = await receivedWorker(source, observed)
    const preDispatchA = await preDispatchWorker(received)
    const preDispatchB = {
      ...preDispatchA,
      transitionEvidenceDigest: await digest('concurrent-transition')
    }
    const candidateA = await createBackendAutomationWorkerCASProposal(
      source,
      observed,
      received,
      preDispatchA
    )
    const candidateB = await createBackendAutomationWorkerCASProposal(
      source,
      observed,
      received,
      preDispatchB
    )
    expect(candidateA.proposal.expectedHeadDigest).toBe(candidateB.proposal.expectedHeadDigest)
    expect(candidateA.proposal.nextRecordDigest).not.toBe(candidateB.proposal.nextRecordDigest)

    await expect(
      verifyBackendAutomationWorkerCASProposal(
        candidateA.proposal,
        source,
        observed,
        received,
        preDispatchB
      )
    ).rejects.toThrow()
    await expect(
      verifyBackendAutomationWorkerCASProposal(
        candidateA.proposal,
        source,
        observed,
        null,
        received
      )
    ).rejects.toThrow()
    await expect(
      verifyBackendAutomationWorkerCASProposal(
        { ...candidateA.proposal, nextRecordDigest: await digest('tampered') },
        source,
        observed,
        received,
        preDispatchA
      )
    ).rejects.toThrow()

    const reordered = Object.fromEntries(Object.entries(candidateA.proposal).reverse())
    expect(canonicalBackendAutomationWorkerCASProposalBytes(candidateA.proposal)).toEqual(
      canonicalBackendAutomationWorkerCASProposalBytes(reordered)
    )
    expect(await digestBackendAutomationWorkerCASProposal(candidateA.proposal)).toBe(
      await digestBackendAutomationWorkerCASProposal(reordered)
    )
    expect(canonicalBackendAutomationWorkerRecordBytes(preDispatchA)).toEqual(
      canonicalBackendAutomationWorkerRecordBytes(
        Object.fromEntries(Object.entries(preDispatchA).reverse())
      )
    )
    expect(await digestBackendAutomationWorkerRecord(preDispatchA)).toBe(
      await digestBackendAutomationWorkerRecord(
        Object.fromEntries(Object.entries(preDispatchA).reverse())
      )
    )
  })

  test('snapshots lifecycle and mutation inputs before the first asynchronous digest boundary', async () => {
    const source = await message()
    const observed = await lease(source)
    const received = await receivedWorker(source, observed)
    const mutablePreDispatch = await preDispatchWorker(received)
    const pendingCAS = createBackendAutomationWorkerCASProposal(
      source,
      observed,
      received,
      mutablePreDispatch
    )
    mutablePreDispatch.state = 'succeeded'
    mutablePreDispatch.idempotencyState = 'succeeded'
    const candidate = await pendingCAS
    expect(candidate.record.state).toBe('pre-dispatch-outcome-unknown')

    const preDispatch = await preDispatchWorker(received)
    const succeeded = await terminalWorker(preDispatch, 'succeeded')
    const mutableRequest = mutationRequest('ack', {
      terminalCASVerificationEvidenceDigest: await digest('terminal-verification')
    })
    const pendingMutation = planBackendAutomationQueueMutation(
      source,
      observed,
      succeeded,
      mutableRequest
    )
    mutableRequest.kind = 'retry'
    mutableRequest.terminalCASVerificationEvidenceDigest = null
    expect((await pendingMutation).kind).toBe('ack')
  })

  test('extends visibility only within bounded count, timeout, and retention nanoseconds', async () => {
    const source = await message()
    const nearRetentionLease = await lease(source, {
      receivedAt: RECEIVED_AT,
      observedAt: '2026-09-09T00:59:00.000000000Z',
      visibilityDeadline: '2026-09-09T00:59:30.000000000Z',
      extensionCount: 1
    })
    const worker = await receivedWorker(source, nearRetentionLease)
    const exactRetention = mutationRequest('extend-visibility', {
      proposedAt: '2026-09-09T00:59:00.000000001Z',
      nextVisibilityDeadline: RETENTION_DEADLINE
    })
    const proposal = await planBackendAutomationQueueMutation(
      source,
      nearRetentionLease,
      worker,
      exactRetention
    )
    expect(proposal).toMatchObject({
      kind: 'extend-visibility',
      nextVisibilityDeadline: RETENTION_DEADLINE,
      nextExtensionCount: 2,
      idempotencyCASDigest: null,
      ackAuthorityGranted: false
    })
    await expect(
      planBackendAutomationQueueMutation(source, nearRetentionLease, worker, {
        ...exactRetention,
        nextVisibilityDeadline: '2026-09-09T01:00:00.000000001Z'
      })
    ).rejects.toThrow()

    const exhaustedLease = await lease(source, {
      extensionCount: BACKEND_AUTOMATION_WORKER_MAX_VISIBILITY_EXTENSIONS
    })
    const exhaustedWorker = await receivedWorker(source, exhaustedLease)
    await expect(
      planBackendAutomationQueueMutation(
        source,
        exhaustedLease,
        exhaustedWorker,
        mutationRequest('extend-visibility', {
          nextVisibilityDeadline: '2026-09-09T00:01:10.000000000Z'
        })
      )
    ).rejects.toThrow()
  })

  test('acks only success with a separate terminal CAS verification digest', async () => {
    const source = await message()
    const observed = await lease(source)
    const received = await receivedWorker(source, observed)
    const preDispatch = await preDispatchWorker(received)
    const succeeded = await terminalWorker(preDispatch, 'succeeded')
    const verification = await digest('authenticated-terminal-cas-verification')
    const proposal = await planBackendAutomationQueueMutation(
      source,
      observed,
      succeeded,
      mutationRequest('ack', { terminalCASVerificationEvidenceDigest: verification })
    )
    expect(proposal).toMatchObject({
      format: BACKEND_AUTOMATION_QUEUE_MUTATION_PROPOSAL_FORMAT,
      kind: 'ack',
      workerState: 'succeeded',
      terminalCASVerificationEvidenceDigest: verification,
      ...NO_AUTHORITY
    })
    expect(Object.isFrozen(proposal)).toBe(true)
    const reordered = Object.fromEntries(Object.entries(proposal).reverse())
    expect(canonicalBackendAutomationQueueMutationProposalBytes(proposal)).toEqual(
      canonicalBackendAutomationQueueMutationProposalBytes(reordered)
    )
    expect(await digestBackendAutomationQueueMutationProposal(proposal)).toBe(
      await digestBackendAutomationQueueMutationProposal(reordered)
    )

    const parsedSucceeded = parseBackendAutomationWorkerRecord(succeeded)
    for (const reused of [
      null,
      parsedSucceeded.idempotencyCASDigest,
      parsedSucceeded.idempotencyRecordDigest,
      parsedSucceeded.transitionEvidenceDigest
    ]) {
      await expect(
        planBackendAutomationQueueMutation(
          source,
          observed,
          succeeded,
          mutationRequest('ack', { terminalCASVerificationEvidenceDigest: reused })
        )
      ).rejects.toThrow()
    }
    await expect(
      planBackendAutomationQueueMutation(
        source,
        observed,
        succeeded,
        mutationRequest('ack', {
          proposedAt: '2026-09-09T00:00:01.000000001Z',
          terminalCASVerificationEvidenceDigest: verification
        })
      )
    ).rejects.toThrow()
  })

  test('retries only known-not-dispatched using an exactly bound verified disposition', async () => {
    const source = await message()
    const observed = await lease(source)
    const received = await receivedWorker(source, observed)
    const preDispatch = await preDispatchWorker(received)
    const known = await terminalWorker(preDispatch, 'known-not-dispatched')
    const planned = await disposition(known)
    const verification = await digest('terminal-verification')
    const request = mutationRequest('retry', {
      terminalCASVerificationEvidenceDigest: verification,
      executionDisposition: planned,
      nextVisibilityDeadline: '2026-09-09T00:00:11.000000000Z'
    })
    const proposal = await planBackendAutomationQueueMutation(source, observed, known, request)
    expect(proposal).toMatchObject({
      kind: 'retry',
      dispositionKind: 'retry',
      nextVisibilityDeadline: '2026-09-09T00:00:11.000000000Z',
      nextExtensionCount: null,
      ackAuthorityGranted: false
    })

    const crossBindings: BackendAutomationExecutionDispositionV1[] = [
      {
        ...planned,
        input: { ...planned.input, attemptId: 'attempt-other' }
      },
      {
        ...planned,
        input: { ...planned.input, eventId: 'event-other' }
      },
      {
        ...planned,
        input: { ...planned.input, idempotencyDigest: await digest('other-key') }
      }
    ]
    for (const crossBound of crossBindings) {
      await expect(
        planBackendAutomationQueueMutation(source, observed, known, {
          ...request,
          executionDisposition: crossBound
        })
      ).rejects.toThrow()
    }
    await expect(
      planBackendAutomationQueueMutation(source, observed, known, {
        ...request,
        nextVisibilityDeadline: '2026-09-09T00:00:11.000000001Z'
      })
    ).rejects.toThrow()

    const nearRetentionLease = await lease(source, {
      observedAt: '2026-09-09T00:59:00.000000000Z',
      visibilityDeadline: RETENTION_DEADLINE,
      extensionCount: 1
    })
    const nearRetentionReceived = await receivedWorker(source, nearRetentionLease)
    const nearRetentionPre = await nextWorker(nearRetentionReceived, {
      state: 'pre-dispatch-outcome-unknown',
      recordedAt: '2026-09-09T00:59:00.000000001Z',
      idempotencyCASDigest: await digest('near-retention-dispatch-cas'),
      idempotencyRecordDigest: await digest('near-retention-dispatch-record'),
      idempotencyState: 'dispatch-started'
    })
    const nearRetentionKnown = await nextWorker(nearRetentionPre, {
      state: 'known-not-dispatched',
      recordedAt: '2026-09-09T00:59:00.000000002Z',
      idempotencyCASDigest: await digest('near-retention-known-cas'),
      idempotencyRecordDigest: await digest('near-retention-known-record'),
      idempotencyState: 'known-not-dispatched',
      reconciliationEvidenceDigest: await digest('near-retention-reconciliation')
    })
    const nearRetentionDisposition = await disposition(nearRetentionKnown)
    await expect(
      planBackendAutomationQueueMutation(
        source,
        nearRetentionLease,
        nearRetentionKnown,
        mutationRequest('retry', {
          proposedAt: '2026-09-09T00:59:59.000000000Z',
          terminalCASVerificationEvidenceDigest: verification,
          executionDisposition: nearRetentionDisposition,
          nextVisibilityDeadline: RETENTION_DEADLINE
        })
      )
    ).rejects.toThrow()
  })

  test('requires an exact claimed-published DLQ record before proposing source archive', async () => {
    const source = await message()
    const observed = await lease(source)
    const received = await receivedWorker(source, observed)
    const preDispatch = await preDispatchWorker(received)
    const known = await terminalWorker(preDispatch, 'known-not-dispatched')
    const planned = await disposition(known, {
      maxAttempts: 1,
      deadLetterQueueId: 'queue-orders-dead-letter'
    })
    expect(planned.decision.kind).toBe('dead-letter')
    const terminalVerification = await digest('terminal-cas-verification')
    const deadLetterEnvelope = await digest('dead-letter-message-envelope')
    const deadLetterRecord = await digest('dead-letter-published-record')
    const deadLetterCAS = await digest('dead-letter-publish-cas')
    const deadLetterVerification = await digest('dead-letter-publish-verification')
    const request = mutationRequest('archive', {
      terminalCASVerificationEvidenceDigest: terminalVerification,
      executionDisposition: planned,
      deadLetterState: 'published',
      deadLetterMessageEnvelopeDigest: deadLetterEnvelope,
      deadLetterPublishedRecordDigest: deadLetterRecord,
      deadLetterCASDigest: deadLetterCAS,
      deadLetterPublishVerificationEvidenceDigest: deadLetterVerification
    })
    const proposal = await planBackendAutomationQueueMutation(source, observed, known, request)
    expect(proposal).toMatchObject({
      kind: 'archive',
      dispositionKind: 'dead-letter',
      deadLetterQueueId: 'queue-orders-dead-letter',
      deadLetterState: 'published',
      deadLetterMessageEnvelopeDigest: deadLetterEnvelope,
      deadLetterPublishedRecordDigest: deadLetterRecord,
      deadLetterCASDigest: deadLetterCAS,
      deadLetterPublishVerificationEvidenceDigest: deadLetterVerification,
      ackAuthorityGranted: false
    })

    const parsedKnown = parseBackendAutomationWorkerRecord(known)
    for (const reused of [
      parsedKnown.idempotencyCASDigest,
      parsedKnown.idempotencyRecordDigest,
      parsedKnown.transitionEvidenceDigest,
      terminalVerification
    ]) {
      for (const field of [
        'deadLetterMessageEnvelopeDigest',
        'deadLetterPublishedRecordDigest',
        'deadLetterCASDigest',
        'deadLetterPublishVerificationEvidenceDigest'
      ]) {
        await expect(
          planBackendAutomationQueueMutation(source, observed, known, {
            ...request,
            [field]: reused
          })
        ).rejects.toThrow()
      }
    }
    for (const field of [
      'deadLetterState',
      'deadLetterMessageEnvelopeDigest',
      'deadLetterPublishedRecordDigest',
      'deadLetterCASDigest',
      'deadLetterPublishVerificationEvidenceDigest'
    ]) {
      await expect(
        planBackendAutomationQueueMutation(source, observed, known, {
          ...request,
          [field]: null
        })
      ).rejects.toThrow()
    }
    await expect(
      planBackendAutomationQueueMutation(source, observed, known, {
        ...request,
        deadLetterPublishVerificationEvidenceDigest: deadLetterCAS
      })
    ).rejects.toThrow()

    expect(() =>
      parseBackendAutomationQueueMutationProposal({
        ...proposal,
        dispositionKind: 'retry',
        deadLetterQueueId: null,
        deadLetterState: null,
        deadLetterMessageEnvelopeDigest: null,
        deadLetterPublishedRecordDigest: null,
        deadLetterCASDigest: null,
        deadLetterPublishVerificationEvidenceDigest: null
      })
    ).toThrow()
  })

  test('rejects every queue mutation once the observed lease expires', async () => {
    const source = await message()
    const observed = await lease(source)
    const received = await receivedWorker(source, observed)
    const preDispatch = await preDispatchWorker(received)
    const succeeded = await terminalWorker(preDispatch, 'succeeded')
    const known = await terminalWorker(preDispatch, 'known-not-dispatched')
    const retryDisposition = await disposition(known)
    const archiveDisposition = await disposition(known, { maxAttempts: 1 })
    const verification = await digest('terminal-verification')
    const expiredAt = VISIBILITY_DEADLINE
    const requests: ReadonlyArray<readonly [unknown, Record<string, unknown>]> = [
      [
        received,
        mutationRequest('extend-visibility', {
          proposedAt: expiredAt,
          nextVisibilityDeadline: '2026-09-09T00:02:01.000000000Z'
        })
      ],
      [
        succeeded,
        mutationRequest('ack', {
          proposedAt: expiredAt,
          terminalCASVerificationEvidenceDigest: verification
        })
      ],
      [
        known,
        mutationRequest('retry', {
          proposedAt: expiredAt,
          nextVisibilityDeadline: '2026-09-09T00:01:02.000000000Z',
          terminalCASVerificationEvidenceDigest: verification,
          executionDisposition: retryDisposition
        })
      ],
      [
        known,
        mutationRequest('archive', {
          proposedAt: expiredAt,
          terminalCASVerificationEvidenceDigest: verification,
          executionDisposition: archiveDisposition
        })
      ]
    ]
    for (const [worker, request] of requests) {
      await expect(
        planBackendAutomationQueueMutation(source, observed, worker, request)
      ).rejects.toThrow()
    }
  })

  test('rejects secret-like material across lease, worker, and mutation normalized data', async () => {
    const source = await message()
    const observed = await lease(source)
    expect(() =>
      parseBackendAutomationQueueLeaseObservation({
        ...observed,
        leaseId: 'sb_secret_hidden-lease-token'
      })
    ).toThrow('Backend Automation queue lease observation is invalid.')

    const received = await receivedWorker(source, observed)
    expect(() =>
      parseBackendAutomationWorkerRecord({
        ...received,
        attemptId: 'sb_secret_hidden-attempt-token'
      })
    ).toThrow('Backend Automation worker record is invalid.')

    const preDispatch = await preDispatchWorker(received)
    const succeeded = await terminalWorker(preDispatch, 'succeeded')
    const proposal = await planBackendAutomationQueueMutation(
      source,
      observed,
      succeeded,
      mutationRequest('ack', {
        terminalCASVerificationEvidenceDigest: await digest('terminal-verification')
      })
    )
    expect(() =>
      parseBackendAutomationQueueMutationProposal({
        ...proposal,
        queueId: 'sb_secret_hidden-mutation-token'
      })
    ).toThrow('Backend Automation queue mutation proposal is invalid.')
  })
})
