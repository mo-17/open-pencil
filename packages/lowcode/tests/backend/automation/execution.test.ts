import { describe, expect, test } from 'bun:test'

import {
  BACKEND_AUTOMATION_EXECUTION_DISPOSITION_FORMAT,
  BACKEND_AUTOMATION_EXECUTION_INPUT_FORMAT,
  BACKEND_AUTOMATION_EXECUTION_UINT32_MAX,
  canonicalBackendAutomationExecutionDispositionBytes,
  canonicalBackendAutomationExecutionInputBytes,
  digestBackendAutomationExecutionDisposition,
  digestBackendAutomationExecutionInput,
  parseBackendAutomationExecutionDisposition,
  parseBackendAutomationExecutionInput,
  planBackendAutomationExecutionDisposition,
  type BackendAutomationExecutionInputV1
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

async function digest(label: string): Promise<string> {
  return digestCanonicalManifest({ label })
}

async function input(
  overrides: Partial<BackendAutomationExecutionInputV1> = {}
): Promise<BackendAutomationExecutionInputV1> {
  return {
    format: BACKEND_AUTOMATION_EXECUTION_INPUT_FORMAT,
    version: 1,
    automationId: 'automation-orders',
    operationId: 'operation-1',
    attemptId: 'attempt-1',
    eventId: 'event-1',
    idempotencyDigest: await digest('idempotency'),
    causation: { id: 'causation-1', hop: 1, maxHop: 8 },
    attemptNumber: 1,
    retryPolicy: {
      maxAttempts: 3,
      initialDelayMs: 1_000,
      maxDelayMs: 8_000,
      backoff: 'exponential',
      jitter: 'none',
      deadLetterQueueId: 'orders-dead-letter'
    },
    observedOutcome: {
      kind: 'retryable-failure',
      stableCode: 'remote-temporarily-unavailable',
      evidenceDigest: await digest('outcome-evidence')
    },
    jitterUint32: null,
    ...overrides
  }
}

describe('Backend Automation execution disposition contract', () => {
  test('plans a bounded fixed or exponential retry without granting runtime authority', async () => {
    const planned = planBackendAutomationExecutionDisposition(await input())

    expect(planned).toMatchObject({
      format: BACKEND_AUTOMATION_EXECUTION_DISPOSITION_FORMAT,
      version: 1,
      decision: {
        kind: 'retry',
        terminal: false,
        requiresReconciliation: false,
        nextAttemptNumber: 2,
        retryDelayMs: 1_000,
        deadLetterQueueId: null,
        hostAuthorityAuthenticated: false,
        runtimeAuthorityGranted: false,
        releaseAuthorityGranted: false
      }
    })
    expect(planned.input.automationId).toBe('automation-orders')
    expect(planned.input.operationId).toBe('operation-1')
    expect(planned.input.attemptId).toBe('attempt-1')
    expect(planned.input.eventId).toBe('event-1')
    expect(planned.input.causation).toEqual({ id: 'causation-1', hop: 1, maxHop: 8 })
    expect(Object.isFrozen(planned)).toBe(true)
    expect(Object.isFrozen(planned.input)).toBe(true)
    expect(Object.isFrozen(planned.input.causation)).toBe(true)
    expect(Object.isFrozen(planned.input.retryPolicy)).toBe(true)
    expect(Object.isFrozen(planned.input.observedOutcome)).toBe(true)
    expect(Object.isFrozen(planned.decision)).toBe(true)
  })

  test('caps exponential backoff without multiplying beyond the configured maximum', async () => {
    expect(
      planBackendAutomationExecutionDisposition(await input({ attemptNumber: 2 })).decision
        .retryDelayMs
    ).toBe(2_000)
    const planned = planBackendAutomationExecutionDisposition(
      await input({
        attemptNumber: 19,
        retryPolicy: {
          maxAttempts: 20,
          initialDelayMs: 60_000,
          maxDelayMs: 86_400_000,
          backoff: 'exponential',
          jitter: 'none',
          deadLetterQueueId: null
        }
      })
    )

    expect(planned.decision).toMatchObject({
      kind: 'retry',
      nextAttemptNumber: 20,
      retryDelayMs: 86_400_000
    })
  })

  test('maps Host-provided uint32 full jitter into the inclusive capped delay range', async () => {
    const base = await input({
      retryPolicy: {
        maxAttempts: 3,
        initialDelayMs: 1_000,
        maxDelayMs: 8_000,
        backoff: 'fixed',
        jitter: 'full',
        deadLetterQueueId: null
      },
      jitterUint32: 0
    })
    const minimum = planBackendAutomationExecutionDisposition(base)
    const maximum = planBackendAutomationExecutionDisposition({
      ...base,
      jitterUint32: BACKEND_AUTOMATION_EXECUTION_UINT32_MAX
    })

    expect(minimum.decision.retryDelayMs).toBe(0)
    expect(maximum.decision.retryDelayMs).toBe(1_000)
    expect(planBackendAutomationExecutionDisposition(base)).toEqual(minimum)
  })

  test('requires jitter entropy exactly when a full-jitter retry is planned', async () => {
    const base = await input({
      retryPolicy: {
        maxAttempts: 3,
        initialDelayMs: 1_000,
        maxDelayMs: 8_000,
        backoff: 'fixed',
        jitter: 'full',
        deadLetterQueueId: null
      }
    })

    expect(() => planBackendAutomationExecutionDisposition(base)).toThrow(
      'required when a full-jitter retry is planned'
    )
    expect(() =>
      planBackendAutomationExecutionDisposition({
        ...base,
        retryPolicy: { ...base.retryPolicy, jitter: 'none' },
        jitterUint32: 1
      })
    ).toThrow('must be null when full jitter is not used')
  })

  test('makes success terminal and never consumes unused jitter', async () => {
    const planned = planBackendAutomationExecutionDisposition(
      await input({
        attemptNumber: 3,
        observedOutcome: {
          kind: 'succeeded',
          stableCode: null,
          evidenceDigest: await digest('success')
        }
      })
    )

    expect(planned.decision).toMatchObject({
      kind: 'succeeded',
      terminal: true,
      requiresReconciliation: false,
      nextAttemptNumber: null,
      retryDelayMs: null,
      deadLetterQueueId: null
    })
  })

  test('never automatically retries or terminally classifies an unknown outcome', async () => {
    const planned = planBackendAutomationExecutionDisposition(
      await input({
        attemptNumber: 3,
        observedOutcome: {
          kind: 'outcome-unknown',
          stableCode: 'dispatch-result-unavailable',
          evidenceDigest: await digest('unknown')
        }
      })
    )

    expect(planned.decision).toMatchObject({
      kind: 'outcome-unknown',
      terminal: false,
      requiresReconciliation: true,
      nextAttemptNumber: null,
      retryDelayMs: null,
      deadLetterQueueId: null,
      runtimeAuthorityGranted: false
    })
  })

  test('dead-letters exhausted retryable failures only when a queue was declared', async () => {
    const exhausted = await input({ attemptNumber: 3 })
    const withQueue = planBackendAutomationExecutionDisposition(exhausted)
    const withoutQueue = planBackendAutomationExecutionDisposition({
      ...exhausted,
      retryPolicy: { ...exhausted.retryPolicy, deadLetterQueueId: null }
    })

    expect(withQueue.decision).toMatchObject({
      kind: 'dead-letter',
      terminal: true,
      deadLetterQueueId: 'orders-dead-letter'
    })
    expect(withoutQueue.decision).toMatchObject({
      kind: 'failed',
      terminal: true,
      deadLetterQueueId: null
    })
  })

  test('never retries permanent failures and uses only a declared dead-letter queue', async () => {
    const permanent = await input({
      observedOutcome: {
        kind: 'permanent-failure',
        stableCode: 'payload-invalid',
        evidenceDigest: await digest('permanent')
      }
    })
    expect(planBackendAutomationExecutionDisposition(permanent).decision.kind).toBe('dead-letter')
    expect(
      planBackendAutomationExecutionDisposition({
        ...permanent,
        retryPolicy: { ...permanent.retryPolicy, deadLetterQueueId: null }
      }).decision.kind
    ).toBe('failed')
  })

  test('rejects unknown fields, non-plain prototypes, symbols, and accessors without invoking them', async () => {
    const base = await input()
    expect(() => parseBackendAutomationExecutionInput({ ...base, extra: true })).toThrow(
      'unsupported fields'
    )

    const inherited = Object.assign(Object.create({ inherited: true }), base)
    expect(() => parseBackendAutomationExecutionInput(inherited)).toThrow('plain data object')

    const symbolic = { ...base, [Symbol('hidden')]: true }
    expect(() => parseBackendAutomationExecutionInput(symbolic)).toThrow('symbol keys')

    let getterCalls = 0
    const accessor = { ...base }
    Object.defineProperty(accessor, 'eventId', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'event-attacker'
      }
    })
    expect(() => parseBackendAutomationExecutionInput(accessor)).toThrow(
      'enumerable data property values only'
    )
    expect(getterCalls).toBe(0)

    const nestedAccessor = { ...base.retryPolicy }
    Object.defineProperty(nestedAccessor, 'maxAttempts', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 3
      }
    })
    expect(() =>
      parseBackendAutomationExecutionInput({ ...base, retryPolicy: nestedAccessor })
    ).toThrow('enumerable data property values only')
    expect(getterCalls).toBe(0)
  })

  test('rejects cyclic and deeply nested hostile values without recursive traversal', async () => {
    const cyclic: Record<string, unknown> = { ...(await input()) }
    cyclic.retryPolicy = cyclic
    expect(() => parseBackendAutomationExecutionInput(cyclic)).toThrow()

    let deep: Record<string, unknown> = {}
    for (let index = 0; index < 10_000; index += 1) deep = { child: deep }
    const base = await input()
    expect(() =>
      parseBackendAutomationExecutionInput({
        ...base,
        observedOutcome: { ...base.observedOutcome, stableCode: deep }
      })
    ).toThrow('must be a string')
  })

  test('rejects invalid numeric boundaries and inconsistent attempt budgets', async () => {
    const base = await input()
    for (const attemptNumber of [0, 1.5, Number.NaN, 21]) {
      expect(() => parseBackendAutomationExecutionInput({ ...base, attemptNumber })).toThrow()
    }
    expect(() =>
      parseBackendAutomationExecutionInput({
        ...base,
        attemptNumber: 3,
        retryPolicy: { ...base.retryPolicy, maxAttempts: 2 }
      })
    ).toThrow('cannot exceed')
    for (const jitterUint32 of [-1, -0, 1.5, BACKEND_AUTOMATION_EXECUTION_UINT32_MAX + 1]) {
      expect(() => parseBackendAutomationExecutionInput({ ...base, jitterUint32 })).toThrow()
    }
    expect(() =>
      parseBackendAutomationExecutionInput({
        ...base,
        causation: { ...base.causation, hop: -0 }
      })
    ).toThrow()
    expect(() =>
      parseBackendAutomationExecutionInput({
        ...base,
        retryPolicy: { ...base.retryPolicy, initialDelayMs: 8_001, maxDelayMs: 8_000 }
      })
    ).toThrow('cannot exceed')
  })

  test('rejects malformed outcome semantics and secret-like identifiers', async () => {
    const base = await input()
    expect(() =>
      parseBackendAutomationExecutionInput({
        ...base,
        observedOutcome: { ...base.observedOutcome, kind: 'succeeded' }
      })
    ).toThrow('must be null')
    expect(() =>
      parseBackendAutomationExecutionInput({
        ...base,
        observedOutcome: { ...base.observedOutcome, stableCode: null }
      })
    ).toThrow('required')
    expect(() =>
      parseBackendAutomationExecutionInput({ ...base, eventId: 'sk_live_abc123' })
    ).toThrow('secret-free')
  })

  test('rejects computed-decision tampering and makes bound-input substitution digest-visible', async () => {
    const planned = planBackendAutomationExecutionDisposition(await input())
    expect(() =>
      parseBackendAutomationExecutionDisposition({
        ...planned,
        decision: { ...planned.decision, retryDelayMs: 999 }
      })
    ).toThrow('does not match')
    const substituted = parseBackendAutomationExecutionDisposition({
      ...planned,
      input: { ...planned.input, eventId: 'event-substituted' }
    })
    expect(await digestBackendAutomationExecutionDisposition(substituted)).not.toBe(
      await digestBackendAutomationExecutionDisposition(planned)
    )
    expect(() => parseBackendAutomationExecutionDisposition({ ...planned, unknown: true })).toThrow(
      'unsupported fields'
    )
  })

  test('canonicalizes insertion order and produces stable input and disposition digests', async () => {
    const base = await input()
    const reordered = {
      jitterUint32: base.jitterUint32,
      observedOutcome: {
        evidenceDigest: base.observedOutcome.evidenceDigest,
        stableCode: base.observedOutcome.stableCode,
        kind: base.observedOutcome.kind
      },
      retryPolicy: {
        deadLetterQueueId: base.retryPolicy.deadLetterQueueId,
        jitter: base.retryPolicy.jitter,
        backoff: base.retryPolicy.backoff,
        maxDelayMs: base.retryPolicy.maxDelayMs,
        initialDelayMs: base.retryPolicy.initialDelayMs,
        maxAttempts: base.retryPolicy.maxAttempts
      },
      attemptNumber: base.attemptNumber,
      causation: {
        maxHop: base.causation.maxHop,
        hop: base.causation.hop,
        id: base.causation.id
      },
      idempotencyDigest: base.idempotencyDigest,
      eventId: base.eventId,
      attemptId: base.attemptId,
      operationId: base.operationId,
      automationId: base.automationId,
      version: base.version,
      format: base.format
    }
    const first = planBackendAutomationExecutionDisposition(base)
    const second = planBackendAutomationExecutionDisposition(reordered)

    expect(canonicalBackendAutomationExecutionInputBytes(base)).toEqual(
      canonicalBackendAutomationExecutionInputBytes(reordered)
    )
    expect(await digestBackendAutomationExecutionInput(base)).toBe(
      await digestBackendAutomationExecutionInput(reordered)
    )
    expect(canonicalBackendAutomationExecutionDispositionBytes(first)).toEqual(
      canonicalBackendAutomationExecutionDispositionBytes(second)
    )
    expect(await digestBackendAutomationExecutionDisposition(first)).toBe(
      await digestBackendAutomationExecutionDisposition(second)
    )
  })
})
