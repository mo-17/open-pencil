import { describe, expect, test } from 'bun:test'

import {
  appendMarketplaceAuditEvent,
  createEmptyMarketplaceState,
  createMarketplacePublisher,
  marketplaceAuditHead,
  marketplaceAuditPayloadDigest,
  parseMarketplaceState,
  verifyMarketplaceAuditChain,
  verifyMarketplaceAuditEventHash
} from '@open-pencil/marketplace'

const FIRST_TIME = '2026-08-05T00:00:00.000Z'
const SECOND_TIME = '2026-08-05T00:00:01.000Z'

describe('marketplace audit hash chain', () => {
  test('hashes canonical payloads and appends a contiguous SHA-256 chain', async () => {
    const left = await marketplaceAuditPayloadDigest({ beta: 2, alpha: 1 })
    const right = await marketplaceAuditPayloadDigest({ alpha: 1, beta: 2 })
    expect(left).toBe(right)

    const first = await appendMarketplaceAuditEvent([], {
      time: FIRST_TIME,
      actor: 'admin-1',
      action: 'publisher.created',
      subject: 'publisher:acme',
      payload: { publisherId: 'acme', status: 'pending' }
    })
    const second = await appendMarketplaceAuditEvent(first.events, {
      time: SECOND_TIME,
      actor: 'admin-1',
      action: 'publisher.status_changed',
      subject: 'publisher:acme',
      payload: { from: 'pending', to: 'active' }
    })

    expect(first.event).toMatchObject({ sequence: 1, previousHash: null })
    expect(second.event).toMatchObject({ sequence: 2, previousHash: first.event.eventHash })
    expect(second.event.payloadDigest).toHaveLength(43)
    expect(second.event.eventHash).toHaveLength(43)
    expect(marketplaceAuditHead(second.events)).toBe(second.event.eventHash)
    expect(await verifyMarketplaceAuditEventHash(second.event)).toBe(true)
    expect((await verifyMarketplaceAuditChain(second.events)).length).toBe(2)
  })

  test('detects changed metadata, broken links, and backwards time', async () => {
    const first = await appendMarketplaceAuditEvent([], {
      time: FIRST_TIME,
      actor: 'system',
      action: 'publisher.created',
      subject: 'publisher:acme',
      payload: null
    })
    const tampered = [{ ...first.event, subject: 'publisher:other' }]
    await expect(verifyMarketplaceAuditChain(tampered)).rejects.toThrow('invalid eventHash')

    await expect(
      appendMarketplaceAuditEvent(first.events, {
        time: '2026-08-04T23:59:59.999Z',
        actor: 'system',
        action: 'publisher.status_changed',
        subject: 'publisher:acme',
        payload: null
      })
    ).rejects.toThrow('must not move backwards')

    const broken = [
      first.event,
      {
        ...first.event,
        sequence: 2,
        time: SECOND_TIME,
        previousHash: null
      }
    ]
    await expect(verifyMarketplaceAuditChain(broken)).rejects.toThrow('invalid previousHash')
  })

  test('rejects non-JSON and oversized payloads before hashing', async () => {
    await expect(marketplaceAuditPayloadDigest({ invalid: Number.NaN })).rejects.toThrow(
      'finite JSON numbers'
    )
    await expect(
      marketplaceAuditPayloadDigest({ oversized: 'x'.repeat(17 * 1024) })
    ).rejects.toThrow('oversized string')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    await expect(marketplaceAuditPayloadDigest(cyclic)).rejects.toThrow('depth limit')
  })

  test('keeps legacy hashes valid and binds new reason/correlation context without plaintext events', async () => {
    const legacy = await appendMarketplaceAuditEvent([], {
      time: FIRST_TIME,
      actor: 'admin-1',
      action: 'publisher.created',
      subject: 'publisher:legacy',
      payload: { publisherId: 'legacy' }
    })
    const contextual = await appendMarketplaceAuditEvent(legacy.events, {
      time: SECOND_TIME,
      actor: 'portal:user-01j5operator',
      action: 'publisher.status_changed',
      subject: 'publisher:legacy',
      payload: { from: 'pending', to: 'rejected' },
      context: {
        reason: 'Publisher identity evidence did not match',
        correlationId: 'correlation_01j5phase7audit'
      }
    })

    expect(legacy.event).not.toHaveProperty('contextDigest')
    expect(contextual.event.contextDigest).toHaveLength(43)
    expect(contextual.event).not.toHaveProperty('reason')
    expect(contextual.event).not.toHaveProperty('correlationId')
    expect(contextual.context).toMatchObject({
      sequence: 2,
      reason: 'Publisher identity evidence did not match',
      correlationId: 'correlation_01j5phase7audit',
      contextDigest: contextual.event.contextDigest
    })
    await expect(verifyMarketplaceAuditChain(contextual.events)).resolves.toHaveLength(2)
    await expect(
      verifyMarketplaceAuditChain([
        legacy.event,
        { ...contextual.event, contextDigest: legacy.event.eventHash }
      ])
    ).rejects.toThrow(/eventHash/i)
  })

  test('loads legacy state without auditContexts and rejects tampered plaintext context', async () => {
    const legacyMutation = await createMarketplacePublisher(
      createEmptyMarketplaceState(),
      { id: 'legacy', displayName: 'Legacy Publisher' },
      { actor: 'admin:legacy', time: FIRST_TIME }
    )
    const { auditContexts: _legacyContexts, ...legacyState } = structuredClone(legacyMutation.state)
    expect(parseMarketplaceState(legacyState).auditContexts).toEqual([])

    const contextualMutation = await createMarketplacePublisher(
      createEmptyMarketplaceState(),
      { id: 'acme', displayName: 'Acme Publisher' },
      {
        actor: 'portal:user-01j5operator',
        time: FIRST_TIME,
        reason: 'Initial operator review',
        correlationId: 'correlation_01j5phase7state'
      }
    )
    const contextualState = structuredClone(contextualMutation.state)
    const [firstContext, ...remainingContexts] = contextualState.auditContexts
    const tampered = {
      ...contextualState,
      auditContexts: [
        {
          ...firstContext,
          reason: 'Tampered reason'
        },
        ...remainingContexts
      ]
    }
    expect(() => parseMarketplaceState(tampered)).toThrow(/contextDigest/i)
  })
})
