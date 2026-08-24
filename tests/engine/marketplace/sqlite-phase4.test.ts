import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createSqliteMarketplaceRepository,
  digestMarketplaceArtifact,
  marketplaceListingDigest,
  type MarketplaceListingMetadataV1
} from '@open-pencil/marketplace'
import { exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

const CREATED_AT = '2026-08-05T12:00:00.000Z'
const KEY_ACTIVATED_AT = '2026-08-05T12:00:01.000Z'
const PUBLISHER_ACTIVATED_AT = '2026-08-05T12:00:02.000Z'
const OWNERSHIP_REQUESTED_AT = '2026-08-05T12:00:03.000Z'
const OWNERSHIP_ACTIVATED_AT = '2026-08-05T12:00:04.000Z'
const SUBMITTED_AT = '2026-08-05T12:00:05.000Z'
const REVIEWED_AT = '2026-08-05T12:00:06.000Z'
const ROTATED_AT = '2026-08-05T12:00:07.000Z'
const ROTATED_KEY_ACTIVATED_AT = '2026-08-05T12:00:08.000Z'
const REVISED_AT = '2026-08-05T12:00:09.000Z'
const REVIEW_REASON = 'Replace the unsafe connector before review continues'
const encoder = new TextEncoder()
const temporaryDirectories: string[] = []

function databasePath(): string {
  const directory = join(tmpdir(), `openpencil-marketplace-phase4-sqlite-${randomUUID()}`)
  temporaryDirectories.push(directory)
  return join(directory, 'marketplace.sqlite')
}

function digest(label: string): string {
  return digestMarketplaceArtifact(encoder.encode(label))
}

function listing(label: string): MarketplaceListingMetadataV1 {
  return {
    displayName: `Analytics ${label}`,
    summary: `${label} listing`,
    description: `${label} declarative analytics plugin for SQLite Phase 4 tests.`,
    categories: ['analytics'],
    iconUrl: null,
    homepageUrl: null
  }
}

function artifactURL(artifactDigest: string): string {
  return `https://plugins.example.com/v1/artifacts/${artifactDigest}`
}

interface RevisionIdentity {
  readonly manifestDigest: string
  readonly artifactDigest: string
  readonly listing: MarketplaceListingMetadataV1
  readonly listingDigest: string
  readonly runtimePackageDigest: string
  readonly runtimeArtifactDigest: string
  readonly keyId: string
}

interface RevisedDatabaseFixture {
  readonly path: string
  readonly original: RevisionIdentity
  readonly revised: RevisionIdentity
}

async function createRevisedDatabase(): Promise<RevisedDatabaseFixture> {
  const path = databasePath()
  const originalPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify'
  ])
  const revisedPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const originalListing = listing('original')
  const revisedListing = listing('revised')
  const original: RevisionIdentity = {
    manifestDigest: digest('manifest-v1'),
    artifactDigest: digest('manifest-artifact-v1'),
    listing: originalListing,
    listingDigest: marketplaceListingDigest(originalListing),
    runtimePackageDigest: digest('runtime-package-v1'),
    runtimeArtifactDigest: digest('runtime-artifact-v1'),
    keyId: 'acme.release'
  }
  const revised: RevisionIdentity = {
    manifestDigest: digest('manifest-v2'),
    artifactDigest: digest('manifest-artifact-v2'),
    listing: revisedListing,
    listingDigest: marketplaceListingDigest(revisedListing),
    runtimePackageDigest: digest('runtime-package-v2'),
    runtimeArtifactDigest: digest('runtime-artifact-v2'),
    keyId: 'acme.release.next'
  }
  const repository = createSqliteMarketplaceRepository({ path })
  try {
    await repository.transaction(async (transaction) => {
      await transaction.createPublisher(
        { id: 'acme', displayName: 'Acme Plugins' },
        { actor: 'publisher:acme', time: CREATED_AT }
      )
      await transaction.registerPublisherKey(
        {
          keyId: original.keyId,
          publisherId: 'acme',
          publicKeyPem: await exportEd25519PublicKeyPem(originalPair.publicKey),
          notBefore: '2026-01-01T00:00:00.000Z',
          notAfter: '2027-01-01T00:00:00.000Z'
        },
        { actor: 'publisher:acme', time: CREATED_AT }
      )
      await transaction.transitionPublisherKey(original.keyId, 'active', {
        actor: 'admin:fixture',
        time: KEY_ACTIVATED_AT
      })
      await transaction.transitionPublisher('acme', 'active', {
        actor: 'admin:fixture',
        time: PUBLISHER_ACTIVATED_AT
      })
      await transaction.requestOwnership(
        { pluginId: 'acme.analytics', publisherId: 'acme' },
        { actor: 'publisher:acme', time: OWNERSHIP_REQUESTED_AT }
      )
      await transaction.transitionOwnership('acme.analytics', 'active', {
        actor: 'admin:fixture',
        time: OWNERSHIP_ACTIVATED_AT
      })
      await transaction.createSubmission(
        {
          id: 'submission-sqlite-phase4',
          publisherId: 'acme',
          coordinate: { pluginId: 'acme.analytics', version: '1.0.0', channel: 'stable' },
          manifestDigest: original.manifestDigest,
          artifactDigest: original.artifactDigest,
          manifestUrl: artifactURL(original.artifactDigest),
          listing: original.listing,
          listingDigest: original.listingDigest,
          runtimeCoordinate: {
            packageDigest: original.runtimePackageDigest,
            packageUrl: artifactURL(original.runtimeArtifactDigest),
            byteLength: 128,
            kind: 'javascript'
          },
          signingKeyId: original.keyId,
          authenticatedRequestKeyId: original.keyId
        },
        { actor: 'publisher:acme', time: SUBMITTED_AT }
      )
      await transaction.transitionSubmission('submission-sqlite-phase4', 'awaiting_review', {
        actor: 'marketplace:validator',
        time: SUBMITTED_AT
      })
      await transaction.transitionSubmission('submission-sqlite-phase4', 'changes_requested', {
        actor: 'admin:reviewer',
        reason: REVIEW_REASON,
        time: REVIEWED_AT
      })
      await transaction.registerPublisherKey(
        {
          keyId: revised.keyId,
          publisherId: 'acme',
          publicKeyPem: await exportEd25519PublicKeyPem(revisedPair.publicKey),
          predecessorKeyId: original.keyId,
          notBefore: ROTATED_AT,
          notAfter: '2027-08-05T00:00:00.000Z'
        },
        { actor: 'publisher:acme', time: ROTATED_AT }
      )
      await transaction.transitionPublisherKey(revised.keyId, 'active', {
        actor: 'admin:fixture',
        time: ROTATED_KEY_ACTIVATED_AT
      })
      await transaction.reviseSubmission(
        {
          id: 'submission-sqlite-phase4',
          publisherId: 'acme',
          coordinate: { pluginId: 'acme.analytics', version: '1.0.0', channel: 'stable' },
          manifestDigest: revised.manifestDigest,
          artifactDigest: revised.artifactDigest,
          manifestUrl: artifactURL(revised.artifactDigest),
          listing: revised.listing,
          listingDigest: revised.listingDigest,
          runtimeCoordinate: {
            packageDigest: revised.runtimePackageDigest,
            packageUrl: artifactURL(revised.runtimeArtifactDigest),
            byteLength: 256,
            kind: 'javascript'
          },
          signingKeyId: revised.keyId,
          authenticatedRequestKeyId: revised.keyId
        },
        1,
        { actor: 'publisher:acme', time: REVISED_AT }
      )
    })
  } finally {
    await repository.close()
  }
  return { path, original, revised }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('Phase 4 SQLite submission revisions', () => {
  test('reopens with exact current and historical revision identity', async () => {
    const fixture = await createRevisedDatabase()
    const reopened = createSqliteMarketplaceRepository({ path: fixture.path })
    try {
      const state = await reopened.snapshot()
      const submission = state.submissions.find(({ id }) => id === 'submission-sqlite-phase4')
      expect(submission).toMatchObject({
        revision: 2,
        revisionCreatedAt: REVISED_AT,
        signingKeyId: fixture.revised.keyId,
        authenticatedRequestKeyId: fixture.revised.keyId,
        manifestDigest: fixture.revised.manifestDigest,
        artifactDigest: fixture.revised.artifactDigest,
        listingDigest: fixture.revised.listingDigest,
        runtimeCoordinate: { packageDigest: fixture.revised.runtimePackageDigest },
        status: 'submitted',
        statusReason: null,
        revisionHistory: [
          {
            revision: 1,
            signingKeyId: fixture.original.keyId,
            authenticatedRequestKeyId: fixture.original.keyId,
            manifestDigest: fixture.original.manifestDigest,
            artifactDigest: fixture.original.artifactDigest,
            listingDigest: fixture.original.listingDigest,
            listing: { summary: fixture.original.listing.summary },
            runtimeCoordinate: { packageDigest: fixture.original.runtimePackageDigest },
            createdAt: SUBMITTED_AT,
            supersededAt: REVISED_AT,
            supersededBy: 'publisher:acme',
            supersededFromStatus: 'changes_requested',
            supersededReason: REVIEW_REASON
          }
        ]
      })
      expect(
        state.auditEvents.filter(({ action }) => action === 'submission.revised')
      ).toHaveLength(1)
    } finally {
      await reopened.close()
    }
  })

  test('rejects history payload or reviewer-evidence tampering with an unchanged audit chain', async () => {
    interface PersistedRevisionForTamper {
      manifestDigest: string
      signingKeyId: string | null
      authenticatedRequestKeyId: string | null
      supersededReason: string
      createdAt: string
    }
    interface PersistedStateForTamper {
      auditEvents: object[]
      submissions: Array<{ revisionHistory: PersistedRevisionForTamper[] }>
    }
    const mutations = [
      (revision: PersistedRevisionForTamper) => {
        revision.manifestDigest = digest('tampered-manifest-v1')
      },
      (revision: PersistedRevisionForTamper) => {
        revision.signingKeyId = 'tampered.signing-key'
      },
      (revision: PersistedRevisionForTamper) => {
        revision.authenticatedRequestKeyId = 'tampered.request-key'
      },
      (revision: PersistedRevisionForTamper) => {
        revision.supersededReason = 'Tampered reviewer evidence'
      },
      (revision: PersistedRevisionForTamper) => {
        revision.createdAt = '2026-08-05T12:00:05.500Z'
      }
    ]
    for (const mutate of mutations) {
      const fixture = await createRevisedDatabase()
      const database = new Database(fixture.path, { strict: true })
      const row = database
        .query<{ state_json: string }, []>('SELECT state_json FROM marketplace_state WHERE id = 1')
        .get()
      const state = JSON.parse(row?.state_json ?? '{}') as PersistedStateForTamper
      const auditEventsBefore = JSON.stringify(state.auditEvents)
      const revision = state.submissions.at(0)?.revisionHistory.at(0)
      if (!revision) throw new TypeError('Expected persisted revision fixture')
      mutate(revision)
      expect(JSON.stringify(state.auditEvents)).toBe(auditEventsBefore)
      database
        .query('UPDATE marketplace_state SET state_json = ? WHERE id = 1')
        .run(JSON.stringify(state))
      database.close(false)

      const tampered = createSqliteMarketplaceRepository({ path: fixture.path })
      try {
        await expect(tampered.snapshot()).rejects.toThrow(/(creation|revision history).*audit/i)
      } finally {
        await tampered.close()
      }
    }
  })
})
