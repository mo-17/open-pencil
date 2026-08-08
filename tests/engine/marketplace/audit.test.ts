import { describe, expect, test } from 'bun:test'

import {
  appendMarketplaceAuditEvent,
  marketplaceAuditHead,
  marketplaceAuditPayloadDigest,
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
})
