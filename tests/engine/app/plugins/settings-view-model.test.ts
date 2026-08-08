import { describe, expect, test } from 'bun:test'

import {
  MARKETPLACE_SNAPSHOT_FORMAT,
  MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
  signMarketplaceSnapshot,
  verifyMarketplaceSnapshot,
  type MarketplaceSnapshotPayloadV1
} from '@open-pencil/core/plugins'
import { digestCanonicalManifest, exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

import {
  createBundledPluginCatalog,
  type AppPluginCatalogItem,
  type MarketplaceSnapshotLoadResult
} from '@/app/plugins'
import {
  ACCESSIBILITY_AUDIT_PLUGIN_ID,
  DESIGN_TOKENS_EXPORTER_PLUGIN_ID
} from '@/app/plugins/host/ids'
import {
  filterPluginDiscoverCatalog,
  pluginMarketplaceListingViews,
  pluginV2ContractSummaries
} from '@/app/plugins/settings-view-model'

const ROOT_KEY_ID = 'marketplace.root.2026'
const PLUGIN_ID = 'open-pencil.map'
const VERIFY_AT = Date.parse('2026-08-05T00:00:00.000Z')

async function keys(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
}

async function signedMarketplace(options: {
  keyNotAfter: string
  revokedAt?: string
}): Promise<MarketplaceSnapshotLoadResult> {
  const root = await keys()
  const publisher = await keys()
  const releaseDigest = await digestCanonicalManifest({ plugin: PLUGIN_ID, version: '1.0.0' })
  const payload: MarketplaceSnapshotPayloadV1 = {
    format: MARKETPLACE_SNAPSHOT_FORMAT,
    schemaVersion: MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
    marketplaceId: 'openpencil.marketplace',
    version: '1.0.0',
    sequence: 1,
    generatedAt: '2026-08-04T00:00:00.000Z',
    expiresAt: '2026-08-10T00:00:00.000Z',
    publisherDirectory: {
      publishers: [
        {
          publisherId: 'acme',
          name: 'Acme Spatial',
          status: 'active',
          keys: [
            {
              keyId: 'acme.release',
              publicKeyPem: await exportEd25519PublicKeyPem(publisher.publicKey),
              notBefore: '2026-08-01T00:00:00.000Z',
              notAfter: options.keyNotAfter,
              ...(options.revokedAt
                ? { revokedAt: options.revokedAt, revocationReason: 'publisher rotation' }
                : {})
            }
          ]
        }
      ],
      ownerships: [
        {
          pluginId: PLUGIN_ID,
          publisherId: 'acme',
          status: 'active',
          grantedAt: '2026-08-01T00:00:00.000Z'
        }
      ]
    },
    catalogs: [
      {
        channel: 'stable',
        catalogId: 'openpencil.marketplace.stable',
        keyId: ROOT_KEY_ID,
        url: 'https://plugins.example.com/catalogs/stable.json',
        digest: await digestCanonicalManifest({ catalog: 'stable' })
      }
    ],
    listings: [
      {
        pluginId: PLUGIN_ID,
        publisherId: 'acme',
        name: 'Spatial Atlas',
        summary: 'Reviewed spatial modules for maps',
        categories: ['geospatial', 'visualization'],
        keywords: ['atlas-keyword', 'maps'],
        releases: [{ channel: 'stable', version: '1.0.0', digest: releaseDigest }]
      }
    ],
    auditHead: {
      sequence: 7,
      headDigest: await digestCanonicalManifest({ audit: 7 }),
      url: 'https://plugins.example.com/audit.json'
    }
  }
  const signed = await signMarketplaceSnapshot(payload, root.privateKey, {
    keyId: ROOT_KEY_ID
  })
  const snapshot = await verifyMarketplaceSnapshot(signed, root.publicKey, {
    expectedMarketplaceId: payload.marketplaceId,
    expectedKeyId: ROOT_KEY_ID,
    now: VERIFY_AT
  })
  return { status: 'fresh', snapshot, source: 'network', refreshError: null }
}

function mapCatalog(): readonly AppPluginCatalogItem[] {
  const entry = createBundledPluginCatalog().find(
    (candidate) => candidate.manifest.plugin.id === PLUGIN_ID
  )
  if (!entry) throw new Error('Expected bundled Map plugin')
  return [
    {
      package: {
        trustSource: 'app-bundle',
        manifest: entry.manifest,
        digest: 'app-bundle-test-digest'
      },
      installed: true
    }
  ]
}

describe('plugin settings marketplace view model', () => {
  test('derives bounded v2 authority summaries from validated manifests', () => {
    const catalog = createBundledPluginCatalog()
    const manifest = (pluginId: string) => {
      const candidate = catalog.find((entry) => entry.manifest.plugin.id === pluginId)?.manifest
      if (!candidate) throw new Error(`Missing plugin ${pluginId}`)
      return candidate
    }

    expect(pluginV2ContractSummaries(manifest(ACCESSIBILITY_AUDIT_PLUGIN_ID))).toEqual([
      {
        kind: 'command',
        contributionId: 'run-static-accessibility-audit',
        permissions: ['document.read'],
        outputs: [],
        parameterMaxBytes: 2,
        resultMaxBytes: 512 * 1024
      }
    ])
    expect(pluginV2ContractSummaries(manifest(DESIGN_TOKENS_EXPORTER_PLUGIN_ID))).toEqual([
      {
        kind: 'exporter',
        contributionId: 'design-tokens-json',
        permissions: ['document.variables.read', 'file.save'],
        outputs: [{ extension: '.json', mimeType: 'application/json' }],
        parameterMaxBytes: 2,
        resultMaxBytes: 2
      }
    ])
    expect(pluginV2ContractSummaries(manifest(PLUGIN_ID))).toEqual([])
  })

  test('searches name, summary, category, and keyword from a verified signed snapshot', async () => {
    const marketplace = await signedMarketplace({
      keyNotAfter: '2026-08-09T00:00:00.000Z'
    })
    for (const query of ['Spatial Atlas', 'reviewed spatial', 'geospatial', 'atlas-keyword']) {
      expect(filterPluginDiscoverCatalog(mapCatalog(), marketplace, query)).toHaveLength(1)
    }
    expect(filterPluginDiscoverCatalog(mapCatalog(), marketplace, 'audio')).toHaveLength(0)

    const listing = pluginMarketplaceListingViews(marketplace, VERIFY_AT).get(PLUGIN_ID)
    expect(listing).toMatchObject({
      publisherName: 'Acme Spatial',
      publisherStatus: 'active',
      ownershipStatus: 'active',
      keyStatus: 'active',
      channels: ['stable']
    })
  })

  test('uses current time and a half-open key validity interval, including revocation', async () => {
    const expiresAt = '2026-08-06T00:00:00.000Z'
    const expiring = await signedMarketplace({ keyNotAfter: expiresAt })
    expect(
      pluginMarketplaceListingViews(expiring, Date.parse(expiresAt)).get(PLUGIN_ID)?.keyStatus
    ).toBe('expired')

    const revokedAt = '2026-08-07T00:00:00.000Z'
    const revoked = await signedMarketplace({
      keyNotAfter: '2026-08-09T00:00:00.000Z',
      revokedAt
    })
    expect(
      pluginMarketplaceListingViews(revoked, Date.parse(revokedAt)).get(PLUGIN_ID)?.keyStatus
    ).toBe('revoked')
  })
})
