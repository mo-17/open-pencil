import { describe, expect, test } from 'bun:test'

import { filterPlugins, loadCatalog, MARKETPLACE_TRUST } from '#marketplace-web/catalog'

import {
  MARKETPLACE_SNAPSHOT_FORMAT,
  MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
  signMarketplaceSnapshot,
  type MarketplaceSnapshotPayloadV1
} from '@open-pencil/plugin-contracts'
import { exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

import { fetchStub } from '#tests/helpers/fetch'

const NOW = Date.parse('2026-10-23T12:00:00.000Z')

async function fixture() {
  const root = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const publicKeyPem = await exportEd25519PublicKeyPem(root.publicKey)
  const generatedAt = new Date(NOW - 60_000).toISOString()
  const expiresAt = new Date(NOW + 86_400_000).toISOString()
  const payload: MarketplaceSnapshotPayloadV1 = {
    format: MARKETPLACE_SNAPSHOT_FORMAT,
    schemaVersion: MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
    marketplaceId: MARKETPLACE_TRUST.marketplaceId,
    version: '1.0.0',
    sequence: 2,
    generatedAt,
    expiresAt,
    publisherDirectory: {
      publishers: [
        {
          publisherId: 'example.publisher',
          name: 'Example Publisher',
          status: 'active',
          keys: [
            {
              keyId: 'example.publisher.2026',
              publicKeyPem,
              notBefore: generatedAt,
              notAfter: expiresAt
            }
          ]
        }
      ],
      ownerships: ['example.document', 'example.styles'].map((pluginId) => ({
        pluginId,
        publisherId: 'example.publisher',
        status: 'active',
        grantedAt: generatedAt
      }))
    },
    catalogs: [
      {
        channel: 'stable',
        catalogId: 'openpencil.marketplace.stable',
        keyId: MARKETPLACE_TRUST.keyId,
        url: 'https://kushui.shop/v1/catalogs/stable',
        digest: 'A'.repeat(43)
      }
    ],
    listings: [
      {
        pluginId: 'example.document',
        publisherId: 'example.publisher',
        name: 'Café Document Summary',
        summary: 'Count selected nodes',
        categories: ['analysis'],
        keywords: ['document', 'selection'],
        releases: [{ channel: 'stable', version: '1.0.0', digest: 'A'.repeat(43) }]
      },
      {
        pluginId: 'example.styles',
        publisherId: 'example.publisher',
        name: 'Style Usage',
        summary: 'Inspect colors and typography',
        categories: ['design'],
        keywords: ['color'],
        releases: [{ channel: 'stable', version: '1.0.0', digest: 'B'.repeat(42) + 'A' }]
      }
    ],
    auditHead: {
      sequence: 1,
      headDigest: 'A'.repeat(43),
      url: 'https://kushui.shop/v1/audit'
    }
  }
  const signed = await signMarketplaceSnapshot(payload, root.privateKey, {
    keyId: MARKETPLACE_TRUST.keyId
  })
  return { signed, trust: { ...MARKETPLACE_TRUST, publicKeyPem } }
}

describe('marketplace website catalog', () => {
  test('loads the complete signed listing snapshot without cookies or redirects', async () => {
    const { signed, trust } = await fixture()
    const fetchImpl = fetchStub(async (input, init) => {
      expect(input).toBe('/v1/snapshot')
      expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' })
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      expect(init?.signal?.aborted).toBe(false)
      return new Response(JSON.stringify(signed))
    })
    const result = await loadCatalog({ fetchImpl, trust, now: NOW })
    expect(result).toEqual({
      plugins: signed.listings,
      sequence: 2,
      issuedAt: signed.generatedAt,
      expiresAt: signed.expiresAt,
      marketplaceId: signed.marketplaceId,
      verifiedKeyId: signed.integrity.signature.keyId,
      snapshotDigest: signed.integrity.digest
    })
  })

  test('rejects malformed JSON and wrong snapshot shapes', async () => {
    for (const source of ['{', '{"items":[]}']) {
      await expect(
        loadCatalog({ fetchImpl: fetchStub(async () => new Response(source)), now: NOW })
      ).rejects.toThrow()
    }
  })

  test('rejects HTTP failures and propagates network failures', async () => {
    await expect(
      loadCatalog({ fetchImpl: fetchStub(async () => new Response('', { status: 503 })) })
    ).rejects.toThrow('HTTP 503')
    await expect(
      loadCatalog({
        fetchImpl: fetchStub(async () => {
          throw new Error('Network unavailable')
        })
      })
    ).rejects.toThrow('Network unavailable')
  })

  test('rejects snapshots from a different root or with changed signed metadata', async () => {
    const { signed, trust } = await fixture()
    const fetchImpl = fetchStub(async () => new Response(JSON.stringify(signed)))
    await expect(loadCatalog({ fetchImpl, now: NOW })).rejects.toThrow()
    const tampered = { ...signed, sequence: signed.sequence + 1 }
    await expect(
      loadCatalog({
        fetchImpl: fetchStub(async () => new Response(JSON.stringify(tampered))),
        trust,
        now: NOW
      })
    ).rejects.toThrow()
  })

  test('rejects an expired snapshot', async () => {
    const { signed, trust } = await fixture()
    await expect(
      loadCatalog({
        fetchImpl: fetchStub(async () => new Response(JSON.stringify(signed))),
        trust,
        now: NOW + 2 * 86_400_000
      })
    ).rejects.toThrow()
  })

  test('combines exact categories with normalized multi-field search', async () => {
    const { signed } = await fixture()
    const plugins = signed.listings
    expect(filterPlugins(plugins, '', '')).toEqual(plugins)
    expect(filterPlugins(plugins, ' EXAMPLE.DOCUMENT ', '')).toEqual([plugins[0]])
    expect(filterPlugins(plugins, 'cafe\u0301', '')).toEqual([plugins[0]])
    expect(filterPlugins(plugins, 'selection', 'analysis')).toEqual([plugins[0]])
    expect(filterPlugins(plugins, 'typography', '')).toEqual([plugins[1]])
    expect(filterPlugins(plugins, 'example.publisher', '')).toEqual(plugins)
    expect(filterPlugins(plugins, 'color', 'analysis')).toEqual([])
    expect(filterPlugins(plugins, '', 'Analysis')).toEqual([])
    expect(
      filterPlugins(plugins, '文档分析', '', { 'example.document': ['文档摘要', '文档分析'] })
    ).toEqual([plugins[0]])
    expect(
      filterPlugins(plugins, '文档分析', 'design', { 'example.document': ['文档分析'] })
    ).toEqual([])
  })
})
