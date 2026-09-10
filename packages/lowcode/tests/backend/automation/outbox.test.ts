/* eslint-disable max-lines -- transactional outbox lifecycle, retry fencing, and hostile-data cases are one focused suite */
import { describe, expect, test } from 'bun:test'

import {
  BACKEND_AUTOMATION_OUTBOX_CAS_PROPOSAL_FORMAT,
  BACKEND_AUTOMATION_OUTBOX_MAX_PUBLISH_ATTEMPTS,
  BACKEND_AUTOMATION_OUTBOX_RECORD_FORMAT,
  canonicalBackendAutomationOutboxCASProposalBytes,
  canonicalBackendAutomationOutboxRecordBytes,
  createBackendAutomationOutboxCASProposal,
  digestBackendAutomationOutboxCASProposal,
  digestBackendAutomationOutboxRecord,
  parseBackendAutomationOutboxCASProposal,
  parseBackendAutomationOutboxRecord,
  verifyBackendAutomationOutboxCASProposal
} from '#lowcode/backend/automation/outbox'
import {
  BACKEND_AUTOMATION_QUEUE_MESSAGE_FORMAT,
  digestBackendAutomationQueueMessageEnvelope,
  parseBackendAutomationQueueMessageEnvelope
} from '#lowcode/backend/automation/worker'

import { digestCanonicalManifest } from '@open-pencil/scene-graph'

const ENQUEUED_AT = '2026-09-09T00:00:00.000000000Z'
const RETENTION_DEADLINE = '2026-09-09T01:00:00.000000000Z'

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
    payloadDigest: await digest('event-payload'),
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

async function initialOutbox(
  messageValue: unknown,
  overrides: Readonly<Record<string, unknown>> = {}
): Promise<Record<string, unknown>> {
  const parsedMessage = parseBackendAutomationQueueMessageEnvelope(messageValue)
  const businessTransactionDigest = await digest('business-transaction')
  return {
    format: BACKEND_AUTOMATION_OUTBOX_RECORD_FORMAT,
    version: 1,
    outboxId: 'outbox-001',
    businessTransactionId: 'transaction-001',
    businessTransactionDigest,
    entityId: 'orders',
    rowIdDigest: await digest('row-id'),
    rowVersion: 1,
    eventId: parsedMessage.eventId,
    eventDigest: parsedMessage.payloadDigest,
    queueId: parsedMessage.queueId,
    messageEnvelopeDigest: await digestBackendAutomationQueueMessageEnvelope(parsedMessage),
    idempotencyKeyDigest: parsedMessage.idempotencyKeyDigest,
    publishAttemptIds: ['publish-attempt-001'],
    currentPublishAttemptId: 'publish-attempt-001',
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
    ...NO_AUTHORITY,
    ...overrides
  }
}

async function nextOutbox(
  previousValue: unknown,
  overrides: Readonly<Record<string, unknown>>
): Promise<Record<string, unknown>> {
  const previous = parseBackendAutomationOutboxRecord(previousValue)
  const nextRevision = previous.revision + 1
  return {
    ...previous,
    revision: nextRevision,
    previousRecordDigest: await digestBackendAutomationOutboxRecord(previous),
    recordedAt: `2026-09-09T00:00:00.${String(nextRevision).padStart(9, '0')}Z`,
    transitionEvidenceDigest: await digest(`outbox-transition-${nextRevision}`),
    ...overrides
  }
}

async function prePublish(previous: unknown): Promise<Record<string, unknown>> {
  return nextOutbox(previous, {
    state: 'pre-publish-outcome-unknown',
    publishConfirmationEvidenceDigest: null,
    knownNotPublishedEvidenceDigest: null,
    deliveryEvidenceDigest: null,
    reconciliationEvidenceDigest: null
  })
}

async function outcomeUnknown(previous: unknown): Promise<Record<string, unknown>> {
  return nextOutbox(previous, {
    state: 'outcome-unknown',
    publishConfirmationEvidenceDigest: null,
    knownNotPublishedEvidenceDigest: null,
    deliveryEvidenceDigest: null,
    reconciliationEvidenceDigest: null
  })
}

async function published(
  previous: unknown,
  reconciliationEvidenceDigest: string | null = null
): Promise<Record<string, unknown>> {
  return nextOutbox(previous, {
    state: 'published',
    publishConfirmationEvidenceDigest: await digest('publish-confirmation'),
    knownNotPublishedEvidenceDigest: null,
    deliveryEvidenceDigest: null,
    reconciliationEvidenceDigest
  })
}

async function knownNotPublished(
  previous: unknown,
  reconciliationEvidenceDigest: string | null
): Promise<Record<string, unknown>> {
  return nextOutbox(previous, {
    state: 'known-not-published',
    publishConfirmationEvidenceDigest: null,
    knownNotPublishedEvidenceDigest: await digest('known-not-published'),
    deliveryEvidenceDigest: null,
    reconciliationEvidenceDigest
  })
}

describe('provider-neutral Backend Automation transactional outbox contract', () => {
  test('normalizes exact secret-free own data, deep-freezes attempts, and canonicalizes deterministically', async () => {
    const sourceMessage = await message()
    const source = await initialOutbox(sourceMessage)
    const reordered = Object.fromEntries(Object.entries(source).reverse())
    const parsed = parseBackendAutomationOutboxRecord(source)

    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.publishAttemptIds)).toBe(true)
    expect(parsed.publishAttemptIds).toEqual(['publish-attempt-001'])
    expect(parsed.hostEvidenceAuthenticated).toBe(false)
    expect(parsed.persistenceAuthorityGranted).toBe(false)
    expect(parsed.dispatchAuthorityGranted).toBe(false)
    expect(parsed.ackAuthorityGranted).toBe(false)
    expect(parsed.releaseAuthorityGranted).toBe(false)
    expect(canonicalBackendAutomationOutboxRecordBytes(source)).toEqual(
      canonicalBackendAutomationOutboxRecordBytes(reordered)
    )
    expect(await digestBackendAutomationOutboxRecord(source)).toBe(
      await digestBackendAutomationOutboxRecord(reordered)
    )
    expect(() => parseBackendAutomationOutboxRecord({ ...source, rowVersion: -0 })).toThrow()
    expect(() =>
      parseBackendAutomationOutboxRecord({ ...source, publishAttemptOrdinal: -0 })
    ).toThrow()
    expect(() => parseBackendAutomationOutboxRecord({ ...source, revision: -0 })).toThrow()
  })

  test('binds pending to the business transaction, then requires pre-publish before confirmation', async () => {
    const sourceMessage = await message()
    const pending = await initialOutbox(sourceMessage)
    const initialCandidate = await createBackendAutomationOutboxCASProposal(
      sourceMessage,
      null,
      pending
    )
    expect(initialCandidate.proposal).toMatchObject({
      format: BACKEND_AUTOMATION_OUTBOX_CAS_PROPOSAL_FORMAT,
      expectedRevision: null,
      expectedHeadDigest: null,
      nextRevision: 0,
      currentPublishAttemptId: 'publish-attempt-001',
      publishAttemptOrdinal: 1,
      ...NO_AUTHORITY
    })
    expect(initialCandidate.proposal.nextRecordDigest).toBe(initialCandidate.recordDigest)
    expect(Object.isFrozen(initialCandidate)).toBe(true)
    expect(Object.isFrozen(initialCandidate.proposal)).toBe(true)
    expect(parseBackendAutomationOutboxCASProposal(initialCandidate.proposal)).toEqual(
      initialCandidate.proposal
    )

    const pre = await prePublish(pending)
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, pending, pre)
    ).resolves.toBeDefined()
    const confirmed = await published(pre)
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, pre, confirmed)
    ).resolves.toBeDefined()
    const parsedPre = parseBackendAutomationOutboxRecord(pre)
    const reusedFenceConfirmation = await nextOutbox(pre, {
      state: 'published',
      publishConfirmationEvidenceDigest: parsedPre.transitionEvidenceDigest
    })
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, pre, reusedFenceConfirmation)
    ).rejects.toThrow()
    const delivered = await nextOutbox(confirmed, {
      state: 'delivered',
      deliveryEvidenceDigest: await digest('delivery-confirmation')
    })
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, confirmed, delivered)
    ).resolves.toBeDefined()

    const continuation = await nextOutbox(delivered, {
      state: 'delivered',
      deliveryEvidenceDigest: await digest('second-delivery')
    })
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, delivered, continuation)
    ).rejects.toThrow()
  })

  test('never marks delivered before publish confirmation or with reused delivery evidence', async () => {
    const sourceMessage = await message()
    const pending = await initialOutbox(sourceMessage)
    const pre = await prePublish(pending)
    const directDelivery = await nextOutbox(pre, {
      state: 'delivered',
      publishConfirmationEvidenceDigest: await digest('publish-confirmation'),
      deliveryEvidenceDigest: await digest('delivery-confirmation')
    })
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, pre, directDelivery)
    ).rejects.toThrow()

    const confirmed = await published(pre)
    const parsedConfirmed = parseBackendAutomationOutboxRecord(confirmed)
    const sameEvidence = await nextOutbox(confirmed, {
      state: 'delivered',
      deliveryEvidenceDigest: parsedConfirmed.publishConfirmationEvidenceDigest
    })
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, confirmed, sameEvidence)
    ).rejects.toThrow()
    const reusedTransition = await nextOutbox(confirmed, {
      state: 'delivered',
      deliveryEvidenceDigest: parsedConfirmed.transitionEvidenceDigest
    })
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, confirmed, reusedTransition)
    ).rejects.toThrow()
  })

  test('keeps unknown publish fenced, then permits retry only after known-not-published evidence', async () => {
    const sourceMessage = await message()
    const pending = await initialOutbox(sourceMessage)
    const pre = await prePublish(pending)
    const unknown = await outcomeUnknown(pre)
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, pre, unknown)
    ).resolves.toBeDefined()

    const unsafeRetry = await nextOutbox(unknown, {
      state: 'pre-publish-outcome-unknown',
      publishAttemptIds: ['publish-attempt-001', 'publish-attempt-002'],
      currentPublishAttemptId: 'publish-attempt-002',
      publishAttemptOrdinal: 2
    })
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, unknown, unsafeRetry)
    ).rejects.toThrow()

    const unprovedKnown = await knownNotPublished(unknown, null)
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, unknown, unprovedKnown)
    ).rejects.toThrow()

    const parsedUnknown = parseBackendAutomationOutboxRecord(unknown)
    const reusedUnknownEvidence = await knownNotPublished(
      unknown,
      parsedUnknown.transitionEvidenceDigest
    )
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, unknown, reusedUnknownEvidence)
    ).rejects.toThrow()

    const reconciliation = await digest('negative-publish-reconciliation')
    const known = await knownNotPublished(unknown, reconciliation)
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, unknown, known)
    ).resolves.toBeDefined()
    const retry = await nextOutbox(known, {
      state: 'pre-publish-outcome-unknown',
      publishAttemptIds: ['publish-attempt-001', 'publish-attempt-002'],
      currentPublishAttemptId: 'publish-attempt-002',
      publishAttemptOrdinal: 2,
      knownNotPublishedEvidenceDigest: null,
      reconciliationEvidenceDigest: null
    })
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, known, retry)
    ).resolves.toBeDefined()

    const replayAttempt = {
      ...retry,
      publishAttemptIds: ['publish-attempt-001'],
      currentPublishAttemptId: 'publish-attempt-001',
      publishAttemptOrdinal: 1
    }
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, known, replayAttempt)
    ).rejects.toThrow()
  })

  test('starts no publish attempt at or after the retention nanosecond boundary', async () => {
    const sourceMessage = await message()
    const pending = await initialOutbox(sourceMessage)
    const justBeforeRetention = await nextOutbox(pending, {
      state: 'pre-publish-outcome-unknown',
      recordedAt: '2026-09-09T00:59:59.999999999Z'
    })
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, pending, justBeforeRetention)
    ).resolves.toBeDefined()

    const atRetention = { ...justBeforeRetention, recordedAt: RETENTION_DEADLINE }
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, pending, atRetention)
    ).rejects.toThrow()

    const pre = await prePublish(pending)
    const unknown = await outcomeUnknown(pre)
    const known = await knownNotPublished(
      unknown,
      await digest('retention-boundary-reconciliation')
    )
    const retryAfterRetention = await nextOutbox(known, {
      state: 'pre-publish-outcome-unknown',
      publishAttemptIds: ['publish-attempt-001', 'publish-attempt-002'],
      currentPublishAttemptId: 'publish-attempt-002',
      publishAttemptOrdinal: 2,
      knownNotPublishedEvidenceDigest: null,
      reconciliationEvidenceDigest: null,
      recordedAt: '2026-09-09T01:00:00.000000001Z'
    })
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, known, retryAfterRetention)
    ).rejects.toThrow()
  })

  test('bounds unique publish attempts and prevents attempt identity changes in other states', async () => {
    const sourceMessage = await message()
    const pending = await initialOutbox(sourceMessage)
    const tooMany = Array.from(
      { length: BACKEND_AUTOMATION_OUTBOX_MAX_PUBLISH_ATTEMPTS + 1 },
      (_, index) => `publish-attempt-${String(index + 1).padStart(3, '0')}`
    )
    expect(() =>
      parseBackendAutomationOutboxRecord({
        ...pending,
        publishAttemptIds: tooMany,
        currentPublishAttemptId: tooMany.at(-1),
        publishAttemptOrdinal: tooMany.length
      })
    ).toThrow()
    expect(() =>
      parseBackendAutomationOutboxRecord({
        ...pending,
        publishAttemptIds: ['publish-attempt-001', 'publish-attempt-001'],
        publishAttemptOrdinal: 2
      })
    ).toThrow()

    const pre = await prePublish(pending)
    const changedAttempt = await nextOutbox(pre, {
      state: 'outcome-unknown',
      publishAttemptIds: ['publish-attempt-001', 'publish-attempt-002'],
      currentPublishAttemptId: 'publish-attempt-002',
      publishAttemptOrdinal: 2
    })
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, pre, changedAttempt)
    ).rejects.toThrow()
  })

  test('allows positive reconciliation from unknown without replaying publish', async () => {
    const sourceMessage = await message()
    const pending = await initialOutbox(sourceMessage)
    const pre = await prePublish(pending)
    const unknown = await outcomeUnknown(pre)
    const withoutReconciliation = await published(unknown)
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, unknown, withoutReconciliation)
    ).rejects.toThrow()

    const positiveReconciliation = await digest('positive-reconciliation')
    const confirmed = await published(unknown, positiveReconciliation)
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, unknown, confirmed)
    ).resolves.toBeDefined()
    expect(parseBackendAutomationOutboxRecord(confirmed).publishAttemptIds).toEqual([
      'publish-attempt-001'
    ])
    const reusedReconciliationDelivery = await nextOutbox(confirmed, {
      state: 'delivered',
      deliveryEvidenceDigest: positiveReconciliation
    })
    await expect(
      createBackendAutomationOutboxCASProposal(
        sourceMessage,
        confirmed,
        reusedReconciliationDelivery
      )
    ).rejects.toThrow()

    const parsedUnknown = parseBackendAutomationOutboxRecord(unknown)
    const reusedUnknownConfirmation = {
      ...confirmed,
      publishConfirmationEvidenceDigest: parsedUnknown.transitionEvidenceDigest
    }
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, unknown, reusedUnknownConfirmation)
    ).rejects.toThrow()

    const repeatedUnknown = await nextOutbox(unknown, {
      state: 'outcome-unknown',
      reconciliationEvidenceDigest: await digest('still-unknown-reconciliation')
    })
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, unknown, repeatedUnknown)
    ).resolves.toBeDefined()
    const parsedRepeated = parseBackendAutomationOutboxRecord(repeatedUnknown)
    const reusedReconciliationConfirmation = await published(
      repeatedUnknown,
      await digest('later-positive-reconciliation')
    )
    await expect(
      createBackendAutomationOutboxCASProposal(sourceMessage, repeatedUnknown, {
        ...reusedReconciliationConfirmation,
        publishConfirmationEvidenceDigest: parsedRepeated.reconciliationEvidenceDigest
      })
    ).rejects.toThrow()
  })

  test('binds CAS to exact transaction, row version, event, attempt, head, and record digest', async () => {
    const sourceMessage = await message()
    const pending = await initialOutbox(sourceMessage)
    const preA = await prePublish(pending)
    const preB = {
      ...preA,
      transitionEvidenceDigest: await digest('concurrent-pre-publish')
    }
    const candidateA = await createBackendAutomationOutboxCASProposal(sourceMessage, pending, preA)
    const candidateB = await createBackendAutomationOutboxCASProposal(sourceMessage, pending, preB)
    expect(candidateA.proposal.expectedHeadDigest).toBe(candidateB.proposal.expectedHeadDigest)
    expect(candidateA.proposal.nextRecordDigest).not.toBe(candidateB.proposal.nextRecordDigest)

    await expect(
      verifyBackendAutomationOutboxCASProposal(candidateA.proposal, sourceMessage, pending, preB)
    ).rejects.toThrow()
    await expect(
      verifyBackendAutomationOutboxCASProposal(
        { ...candidateA.proposal, rowVersion: 2 },
        sourceMessage,
        pending,
        preA
      )
    ).rejects.toThrow()
    await expect(
      verifyBackendAutomationOutboxCASProposal(
        { ...candidateA.proposal, nextRecordDigest: await digest('tampered-record') },
        sourceMessage,
        pending,
        preA
      )
    ).rejects.toThrow()
    await expect(
      verifyBackendAutomationOutboxCASProposal(candidateA.proposal, sourceMessage, null, pending)
    ).rejects.toThrow()

    const reordered = Object.fromEntries(Object.entries(candidateA.proposal).reverse())
    expect(canonicalBackendAutomationOutboxCASProposalBytes(candidateA.proposal)).toEqual(
      canonicalBackendAutomationOutboxCASProposalBytes(reordered)
    )
    expect(await digestBackendAutomationOutboxCASProposal(candidateA.proposal)).toBe(
      await digestBackendAutomationOutboxCASProposal(reordered)
    )
  })

  test('snapshots outbox transition inputs before the first asynchronous digest boundary', async () => {
    const sourceMessage = await message()
    const pending = await initialOutbox(sourceMessage)
    const mutablePre = await prePublish(pending)
    const pendingCAS = createBackendAutomationOutboxCASProposal(sourceMessage, pending, mutablePre)
    mutablePre.state = 'delivered'
    mutablePre.publishConfirmationEvidenceDigest = await digest('forged-publish')
    mutablePre.deliveryEvidenceDigest = await digest('forged-delivery')
    const candidate = await pendingCAS
    expect(candidate.record.state).toBe('pre-publish-outcome-unknown')
    expect(candidate.record.publishConfirmationEvidenceDigest).toBeNull()
  })

  test('rejects cross-message and cross-revision binding changes at one-nanosecond precision', async () => {
    const sourceMessage = await message()
    const pending = await initialOutbox(sourceMessage)
    const pre = await prePublish(pending)

    for (const changes of [
      { businessTransactionId: 'transaction-other' },
      { businessTransactionDigest: await digest('transaction-other') },
      { entityId: 'other-entity' },
      { rowIdDigest: await digest('other-row') },
      { rowVersion: 2 },
      { eventId: 'event-other' },
      { eventDigest: await digest('other-event') },
      { queueId: 'queue-other' },
      { messageEnvelopeDigest: await digest('other-message') },
      { idempotencyKeyDigest: await digest('other-idempotency') },
      { recordedAt: ENQUEUED_AT }
    ]) {
      await expect(
        createBackendAutomationOutboxCASProposal(sourceMessage, pending, { ...pre, ...changes })
      ).rejects.toThrow()
    }

    await expect(
      createBackendAutomationOutboxCASProposal(
        sourceMessage,
        null,
        await initialOutbox(sourceMessage, {
          recordedAt: '2026-09-09T00:00:00.000000001Z'
        })
      )
    ).rejects.toThrow()

    const otherMessage = await message({
      eventId: 'event-other',
      payloadDigest: await digest('event-other')
    })
    await expect(
      createBackendAutomationOutboxCASProposal(otherMessage, null, pending)
    ).rejects.toThrow()
  })

  test('rejects accessors, proxies, prototypes, symbols, cycles, depth, and secret-like data safely', async () => {
    const sourceMessage = await message()
    const source = await initialOutbox(sourceMessage)
    const inherited = Object.assign(Object.create({ inherited: true }), source)
    expect(() => parseBackendAutomationOutboxRecord(inherited)).toThrow(
      'Backend Automation outbox record is invalid.'
    )
    expect(() =>
      parseBackendAutomationOutboxRecord({ ...source, [Symbol('hidden')]: true })
    ).toThrow()

    let getterCalls = 0
    const accessor = { ...source }
    Object.defineProperty(accessor, 'outboxId', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'outbox-attacker'
      }
    })
    expect(() => parseBackendAutomationOutboxRecord(accessor)).toThrow()
    expect(getterCalls).toBe(0)

    const proxied = new Proxy(source, {
      ownKeys() {
        throw new Error('sb_secret_do-not-reflect-this')
      }
    })
    expect(() => parseBackendAutomationOutboxRecord(proxied)).toThrow(
      'Backend Automation outbox record is invalid.'
    )
    expect(() => parseBackendAutomationOutboxRecord(new Proxy(source, {}))).toThrow(
      'Backend Automation outbox record is invalid.'
    )
    expect(() =>
      parseBackendAutomationOutboxRecord({
        ...source,
        publishAttemptIds: new Proxy(['publish-attempt-001'], {})
      })
    ).toThrow('Backend Automation outbox record is invalid.')

    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => parseBackendAutomationOutboxRecord({ ...source, extra: cyclic })).toThrow()
    let deep: unknown = 'leaf'
    for (let index = 0; index < 1_000; index += 1) deep = { deep }
    expect(() => parseBackendAutomationOutboxRecord({ ...source, outboxId: deep })).toThrow()
    expect(() =>
      parseBackendAutomationOutboxRecord({
        ...source,
        entityId: 'sb_secret_hidden-outbox-token'
      })
    ).toThrow('Backend Automation outbox record is invalid.')

    const candidate = await createBackendAutomationOutboxCASProposal(sourceMessage, null, source)
    expect(() =>
      parseBackendAutomationOutboxCASProposal({
        ...candidate.proposal,
        entityId: 'sb_secret_hidden-cas-token'
      })
    ).toThrow('Backend Automation outbox CAS proposal is invalid.')
  })
})
