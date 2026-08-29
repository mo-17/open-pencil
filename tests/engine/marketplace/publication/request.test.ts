/* eslint-disable max-lines -- Canonical publication request and emergency review invariants share one bounded security matrix. */
import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import {
  MARKETPLACE_PUBLICATION_REQUEST_LIMITS,
  assertMarketplacePublicationRequestState,
  createMarketplacePublicationRequest,
  createMemoryMarketplaceRepository,
  marketplacePublicationRequestBytes,
  marketplacePublicationRequestDigest,
  parseMarketplacePublicationRequest,
  parseMarketplacePublicationRequestBytes,
  parseMarketplacePublicationRequestJSON,
  serializeMarketplacePublicationRequest,
  type MarketplaceMutationContext,
  type MarketplacePublicationProjectionV1,
  type MarketplaceStateV1
} from '@open-pencil/marketplace'
import {
  MARKETPLACE_SNAPSHOT_FORMAT,
  MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
  PLUGIN_CATALOG_FORMAT,
  PLUGIN_CATALOG_SCHEMA_VERSION,
  PLUGIN_RUNTIME_INDEX_FORMAT,
  PLUGIN_RUNTIME_INDEX_SCHEMA_VERSION
} from '@open-pencil/plugin-contracts'
import { exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

const MARKETPLACE_ID = 'openpencil-marketplace'
const ROOT_KEY_ID = 'marketplace-root-2026'
const PUBLIC_BASE_URL = 'https://plugins.example.com/'
const BASELINE_GENERATED_AT = '2026-08-10T00:00:00.000Z'
const BASELINE_EXPIRES_AT = '2026-08-11T00:00:00.000Z'
const PLAN_GENERATED_AT = '2026-08-12T00:00:00.000Z'
const PLAN_EXPIRES_AT = '2026-08-13T00:00:00.000Z'

function digest(label: string): string {
  return createHash('sha256').update(label).digest('base64url')
}

function context(time: string): MarketplaceMutationContext {
  return { actor: 'local-admin', time }
}

interface ProjectionOptions {
  sequence: number
  generatedAt: string
  expiresAt: string
  auditSequence: number
  auditHead: string
  publicKeyPEM: string
  publisherStatus?: 'active' | 'suspended'
  keyRevoked?: boolean
  keyRevokedAt?: string
  includeOwnership?: boolean
  ownershipStatus?: 'active' | 'revoked'
  ownershipRevokedAt?: string
  includeDistribution?: boolean
  additionalPublisherPEM?: string
  additionalKeyPEM?: string
}

function artifactURL(label: string): string {
  return `${PUBLIC_BASE_URL}v1/artifacts/${digest(label)}`
}

function projection(options: ProjectionOptions): MarketplacePublicationProjectionV1 {
  const publisherStatus = options.publisherStatus ?? 'active'
  const includeOwnership = options.includeOwnership ?? true
  const ownershipStatus = options.ownershipStatus ?? 'active'
  const includeDistribution = options.includeDistribution ?? false
  const manifestDigest = digest('acme.widget@1.0.0 manifest')
  const primaryKey = {
    keyId: 'acme.release.1',
    publicKeyPem: options.publicKeyPEM,
    notBefore: '2026-01-01T00:00:00.000Z',
    notAfter: '2027-01-01T00:00:00.000Z',
    ...(options.keyRevoked
      ? {
          revokedAt: options.keyRevokedAt ?? options.generatedAt,
          revocationReason: 'Emergency credential revocation'
        }
      : {})
  }
  const publishers = [
    {
      publisherId: 'acme',
      name: 'Acme Plugins',
      status: publisherStatus,
      keys: [
        primaryKey,
        ...(options.additionalKeyPEM
          ? [
              {
                keyId: 'acme.release.2',
                publicKeyPem: options.additionalKeyPEM,
                notBefore: '2026-06-01T00:00:00.000Z',
                notAfter: '2027-06-01T00:00:00.000Z'
              }
            ]
          : [])
      ]
    },
    ...(options.additionalPublisherPEM
      ? [
          {
            publisherId: 'bravo',
            name: 'Bravo Plugins',
            status: 'active' as const,
            keys: [
              {
                keyId: 'bravo.release.1',
                publicKeyPem: options.additionalPublisherPEM,
                notBefore: '2026-01-01T00:00:00.000Z',
                notAfter: '2027-01-01T00:00:00.000Z'
              }
            ]
          }
        ]
      : [])
  ]
  const ownerships = includeOwnership
    ? [
        {
          pluginId: 'acme.widget',
          publisherId: 'acme',
          status: ownershipStatus,
          grantedAt: '2026-02-01T00:00:00.000Z',
          ...(ownershipStatus === 'revoked'
            ? {
                revokedAt: options.ownershipRevokedAt ?? options.generatedAt,
                revocationReason: 'Emergency ownership revocation'
              }
            : {})
        }
      ]
    : []
  const stableEntries = includeDistribution
    ? [
        {
          pluginId: 'acme.widget',
          version: '1.0.0',
          digest: manifestDigest,
          manifestUrl: artifactURL('acme.widget@1.0.0 artifact'),
          publisherId: 'acme',
          keyId: 'acme.release.1'
        }
      ]
    : []
  const version = `1.0.${options.sequence}`
  return {
    catalogs: [
      {
        channel: 'stable',
        catalog: {
          format: PLUGIN_CATALOG_FORMAT,
          schemaVersion: PLUGIN_CATALOG_SCHEMA_VERSION,
          catalogId: `${MARKETPLACE_ID}-stable`,
          version,
          generatedAt: options.generatedAt,
          expiresAt: options.expiresAt,
          entries: stableEntries
        }
      },
      {
        channel: 'beta',
        catalog: {
          format: PLUGIN_CATALOG_FORMAT,
          schemaVersion: PLUGIN_CATALOG_SCHEMA_VERSION,
          catalogId: `${MARKETPLACE_ID}-beta`,
          version,
          generatedAt: options.generatedAt,
          expiresAt: options.expiresAt,
          entries: []
        }
      }
    ],
    runtimeIndex: includeDistribution
      ? {
          format: PLUGIN_RUNTIME_INDEX_FORMAT,
          schemaVersion: PLUGIN_RUNTIME_INDEX_SCHEMA_VERSION,
          indexId: `${MARKETPLACE_ID}-runtime`,
          version,
          generatedAt: options.generatedAt,
          expiresAt: options.expiresAt,
          entries: [
            {
              pluginId: 'acme.widget',
              version: '1.0.0',
              publisherId: 'acme',
              keyId: 'acme.release.1',
              declarativeManifestDigest: manifestDigest,
              runtimeKind: 'wasm',
              runtimePackageUrl: artifactURL('acme.widget@1.0.0 runtime artifact'),
              runtimePackageDigest: digest('acme.widget@1.0.0 runtime package'),
              runtimePackageByteLength: 4_096
            }
          ]
        }
      : null,
    snapshot: {
      format: MARKETPLACE_SNAPSHOT_FORMAT,
      schemaVersion: MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
      marketplaceId: MARKETPLACE_ID,
      version,
      sequence: options.sequence,
      generatedAt: options.generatedAt,
      expiresAt: options.expiresAt,
      publisherDirectory: { publishers, ownerships },
      listings: includeDistribution
        ? [
            {
              pluginId: 'acme.widget',
              publisherId: 'acme',
              name: 'Acme Widget',
              summary: 'A reviewed widget.',
              categories: ['widgets'],
              keywords: ['acme'],
              releases: [{ channel: 'stable', version: '1.0.0', digest: manifestDigest }]
            }
          ]
        : [],
      auditHead: {
        sequence: options.auditSequence,
        headDigest: options.auditHead,
        url: `${PUBLIC_BASE_URL}v1/audit`
      }
    }
  }
}

async function publicKeyPEM(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  return exportEd25519PublicKeyPem(pair.publicKey)
}

async function stateFixture(recordPublication: boolean): Promise<{
  repository: ReturnType<typeof createMemoryMarketplaceRepository>
  state: MarketplaceStateV1
}> {
  const repository = createMemoryMarketplaceRepository()
  await repository.transaction((transaction) =>
    transaction.createPublisher(
      { id: 'state-anchor', displayName: 'State Anchor' },
      context('2026-08-01T00:00:00.000Z')
    )
  )
  if (recordPublication) {
    await repository.transaction((transaction) =>
      transaction.recordPublication(
        {
          snapshotDigest: digest('prior snapshot'),
          snapshotArtifactDigest: digest('prior snapshot artifact'),
          catalogs: [
            {
              channel: 'stable',
              catalogDigest: digest('prior stable catalog'),
              artifactDigest: digest('prior stable catalog artifact')
            }
          ]
        },
        context('2026-08-02T00:00:00.000Z')
      )
    )
  }
  return { repository, state: await repository.snapshot() }
}

function currentAudit(state: MarketplaceStateV1): { sequence: number; head: string } {
  const head = state.auditEvents.at(-1)?.eventHash
  if (!head) throw new Error('Fixture must have a current audit head')
  return { sequence: state.auditEvents.length, head }
}

function baselineAudit(state: MarketplaceStateV1): { sequence: number; head: string } {
  const publication = state.publications.at(-1)
  if (!publication?.auditHead) throw new Error('Fixture must have a prior publication')
  return { sequence: publication.auditSequence, head: publication.auditHead }
}

function requestInput(
  state: MarketplaceStateV1,
  baseline: MarketplacePublicationProjectionV1 | null,
  plan: MarketplacePublicationProjectionV1,
  purpose: 'routine' | 'emergency-revocation'
) {
  return {
    state,
    purpose,
    marketplaceId: MARKETPLACE_ID,
    rootKeyId: ROOT_KEY_ID,
    publicBaseUrl: PUBLIC_BASE_URL,
    baseline,
    plan
  } as const
}

describe('offline marketplace publication request', () => {
  test('produces deterministic exact canonical bytes and binds the trusted state and plan', async () => {
    const publicKey = await publicKeyPEM()
    const { repository, state } = await stateFixture(false)
    const audit = currentAudit(state)
    const plan = projection({
      sequence: 1,
      generatedAt: PLAN_GENERATED_AT,
      expiresAt: PLAN_EXPIRES_AT,
      auditSequence: audit.sequence,
      auditHead: audit.head,
      publicKeyPEM: publicKey,
      includeDistribution: true
    })
    const input = requestInput(state, null, plan, 'routine')
    const first = createMarketplacePublicationRequest(input)
    const second = createMarketplacePublicationRequest(input)

    expect(serializeMarketplacePublicationRequest(first)).toBe(
      serializeMarketplacePublicationRequest(second)
    )
    expect(marketplacePublicationRequestBytes(first)).toEqual(
      marketplacePublicationRequestBytes(second)
    )
    expect(marketplacePublicationRequestDigest(first)).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(first.previousPublicationSnapshotDigest).toBeNull()
    expect(first.previousPublicationSnapshotArtifactDigest).toBeNull()
    expect(first.baselineDigest).toBeNull()
    expect(
      parseMarketplacePublicationRequestBytes(marketplacePublicationRequestBytes(first))
    ).toEqual(first)
    expect(assertMarketplacePublicationRequestState(first, state)).toEqual(first)

    await repository.transaction((transaction) =>
      transaction.createPublisher(
        { id: 'state-changed', displayName: 'State Changed' },
        context('2026-08-03T00:00:00.000Z')
      )
    )
    const changedState = await repository.snapshot()
    expect(() => assertMarketplacePublicationRequestState(first, changedState)).toThrow(
      'current trusted state'
    )
  })

  test('rejects unknown fields, bounded collection overflow, oversized bytes, and non-canonical JSON', async () => {
    const publicKey = await publicKeyPEM()
    const { state } = await stateFixture(false)
    const audit = currentAudit(state)
    const request = createMarketplacePublicationRequest(
      requestInput(
        state,
        null,
        projection({
          sequence: 1,
          generatedAt: PLAN_GENERATED_AT,
          expiresAt: PLAN_EXPIRES_AT,
          auditSequence: audit.sequence,
          auditHead: audit.head,
          publicKeyPEM: publicKey
        }),
        'routine'
      )
    )

    expect(() => parseMarketplacePublicationRequest({ ...request, actor: 'root' })).toThrow(
      'unsupported fields'
    )
    expect(() =>
      parseMarketplacePublicationRequest({
        ...request,
        plan: {
          ...request.plan,
          catalogs: [...request.plan.catalogs, request.plan.catalogs[1]]
        }
      })
    ).toThrow('more than 2 entries')
    expect(() =>
      parseMarketplacePublicationRequestBytes(
        new Uint8Array(MARKETPLACE_PUBLICATION_REQUEST_LIMITS.maxJsonBytes + 1)
      )
    ).toThrow('may not exceed')
    expect(() => parseMarketplacePublicationRequestJSON(JSON.stringify(request))).toThrow(
      'exact canonical JSON encoding'
    )
  })

  test('rejects a plan whose exact digest or derived human-review diff was tampered', async () => {
    const publicKey = await publicKeyPEM()
    const { state } = await stateFixture(false)
    const audit = currentAudit(state)
    const request = createMarketplacePublicationRequest(
      requestInput(
        state,
        null,
        projection({
          sequence: 1,
          generatedAt: PLAN_GENERATED_AT,
          expiresAt: PLAN_EXPIRES_AT,
          auditSequence: audit.sequence,
          auditHead: audit.head,
          publicKeyPEM: publicKey,
          includeDistribution: true
        }),
        'routine'
      )
    )
    const listing = request.plan.snapshot.listings[0]
    if (!listing) throw new Error('Fixture must contain a listing')

    expect(() =>
      parseMarketplacePublicationRequest({
        ...request,
        plan: {
          ...request.plan,
          snapshot: {
            ...request.plan.snapshot,
            listings: [{ ...listing, name: 'Tampered name' }]
          }
        }
      })
    ).toThrow('planDigest')
    expect(() =>
      parseMarketplacePublicationRequest({
        ...request,
        review: { changes: request.review.changes.slice(1) }
      })
    ).toThrow('exact derived plan diff')
  })

  test('accepts an emergency plan made only of revocations and distribution removals', async () => {
    const publicKey = await publicKeyPEM()
    const { state } = await stateFixture(true)
    const prior = baselineAudit(state)
    const current = currentAudit(state)
    const baseline = projection({
      sequence: 1,
      generatedAt: BASELINE_GENERATED_AT,
      expiresAt: BASELINE_EXPIRES_AT,
      auditSequence: prior.sequence,
      auditHead: prior.head,
      publicKeyPEM: publicKey,
      includeDistribution: true
    })
    const plan = projection({
      sequence: 2,
      generatedAt: PLAN_GENERATED_AT,
      expiresAt: PLAN_EXPIRES_AT,
      auditSequence: current.sequence,
      auditHead: current.head,
      publicKeyPEM: publicKey,
      publisherStatus: 'suspended',
      keyRevoked: true,
      ownershipStatus: 'revoked'
    })

    const request = createMarketplacePublicationRequest(
      requestInput(state, baseline, plan, 'emergency-revocation')
    )
    const priorPublication = state.publications.at(-1)
    if (!priorPublication) throw new Error('Fixture must contain a prior publication')
    expect(request.previousPublicationSnapshotDigest).toBe(priorPublication.snapshotDigest)
    expect(request.previousPublicationSnapshotArtifactDigest).toBe(
      priorPublication.snapshotArtifactDigest
    )
    expect(request.baselineDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(() =>
      parseMarketplacePublicationRequest({
        ...request,
        baselineDigest: digest('self-reported baseline replacement')
      })
    ).toThrow('baselineDigest')
    expect(() =>
      assertMarketplacePublicationRequestState(
        {
          ...request,
          previousPublicationSnapshotArtifactDigest: digest('wrong prior artifact')
        },
        state
      )
    ).toThrow('current trusted state')
    expect(new Set(request.review.changes.map(({ operation }) => operation))).toEqual(
      new Set(['remove', 'restrict'])
    )
    expect(new Set(request.review.changes.map(({ resource }) => resource))).toEqual(
      new Set([
        'publisher',
        'publisher-key',
        'ownership',
        'catalog-entry',
        'listing',
        'listing-release',
        'runtime-entry'
      ])
    )
    expect(
      parseMarketplacePublicationRequestBytes(marketplacePublicationRequestBytes(request))
    ).toEqual(request)
  })

  test('rejects emergency key and ownership revocations that are not effective by plan generation', async () => {
    const publicKey = await publicKeyPEM()
    const { state } = await stateFixture(true)
    const prior = baselineAudit(state)
    const current = currentAudit(state)
    const baseline = projection({
      sequence: 1,
      generatedAt: BASELINE_GENERATED_AT,
      expiresAt: BASELINE_EXPIRES_AT,
      auditSequence: prior.sequence,
      auditHead: prior.head,
      publicKeyPEM: publicKey
    })
    const planOptions = {
      sequence: 2,
      generatedAt: PLAN_GENERATED_AT,
      expiresAt: PLAN_EXPIRES_AT,
      auditSequence: current.sequence,
      auditHead: current.head,
      publicKeyPEM: publicKey
    } as const

    expect(() =>
      createMarketplacePublicationRequest(
        requestInput(
          state,
          baseline,
          projection({
            ...planOptions,
            keyRevoked: true,
            keyRevokedAt: '2027-01-01T00:00:00.000Z'
          }),
          'emergency-revocation'
        )
      )
    ).toThrow('effective by plan generation')
    expect(() =>
      createMarketplacePublicationRequest(
        requestInput(
          state,
          baseline,
          projection({
            ...planOptions,
            ownershipStatus: 'revoked',
            ownershipRevokedAt: '2027-01-01T00:00:00.000Z'
          }),
          'emergency-revocation'
        )
      )
    ).toThrow('effective by plan generation')
  })

  test('fails closed on emergency publisher, key, ownership, release, listing, or runtime expansion', async () => {
    const [publicKey, secondKey, secondPublisherKey] = await Promise.all([
      publicKeyPEM(),
      publicKeyPEM(),
      publicKeyPEM()
    ])
    const { state } = await stateFixture(true)
    const prior = baselineAudit(state)
    const current = currentAudit(state)
    const baselineOptions = {
      sequence: 1,
      generatedAt: BASELINE_GENERATED_AT,
      expiresAt: BASELINE_EXPIRES_AT,
      auditSequence: prior.sequence,
      auditHead: prior.head,
      publicKeyPEM: publicKey
    } as const
    const planOptions = {
      sequence: 2,
      generatedAt: PLAN_GENERATED_AT,
      expiresAt: PLAN_EXPIRES_AT,
      auditSequence: current.sequence,
      auditHead: current.head,
      publicKeyPEM: publicKey
    } as const
    const expansions = [
      {
        name: 'publisher addition',
        baseline: projection(baselineOptions),
        plan: projection({ ...planOptions, additionalPublisherPEM: secondPublisherKey })
      },
      {
        name: 'publisher reactivation',
        baseline: projection({ ...baselineOptions, publisherStatus: 'suspended' }),
        plan: projection(planOptions)
      },
      {
        name: 'publisher key addition',
        baseline: projection(baselineOptions),
        plan: projection({ ...planOptions, additionalKeyPEM: secondKey })
      },
      {
        name: 'publisher key reactivation',
        baseline: projection({ ...baselineOptions, keyRevoked: true }),
        plan: projection(planOptions)
      },
      {
        name: 'ownership addition',
        baseline: projection({ ...baselineOptions, includeOwnership: false }),
        plan: projection(planOptions)
      },
      {
        name: 'ownership reactivation',
        baseline: projection({ ...baselineOptions, ownershipStatus: 'revoked' }),
        plan: projection(planOptions)
      },
      {
        name: 'release, listing, and runtime addition',
        baseline: projection(baselineOptions),
        plan: projection({ ...planOptions, includeDistribution: true })
      }
    ]

    for (const expansion of expansions) {
      expect(() =>
        createMarketplacePublicationRequest(
          requestInput(state, expansion.baseline, expansion.plan, 'emergency-revocation')
        )
      ).toThrow('may not add or expand')
    }

    const routine = createMarketplacePublicationRequest(
      requestInput(
        state,
        projection(baselineOptions),
        projection({ ...planOptions, includeDistribution: true }),
        'routine'
      )
    )
    expect(new Set(routine.review.changes.map(({ resource }) => resource))).toEqual(
      new Set(['catalog-entry', 'listing', 'listing-release', 'runtime-entry'])
    )
  })
})
