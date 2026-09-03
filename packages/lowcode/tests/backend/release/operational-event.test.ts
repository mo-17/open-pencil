import { describe, expect, test } from 'bun:test'

import {
  BACKEND_OPERATIONAL_APPEND_AUTHORITY_FORMAT,
  BACKEND_OPERATIONAL_EVENT_ANCHOR_FORMAT,
  appendBackendOperationalEvent,
  canonicalBackendOperationalEventBytes,
  digestBackendOperationalEvent,
  inspectBackendOperationalEventChain,
  parseBackendOperationalEvent,
  verifyBackendOperationalEventChain,
  type BackendOperationalEventAppendAuthorityV1,
  type BackendOperationalEventTrustedAnchorV1
} from '#lowcode/backend/release/operational-event'

import {
  backendReleaseSingleFlightKey,
  createBackendReleasePlan,
  planBackendMigration,
  type BackendReleaseAuthorityV1
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import { backendModelFixture, stripeSecretCanary } from '../fixture'

const NOW = '2026-09-04T00:00:00Z'

async function digest(label: string): Promise<string> {
  return digestCanonicalManifest({ label })
}

async function appendAuthority(
  overrides: Partial<BackendOperationalEventAppendAuthorityV1> = {}
): Promise<BackendOperationalEventAppendAuthorityV1> {
  return {
    format: BACKEND_OPERATIONAL_APPEND_AUTHORITY_FORMAT,
    version: 1,
    eventId: 'event-1',
    operationId: 'operation-1',
    attemptId: 'attempt-1',
    observedAt: NOW,
    releaseId: 'release-1',
    planId: 'plan-1',
    planDigest: await digest('plan'),
    singleFlightKey: 'flight-1',
    remoteOperationIds: ['remote-b', 'remote-a'],
    phase: 'dispatch',
    outcome: 'started',
    durationMs: null,
    stableErrorCode: null,
    evidenceDigest: null,
    traceId: 'trace-1',
    ...overrides
  }
}

async function terminalAuthority(
  overrides: Partial<BackendOperationalEventAppendAuthorityV1> = {}
): Promise<BackendOperationalEventAppendAuthorityV1> {
  return appendAuthority({
    eventId: 'event-2',
    observedAt: '2026-09-04T00:00:01Z',
    outcome: 'succeeded',
    durationMs: 1_000,
    ...overrides
  })
}

async function trustedAnchor(
  trustedHeadDigest: string | null,
  priorSegmentHeadDigest: string | null = null,
  overrides: Partial<BackendOperationalEventTrustedAnchorV1> = {}
): Promise<BackendOperationalEventTrustedAnchorV1> {
  return {
    format: BACKEND_OPERATIONAL_EVENT_ANCHOR_FORMAT,
    version: 1,
    providerId: 'provider.test',
    environment: 'staging',
    authorityDigest: await digest('authority'),
    priorSegmentHeadDigest,
    priorSegmentLastOccurredAt: priorSegmentHeadDigest ? '2026-09-04T00:00:01Z' : null,
    priorSegmentOpenAttemptIds: [],
    trustedHeadDigest,
    evaluatedAt: '2026-09-04T00:00:10Z',
    ...overrides
  }
}

async function realSingleFlightKey(): Promise<string> {
  const authority: BackendReleaseAuthorityV1 = {
    documentDigest: await digest('document'),
    irDigest: await digest('ir'),
    inspectedSchemaDigest: await digest('schema'),
    compilerVersion: '0.15.0',
    target: 'project-main',
    environment: 'staging',
    projectId: 'project-1',
    accountId: 'account-1',
    grantGeneration: 'grant-1',
    backendProvider: {
      publisherId: 'open-pencil',
      packageDigest: `app-bundle-sha256:${await digest('package')}`,
      pluginId: 'open-pencil.backend-provider',
      contributionId: 'backend-provider',
      providerId: 'provider.test',
      adapterId: 'provider-test-v1',
      adapterVersion: '1.0.0',
      contractVersion: 1,
      supportedModelVersions: [1],
      capabilities: ['migrations.schema'],
      permissions: [],
      outputKinds: ['database-schema', 'server-runtime']
    }
  }
  const model = backendModelFixture()
  const plan = await createBackendReleasePlan({
    planId: 'plan-real-single-flight',
    authority,
    migrationPlan: await planBackendMigration(model, model),
    requiredArtifactKinds: ['schema', 'server']
  })
  return backendReleaseSingleFlightKey(plan, {
    staticArtifactDigest: null,
    serverArtifactDigest: await digest('server-artifact'),
    schemaArtifactDigest: await digest('schema-artifact')
  })
}

describe('authenticated append-only Backend operational event envelope', () => {
  test('seals an event from Host authority only against an explicit empty CAS head', async () => {
    const authority = await appendAuthority()
    const appended = await appendBackendOperationalEvent([], await trustedAnchor(null), authority)

    expect(appended.event).toMatchObject({
      format: 'openpencil.backend-operational-event',
      version: 1,
      eventId: authority.eventId,
      operationId: authority.operationId,
      attemptId: authority.attemptId,
      occurredAt: authority.observedAt,
      previousEventDigest: null,
      remoteOperationIds: ['remote-a', 'remote-b']
    })
    expect(appended.previousHeadDigest).toBeNull()
    expect(appended.eventDigest).toBe(await digestBackendOperationalEvent(appended.event))
    expect(canonicalBackendOperationalEventBytes(appended.event)).toBeInstanceOf(Uint8Array)
  })

  test('accepts started to terminal and verifies the mandatory trusted anchor', async () => {
    const first = await appendBackendOperationalEvent(
      [],
      await trustedAnchor(null),
      await appendAuthority()
    )
    const second = await appendBackendOperationalEvent(
      [first.event],
      await trustedAnchor(first.eventDigest),
      await terminalAuthority()
    )

    expect(second.event.previousEventDigest).toBe(first.eventDigest)
    expect(
      await verifyBackendOperationalEventChain(
        [first.event, second.event],
        await trustedAnchor(second.eventDigest)
      )
    ).toMatchObject({
      ok: true,
      events: [first.event, second.event],
      priorSegmentHeadDigest: null,
      computedHeadDigest: second.eventDigest,
      openAttemptIds: []
    })
  })

  test('separates self-consistency from authenticity and rejects a recomputed chain', async () => {
    const legitimate = await appendBackendOperationalEvent(
      [],
      await trustedAnchor(null),
      await appendAuthority()
    )
    const attackerFirst = await appendBackendOperationalEvent(
      [],
      await trustedAnchor(null),
      await appendAuthority({ eventId: 'attacker-event-1' })
    )
    const attackerSecond = await appendBackendOperationalEvent(
      [attackerFirst.event],
      await trustedAnchor(attackerFirst.eventDigest),
      await terminalAuthority({ eventId: 'attacker-event-2' })
    )
    const attackerHistory = [attackerFirst.event, attackerSecond.event]

    expect(await inspectBackendOperationalEventChain(attackerHistory, null)).toMatchObject({
      ok: true
    })
    expect(
      await verifyBackendOperationalEventChain(
        attackerHistory,
        await trustedAnchor(legitimate.eventDigest)
      )
    ).toMatchObject({ ok: false, code: 'operational-event-head-mismatch' })
    expect(await verifyBackendOperationalEventChain(attackerHistory, undefined)).toMatchObject({
      ok: false,
      code: 'operational-event-trusted-anchor-required'
    })
    await expect(
      appendBackendOperationalEvent(
        attackerHistory,
        await trustedAnchor(legitimate.eventDigest),
        await terminalAuthority()
      )
    ).rejects.toThrow('operational-event-head-mismatch')
  })

  test('rejects cross-authority domains even when the hash link is recomputed', async () => {
    const first = await appendBackendOperationalEvent(
      [],
      await trustedAnchor(null),
      await appendAuthority()
    )
    const validSecond = await appendBackendOperationalEvent(
      [first.event],
      await trustedAnchor(first.eventDigest),
      await terminalAuthority()
    )
    const second = parseBackendOperationalEvent({
      ...validSecond.event,
      authorityDigest: await digest('other-authority')
    })

    expect(await inspectBackendOperationalEventChain([first.event, second], null)).toMatchObject({
      ok: false,
      code: 'operational-event-domain-mismatch'
    })
  })

  test('rejects unrelated terminal events and changed attempt bindings', async () => {
    await expect(
      appendBackendOperationalEvent([], await trustedAnchor(null), await terminalAuthority())
    ).rejects.toThrow('operational-event-attempt-transition-invalid')

    const first = await appendBackendOperationalEvent(
      [],
      await trustedAnchor(null),
      await appendAuthority()
    )
    for (const changed of [
      { planDigest: await digest('substituted-plan') },
      { phase: 'apply' as const },
      { traceId: 'substituted-trace' },
      { remoteOperationIds: ['remote-substituted'] },
      { remoteOperationIds: ['remote-a'] }
    ]) {
      await expect(
        appendBackendOperationalEvent(
          [first.event],
          await trustedAnchor(first.eventDigest),
          await terminalAuthority(changed)
        )
      ).rejects.toThrow('operational-event-attempt-binding-mismatch')
    }
  })

  test('permits a new retry attempt but only one terminal event per attempt', async () => {
    const first = await appendBackendOperationalEvent(
      [],
      await trustedAnchor(null),
      await appendAuthority()
    )
    const second = await appendBackendOperationalEvent(
      [first.event],
      await trustedAnchor(first.eventDigest),
      await terminalAuthority({ outcome: 'failed', stableErrorCode: 'provider-rejected' })
    )
    const retry = await appendBackendOperationalEvent(
      [first.event, second.event],
      await trustedAnchor(second.eventDigest),
      await appendAuthority({
        eventId: 'event-3',
        attemptId: 'attempt-2',
        observedAt: '2026-09-04T00:00:02Z'
      })
    )
    expect(retry.event.attemptId).toBe('attempt-2')

    await expect(
      appendBackendOperationalEvent(
        [first.event, second.event],
        await trustedAnchor(second.eventDigest),
        await terminalAuthority({ eventId: 'event-4' })
      )
    ).rejects.toThrow('operational-event-attempt-transition-invalid')
  })

  test('binds event ID, remote IDs, duration, error, and time to Host authority', async () => {
    const started = await appendBackendOperationalEvent(
      [],
      await trustedAnchor(null),
      await appendAuthority()
    )
    const authority = await terminalAuthority({
      eventId: 'event-host-terminal',
      observedAt: '2026-09-04T00:00:04Z',
      outcome: 'failed',
      durationMs: 4_000,
      stableErrorCode: 'remote-timeout',
      remoteOperationIds: ['remote-b', 'remote-a', 'remote-host-2', 'remote-host-1']
    })
    const terminal = await appendBackendOperationalEvent(
      [started.event],
      await trustedAnchor(started.eventDigest),
      authority
    )

    expect(terminal.event).toMatchObject({
      eventId: authority.eventId,
      occurredAt: authority.observedAt,
      remoteOperationIds: ['remote-a', 'remote-b', 'remote-host-1', 'remote-host-2'],
      durationMs: authority.durationMs,
      stableErrorCode: authority.stableErrorCode
    })
  })

  test('rolls over at a closed attempt using an authenticated prior-segment checkpoint', async () => {
    const first = await appendBackendOperationalEvent(
      [],
      await trustedAnchor(null),
      await appendAuthority()
    )
    const terminal = await appendBackendOperationalEvent(
      [first.event],
      await trustedAnchor(first.eventDigest),
      await terminalAuthority()
    )
    const closed = await inspectBackendOperationalEventChain([first.event, terminal.event], null)
    expect(closed).toMatchObject({ ok: true, openAttemptIds: [] })

    const next = await appendBackendOperationalEvent(
      [],
      await trustedAnchor(terminal.eventDigest, terminal.eventDigest),
      await appendAuthority({
        eventId: 'event-segment-2',
        operationId: 'operation-2',
        attemptId: 'attempt-2',
        observedAt: '2026-09-04T00:00:02Z'
      })
    )
    expect(next.event.previousEventDigest).toBe(terminal.eventDigest)
    expect(
      await verifyBackendOperationalEventChain(
        [next.event],
        await trustedAnchor(next.eventDigest, terminal.eventDigest)
      )
    ).toMatchObject({ ok: true, priorSegmentHeadDigest: terminal.eventDigest })

    expect(
      await inspectBackendOperationalEventChain(
        Array.from({ length: 257 }, () => next.event),
        terminal.eventDigest
      )
    ).toMatchObject({ ok: false, code: 'operational-event-invalid' })
  })

  test('rejects segment rotation while the authenticated prior checkpoint has open attempts', async () => {
    const open = await appendBackendOperationalEvent(
      [],
      await trustedAnchor(null),
      await appendAuthority()
    )
    const inspected = await inspectBackendOperationalEventChain([open.event], null)
    expect(inspected).toMatchObject({ ok: true, openAttemptIds: ['attempt-1'] })

    await expect(
      appendBackendOperationalEvent(
        [],
        await trustedAnchor(open.eventDigest, open.eventDigest, {
          priorSegmentOpenAttemptIds: ['attempt-1']
        }),
        await appendAuthority({
          eventId: 'event-segment-2',
          operationId: 'operation-2',
          attemptId: 'attempt-2'
        })
      )
    ).rejects.toThrow('operational-event-segment-boundary-open')
  })

  test('rejects persisted and appended events after the trusted Host clock', async () => {
    await expect(
      appendBackendOperationalEvent(
        [],
        await trustedAnchor(null, null, { evaluatedAt: NOW }),
        await appendAuthority({ observedAt: '2026-09-04T00:00:00.000000001Z' })
      )
    ).rejects.toThrow('after the Host evaluation time')

    await expect(
      appendBackendOperationalEvent(
        [],
        await trustedAnchor(null, null, { evaluatedAt: NOW }),
        await appendAuthority({ observedAt: '9999-01-01T00:00:00Z' })
      )
    ).rejects.toThrow('after the Host evaluation time')

    const future = await appendBackendOperationalEvent(
      [],
      await trustedAnchor(null, null, { evaluatedAt: '9999-01-01T00:00:00Z' }),
      await appendAuthority({ observedAt: '9999-01-01T00:00:00Z' })
    )
    expect(
      await verifyBackendOperationalEventChain(
        [future.event],
        await trustedAnchor(future.eventDigest, null, { evaluatedAt: NOW })
      )
    ).toMatchObject({ ok: false, code: 'operational-event-clock-skew-invalid' })

    const priorHead = await digest('prior-segment-head')
    expect(
      await verifyBackendOperationalEventChain(
        [],
        await trustedAnchor(priorHead, priorHead, {
          priorSegmentLastOccurredAt: '2026-09-04T00:00:11Z',
          evaluatedAt: '2026-09-04T00:00:10Z'
        })
      )
    ).toMatchObject({ ok: false, code: 'operational-event-invalid' })
  })

  test('rejects a backdated event at an authenticated segment boundary', async () => {
    const priorHead = await digest('prior-segment-head')
    await expect(
      appendBackendOperationalEvent(
        [],
        await trustedAnchor(priorHead, priorHead, {
          priorSegmentLastOccurredAt: '2026-09-04T00:00:01Z'
        }),
        await appendAuthority({ observedAt: NOW })
      )
    ).rejects.toThrow('before the prior segment boundary')
  })

  test('rejects concurrent open attempts for one release single-flight scope', async () => {
    const first = await appendBackendOperationalEvent(
      [],
      await trustedAnchor(null),
      await appendAuthority()
    )
    await expect(
      appendBackendOperationalEvent(
        [first.event],
        await trustedAnchor(first.eventDigest),
        await appendAuthority({
          eventId: 'event-concurrent',
          operationId: 'operation-concurrent',
          attemptId: 'attempt-concurrent',
          observedAt: '2026-09-04T00:00:01Z'
        })
      )
    ).rejects.toThrow('operational-event-single-flight-conflict')
  })

  test('snapshots Host authority and history before the first asynchronous digest', async () => {
    const anchor = await trustedAnchor(null)
    const authority = await appendAuthority()
    const pending = appendBackendOperationalEvent([], anchor, authority)
    ;(anchor as { providerId: string }).providerId = 'provider.mutated'
    ;(authority as { eventId: string }).eventId = 'event-mutated'

    const first = await pending
    expect(first.event).toMatchObject({ providerId: 'provider.test', eventId: 'event-1' })

    const history = [first.event]
    const secondPending = appendBackendOperationalEvent(
      history,
      await trustedAnchor(first.eventDigest),
      await terminalAuthority()
    )
    history[0] = { ...first.event, eventId: 'history-mutated' }
    await expect(secondPending).resolves.toMatchObject({
      event: { eventId: 'event-2', previousEventDigest: first.eventDigest }
    })
  })

  test('accepts the real bounded composite Backend release single-flight key', async () => {
    const singleFlightKey = await realSingleFlightKey()
    expect(singleFlightKey.length).toBeGreaterThan(256)
    const appended = await appendBackendOperationalEvent(
      [],
      await trustedAnchor(null),
      await appendAuthority({ singleFlightKey })
    )
    expect(appended.event.singleFlightKey).toBe(singleFlightKey)
  })

  test('enforces phase bindings and rejects payload, credential, or time substitution fields', async () => {
    await expect(
      appendBackendOperationalEvent(
        [],
        await trustedAnchor(null),
        await appendAuthority({ singleFlightKey: null })
      )
    ).rejects.toThrow('requires singleFlightKey')
    await expect(
      appendBackendOperationalEvent(
        [],
        await trustedAnchor(null),
        await appendAuthority({ evidenceDigest: await digest('unscoped-evidence') })
      )
    ).rejects.toThrow('allowed only for verify or receipt phases')
    await expect(
      appendBackendOperationalEvent(
        [],
        await trustedAnchor(null),
        await appendAuthority({ eventId: stripeSecretCanary('event012345678901234567890') })
      )
    ).rejects.toThrow('secret-free')
    await expect(
      appendBackendOperationalEvent([], await trustedAnchor(null), {
        ...(await appendAuthority()),
        payload: { rows: [] }
      })
    ).rejects.toThrow('unsupported fields')
    await expect(
      appendBackendOperationalEvent([], await trustedAnchor(null), {
        ...(await appendAuthority()),
        occurredAt: '9999-01-01T00:00:00Z'
      })
    ).rejects.toThrow('unsupported fields')
  })

  test('rejects accessor-backed Host authority without invoking accessors', async () => {
    const authority = await appendAuthority()
    let getterCalls = 0
    Object.defineProperty(authority, 'eventId', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'event-1'
      }
    })
    await expect(
      appendBackendOperationalEvent([], await trustedAnchor(null), authority)
    ).rejects.toThrow('enumerable data property values only')
    expect(getterCalls).toBe(0)
  })
})
