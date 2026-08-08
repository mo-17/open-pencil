import { describe, expect, test } from 'bun:test'

import {
  MARKETPLACE_LIMITS,
  canTransitionMarketplaceOwnership,
  canTransitionMarketplacePublisher,
  canTransitionMarketplacePublisherKey,
  canTransitionMarketplaceSubmission,
  createEmptyMarketplaceState,
  marketplaceReleaseCoordinateKey,
  parseCreateMarketplaceSubmissionInput,
  parseMarketplacePublication,
  parseMarketplaceReleaseCoordinate,
  parseMarketplaceState
} from '@open-pencil/marketplace'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

describe('marketplace v1 domain schema', () => {
  test('keeps every lifecycle transition explicit and terminal states closed', () => {
    expect(canTransitionMarketplacePublisher('pending', 'active')).toBe(true)
    expect(canTransitionMarketplacePublisher('rejected', 'active')).toBe(false)
    expect(canTransitionMarketplacePublisherKey('pending', 'active')).toBe(true)
    expect(canTransitionMarketplacePublisherKey('revoked', 'active')).toBe(false)
    expect(canTransitionMarketplaceOwnership('active', 'revoked')).toBe(true)
    expect(canTransitionMarketplaceOwnership('revoked', 'requested')).toBe(false)

    expect(canTransitionMarketplaceSubmission('submitted', 'validation_failed')).toBe(true)
    expect(canTransitionMarketplaceSubmission('validation_failed', 'submitted')).toBe(true)
    expect(canTransitionMarketplaceSubmission('awaiting_review', 'changes_requested')).toBe(true)
    expect(canTransitionMarketplaceSubmission('awaiting_review', 'approved')).toBe(true)
    expect(canTransitionMarketplaceSubmission('approved', 'published')).toBe(true)
    expect(canTransitionMarketplaceSubmission('published', 'yanked')).toBe(true)
    expect(canTransitionMarketplaceSubmission('submitted', 'withdrawn')).toBe(true)
    expect(canTransitionMarketplaceSubmission('approved', 'withdrawn')).toBe(true)
    expect(canTransitionMarketplaceSubmission('published', 'withdrawn')).toBe(false)
    expect(canTransitionMarketplaceSubmission('withdrawn', 'submitted')).toBe(false)
    expect(canTransitionMarketplaceSubmission('yanked', 'published')).toBe(false)
  })

  test('uses stable semantic versions plus an independent stable or beta channel', () => {
    const stable = parseMarketplaceReleaseCoordinate({
      pluginId: 'acme.analytics',
      version: '1.2.3',
      channel: 'stable'
    })
    const beta = parseMarketplaceReleaseCoordinate({ ...stable, channel: 'beta' })
    expect(marketplaceReleaseCoordinateKey(stable)).toBe('acme.analytics@1.2.3#stable')
    expect(marketplaceReleaseCoordinateKey(beta)).toBe('acme.analytics@1.2.3#beta')
    expect(() => parseMarketplaceReleaseCoordinate({ ...stable, version: '1.2.3-beta.1' })).toThrow(
      'stable semantic version'
    )
    expect(() => parseMarketplaceReleaseCoordinate({ ...stable, channel: 'nightly' })).toThrow(
      'not supported'
    )
  })

  test('rejects unknown fields, sparse arrays, oversized listing data, and unsafe URLs', async () => {
    const empty = createEmptyMarketplaceState()
    expect(() => parseMarketplaceState({ ...empty, surprise: true })).toThrow('unsupported fields')

    const sparse: unknown[] = []
    sparse.length = 1
    expect(() => parseMarketplaceState({ ...empty, publishers: sparse })).toThrow(
      'dense JSON array'
    )

    const digest = await digestCanonicalManifest({ fixture: 'manifest' })
    const listing = {
      displayName: 'Analytics',
      summary: 'A bounded summary',
      description: 'A bounded description',
      categories: ['analytics'],
      iconUrl: null,
      homepageUrl: 'https://plugins.example.com/analytics'
    }
    const input = {
      id: 'submission-1',
      publisherId: 'acme',
      coordinate: { pluginId: 'acme.analytics', version: '1.0.0', channel: 'stable' },
      manifestDigest: digest,
      artifactDigest: digest,
      manifestUrl: 'https://plugins.example.com/acme.analytics/1.0.0/manifest.json',
      listing,
      runtimeCoordinate: null
    }
    expect(parseCreateMarketplaceSubmissionInput(input).manifestDigest).toBe(digest)
    expect(() =>
      parseCreateMarketplaceSubmissionInput({
        ...input,
        manifestUrl: 'http://localhost:8080/manifest.json'
      })
    ).toThrow('canonical public HTTPS URL')
    expect(() =>
      parseCreateMarketplaceSubmissionInput({
        ...input,
        listing: {
          ...listing,
          categories: Array.from(
            { length: MARKETPLACE_LIMITS.maxCategories + 1 },
            (_, index) => `category-${index}`
          )
        }
      })
    ).toThrow('may not contain more than')
  })

  test('validates publication ordering, runtime pairs, and audit checkpoints', async () => {
    const digest = await digestCanonicalManifest({ fixture: 'publication' })
    expect(
      parseMarketplacePublication({
        schemaVersion: 1,
        sequence: 1,
        snapshotDigest: digest,
        snapshotArtifactDigest: digest,
        catalogs: [
          { channel: 'stable', catalogDigest: digest, artifactDigest: digest },
          { channel: 'beta', catalogDigest: digest, artifactDigest: digest }
        ],
        runtimeIndexDigest: null,
        runtimeIndexArtifactDigest: null,
        auditSequence: 0,
        auditHead: null,
        publishedAt: '2026-08-05T00:00:00.000Z'
      }).catalogs.map(({ channel }) => channel)
    ).toEqual(['stable', 'beta'])

    expect(() =>
      parseMarketplacePublication({
        schemaVersion: 1,
        sequence: 1,
        snapshotDigest: digest,
        snapshotArtifactDigest: digest,
        catalogs: [
          { channel: 'beta', catalogDigest: digest, artifactDigest: digest },
          { channel: 'stable', catalogDigest: digest, artifactDigest: digest }
        ],
        runtimeIndexDigest: null,
        runtimeIndexArtifactDigest: null,
        auditSequence: 0,
        auditHead: null,
        publishedAt: '2026-08-05T00:00:00.000Z'
      })
    ).toThrow('ordered stable then beta')
  })
})
