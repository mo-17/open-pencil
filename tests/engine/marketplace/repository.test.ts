import { describe, expect, test } from 'bun:test'

import type {
  CreateMarketplaceSubmissionInput,
  MarketplaceMutationContext,
  RegisterMarketplacePublisherKeyInput
} from '@open-pencil/marketplace'
import {
  createMemoryMarketplaceRepository,
  marketplaceListingDigest
} from '@open-pencil/marketplace'
import { digestCanonicalManifest, exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

const times = Array.from(
  { length: 32 },
  (_, index) => `2026-08-05T00:00:${String(index).padStart(2, '0')}.000Z`
)

async function publisherKey(): Promise<RegisterMarketplacePublisherKeyInput> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  return {
    keyId: 'acme.release.2026',
    publisherId: 'acme',
    publicKeyPem: await exportEd25519PublicKeyPem(pair.publicKey),
    notBefore: '2026-01-01T00:00:00.000Z',
    notAfter: '2027-01-01T00:00:00.000Z'
  }
}

function context(index: number, reason?: string): MarketplaceMutationContext {
  return { actor: 'local-admin', time: times[index], ...(reason ? { reason } : {}) }
}

async function submission(): Promise<CreateMarketplaceSubmissionInput> {
  const manifestDigest = await digestCanonicalManifest({ kind: 'manifest-payload' })
  const artifactDigest = await digestCanonicalManifest({ kind: 'manifest-artifact' })
  const packageDigest = await digestCanonicalManifest({ kind: 'runtime-package' })
  const listing = {
    displayName: 'Acme Analytics',
    summary: 'Verified analytics components.',
    description: 'Declarative analytics components for OpenPencil documents.',
    categories: ['analytics'],
    iconUrl: null,
    homepageUrl: 'https://plugins.example.com/acme.analytics'
  }
  return {
    id: 'submission-1',
    publisherId: 'acme',
    coordinate: { pluginId: 'acme.analytics', version: '1.0.0', channel: 'stable' },
    manifestDigest,
    artifactDigest,
    manifestUrl: 'https://plugins.example.com/acme.analytics/1.0.0/manifest.json',
    listing,
    listingDigest: marketplaceListingDigest(listing),
    signingKeyId: 'acme.release.2026',
    authenticatedRequestKeyId: 'acme.release.2026',
    runtimeCoordinate: {
      packageDigest,
      packageUrl: 'https://plugins.example.com/acme.analytics/1.0.0/runtime.wasm',
      byteLength: 1_024,
      kind: 'wasm'
    }
  }
}

async function activatePublisherAndOwnership(
  repository: ReturnType<typeof createMemoryMarketplaceRepository>
): Promise<void> {
  const key = await publisherKey()
  await repository.transaction(async (transaction) => {
    await transaction.createPublisher({ id: 'acme', displayName: 'Acme' }, context(0))
    await transaction.registerPublisherKey(key, context(1))
    await transaction.transitionPublisherKey(key.keyId, 'active', context(2))
    await transaction.transitionPublisher('acme', 'active', context(3))
    await transaction.requestOwnership(
      { pluginId: 'acme.analytics', publisherId: 'acme' },
      context(4)
    )
    await transaction.transitionOwnership('acme.analytics', 'active', context(5))
  })
}

describe('memory marketplace repository', () => {
  test('runs the publisher, ownership, submission, publication, and yank lifecycle with audit', async () => {
    const repository = createMemoryMarketplaceRepository()
    await activatePublisherAndOwnership(repository)
    const input = await submission()

    await repository.transaction(async (transaction) => {
      await transaction.createSubmission(input, context(6))
      await transaction.transitionSubmission(input.id, 'awaiting_review', context(7))
      await transaction.transitionSubmission(input.id, 'approved', context(8))
      const release = await transaction.publishSubmission(input.id, context(9))
      expect(release.manifestDigest).toBe(input.manifestDigest)
      expect(release.artifactDigest).toBe(input.artifactDigest)
    })

    const beforePublication = await repository.snapshot()
    const priorAuditHead = beforePublication.auditEvents.at(-1)?.eventHash ?? null
    const digest = await digestCanonicalManifest({ publication: 1 })
    await repository.transaction(async (transaction) => {
      const publication = await transaction.recordPublication(
        {
          snapshotDigest: digest,
          snapshotArtifactDigest: digest,
          catalogs: [{ channel: 'stable', catalogDigest: digest, artifactDigest: digest }]
        },
        context(10)
      )
      expect(publication.auditSequence).toBe(beforePublication.auditEvents.length)
      expect(publication.auditHead).toBe(priorAuditHead)
    })
    await repository.transaction((transaction) =>
      transaction.yankRelease(input.coordinate, context(11, 'Security incident'))
    )

    const snapshot = await repository.snapshot()
    expect(snapshot.submissions[0]).toMatchObject({ status: 'yanked' })
    expect(snapshot.releases[0]).toMatchObject({ yankReason: 'Security incident' })
    expect(snapshot.publications).toHaveLength(1)
    expect(snapshot.auditEvents).toHaveLength(12)
    expect(snapshot.auditEvents.map(({ sequence }) => sequence)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1)
    )
  })

  test('forbids ownership transfer even after rejection or revocation', async () => {
    const repository = createMemoryMarketplaceRepository()
    await activatePublisherAndOwnership(repository)
    await repository.transaction((transaction) =>
      transaction.transitionOwnership('acme.analytics', 'revoked', context(6, 'Policy violation'))
    )
    await repository.transaction(async (transaction) => {
      await transaction.createPublisher({ id: 'other', displayName: 'Other' }, context(7))
    })
    await expect(
      repository.transaction((transaction) =>
        transaction.requestOwnership(
          { pluginId: 'acme.analytics', publisherId: 'other' },
          context(8)
        )
      )
    ).rejects.toThrow('cannot be transferred')
  })

  test('serializes transactions and rolls back records plus audit on failure', async () => {
    const repository = createMemoryMarketplaceRepository()
    let releaseFirst!: () => void
    let markFirstStarted!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve
    })
    const order: string[] = []
    const first = repository.transaction(async (transaction) => {
      order.push('first-start')
      markFirstStarted()
      await gate
      await transaction.createPublisher({ id: 'first', displayName: 'First' }, context(0))
      order.push('first-end')
    })
    const second = repository.transaction(async (transaction) => {
      order.push('second-start')
      await transaction.createPublisher({ id: 'second', displayName: 'Second' }, context(1))
    })
    await firstStarted
    expect(order).toEqual(['first-start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second-start'])

    await expect(
      repository.transaction(async (transaction) => {
        await transaction.createPublisher(
          { id: 'rolled-back', displayName: 'Rollback' },
          context(2)
        )
        throw new Error('abort')
      })
    ).rejects.toThrow('abort')
    const snapshot = await repository.snapshot()
    expect(snapshot.publishers.map(({ id }) => id)).toEqual(['first', 'second'])
    expect(snapshot.auditEvents).toHaveLength(2)
  })

  test('clones inputs/results and enforces configured capacity atomically', async () => {
    const repository = createMemoryMarketplaceRepository({ capacity: { maxPublishers: 1 } })
    const input = { id: 'isolated', displayName: 'Original' }
    const created = await repository.transaction(async (transaction) => {
      const pending = transaction.createPublisher(input, context(0))
      input.displayName = 'Tampered'
      return pending
    })
    expect(created.displayName).toBe('Original')
    ;(created as { displayName: string }).displayName = 'Outside mutation'
    expect((await repository.snapshot()).publishers[0]?.displayName).toBe('Original')

    await expect(
      repository.transaction((transaction) =>
        transaction.createPublisher({ id: 'overflow', displayName: 'Overflow' }, context(1))
      )
    ).rejects.toThrow('maxPublishers')
    const snapshot = await repository.snapshot()
    expect(snapshot.publishers).toHaveLength(1)
    expect(snapshot.auditEvents).toHaveLength(1)
  })
})
