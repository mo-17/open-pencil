/* oxlint-disable eslint/max-lines -- The focused fixture keeps durable CAS, one-shot dispatch, unknown outcome, and DLQ ordering visible together. */
import { describe, expect, test } from 'bun:test'

import {
  BACKEND_AUTOMATION_IDEMPOTENCY_RECORD_FORMAT,
  BACKEND_AUTOMATION_OUTBOX_RECORD_FORMAT,
  BACKEND_AUTOMATION_QUEUE_LEASE_FORMAT,
  BACKEND_AUTOMATION_QUEUE_MESSAGE_FORMAT,
  digestBackendAutomationIdempotencyRecord,
  digestBackendAutomationOutboxRecord,
  digestBackendAutomationQueueMessageEnvelope,
  digestBackendAutomationWorkerRecord,
  parseBackendAutomationIdempotencyRecord,
  parseBackendAutomationOutboxRecord,
  parseBackendAutomationQueueLeaseObservation,
  parseBackendAutomationQueueMessageEnvelope,
  type BackendAutomationIdempotencyCASCandidateV1,
  type BackendAutomationIdempotencyRecordV1,
  type BackendAutomationOutboxCASCandidateV1,
  type BackendAutomationOutboxRecordV1,
  type BackendAutomationQueueLeaseObservationV1,
  type BackendAutomationQueueMessageEnvelopeV1,
  type BackendAutomationQueueMutationProposalV1,
  type BackendAutomationWorkerCASCandidateV1,
  type BackendAutomationWorkerRecordV1
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  HOST_AUTOMATION_QUEUE_RUNNER_REMAINING_PRODUCTION_BLOCKERS,
  HostAutomationQueueRunnerTestingError,
  createHostAutomationQueueInjectedAdaptersForTestingV1,
  createHostAutomationQueueRunnerKernelForTestingV1,
  type CreateHostAutomationQueueInjectedAdaptersForTestingOptionsV1,
  type HostAutomationQueueDeadLetterPublishOutcomeForTestingV1,
  type HostAutomationQueueDispatchInvocationForTestingV1,
  type HostAutomationQueueDispatchOutcomeForTestingV1
} from '@/app/plugins/host/deployment/backend/testing/automation-queue-runner'

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
): Promise<BackendAutomationQueueMessageEnvelopeV1> {
  return parseBackendAutomationQueueMessageEnvelope({
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
  })
}

async function lease(
  source: BackendAutomationQueueMessageEnvelopeV1,
  overrides: Readonly<Record<string, unknown>> = {}
): Promise<BackendAutomationQueueLeaseObservationV1> {
  return parseBackendAutomationQueueLeaseObservation({
    format: BACKEND_AUTOMATION_QUEUE_LEASE_FORMAT,
    version: 1,
    messageEnvelopeDigest: await digestBackendAutomationQueueMessageEnvelope(source),
    queueId: source.queueId,
    messageId: source.messageId,
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
  })
}

async function succeededIdempotency(
  source: BackendAutomationQueueMessageEnvelopeV1,
  sourceLease: BackendAutomationQueueLeaseObservationV1
): Promise<BackendAutomationIdempotencyRecordV1> {
  return parseBackendAutomationIdempotencyRecord({
    format: BACKEND_AUTOMATION_IDEMPOTENCY_RECORD_FORMAT,
    version: 1,
    automationId: source.automationId,
    eventId: source.eventId,
    operationId: source.operationId,
    idempotencyKeyDigest: source.idempotencyKeyDigest,
    causationId: source.causationId,
    causationHop: source.causationHop,
    retentionHours: 24,
    createdAt: '2026-09-09T00:00:00.000Z',
    expiresAt: '2026-09-10T00:00:00.000Z',
    recordedAt: '2026-09-09T00:00:02.000Z',
    revision: 2,
    previousRecordDigest: await digest('idempotency-previous'),
    attemptIds: [sourceLease.attemptId],
    currentAttemptId: sourceLease.attemptId,
    state: 'succeeded',
    completionEvidenceDigest: await digest('already-succeeded'),
    knownNotDispatchedEvidenceDigest: null,
    reconciliationEvidenceDigest: null,
    hostEvidenceAuthenticated: false,
    persistenceAuthorityGranted: false,
    dispatchAuthorityGranted: false
  })
}

async function deadLetterMessage(
  source: BackendAutomationQueueMessageEnvelopeV1
): Promise<BackendAutomationQueueMessageEnvelopeV1> {
  return message({
    ...source,
    queueId: 'queue-orders-dead',
    messageId: 'message-dead-001'
  })
}

async function pendingDeadLetterOutbox(
  target: BackendAutomationQueueMessageEnvelopeV1
): Promise<BackendAutomationOutboxRecordV1> {
  const businessTransactionDigest = await digest('dead-letter-business-transaction')
  return parseBackendAutomationOutboxRecord({
    format: BACKEND_AUTOMATION_OUTBOX_RECORD_FORMAT,
    version: 1,
    outboxId: 'outbox-dead-001',
    businessTransactionId: 'transaction-dead-001',
    businessTransactionDigest,
    entityId: 'automation-dead-letter',
    rowIdDigest: await digest('dead-letter-row'),
    rowVersion: 1,
    eventId: target.eventId,
    eventDigest: target.payloadDigest,
    queueId: target.queueId,
    messageEnvelopeDigest: await digestBackendAutomationQueueMessageEnvelope(target),
    idempotencyKeyDigest: target.idempotencyKeyDigest,
    publishAttemptIds: ['publish-attempt-dead-001'],
    currentPublishAttemptId: 'publish-attempt-dead-001',
    publishAttemptOrdinal: 1,
    state: 'pending',
    revision: 0,
    previousRecordDigest: null,
    recordedAt: ENQUEUED_AT,
    transitionEvidenceDigest: businessTransactionDigest,
    publishConfirmationEvidenceDigest: null,
    knownNotPublishedEvidenceDigest: null,
    deliveryEvidenceDigest: null,
    reconciliationEvidenceDigest: null,
    ...NO_AUTHORITY
  })
}

interface FixtureOptions {
  readonly adapterKind?: 'fake' | 'durable-test-double'
  readonly dispatchOutcome?: HostAutomationQueueDispatchOutcomeForTestingV1
  readonly deadLetterQueueId?: string | null
  readonly maxAttempts?: number
  readonly initialIdempotencyState?: 'succeeded'
  readonly leaseExtended?: boolean
  readonly preDispatchLeaseCheckCrossesDeadline?: boolean
  readonly finalLeaseCheckRevoked?: boolean
  readonly asyncFinalLeaseCheck?: boolean
  readonly clockRewindsAfterLeaseConfirmation?: boolean
  readonly deadLetterPublishOutcome?: HostAutomationQueueDeadLetterPublishOutcomeForTestingV1
  readonly empty?: boolean
  readonly wrapAdapterOptions?: (
    value: CreateHostAutomationQueueInjectedAdaptersForTestingOptionsV1
  ) => CreateHostAutomationQueueInjectedAdaptersForTestingOptionsV1
}

interface Fixture {
  readonly runner: ReturnType<typeof createHostAutomationQueueRunnerKernelForTestingV1>
  readonly adapters: ReturnType<typeof createHostAutomationQueueInjectedAdaptersForTestingV1>
  readonly calls: string[]
  readonly sourceMutations: BackendAutomationQueueMutationProposalV1[]
  readonly dispatchObservations: Readonly<{
    invocation: HostAutomationQueueDispatchInvocationForTestingV1
    idempotencyState: string | null
    workerState: string | null
  }>[]
  readonly heads: () => Readonly<{
    idempotency: BackendAutomationIdempotencyRecordV1 | null
    worker: BackendAutomationWorkerRecordV1 | null
    deadLetter: BackendAutomationOutboxRecordV1
  }>
}

async function fixture(options: FixtureOptions = {}): Promise<Fixture> {
  const calls: string[] = []
  const sourceMutations: BackendAutomationQueueMutationProposalV1[] = []
  const dispatchObservations: {
    invocation: HostAutomationQueueDispatchInvocationForTestingV1
    idempotencyState: string | null
    workerState: string | null
  }[] = []
  const sourceMessage = await message()
  const sourceLease = await lease(
    sourceMessage,
    options.leaseExtended
      ? {
          observedAt: '2026-09-09T00:00:02.000000000Z',
          visibilityDeadline: '2026-09-09T00:01:02.000000000Z',
          extensionCount: 1
        }
      : {}
  )
  const targetMessage = await deadLetterMessage(sourceMessage)
  let idempotencyHead: BackendAutomationIdempotencyRecordV1 | null =
    options.initialIdempotencyState === 'succeeded'
      ? await succeededIdempotency(sourceMessage, sourceLease)
      : null
  let workerHead: BackendAutomationWorkerRecordV1 | null = null
  let deadLetterHead = await pendingDeadLetterOutbox(targetMessage)
  let clockTick = 1
  let leaseCheckCount = 0
  let preDispatchLeaseCheckCrossedDeadline = false

  async function commitEvidence(label: string): Promise<
    Readonly<{
      committed: true
      verificationEvidenceDigest: string
    }>
  > {
    return Object.freeze({
      committed: true,
      verificationEvidenceDigest: await digest(`commit-verification:${label}`)
    })
  }

  async function compareIdempotency(
    candidate: BackendAutomationIdempotencyCASCandidateV1
  ): Promise<unknown> {
    calls.push(`idempotency-cas:${candidate.record.state}`)
    const currentDigest =
      idempotencyHead === null
        ? null
        : await digestBackendAutomationIdempotencyRecord(idempotencyHead)
    if (
      candidate.proposal.expectedRevision !== (idempotencyHead?.revision ?? null) ||
      candidate.proposal.expectedHeadDigest !== currentDigest
    ) {
      return { committed: false, verificationEvidenceDigest: null }
    }
    idempotencyHead = candidate.record
    return commitEvidence(`idempotency:${candidate.record.revision}:${candidate.record.state}`)
  }

  async function compareWorker(candidate: BackendAutomationWorkerCASCandidateV1): Promise<unknown> {
    calls.push(`worker-cas:${candidate.record.state}`)
    const currentDigest =
      workerHead === null ? null : await digestBackendAutomationWorkerRecord(workerHead)
    if (
      candidate.proposal.expectedRevision !== (workerHead?.revision ?? null) ||
      candidate.proposal.expectedHeadDigest !== currentDigest
    ) {
      return { committed: false, verificationEvidenceDigest: null }
    }
    workerHead = candidate.record
    return commitEvidence(`worker:${candidate.record.revision}:${candidate.record.state}`)
  }

  async function compareDeadLetter(
    candidate: BackendAutomationOutboxCASCandidateV1
  ): Promise<unknown> {
    calls.push(`dead-letter-cas:${candidate.record.state}`)
    const currentDigest = await digestBackendAutomationOutboxRecord(deadLetterHead)
    if (
      candidate.proposal.expectedRevision !== deadLetterHead.revision ||
      candidate.proposal.expectedHeadDigest !== currentDigest
    ) {
      return { committed: false, verificationEvidenceDigest: null }
    }
    deadLetterHead = candidate.record
    return commitEvidence(`dead-letter:${candidate.record.revision}:${candidate.record.state}`)
  }

  const defaultDispatchOutcome: HostAutomationQueueDispatchOutcomeForTestingV1 = Object.freeze({
    kind: 'succeeded',
    evidenceDigest: await digest('dispatch-succeeded')
  })
  const defaultDeadLetterPublishOutcome: HostAutomationQueueDeadLetterPublishOutcomeForTestingV1 =
    Object.freeze({ kind: 'published', evidenceDigest: await digest('dead-letter-published') })

  const adapterOptions: CreateHostAutomationQueueInjectedAdaptersForTestingOptionsV1 = {
    adapterKind: options.adapterKind ?? 'fake',
    now() {
      calls.push('now')
      if (preDispatchLeaseCheckCrossedDeadline) return VISIBILITY_DEADLINE
      clockTick += 1
      if (options.clockRewindsAfterLeaseConfirmation && clockTick === 4) {
        return '2026-09-09T00:00:02.000000002Z'
      }
      return `2026-09-09T00:00:02.${String(clockTick).padStart(9, '0')}Z`
    },
    receiveOne() {
      calls.push('receive-one')
      return options.empty ? null : { message: sourceMessage, lease: sourceLease }
    },
    isLeaseLive(_binding, observedAt) {
      calls.push(`lease-live:${observedAt}`)
      leaseCheckCount += 1
      if (options.preDispatchLeaseCheckCrossesDeadline && leaseCheckCount === 2) {
        preDispatchLeaseCheckCrossedDeadline = true
      }
      if (options.finalLeaseCheckRevoked && leaseCheckCount === 3) return false
      if (options.asyncFinalLeaseCheck && leaseCheckCount === 3) return Promise.resolve(true)
      return true
    },
    loadPolicy() {
      calls.push('load-policy')
      return {
        idempotencyRetentionHours: 24,
        retryPolicy: {
          maxAttempts: options.maxAttempts ?? 3,
          initialDelayMs: 1_000,
          maxDelayMs: 8_000,
          backoff: 'fixed',
          jitter: 'none',
          deadLetterQueueId: options.deadLetterQueueId ?? null
        }
      }
    },
    readIdempotencyHead() {
      calls.push('idempotency-read')
      return idempotencyHead
    },
    compareAndSwapIdempotency: compareIdempotency,
    readWorkerHead() {
      calls.push('worker-read')
      return workerHead
    },
    compareAndSwapWorker: compareWorker,
    dispatch(invocation) {
      calls.push('dispatch')
      dispatchObservations.push({
        invocation,
        idempotencyState: idempotencyHead?.state ?? null,
        workerState: workerHead?.state ?? null
      })
      return options.dispatchOutcome ?? defaultDispatchOutcome
    },
    applySourceQueueMutation(proposal) {
      calls.push(`source-mutation:${proposal.kind}`)
      sourceMutations.push(proposal)
      return commitEvidence(`source:${proposal.kind}`)
    },
    readDeadLetterOutboxHead() {
      calls.push('dead-letter-read')
      return { message: targetMessage, outbox: deadLetterHead }
    },
    compareAndSwapDeadLetterOutbox: compareDeadLetter,
    publishDeadLetter() {
      calls.push('dead-letter-publish')
      return options.deadLetterPublishOutcome ?? defaultDeadLetterPublishOutcome
    }
  }
  const adapters = createHostAutomationQueueInjectedAdaptersForTestingV1(
    options.wrapAdapterOptions?.(adapterOptions) ?? adapterOptions
  )
  const runner = createHostAutomationQueueRunnerKernelForTestingV1({ adapters })
  return {
    runner,
    adapters,
    calls,
    sourceMutations,
    dispatchObservations,
    heads: () => ({ idempotency: idempotencyHead, worker: workerHead, deadLetter: deadLetterHead })
  }
}

describe('testing-only Host Automation bounded queue runner', () => {
  test('records both pre-dispatch ledgers through injected stores before one dispatch and ack', async () => {
    const current = await fixture()
    const run = await current.runner.runOne()

    expect(run).toMatchObject({
      status: 'succeeded',
      messagesDequeued: 1,
      messagesDispatched: 1,
      sourceMutationKind: 'ack',
      sourceQueueMutationCallbackReportedCommitted: true,
      sourceQueueMutationReadbackVerified: false,
      sourceQueueMutationCallbackReportAuthenticated: false,
      deadLetterPublishCASCommitted: false,
      oneShotDispatchPermitConsumed: true,
      preDispatchOutcomeUnknownFencePersisted: true,
      callbackSideEffectsAuthenticated: false,
      injectedReconciliationEvidenceAuthenticated: false,
      productionQueueAuthorityCreated: false,
      productionNetworkAuthorityCreated: false,
      credentialAuthorityCreated: false,
      databaseAuthorityCreated: false,
      releaseAuthorityCreated: false
    })
    expect(run.trace).toEqual([
      'live-lease-confirmed',
      'idempotency-reserved-cas',
      'worker-received-cas',
      'idempotency-dispatch-started-cas',
      'worker-predispatch-outcome-unknown-cas',
      'dispatch-lease-reconfirmed',
      'dispatch-permit-issued',
      'dispatch-permit-consumed',
      'dispatch-entered',
      'idempotency-settlement-cas',
      'worker-settlement-cas',
      'source-ack-callback-reported-committed'
    ])
    expect(current.dispatchObservations).toHaveLength(1)
    expect(current.dispatchObservations[0]).toMatchObject({
      idempotencyState: 'dispatch-started',
      workerState: 'pre-dispatch-outcome-unknown',
      invocation: {
        payloadIncluded: false,
        oneShotPermitConsumed: true,
        callbackSideEffectsAuthenticated: false,
        injectedReconciliationEvidenceAuthenticated: false,
        productionNetworkAuthorityCreated: false
      }
    })
    expect(current.heads().idempotency?.state).toBe('succeeded')
    expect(current.heads().worker?.state).toBe('succeeded')
    expect(current.sourceMutations).toHaveLength(1)
    expect(current.sourceMutations[0]).toMatchObject(NO_AUTHORITY)
    expect(Object.isFrozen(run)).toBe(true)
    expect(Object.isFrozen(run.trace)).toBe(true)
    expect(run.remainingProductionBlockers).toBe(
      HOST_AUTOMATION_QUEUE_RUNNER_REMAINING_PRODUCTION_BLOCKERS
    )
    expect(run.remainingProductionBlockers).toContain(
      'host-deduplication-terminal-composition-unavailable'
    )
    expect(run.remainingProductionBlockers).toContain(
      'production-atomic-lease-dispatch-fence-unavailable'
    )
  })

  test('fences an unknown dispatch outcome and never acknowledges, retries, archives, or publishes', async () => {
    const current = await fixture({
      dispatchOutcome: Object.freeze({
        kind: 'outcome-unknown',
        stableCode: 'transport-timeout',
        evidenceDigest: await digest('dispatch-unknown')
      })
    })
    const run = await current.runner.runOne()

    expect(run).toMatchObject({
      status: 'outcome-unknown',
      messagesDispatched: 1,
      sourceMutationKind: null,
      sourceQueueMutationCallbackReportedCommitted: false,
      deadLetterPublishCASCommitted: false,
      preDispatchOutcomeUnknownFencePersisted: true
    })
    expect(current.heads().idempotency?.state).toBe('outcome-unknown')
    expect(current.heads().worker?.state).toBe('outcome-unknown')
    expect(current.sourceMutations).toEqual([])
    expect(current.calls.some((entry) => entry.startsWith('source-mutation:'))).toBe(false)
    expect(current.calls).not.toContain('dead-letter-publish')
  })

  test('commits target pre-publish and published CAS before archiving a dead-letter source', async () => {
    const current = await fixture({
      maxAttempts: 1,
      deadLetterQueueId: 'queue-orders-dead',
      dispatchOutcome: Object.freeze({
        kind: 'permanent-failure',
        stableCode: 'payload-rejected',
        evidenceDigest: await digest('dispatch-permanent-failure'),
        injectedTestingReconciliationEvidenceDigest: await digest(
          'dispatch-negative-reconciliation'
        )
      })
    })
    const run = await current.runner.runOne()

    expect(run).toMatchObject({
      status: 'dead-lettered',
      sourceMutationKind: 'archive',
      sourceQueueMutationCallbackReportedCommitted: true,
      deadLetterPublishCASCommitted: true,
      injectedReconciliationEvidenceAuthenticated: false
    })
    expect(run.trace).toContain('injected-testing-reconciliation-evidence-untrusted')
    const prePublish = current.calls.indexOf('dead-letter-cas:pre-publish-outcome-unknown')
    const publish = current.calls.indexOf('dead-letter-publish')
    const published = current.calls.indexOf('dead-letter-cas:published')
    const archive = current.calls.indexOf('source-mutation:archive')
    expect(prePublish).toBeGreaterThan(-1)
    expect(publish).toBeGreaterThan(prePublish)
    expect(published).toBeGreaterThan(publish)
    expect(archive).toBeGreaterThan(published)
    expect(current.heads().deadLetter.state).toBe('published')
    expect(current.heads().deadLetter).toMatchObject(NO_AUTHORITY)
    expect(current.sourceMutations[0]).toMatchObject({
      dispositionKind: 'dead-letter',
      deadLetterQueueId: 'queue-orders-dead',
      deadLetterState: 'published'
    })
  })

  test('keeps the source unarchived when the target publish outcome is unknown', async () => {
    const current = await fixture({
      maxAttempts: 1,
      deadLetterQueueId: 'queue-orders-dead',
      dispatchOutcome: Object.freeze({
        kind: 'permanent-failure',
        stableCode: 'payload-rejected',
        evidenceDigest: await digest('dispatch-permanent-failure'),
        injectedTestingReconciliationEvidenceDigest: await digest(
          'dispatch-negative-reconciliation'
        )
      }),
      deadLetterPublishOutcome: Object.freeze({
        kind: 'outcome-unknown',
        evidenceDigest: await digest('dead-letter-unknown')
      })
    })
    const run = await current.runner.runOne()

    expect(run).toMatchObject({
      status: 'blocked',
      blocker: 'dead-letter-publication-reconciliation-required',
      sourceQueueMutationCallbackReportedCommitted: false,
      deadLetterPublishCASCommitted: false
    })
    expect(current.heads().deadLetter.state).toBe('outcome-unknown')
    expect(current.sourceMutations).toEqual([])
    expect(current.calls).not.toContain('source-mutation:archive')
  })

  test('burns the single-run handle before await and processes at most one message', async () => {
    const current = await fixture()
    const runs = await Promise.allSettled([current.runner.runOne(), current.runner.runOne()])

    expect(runs.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1)
    const rejected = runs.find((entry) => entry.status === 'rejected')
    expect(rejected?.status).toBe('rejected')
    if (rejected?.status === 'rejected') {
      expect(rejected.reason).toBeInstanceOf(HostAutomationQueueRunnerTestingError)
      expect((rejected.reason as HostAutomationQueueRunnerTestingError).code).toBe(
        'host-automation-queue-runner-consumed'
      )
    }
    expect(current.calls.filter((entry) => entry === 'receive-one')).toHaveLength(1)
    expect(current.calls.filter((entry) => entry === 'dispatch')).toHaveLength(1)
  })

  test('captures stateful Proxy factory callbacks from one descriptor snapshot', async () => {
    let receiveDescriptorReads = 0
    let unexpectedReceiveCalls = 0
    const current = await fixture({
      empty: true,
      wrapAdapterOptions(value) {
        return new Proxy(value, {
          getOwnPropertyDescriptor(target, property) {
            const descriptor = Reflect.getOwnPropertyDescriptor(target, property)
            if (property !== 'receiveOne' || !descriptor || !('value' in descriptor)) {
              return descriptor
            }
            receiveDescriptorReads += 1
            if (receiveDescriptorReads === 1) return descriptor
            return {
              ...descriptor,
              value() {
                unexpectedReceiveCalls += 1
                return null
              }
            }
          }
        })
      }
    })

    await expect(current.runner.runOne()).resolves.toMatchObject({ status: 'empty' })
    expect(receiveDescriptorReads).toBe(1)
    expect(unexpectedReceiveCalls).toBe(0)
    expect(current.calls.filter((entry) => entry === 'receive-one')).toHaveLength(1)
    expect(current.sourceMutations).toEqual([])
  })

  test('uses one stateful Proxy dispatch-outcome snapshot without queue mutation', async () => {
    const initialEvidence = await digest('stateful-dispatch-initial')
    const replacementEvidence = await digest('stateful-dispatch-replacement')
    const descriptorReads = new Map<PropertyKey, number>()
    const dispatchOutcome = new Proxy(
      {
        kind: 'outcome-unknown' as const,
        stableCode: 'transport-timeout',
        evidenceDigest: initialEvidence
      },
      {
        getOwnPropertyDescriptor(target, property) {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, property)
          if (!descriptor || !('value' in descriptor)) return descriptor
          const count = (descriptorReads.get(property) ?? 0) + 1
          descriptorReads.set(property, count)
          if (count === 1) return descriptor
          let value = replacementEvidence
          if (property === 'kind') value = 'succeeded'
          if (property === 'stableCode') value = 'swapped-outcome'
          return { ...descriptor, value }
        }
      }
    )
    const current = await fixture({ dispatchOutcome })

    await expect(current.runner.runOne()).resolves.toMatchObject({ status: 'outcome-unknown' })
    expect(Object.fromEntries(descriptorReads)).toEqual({
      kind: 1,
      stableCode: 1,
      evidenceDigest: 1
    })
    expect(current.heads().worker?.transitionEvidenceDigest).toBe(initialEvidence)
    expect(current.calls.filter((entry) => entry === 'dispatch')).toHaveLength(1)
    expect(current.sourceMutations).toEqual([])
  })

  test('rejects a Host clock rewind before dispatch', async () => {
    const current = await fixture({ clockRewindsAfterLeaseConfirmation: true })

    await expect(current.runner.runOne()).rejects.toMatchObject({
      code: 'host-automation-queue-runner-input-invalid'
    })
    expect(current.calls).not.toContain('dispatch')
    expect(current.sourceMutations).toEqual([])
  })

  test('enters dispatch synchronously after an async final lease confirmation', async () => {
    const current = await fixture({ asyncFinalLeaseCheck: true })
    const run = await current.runner.runOne()
    const finalLeaseCheck = current.calls.findLastIndex((entry) => entry.startsWith('lease-live:'))
    const dispatch = current.calls.indexOf('dispatch')

    expect(run.status).toBe('succeeded')
    expect(finalLeaseCheck).toBeGreaterThan(-1)
    expect(dispatch).toBeGreaterThan(finalLeaseCheck)
    expect(current.calls.slice(finalLeaseCheck + 1, dispatch)).not.toContain('now')
  })

  test('does not mint a dispatch permit when the live-lease callback crosses the deadline', async () => {
    const current = await fixture({ preDispatchLeaseCheckCrossesDeadline: true })
    const run = await current.runner.runOne()

    expect(run).toMatchObject({
      status: 'blocked',
      blocker: 'durable-settlement-reconciliation-required',
      messagesDequeued: 1,
      messagesDispatched: 0,
      oneShotDispatchPermitConsumed: false,
      preDispatchOutcomeUnknownFencePersisted: true,
      sourceQueueMutationCallbackReportedCommitted: false
    })
    expect(run.trace.at(-1)).toBe('worker-predispatch-outcome-unknown-cas')
    expect(run.trace).not.toContain('dispatch-permit-issued')
    expect(current.calls).not.toContain('dispatch')
    expect(current.sourceMutations).toEqual([])
  })

  test('does not mint a dispatch permit when the final live-lease check reports revocation', async () => {
    const current = await fixture({ finalLeaseCheckRevoked: true })
    const run = await current.runner.runOne()

    expect(run).toMatchObject({
      status: 'blocked',
      blocker: 'durable-settlement-reconciliation-required',
      messagesDispatched: 0,
      oneShotDispatchPermitConsumed: false,
      preDispatchOutcomeUnknownFencePersisted: true,
      sourceQueueMutationCallbackReportedCommitted: false
    })
    expect(current.calls.filter((entry) => entry.startsWith('lease-live:'))).toHaveLength(3)
    expect(run.trace).not.toContain('dispatch-permit-issued')
    expect(current.calls).not.toContain('dispatch')
  })

  test('fails closed on the duplicate-success and visibility-extension contract seams', async () => {
    const duplicate = await fixture({ initialIdempotencyState: 'succeeded' })
    const duplicateRun = await duplicate.runner.runOne()
    expect(duplicateRun).toMatchObject({
      status: 'blocked',
      blocker: 'already-succeeded-duplicate-ack-unavailable',
      messagesDispatched: 0,
      sourceQueueMutationCallbackReportedCommitted: false
    })
    expect(duplicate.calls).not.toContain('dispatch')

    const extended = await fixture({ leaseExtended: true })
    const extendedRun = await extended.runner.runOne()
    expect(extendedRun).toMatchObject({
      status: 'blocked',
      blocker: 'visibility-extension-rebind-unavailable',
      messagesDispatched: 0,
      sourceQueueMutationCallbackReportedCommitted: false
    })
    expect(extended.calls).toEqual(['receive-one'])
  })

  test('accepts only exact injected handles and remains absent from production import topology', async () => {
    const current = await fixture({ empty: true })
    expect(current.adapters).toMatchObject({
      testingOnly: true,
      processLocalOnly: true,
      adapterKind: 'fake',
      defaultImplementationsCreated: false,
      callbackSideEffectsAuthenticated: false,
      injectedReconciliationEvidenceAuthenticated: false,
      productionQueueAuthorityCreated: false,
      productionNetworkAuthorityCreated: false,
      credentialAuthorityCreated: false,
      databaseAuthorityCreated: false,
      releaseAuthorityCreated: false
    })
    expect(await current.runner.runOne()).toMatchObject({ status: 'empty', messagesDequeued: 0 })
    const durableTestDouble = await fixture({ adapterKind: 'durable-test-double', empty: true })
    expect(durableTestDouble.adapters).toMatchObject({
      adapterKind: 'durable-test-double',
      testingOnly: true,
      defaultImplementationsCreated: false,
      injectedReconciliationEvidenceAuthenticated: false,
      productionQueueAuthorityCreated: false,
      databaseAuthorityCreated: false
    })
    expect(await durableTestDouble.runner.runOne()).toMatchObject({ status: 'empty' })
    expect(() =>
      createHostAutomationQueueRunnerKernelForTestingV1({ adapters: { ...current.adapters } })
    ).toThrow('host-automation-queue-runner-adapters-untrusted')

    let getterCalls = 0
    const accessor = Object.defineProperty({}, 'adapters', {
      enumerable: true,
      get() {
        getterCalls += 1
        return current.adapters
      }
    })
    expect(() => createHostAutomationQueueRunnerKernelForTestingV1(accessor as never)).toThrow(
      'host-automation-queue-runner-input-invalid'
    )
    expect(getterCalls).toBe(0)

    const root = new URL('../../../../../../../', import.meta.url)
    const productionSourcePatterns = [
      'src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,vue,json,jsonc}',
      'packages/*/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,vue,json,jsonc}',
      'packages/*/package.json',
      'desktop/src/**/*.{rs,json}',
      'desktop/*.{rs,toml,json}',
      'extensions/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,vue,json,jsonc,rs,toml}'
    ] as const
    const forbiddenReference = 'automation-queue-runner'
    const importers: string[] = []
    for (const pattern of productionSourcePatterns) {
      const productionSources = new Bun.Glob(pattern)
      for await (const path of productionSources.scan({ cwd: root.pathname, absolute: true })) {
        if (path.endsWith('/backend/testing/automation-queue-runner.ts')) continue
        const source = await Bun.file(path).text()
        if (source.includes(forbiddenReference)) importers.push(path)
      }
    }
    expect(importers).toEqual([])

    const kernelSource = await Bun.file(
      new URL('src/app/plugins/host/deployment/backend/testing/automation-queue-runner.ts', root)
    ).text()
    expect(kernelSource).not.toContain('fetch(')
    expect(kernelSource).not.toContain('@tauri-apps')
    expect(kernelSource).not.toContain('Supabase')
    expect(kernelSource).not.toContain('CredentialResolver')
  })
})
