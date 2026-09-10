/* eslint-disable max-lines -- bounded sink fixtures and strict tamper cases share one contract boundary */
import { describe, expect, test } from 'bun:test'

import {
  BACKEND_OPERATIONAL_EVENT_SINK_BATCH_FORMAT,
  BACKEND_OPERATIONAL_EVENT_SINK_CAS_PROPOSAL_FORMAT,
  BACKEND_OPERATIONAL_EVENT_SINK_INPUT_FORMAT,
  BACKEND_OPERATIONAL_EVENT_SINK_MAX_CANONICAL_BYTES,
  BACKEND_OPERATIONAL_EVENT_SINK_MAX_EVENT_CANONICAL_BYTES,
  BACKEND_OPERATIONAL_EVENT_SINK_MAX_REVISION,
  canonicalBackendOperationalEventSinkBatchBytes,
  canonicalBackendOperationalEventSinkCASProposalBytes,
  createBackendOperationalEventSinkCASProposal,
  digestBackendOperationalEventSinkBatch,
  digestBackendOperationalEventSinkCASProposal,
  verifyBackendOperationalEventSinkBatch,
  verifyBackendOperationalEventSinkCASProposal,
  type BackendOperationalEventSinkInputV1
} from '#lowcode/backend/operational-event-sink'
import {
  BACKEND_OPERATIONAL_APPEND_AUTHORITY_FORMAT,
  BACKEND_OPERATIONAL_EVENT_ANCHOR_FORMAT,
  BACKEND_OPERATIONAL_EVENT_FORMAT,
  appendBackendOperationalEvent,
  canonicalBackendOperationalEventBytes,
  digestBackendOperationalEvent,
  parseBackendOperationalEvent,
  type BackendOperationalEventAppendAuthorityV1,
  type BackendOperationalEventTrustedAnchorV1,
  type BackendOperationalEventV1
} from '#lowcode/backend/release/operational-event'

import { canonicalManifestBytes, digestCanonicalManifest } from '@open-pencil/scene-graph'

const STARTED_AT = '2026-09-09T00:00:00Z'
const TERMINAL_AT = '2026-09-09T00:00:01Z'
const EVALUATED_AT = '2026-09-09T00:00:10Z'

async function digest(label: string): Promise<string> {
  return digestCanonicalManifest({ label })
}

async function authority(
  overrides: Partial<BackendOperationalEventAppendAuthorityV1> = {}
): Promise<BackendOperationalEventAppendAuthorityV1> {
  return {
    format: BACKEND_OPERATIONAL_APPEND_AUTHORITY_FORMAT,
    version: 1,
    eventId: 'event-1',
    operationId: 'operation-1',
    attemptId: 'attempt-1',
    observedAt: STARTED_AT,
    phase: 'observe',
    outcome: 'started',
    releaseId: null,
    planId: null,
    planDigest: null,
    singleFlightKey: null,
    remoteOperationIds: [],
    durationMs: null,
    stableErrorCode: null,
    evidenceDigest: null,
    traceId: 'trace-1',
    ...overrides
  }
}

async function anchor(
  trustedHeadDigest: string | null,
  overrides: Partial<BackendOperationalEventTrustedAnchorV1> = {}
): Promise<BackendOperationalEventTrustedAnchorV1> {
  return {
    format: BACKEND_OPERATIONAL_EVENT_ANCHOR_FORMAT,
    version: 1,
    providerId: 'provider.test',
    environment: 'staging',
    authorityDigest: await digest('authority'),
    priorSegmentHeadDigest: null,
    priorSegmentLastOccurredAt: null,
    priorSegmentOpenAttemptIds: [],
    trustedHeadDigest,
    evaluatedAt: EVALUATED_AT,
    ...overrides
  }
}

async function closedSegment(): Promise<{
  events: readonly [BackendOperationalEventV1, BackendOperationalEventV1]
  trustedAnchor: BackendOperationalEventTrustedAnchorV1
}> {
  const first = await appendBackendOperationalEvent([], await anchor(null), await authority())
  const second = await appendBackendOperationalEvent(
    [first.event],
    await anchor(first.eventDigest),
    await authority({
      eventId: 'event-2',
      observedAt: TERMINAL_AT,
      outcome: 'succeeded',
      durationMs: 1_000
    })
  )
  return {
    events: [first.event, second.event],
    trustedAnchor: await anchor(second.eventDigest)
  }
}

async function input(
  overrides: Partial<BackendOperationalEventSinkInputV1> = {}
): Promise<BackendOperationalEventSinkInputV1> {
  const segment = await closedSegment()
  return {
    format: BACKEND_OPERATIONAL_EVENT_SINK_INPUT_FORMAT,
    version: 1,
    events: segment.events,
    trustedAnchor: segment.trustedAnchor,
    expectedRevision: null,
    expectedHeadDigest: null,
    ...overrides
  }
}

async function rolloverInput(expectedRevision = 0): Promise<BackendOperationalEventSinkInputV1> {
  const prior = await closedSegment()
  const priorHead = prior.trustedAnchor.trustedHeadDigest
  if (!priorHead) throw new Error('fixture prior head is unavailable')
  const rolloverBoundary = await anchor(priorHead, {
    priorSegmentHeadDigest: priorHead,
    priorSegmentLastOccurredAt: TERMINAL_AT
  })
  const next = await appendBackendOperationalEvent(
    [],
    rolloverBoundary,
    await authority({
      eventId: 'event-segment-2',
      operationId: 'operation-2',
      attemptId: 'attempt-2',
      observedAt: '2026-09-09T00:00:02Z',
      traceId: 'trace-2'
    })
  )
  return {
    format: BACKEND_OPERATIONAL_EVENT_SINK_INPUT_FORMAT,
    version: 1,
    events: [next.event],
    trustedAnchor: await anchor(next.eventDigest, {
      priorSegmentHeadDigest: priorHead,
      priorSegmentLastOccurredAt: TERMINAL_AT
    }),
    expectedRevision,
    expectedHeadDigest: priorHead
  }
}

async function boundedSegment(
  count: number,
  singleFlightPadding = 0
): Promise<{
  events: readonly BackendOperationalEventV1[]
  head: string
}> {
  const events: BackendOperationalEventV1[] = []
  let previousEventDigest: string | null = null
  const authorityDigest = await digest('authority')
  for (let index = 0; index < count; index += 1) {
    const started = index % 2 === 0
    const attempt = Math.floor(index / 2)
    const event = parseBackendOperationalEvent({
      format: BACKEND_OPERATIONAL_EVENT_FORMAT,
      version: 1,
      eventId: `bounded-event-${index}`,
      operationId: `bounded-operation-${attempt}`,
      attemptId: `bounded-attempt-${attempt}`,
      occurredAt: STARTED_AT,
      providerId: 'provider.test',
      environment: 'staging',
      authorityDigest,
      releaseId: null,
      planId: null,
      planDigest: null,
      singleFlightKey:
        singleFlightPadding === 0
          ? null
          : `bounded-flight-${attempt}-${'a'.repeat(singleFlightPadding)}`,
      remoteOperationIds: [],
      phase: 'observe',
      outcome: started ? 'started' : 'succeeded',
      durationMs: started ? null : 1,
      stableErrorCode: null,
      evidenceDigest: null,
      traceId: `bounded-trace-${attempt}`,
      previousEventDigest
    })
    events.push(event)
    previousEventDigest = await digestBackendOperationalEvent(event)
  }
  if (!previousEventDigest) throw new Error('fixture head is unavailable')
  return { events, head: previousEventDigest }
}

describe('provider-neutral operational event sink batch and CAS proposal', () => {
  test('binds a strict event segment to one immutable, unprivileged sink proposal', async () => {
    const source = await input()
    const proposal = await createBackendOperationalEventSinkCASProposal(source)

    expect(proposal).toMatchObject({
      format: BACKEND_OPERATIONAL_EVENT_SINK_CAS_PROPOSAL_FORMAT,
      version: 1,
      expectedRevision: null,
      expectedHeadDigest: null,
      nextRevision: 0,
      nextHeadDigest: source.trustedAnchor.trustedHeadDigest,
      hostAnchorAuthenticated: false,
      persistenceAuthorityGranted: false,
      exportAuthorityGranted: false,
      alertAuthorityGranted: false,
      releaseAuthorityGranted: false,
      batch: {
        format: BACKEND_OPERATIONAL_EVENT_SINK_BATCH_FORMAT,
        providerId: 'provider.test',
        environment: 'staging',
        authorityDigest: source.trustedAnchor.authorityDigest,
        segmentPriorHeadDigest: null,
        segmentHeadDigest: source.trustedAnchor.trustedHeadDigest,
        eventCount: 2,
        hostEvaluatedAt: EVALUATED_AT,
        hostAnchorAuthenticated: false,
        persistenceAuthorityGranted: false,
        exportAuthorityGranted: false,
        alertAuthorityGranted: false,
        releaseAuthorityGranted: false
      }
    })
    expect(proposal.batch.eventDigests).toEqual(
      await Promise.all(source.events.map((event) => digestBackendOperationalEvent(event)))
    )
    expect(await verifyBackendOperationalEventSinkBatch(proposal.batch)).toEqual(proposal.batch)
    expect(await verifyBackendOperationalEventSinkCASProposal(proposal)).toEqual(proposal)
    for (const value of [
      proposal,
      proposal.batch,
      proposal.batch.events,
      proposal.batch.events[0],
      proposal.batch.events[0]?.remoteOperationIds,
      proposal.batch.eventDigests,
      proposal.batch.trustedAnchor,
      proposal.batch.trustedAnchor.priorSegmentOpenAttemptIds
    ]) {
      expect(Object.isFrozen(value)).toBe(true)
    }
  })

  test('binds a rollover batch to the exact prior sink revision and chain head', async () => {
    const source = await rolloverInput()
    const proposal = await createBackendOperationalEventSinkCASProposal(source)

    expect(proposal).toMatchObject({
      expectedRevision: 0,
      expectedHeadDigest: source.expectedHeadDigest,
      nextRevision: 1,
      nextHeadDigest: source.trustedAnchor.trustedHeadDigest,
      batch: {
        segmentPriorHeadDigest: source.expectedHeadDigest,
        eventCount: 1
      }
    })
  })

  test('accepts exactly 256 verified events and rejects an oversized or empty batch', async () => {
    const bounded = await boundedSegment(256)
    const accepted = await createBackendOperationalEventSinkCASProposal({
      format: BACKEND_OPERATIONAL_EVENT_SINK_INPUT_FORMAT,
      version: 1,
      events: bounded.events,
      trustedAnchor: await anchor(bounded.head),
      expectedRevision: null,
      expectedHeadDigest: null
    })
    expect(accepted.batch.eventCount).toBe(256)

    await expect(
      createBackendOperationalEventSinkCASProposal({
        format: BACKEND_OPERATIONAL_EVENT_SINK_INPUT_FORMAT,
        version: 1,
        events: [],
        trustedAnchor: await anchor(null),
        expectedRevision: null,
        expectedHeadDigest: null
      })
    ).rejects.toThrow()
    await expect(
      createBackendOperationalEventSinkCASProposal({
        format: BACKEND_OPERATIONAL_EVENT_SINK_INPUT_FORMAT,
        version: 1,
        events: Array.from({ length: 257 }, () => bounded.events[0]),
        trustedAnchor: await anchor(bounded.head),
        expectedRevision: null,
        expectedHeadDigest: null
      })
    ).rejects.toThrow()
  })

  test('enforces the 16 KiB event and 256 KiB total canonical sink envelopes', async () => {
    const remoteOperationIds = Array.from(
      { length: 100 },
      (_, index) => `remote-${index}-${'a'.repeat(190)}`
    )
    const first = await appendBackendOperationalEvent(
      [],
      await anchor(null),
      await authority({ remoteOperationIds })
    )
    const terminal = await appendBackendOperationalEvent(
      [first.event],
      await anchor(first.eventDigest),
      await authority({
        eventId: 'oversized-event-2',
        observedAt: TERMINAL_AT,
        outcome: 'succeeded',
        durationMs: 1,
        remoteOperationIds
      })
    )
    expect(canonicalBackendOperationalEventBytes(first.event).byteLength).toBeGreaterThan(
      BACKEND_OPERATIONAL_EVENT_SINK_MAX_EVENT_CANONICAL_BYTES
    )
    await expect(
      createBackendOperationalEventSinkCASProposal({
        format: BACKEND_OPERATIONAL_EVENT_SINK_INPUT_FORMAT,
        version: 1,
        events: [first.event, terminal.event],
        trustedAnchor: await anchor(terminal.eventDigest),
        expectedRevision: null,
        expectedHeadDigest: null
      })
    ).rejects.toThrow()

    const aggregate = await boundedSegment(256, 1_100)
    expect(
      Math.max(
        ...aggregate.events.map((event) => canonicalBackendOperationalEventBytes(event).length)
      )
    ).toBeLessThan(BACKEND_OPERATIONAL_EVENT_SINK_MAX_EVENT_CANONICAL_BYTES)
    expect(canonicalManifestBytes(aggregate.events).byteLength).toBeGreaterThan(
      BACKEND_OPERATIONAL_EVENT_SINK_MAX_CANONICAL_BYTES
    )
    await expect(
      createBackendOperationalEventSinkCASProposal({
        format: BACKEND_OPERATIONAL_EVENT_SINK_INPUT_FORMAT,
        version: 1,
        events: aggregate.events,
        trustedAnchor: await anchor(aggregate.head),
        expectedRevision: null,
        expectedHeadDigest: null
      })
    ).rejects.toThrow()
  })

  test('delegates cross-domain, hash-chain, anchor, boundary, and Host-clock checks to the strict verifier', async () => {
    const source = await input()
    const otherDigest = await digest('other')
    const cases: unknown[] = [
      {
        ...source,
        trustedAnchor: { ...source.trustedAnchor, providerId: 'provider.other' }
      },
      {
        ...source,
        events: [source.events[0], { ...source.events[1], previousEventDigest: otherDigest }]
      },
      {
        ...source,
        trustedAnchor: { ...source.trustedAnchor, trustedHeadDigest: otherDigest }
      },
      {
        ...source,
        trustedAnchor: { ...source.trustedAnchor, priorSegmentOpenAttemptIds: ['attempt-open'] }
      },
      {
        ...source,
        trustedAnchor: { ...source.trustedAnchor, evaluatedAt: STARTED_AT }
      }
    ]

    for (const invalid of cases) {
      await expect(createBackendOperationalEventSinkCASProposal(invalid)).rejects.toThrow()
    }
  })

  test('rejects negative zero, unsafe or overflowing revisions, and non-exact CAS heads', async () => {
    const source = await input()
    for (const expectedRevision of [-0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        createBackendOperationalEventSinkCASProposal({ ...source, expectedRevision })
      ).rejects.toThrow()
    }
    await expect(
      createBackendOperationalEventSinkCASProposal({
        ...source,
        expectedRevision: BACKEND_OPERATIONAL_EVENT_SINK_MAX_REVISION,
        expectedHeadDigest: await digest('prior')
      })
    ).rejects.toThrow()
    await expect(
      createBackendOperationalEventSinkCASProposal({
        ...source,
        expectedRevision: 0,
        expectedHeadDigest: null
      })
    ).rejects.toThrow()
    await expect(
      createBackendOperationalEventSinkCASProposal({
        ...source,
        expectedRevision: 0,
        expectedHeadDigest: await digest('wrong-prior')
      })
    ).rejects.toThrow()

    const negativeZeroTerminal = parseBackendOperationalEvent({
      ...source.events[1],
      durationMs: -0
    })
    await expect(
      createBackendOperationalEventSinkCASProposal({
        ...source,
        events: [source.events[0], negativeZeroTerminal],
        trustedAnchor: {
          ...source.trustedAnchor,
          trustedHeadDigest: await digestBackendOperationalEvent(negativeZeroTerminal)
        }
      })
    ).rejects.toThrow()

    const largest = await rolloverInput(BACKEND_OPERATIONAL_EVENT_SINK_MAX_REVISION - 1)
    expect((await createBackendOperationalEventSinkCASProposal(largest)).nextRevision).toBe(
      BACKEND_OPERATIONAL_EVENT_SINK_MAX_REVISION
    )
  })

  test('rejects unknown fields, custom prototypes, cycles, deep values, and secret-like input', async () => {
    const source = await input()
    await expect(
      createBackendOperationalEventSinkCASProposal({ ...source, payload: { rows: [] } })
    ).rejects.toThrow()

    const customInput = Object.assign(Object.create({ inherited: true }), source)
    await expect(createBackendOperationalEventSinkCASProposal(customInput)).rejects.toThrow()
    const customEvent = Object.assign(Object.create({ inherited: true }), source.events[0])
    await expect(
      createBackendOperationalEventSinkCASProposal({
        ...source,
        events: [customEvent, source.events[1]]
      })
    ).rejects.toThrow()
    const customAnchor = Object.assign(Object.create({ inherited: true }), source.trustedAnchor)
    await expect(
      createBackendOperationalEventSinkCASProposal({ ...source, trustedAnchor: customAnchor })
    ).rejects.toThrow()

    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    await expect(
      createBackendOperationalEventSinkCASProposal({ ...source, expectedRevision: cycle })
    ).rejects.toThrow()
    let deep: unknown = null
    for (let index = 0; index < 10_000; index += 1) deep = { nested: deep }
    await expect(
      createBackendOperationalEventSinkCASProposal({ ...source, expectedHeadDigest: deep })
    ).rejects.toThrow()
    const secretCanary = ['sk', 'live', 'abcdefghijklmnop'].join('_')
    for (const events of [
      [{ ...source.events[0], eventId: secretCanary }, source.events[1]],
      [source.events[0], { ...source.events[1], outcome: 'failed', stableErrorCode: secretCanary }],
      [{ ...source.events[0], remoteOperationIds: [secretCanary] }, source.events[1]],
      [{ ...source.events[0], traceId: secretCanary }, source.events[1]]
    ]) {
      await expect(
        createBackendOperationalEventSinkCASProposal({ ...source, events })
      ).rejects.toThrow()
    }
  })

  test('rejects accessors and transparent or hostile Proxies without invoking getters or leaking errors', async () => {
    const source = await input()
    let getterCalls = 0
    const accessorEvent = { ...source.events[0] }
    Object.defineProperty(accessorEvent, 'eventId', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'event-accessor'
      }
    })
    await expect(
      createBackendOperationalEventSinkCASProposal({
        ...source,
        events: [accessorEvent, source.events[1]]
      })
    ).rejects.toThrow()
    expect(getterCalls).toBe(0)

    const accessorEvents = [...source.events]
    Object.defineProperty(accessorEvents, '0', {
      enumerable: true,
      get() {
        getterCalls += 1
        return source.events[0]
      }
    })
    await expect(
      createBackendOperationalEventSinkCASProposal({ ...source, events: accessorEvents })
    ).rejects.toThrow()
    expect(getterCalls).toBe(0)

    await expect(
      createBackendOperationalEventSinkCASProposal(new Proxy(source, {}))
    ).rejects.toThrow()
    await expect(
      createBackendOperationalEventSinkCASProposal({
        ...source,
        events: [new Proxy(source.events[0] as BackendOperationalEventV1, {}), source.events[1]]
      })
    ).rejects.toThrow()
    await expect(
      createBackendOperationalEventSinkCASProposal({
        ...source,
        trustedAnchor: new Proxy(source.trustedAnchor, {})
      })
    ).rejects.toThrow()

    const secretCanary = 'sk_live_proxy_secret_abcdefghijklmnop'
    const hostileProxy = new Proxy(source, {
      ownKeys() {
        throw new Error(secretCanary)
      }
    })
    let message = ''
    try {
      await createBackendOperationalEventSinkCASProposal(hostileProxy)
    } catch (cause) {
      message = cause instanceof Error ? cause.message : String(cause)
    }
    expect(message).not.toContain(secretCanary)
  })

  test('snapshots input and proposal data before the first asynchronous digest', async () => {
    const immutableSource = await input()
    const source = {
      ...immutableSource,
      events: immutableSource.events.map((event) => ({
        ...event,
        remoteOperationIds: [...event.remoteOperationIds]
      })),
      trustedAnchor: {
        ...immutableSource.trustedAnchor,
        priorSegmentOpenAttemptIds: [...immutableSource.trustedAnchor.priorSegmentOpenAttemptIds]
      }
    }
    const pending = createBackendOperationalEventSinkCASProposal(source)
    const firstSourceEvent = source.events.at(0)
    if (!firstSourceEvent) throw new Error('fixture first event is unavailable')
    firstSourceEvent.eventId = 'event-mutated'
    source.trustedAnchor.providerId = 'provider.mutated'
    source.expectedRevision = 9
    const proposal = await pending
    expect(proposal.batch.events[0]?.eventId).toBe('event-1')
    expect(proposal.batch.providerId).toBe('provider.test')
    expect(proposal.expectedRevision).toBeNull()

    const otherDigest = await digest('async-mutation')
    const candidate = {
      ...proposal,
      batch: {
        ...proposal.batch,
        trustedAnchor: {
          ...proposal.batch.trustedAnchor,
          priorSegmentOpenAttemptIds: [...proposal.batch.trustedAnchor.priorSegmentOpenAttemptIds]
        },
        events: proposal.batch.events.map((event) => ({
          ...event,
          remoteOperationIds: [...event.remoteOperationIds]
        })),
        eventDigests: [...proposal.batch.eventDigests]
      }
    }
    const verifying = verifyBackendOperationalEventSinkCASProposal(candidate)
    const firstCandidateEvent = candidate.batch.events.at(0)
    if (!firstCandidateEvent) throw new Error('fixture first candidate event is unavailable')
    firstCandidateEvent.eventId = 'event-mutated-again'
    candidate.batch.eventDigests[0] = otherDigest
    candidate.batch.providerId = 'provider.mutated-again'
    candidate.nextRevision = 9
    await expect(verifying).resolves.toEqual(proposal)
  })

  test('rejects every redundant batch claim or authority-flag tamper', async () => {
    const proposal = await createBackendOperationalEventSinkCASProposal(await input())
    const otherDigest = await digest('other')
    const batches: unknown[] = [
      { ...proposal.batch, eventCount: -0 },
      { ...proposal.batch, eventCount: 1 },
      { ...proposal.batch, eventDigests: [otherDigest, proposal.batch.eventDigests[1]] },
      { ...proposal.batch, providerId: 'provider.other' },
      { ...proposal.batch, authorityDigest: otherDigest },
      { ...proposal.batch, segmentHeadDigest: otherDigest },
      { ...proposal.batch, hostEvaluatedAt: '2026-09-09T00:00:09Z' },
      { ...proposal.batch, hostAnchorAuthenticated: true },
      { ...proposal.batch, persistenceAuthorityGranted: true },
      { ...proposal.batch, exportAuthorityGranted: true },
      { ...proposal.batch, alertAuthorityGranted: true },
      { ...proposal.batch, releaseAuthorityGranted: true },
      { ...proposal.batch, unknown: true }
    ]
    for (const batch of batches) {
      await expect(verifyBackendOperationalEventSinkBatch(batch)).rejects.toThrow()
    }
  })

  test('rejects batch-digest, CAS, nested-batch, authority, and shape tampering', async () => {
    const proposal = await createBackendOperationalEventSinkCASProposal(await input())
    const otherDigest = await digest('other')
    const proposals: unknown[] = [
      { ...proposal, batchDigest: otherDigest },
      { ...proposal, expectedRevision: -0 },
      { ...proposal, expectedRevision: 0 },
      { ...proposal, expectedHeadDigest: otherDigest },
      { ...proposal, nextRevision: -0 },
      { ...proposal, nextRevision: 1 },
      { ...proposal, nextHeadDigest: otherDigest },
      { ...proposal, batch: { ...proposal.batch, eventCount: 1 } },
      { ...proposal, hostAnchorAuthenticated: true },
      { ...proposal, persistenceAuthorityGranted: true },
      { ...proposal, exportAuthorityGranted: true },
      { ...proposal, alertAuthorityGranted: true },
      { ...proposal, releaseAuthorityGranted: true },
      { ...proposal, unknown: true }
    ]
    for (const candidate of proposals) {
      await expect(verifyBackendOperationalEventSinkCASProposal(candidate)).rejects.toThrow()
    }
  })

  test('canonicalizes property insertion order and rejects event substitution without a recomputed chain', async () => {
    const source = await input()
    const reordered: BackendOperationalEventSinkInputV1 = {
      expectedHeadDigest: source.expectedHeadDigest,
      expectedRevision: source.expectedRevision,
      trustedAnchor: {
        evaluatedAt: source.trustedAnchor.evaluatedAt,
        trustedHeadDigest: source.trustedAnchor.trustedHeadDigest,
        priorSegmentOpenAttemptIds: source.trustedAnchor.priorSegmentOpenAttemptIds,
        priorSegmentLastOccurredAt: source.trustedAnchor.priorSegmentLastOccurredAt,
        priorSegmentHeadDigest: source.trustedAnchor.priorSegmentHeadDigest,
        authorityDigest: source.trustedAnchor.authorityDigest,
        environment: source.trustedAnchor.environment,
        providerId: source.trustedAnchor.providerId,
        version: source.trustedAnchor.version,
        format: source.trustedAnchor.format
      },
      events: source.events.map((event) => ({
        previousEventDigest: event.previousEventDigest,
        traceId: event.traceId,
        evidenceDigest: event.evidenceDigest,
        stableErrorCode: event.stableErrorCode,
        durationMs: event.durationMs,
        outcome: event.outcome,
        phase: event.phase,
        remoteOperationIds: event.remoteOperationIds,
        singleFlightKey: event.singleFlightKey,
        planDigest: event.planDigest,
        planId: event.planId,
        releaseId: event.releaseId,
        authorityDigest: event.authorityDigest,
        environment: event.environment,
        providerId: event.providerId,
        occurredAt: event.occurredAt,
        attemptId: event.attemptId,
        operationId: event.operationId,
        eventId: event.eventId,
        version: event.version,
        format: event.format
      })),
      version: source.version,
      format: source.format
    }
    const first = await createBackendOperationalEventSinkCASProposal(source)
    const second = await createBackendOperationalEventSinkCASProposal(reordered)

    expect(await canonicalBackendOperationalEventSinkBatchBytes(first.batch)).toEqual(
      await canonicalBackendOperationalEventSinkBatchBytes(second.batch)
    )
    expect(await digestBackendOperationalEventSinkBatch(first.batch)).toBe(
      await digestBackendOperationalEventSinkBatch(second.batch)
    )
    expect(await canonicalBackendOperationalEventSinkCASProposalBytes(first)).toEqual(
      await canonicalBackendOperationalEventSinkCASProposalBytes(second)
    )
    expect(await digestBackendOperationalEventSinkCASProposal(first)).toBe(
      await digestBackendOperationalEventSinkCASProposal(second)
    )

    const substituted = await input({
      events: [
        { ...source.events[0], eventId: 'event-substituted' },
        source.events[1]
      ] as readonly BackendOperationalEventV1[]
    })
    await expect(createBackendOperationalEventSinkCASProposal(substituted)).rejects.toThrow()
  })
})
