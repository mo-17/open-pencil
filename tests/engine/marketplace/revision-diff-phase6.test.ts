import { describe, expect, test } from 'bun:test'

import {
  createMarketplaceHttpApp,
  createMarketplaceService,
  createMemoryMarketplaceArtifactStore,
  createMemoryMarketplaceNonceStore,
  createMemoryMarketplaceRepository,
  parseMarketplaceSubmissionRevisionDiff,
  type MarketplaceArtifactStore,
  type MarketplaceService
} from '@open-pencil/marketplace'
import {
  PLUGIN_RUNTIME_COMPUTE_ABI,
  PLUGIN_RUNTIME_PACKAGE_FORMAT,
  PLUGIN_RUNTIME_PACKAGE_SCHEMA_VERSION,
  createPluginRuntimeAsset,
  signPluginRuntimePackage,
  signVersionedPluginManifest
} from '@open-pencil/plugin-contracts'
import { exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

import {
  pluginConnectorContract,
  pluginPayloadV2,
  pluginStorageProviderContribution
} from '../plugins/helpers'

const NOW = '2026-08-22T08:00:00.000Z'
const ADMIN_TOKEN = 'phase6-diff-admin-token-that-is-at-least-32-characters'
const encoder = new TextEncoder()

async function publisher(service: MarketplaceService, id: string, pluginId: string) {
  const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const keyId = `${id}.release`
  await service.registerPublisher(
    {
      publisher: { id, displayName: `${id} publisher` },
      key: {
        keyId,
        publisherId: id,
        publicKeyPem: await exportEd25519PublicKeyPem(keyPair.publicKey),
        notBefore: '2026-01-01T00:00:00.000Z',
        notAfter: '2027-01-01T00:00:00.000Z'
      }
    },
    { actor: `publisher:${id}`, time: '2026-08-22T07:59:00.000Z' }
  )
  await service.transitionPublisherKey(keyId, 'active', {
    actor: 'admin:fixture',
    time: '2026-08-22T07:59:00.000Z'
  })
  await service.transitionPublisher(id, 'active', {
    actor: 'admin:fixture',
    time: '2026-08-22T07:59:00.000Z'
  })
  await service.requestOwnership(pluginId, id, {
    actor: `publisher:${id}`,
    time: '2026-08-22T07:59:00.000Z'
  })
  await service.transitionOwnership(pluginId, 'active', {
    actor: 'admin:fixture',
    time: '2026-08-22T07:59:00.000Z'
  })
  return { id, keyId, keyPair, pluginId }
}

async function fixture() {
  const repository = createMemoryMarketplaceRepository()
  const backing = createMemoryMarketplaceArtifactStore()
  let tampered = false
  const artifacts: MarketplaceArtifactStore = {
    put: (bytes) => backing.put(bytes),
    async get(digest) {
      const artifact = await backing.get(digest)
      if (!artifact || !tampered) return artifact
      const bytes = Uint8Array.from([...artifact.bytes, 0x20])
      return { ...artifact, bytes, byteLength: bytes.byteLength }
    }
  }
  const service = createMarketplaceService({
    repository,
    artifacts,
    marketplaceId: 'phase6-diff-marketplace',
    publicBaseUrl: 'https://plugins.example.com/',
    now: () => new Date(NOW)
  })
  const acme = await publisher(service, 'acme', 'acme.analytics')
  const beta = await publisher(service, 'beta', 'beta.toolbox')
  const payload = pluginPayloadV2('2.0.0')
  const manifest = await signVersionedPluginManifest(
    {
      ...payload,
      contributions: {
        ...payload.contributions,
        connectors: [pluginConnectorContract()],
        storageProviders: [pluginStorageProviderContribution()]
      }
    },
    acme.keyPair.privateKey
  )
  const runtimePackage = await signPluginRuntimePackage(
    {
      format: PLUGIN_RUNTIME_PACKAGE_FORMAT,
      schemaVersion: PLUGIN_RUNTIME_PACKAGE_SCHEMA_VERSION,
      plugin: { id: acme.pluginId, version: '2.0.0' },
      publisher: { id: acme.id, keyId: acme.keyId },
      declarativeManifestDigest: manifest.integrity.digest,
      runtime: {
        kind: 'javascript',
        abi: PLUGIN_RUNTIME_COMPUTE_ABI,
        capabilities: [],
        limits: {
          timeoutMs: 2_000,
          maxInputBytes: 4_096,
          maxOutputBytes: 8_192,
          maxMemoryPages: 4
        },
        asset: await createPluginRuntimeAsset(
          'javascript',
          encoder.encode('export function compute() { return { ok: true } }\n')
        )
      }
    },
    acme.keyPair.privateKey
  )
  const submission = await service.submit(
    {
      id: 'acme-revision-diff',
      publisherId: acme.id,
      channel: 'stable',
      manifest,
      runtimePackage,
      listing: {
        displayName: 'Acme Analytics',
        summary: 'Bounded analytics plugin',
        description: 'Phase 6 revision diff fixture.',
        categories: ['analytics'],
        iconUrl: null,
        homepageUrl: null
      },
      authenticatedRequestKeyId: acme.keyId
    },
    { actor: `publisher:${acme.id}`, time: NOW }
  )
  await service.transitionSubmission(submission.id, 'changes_requested', {
    actor: 'admin:reviewer-one',
    reason: 'Clarify connector authority',
    time: NOW
  })
  const app = createMarketplaceHttpApp({
    service,
    nonces: createMemoryMarketplaceNonceStore(() => Date.parse(NOW)),
    now: () => Date.parse(NOW),
    admin: { enabled: true, token: ADMIN_TOKEN }
  })
  return {
    acme,
    app,
    beta,
    service,
    submission,
    tamper() {
      tampered = true
    }
  }
}

describe('Phase 6 verified Submission revision diff', () => {
  test('derives readable permissions, network, and runtime changes from two immutable revisions', async () => {
    const value = await fixture()
    const payload = pluginPayloadV2('2.0.0')
    const connector = structuredClone(pluginConnectorContract())
    connector.network.origins = ['https://api-v2.example.com']
    connector.network.methods = ['GET', 'POST']
    connector.operations = connector.operations.map((operation) => ({
      ...operation,
      request: { ...operation.request, origin: 'https://api-v2.example.com' }
    }))
    const manifest = await signVersionedPluginManifest(
      {
        ...payload,
        contributions: {
          ...payload.contributions,
          commands: payload.contributions.commands.map((command) => ({
            ...command,
            permissions: ['document.read']
          })),
          connectors: [connector],
          storageProviders: [pluginStorageProviderContribution()]
        }
      },
      value.acme.keyPair.privateKey
    )
    const runtimePackage = await signPluginRuntimePackage(
      {
        format: PLUGIN_RUNTIME_PACKAGE_FORMAT,
        schemaVersion: PLUGIN_RUNTIME_PACKAGE_SCHEMA_VERSION,
        plugin: { id: value.acme.pluginId, version: '2.0.0' },
        publisher: { id: value.acme.id, keyId: value.acme.keyId },
        declarativeManifestDigest: manifest.integrity.digest,
        runtime: {
          kind: 'javascript',
          abi: PLUGIN_RUNTIME_COMPUTE_ABI,
          capabilities: ['document.nodes.read'],
          limits: {
            timeoutMs: 2_000,
            maxInputBytes: 8_192,
            maxOutputBytes: 8_192,
            maxMemoryPages: 4
          },
          asset: await createPluginRuntimeAsset(
            'javascript',
            encoder.encode('export function compute() { return { ok: true, revision: 2 } }\n')
          )
        }
      },
      value.acme.keyPair.privateKey
    )
    await value.service.reviseSubmission(
      value.submission.id,
      {
        publisherId: value.acme.id,
        expectedRevision: 1,
        channel: 'stable',
        manifest,
        runtimePackage,
        listing: {
          displayName: 'Acme Analytics',
          summary: 'Bounded analytics plugin revision',
          description: 'Phase 6 revised diff fixture.',
          categories: ['analytics'],
          iconUrl: null,
          homepageUrl: null
        }
      },
      {
        actor: `publisher:${value.acme.id}`,
        authenticatedKeyId: value.acme.keyId,
        time: '2026-08-22T08:01:00.000Z'
      }
    )

    const target = (publisherId: string, suffix = '') =>
      `http://localhost/admin/publishers/${publisherId}/submissions/${value.submission.id}/revision-diff/1/2${suffix}`
    const headers = { authorization: `Bearer ${ADMIN_TOKEN}` }
    const response = await value.app.request(target(value.acme.id), { headers })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const source = await response.text()
    const wire = JSON.parse(source)
    const diff = parseMarketplaceSubmissionRevisionDiff(wire)
    expect(diff).toMatchObject({
      publisherId: value.acme.id,
      submissionId: value.submission.id,
      from: { revision: 1 },
      to: { revision: 2 }
    })
    expect(diff.permissions.removed).toEqual(['document.selection.read'])
    expect(diff.network.connectors[0]).toMatchObject({
      connectorId: 'analytics.records',
      origins: {
        added: ['https://api-v2.example.com'],
        removed: ['https://api.example.com']
      },
      methods: { added: ['POST'], removed: [] }
    })
    expect(diff.runtime.capabilities.added).toEqual(['document.nodes.read'])
    expect(diff.runtime.changedFields).toContain('limits.maxInputBytes')
    expect(source).not.toContain('publicKeyPem')
    expect(source).not.toContain('/v1/artifacts/')
    expect(source).not.toContain('export function compute')

    const inconsistent = structuredClone(wire)
    inconsistent.permissions.added = ['document.read']
    expect(() => parseMarketplaceSubmissionRevisionDiff(inconsistent)).toThrow('set diff')
    const mismatchedRuntime = structuredClone(wire)
    mismatchedRuntime.to.runtimePackageDigest = wire.from.runtimePackageDigest
    expect(() => parseMarketplaceSubmissionRevisionDiff(mismatchedRuntime)).toThrow(
      'revision identity'
    )

    expect((await value.app.request(target(value.acme.id))).status).toBe(401)
    expect(
      (await value.app.request(target(value.acme.id, '?publisherId=beta'), { headers })).status
    ).toBe(400)
    expect((await value.app.request(target(value.beta.id), { headers })).status).toBe(404)
    expect(
      (
        await value.app.request(
          `http://localhost/admin/publishers/${value.acme.id}/submissions/${value.submission.id}/revision-diff/2/1`,
          { headers }
        )
      ).status
    ).toBe(400)

    value.tamper()
    const tampered = await value.app.request(target(value.acme.id), { headers })
    expect(tampered.status).toBe(500)
    expect(await tampered.json()).toEqual({ error: 'Internal marketplace server error' })
  })
})
