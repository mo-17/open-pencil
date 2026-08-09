import { describe, expect, test } from 'bun:test'

import {
  PLUGIN_RUNTIME_COMPUTE_ABI,
  PLUGIN_RUNTIME_PACKAGE_FORMAT,
  PLUGIN_RUNTIME_PACKAGE_SCHEMA_VERSION,
  createPluginRuntimeAsset,
  parseVersionedPluginPackageBytes,
  serializePluginManifest,
  serializeVersionedPluginManifest,
  signPluginManifest,
  signVersionedPluginManifest,
  signPluginRuntimePackage
} from '@open-pencil/core/plugins'
import {
  createMarketplaceService,
  createMemoryMarketplaceArtifactStore,
  createMemoryMarketplaceRepository
} from '@open-pencil/marketplace'
import { exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

import {
  pluginPayload,
  pluginPayloadV2,
  pluginStorageProviderContribution
} from '../plugins/helpers'

const NOW = '2026-08-05T12:00:00.000Z'
const BEFORE_OWNERSHIP_GRANT = '2026-08-05T11:59:00.000Z'

async function keyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
}

async function marketplaceFixture() {
  const root = await keyPair()
  const publisher = await keyPair()
  const repository = createMemoryMarketplaceRepository()
  const artifacts = createMemoryMarketplaceArtifactStore()
  const service = createMarketplaceService({
    repository,
    artifacts,
    marketplaceId: 'openpencil-marketplace',
    publicBaseUrl: 'https://plugins.example.com/',
    now: () => new Date(NOW),
    root: {
      keyId: 'marketplace-root-2026',
      privateKey: root.privateKey,
      publicKey: root.publicKey
    }
  })

  await service.registerPublisher(
    {
      publisher: { id: 'acme', displayName: 'Acme Plugins' },
      key: {
        keyId: 'acme.release',
        publisherId: 'acme',
        publicKeyPem: await exportEd25519PublicKeyPem(publisher.publicKey),
        notBefore: '2026-01-01T00:00:00.000Z',
        notAfter: '2027-01-01T00:00:00.000Z'
      }
    },
    { actor: 'publisher:acme', time: BEFORE_OWNERSHIP_GRANT }
  )
  await service.transitionPublisherKey('acme.release', 'active', {
    actor: 'admin:test',
    time: BEFORE_OWNERSHIP_GRANT
  })
  await service.transitionPublisher('acme', 'active', {
    actor: 'admin:test',
    time: BEFORE_OWNERSHIP_GRANT
  })
  await service.requestOwnership('acme.analytics', 'acme', {
    actor: 'publisher:acme',
    time: BEFORE_OWNERSHIP_GRANT
  })
  await service.transitionOwnership('acme.analytics', 'active', {
    actor: 'admin:test',
    time: NOW
  })
  return { artifacts, publisher, repository, root, service }
}

describe('marketplace service publication pipeline', () => {
  test('keeps signed manifest and CAS digests distinct and publishes root-bound artifacts', async () => {
    const { artifacts, publisher, repository, root, service } = await marketplaceFixture()

    const manifest = await signPluginManifest(pluginPayload(), publisher.privateKey)
    const runtimePackage = await signPluginRuntimePackage(
      {
        format: PLUGIN_RUNTIME_PACKAGE_FORMAT,
        schemaVersion: PLUGIN_RUNTIME_PACKAGE_SCHEMA_VERSION,
        plugin: { id: 'acme.analytics', version: '1.0.0' },
        publisher: { id: 'acme', keyId: 'acme.release' },
        declarativeManifestDigest: manifest.integrity.digest,
        runtime: {
          kind: 'javascript',
          abi: PLUGIN_RUNTIME_COMPUTE_ABI,
          capabilities: [],
          limits: {
            timeoutMs: 2_000,
            maxInputBytes: 256 * 1024,
            maxOutputBytes: 256 * 1024,
            maxMemoryPages: 4
          },
          asset: await createPluginRuntimeAsset(
            'javascript',
            new TextEncoder().encode('export function compute(input) { return input }\n')
          )
        }
      },
      publisher.privateKey
    )
    const submission = await service.submit(
      {
        id: 'submission-one',
        publisherId: 'acme',
        channel: 'stable',
        manifest,
        listing: {
          displayName: 'Analytics',
          summary: 'Private analytics module',
          description: 'A bounded declarative analytics module for testing.',
          categories: ['analytics'],
          iconUrl: null,
          homepageUrl: null
        },
        runtimePackage
      },
      { actor: 'publisher:acme', time: NOW }
    )
    expect(submission.status).toBe('awaiting_review')
    expect(submission.manifestDigest).toBe(manifest.integrity.digest)
    expect(submission.artifactDigest).not.toBe(submission.manifestDigest)
    expect(submission.manifestUrl).toEndWith(`/v1/artifacts/${submission.artifactDigest}`)
    expect(submission.runtimeCoordinate?.packageDigest).toBe(runtimePackage.integrity.digest)
    expect(submission.runtimeCoordinate?.packageUrl).toContain('/v1/artifacts/')
    const manifestArtifact = await artifacts.get(submission.artifactDigest)
    expect(new TextDecoder().decode(manifestArtifact?.bytes)).toBe(
      serializePluginManifest(manifest)
    )
    expect(serializeVersionedPluginManifest(manifest)).toBe(serializePluginManifest(manifest))

    await service.transitionSubmission(submission.id, 'approved', {
      actor: 'admin:test',
      time: NOW
    })
    await service.publishSubmission(submission.id, { actor: 'admin:test', time: NOW })
    const result = await service.publish({ actor: 'admin:test', time: NOW })

    expect(result.publication.sequence).toBe(1)
    expect(result.publication.auditSequence).toBeGreaterThan(0)
    expect(result.prepared.catalogs.map(({ channel }) => channel)).toEqual(['stable', 'beta'])
    expect(result.prepared.runtimeIndex?.index.entries).toHaveLength(1)
    expect(result.prepared.snapshot.runtimeIndex?.digest).toBe(
      result.prepared.runtimeIndex?.index.integrity.digest
    )
    expect(result.prepared.snapshot.catalogs[0].url).toContain('/v1/artifacts/')
    expect(result.prepared.snapshot.publisherDirectory.ownerships[0].grantedAt).toBe(NOW)
    expect(result.prepared.snapshot.listings[0].releases).toEqual([
      { channel: 'stable', version: '1.0.0', digest: manifest.integrity.digest }
    ])

    const verified = await service.latestVerifiedSnapshot()
    expect(verified?.verifiedDigest).toBe(result.publication.snapshotDigest)
    expect(await service.search({ query: 'analytics' })).toHaveLength(1)
    const state = await service.snapshot()
    expect(state.auditEvents.at(-1)?.action).toBe('publication.recorded')
    expect(result.publication.auditHead).toBe(
      state.auditEvents[result.publication.auditSequence - 1]?.eventHash
    )

    const wrongRoot = await keyPair()
    const mismatchedSigner = createMarketplaceService({
      repository,
      artifacts,
      marketplaceId: 'openpencil-marketplace',
      publicBaseUrl: 'https://plugins.example.com/',
      now: () => new Date(NOW),
      root: {
        keyId: 'marketplace-root-2026',
        privateKey: wrongRoot.privateKey,
        publicKey: root.publicKey
      }
    })
    await expect(mismatchedSigner.publish({ actor: 'admin:test', time: NOW })).rejects.toThrow(
      'signature verification failed'
    )
    expect((await repository.snapshot()).publications).toHaveLength(1)
  })

  test('submits and publishes schema-v2 manifests while unknown versions fail closed', async () => {
    const { artifacts, publisher, service } = await marketplaceFixture()
    const payload = pluginPayloadV2()
    payload.contributions.storageProviders = [pluginStorageProviderContribution()]
    const manifest = await signVersionedPluginManifest(payload, publisher.privateKey)
    const submission = await service.submit(
      {
        id: 'submission-v2',
        publisherId: 'acme',
        channel: 'stable',
        manifest,
        listing: {
          displayName: 'Analytics v2',
          summary: 'Bounded v2 automation contracts',
          description: 'A schema-v2 declarative plugin for marketplace publication testing.',
          categories: ['analytics'],
          iconUrl: null,
          homepageUrl: null
        }
      },
      { actor: 'publisher:acme', time: NOW }
    )
    const artifact = await artifacts.get(submission.artifactDigest)
    const parsedArtifact = parseVersionedPluginPackageBytes(artifact?.bytes ?? new Uint8Array())
    expect(parsedArtifact.schemaVersion).toBe(2)
    if (parsedArtifact.schemaVersion !== 2) throw new Error('Expected schema-v2 artifact')
    expect(parsedArtifact.contributions.storageProviders).toEqual(
      payload.contributions.storageProviders
    )

    await service.transitionSubmission(submission.id, 'approved', {
      actor: 'admin:test',
      time: NOW
    })
    await service.publishSubmission(submission.id, { actor: 'admin:test', time: NOW })
    const published = await service.publish({ actor: 'admin:test', time: NOW })
    expect(published.prepared.catalogs[0].catalog.entries).toMatchObject([
      { pluginId: 'acme.analytics', version: '2.0.0', digest: manifest.integrity.digest }
    ])

    await expect(
      service.submit(
        {
          id: 'submission-unknown',
          publisherId: 'acme',
          channel: 'stable',
          manifest: { ...manifest, schemaVersion: 3 },
          listing: {
            displayName: 'Unknown',
            summary: 'Unsupported schema version',
            description: 'This submission must be rejected before persistence.',
            categories: ['analytics'],
            iconUrl: null,
            homepageUrl: null
          }
        },
        { actor: 'publisher:acme', time: NOW }
      )
    ).rejects.toThrow('schemaVersion')
    expect((await service.snapshot()).submissions).toHaveLength(1)
  })

  test('withdraws only unpublished submissions owned by the authenticated publisher', async () => {
    const root = await keyPair()
    const service = createMarketplaceService({
      repository: createMemoryMarketplaceRepository(),
      artifacts: createMemoryMarketplaceArtifactStore(),
      marketplaceId: 'openpencil-marketplace',
      publicBaseUrl: 'https://plugins.example.com/',
      now: () => new Date(NOW),
      root: { keyId: 'root', privateKey: root.privateKey, publicKey: root.publicKey }
    })
    await expect(
      service.withdrawSubmission('missing', 'acme', 'Publisher cancelled this review', {
        actor: 'publisher:acme',
        time: NOW
      })
    ).rejects.toThrow('does not belong')
  })
})
