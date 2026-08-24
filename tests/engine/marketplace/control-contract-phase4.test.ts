import { describe, expect, test } from 'bun:test'

import {
  MARKETPLACE_ARTIFACT_LIMITS,
  MARKETPLACE_CONTROL_LIMITS,
  encodeMarketplaceControlCursor,
  importMarketplaceControlCursorKey,
  inspectMarketplaceArtifact,
  marketplaceListingDigest,
  parseMarketplaceControlSubmission,
  parseMarketplaceControlSubmissionSummary,
  parseMarketplaceControlSubmissionValidation,
  parseMarketplaceImpactPreview,
  serializeMarketplaceControlJSON
} from '@open-pencil/marketplace'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

const AT = '2026-08-05T12:00:00.000Z'

function listing() {
  return {
    displayName: 'Acme Analytics',
    summary: 'Bounded analytics components.',
    description: 'A declarative marketplace contract fixture.',
    categories: ['analytics'],
    iconUrl: null,
    homepageUrl: null
  }
}

async function legacySummary() {
  const manifestDigest = await digestCanonicalManifest({ manifest: 1 })
  const value = listing()
  return {
    schemaVersion: 1,
    id: 'legacy-submission',
    publisherId: 'acme',
    coordinate: { pluginId: 'acme.analytics', version: '1.0.0', channel: 'stable' },
    manifestDigest,
    listing: value,
    listingDigest: marketplaceListingDigest(value),
    runtimeCoordinate: null,
    signingKeyId: null,
    revision: 1,
    revisionCreatedAt: AT,
    status: 'approved',
    submittedAt: AT,
    updatedAt: AT,
    statusReason: null
  } as const
}

describe('marketplace Phase 4 control runtime contract', () => {
  test('round-trips legacy revision one while rejecting unknown and mismatched identities', async () => {
    const summary = await legacySummary()
    expect(parseMarketplaceControlSubmissionSummary(summary).signingKeyId).toBeNull()
    const artifactDigest = await digestCanonicalManifest({ artifact: 1 })
    const detail = {
      ...summary,
      artifactDigest,
      authenticatedRequestKeyId: null,
      revisions: [
        {
          revision: 1,
          signingKeyId: null,
          authenticatedRequestKeyId: null,
          manifestDigest: summary.manifestDigest,
          artifactDigest,
          listingDigest: summary.listingDigest,
          runtimeCoordinate: null,
          createdAt: AT,
          supersededAt: null,
          supersededBy: null,
          status: 'approved',
          statusReason: null
        }
      ]
    }
    expect(parseMarketplaceControlSubmission(detail).revision).toBe(1)
    expect(() => parseMarketplaceControlSubmission({ ...detail, unexpected: true })).toThrow(
      'unsupported fields'
    )

    const packageDigest = await digestCanonicalManifest({ runtime: 1 })
    const otherPackageDigest = await digestCanonicalManifest({ runtime: 2 })
    const runtimeSummary = {
      ...summary,
      runtimeCoordinate: { packageDigest, byteLength: 128, kind: 'wasm' }
    }
    const runtimeDetail = {
      ...runtimeSummary,
      artifactDigest,
      authenticatedRequestKeyId: null,
      revisions: [
        {
          ...detail.revisions[0],
          runtimeCoordinate: { packageDigest: otherPackageDigest, byteLength: 128, kind: 'wasm' }
        }
      ]
    }
    expect(() => parseMarketplaceControlSubmission(runtimeDetail)).toThrow(
      'current identity does not match'
    )
  })

  test('rejects an impossible cross-revision timeline', async () => {
    const base = await legacySummary()
    const oldManifestDigest = await digestCanonicalManifest({ manifest: 'old' })
    const oldArtifactDigest = await digestCanonicalManifest({ artifact: 'old' })
    const currentArtifactDigest = await digestCanonicalManifest({ artifact: 'current' })
    const detail = {
      ...base,
      revision: 2,
      signingKeyId: 'acme.release',
      revisionCreatedAt: '2026-08-05T12:00:01.000Z',
      updatedAt: '2026-08-05T12:00:02.000Z',
      artifactDigest: currentArtifactDigest,
      authenticatedRequestKeyId: 'acme.release',
      revisions: [
        {
          revision: 1,
          signingKeyId: null,
          authenticatedRequestKeyId: null,
          manifestDigest: oldManifestDigest,
          artifactDigest: oldArtifactDigest,
          listingDigest: base.listingDigest,
          runtimeCoordinate: null,
          createdAt: AT,
          supersededAt: '2026-08-05T12:00:02.000Z',
          supersededBy: 'publisher:acme',
          status: 'changes_requested',
          statusReason: 'A revision was required'
        },
        {
          revision: 2,
          signingKeyId: 'acme.release',
          authenticatedRequestKeyId: 'acme.release',
          manifestDigest: base.manifestDigest,
          artifactDigest: currentArtifactDigest,
          listingDigest: base.listingDigest,
          runtimeCoordinate: null,
          createdAt: '2026-08-05T12:00:01.000Z',
          supersededAt: null,
          supersededBy: null,
          status: 'approved',
          statusReason: null
        }
      ]
    }
    expect(() => parseMarketplaceControlSubmission(detail)).toThrow(
      'must advance at the exact supersession time'
    )
  })

  test('strictly parses validate and impact DTOs', async () => {
    const digest = await digestCanonicalManifest({ digest: 1 })
    const validation = {
      schemaVersion: 1,
      valid: true,
      publisherId: 'acme',
      coordinate: { pluginId: 'acme.analytics', version: '1.0.0', channel: 'stable' },
      signingKeyId: 'acme.release',
      authenticatedRequestKeyId: 'acme.release',
      manifestDigest: digest,
      artifactDigest: digest,
      listingDigest: digest,
      runtimePackageDigest: null,
      runtimeArtifactDigest: null,
      manifestByteLength: 128,
      runtimeByteLength: null
    } as const
    expect(parseMarketplaceControlSubmissionValidation(validation).valid).toBe(true)
    expect(() =>
      parseMarketplaceControlSubmissionValidation({
        ...validation,
        runtimePackageDigest: digest
      })
    ).toThrow('must be present together')

    const impact = {
      schemaVersion: 1,
      operation: 'publisher.status',
      subject: 'publisher:acme',
      authorityDigest: digest,
      auditSequence: 0,
      auditHead: null,
      allowed: true,
      blockers: []
    } as const
    expect(parseMarketplaceImpactPreview(impact).allowed).toBe(true)
    expect(() => parseMarketplaceImpactPreview({ ...impact, blockers: ['blocked'] })).toThrow(
      'allowed must exactly match blockers'
    )
  })
})

describe('marketplace Phase 4 byte and secret boundaries', () => {
  test('requires a non-extractable server-only cursor HMAC key', async () => {
    const payload = {
      schemaVersion: 1,
      resource: 'submissions',
      scope: 'publisher:acme',
      sort: 'created',
      filters: {},
      stateToken: '0:empty',
      after: `${AT}|legacy-submission`
    } as const
    const extractable = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(MARKETPLACE_CONTROL_LIMITS.minCursorKeyBytes),
      { name: 'HMAC', hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    )
    await expect(encodeMarketplaceControlCursor(payload, extractable)).rejects.toThrow(
      'non-extractable'
    )
    const serverOnly = await importMarketplaceControlCursorKey(
      new Uint8Array(MARKETPLACE_CONTROL_LIMITS.minCursorKeyBytes)
    )
    expect(serverOnly.extractable).toBe(false)
    expect(await encodeMarketplaceControlCursor(payload, serverOnly)).toContain('.')
  })

  test('fails closed on response overflow and structurally forbidden secret or internal fields', () => {
    const privateKeyHeader = ['-----BEGIN PRIVATE', 'KEY-----'].join(' ')
    expect(() =>
      serializeMarketplaceControlJSON({
        value: 'x'.repeat(MARKETPLACE_CONTROL_LIMITS.maxResponseJsonBytes)
      })
    ).toThrow('byte limit')
    for (const value of [
      { accessToken: 'credential' },
      { apiKey: 'credential' },
      { artifactPath: '/Users/operator/private/artifact' },
      { publicKeyPem: '-----BEGIN PUBLIC KEY-----' },
      { privateKey: 'credential' },
      { key: privateKeyHeader },
      { manifestUrl: 'https://plugins.example.com/manifest.json' },
      { packageUrl: 'https://plugins.example.com/package.json' },
      { endpoint: 'http://localhost:8787/internal' }
    ]) {
      expect(() => serializeMarketplaceControlJSON(value)).toThrow()
    }

    const untrustedText = {
      statusReason: '/Users/operator/private is an example supplied by the reviewer',
      listing: {
        summary: 'Do not call http://localhost:8787 from a plugin',
        description: `The literal ${privateKeyHeader} is documentation`,
        iconUrl: null,
        homepageUrl: 'https://plugins.example.com/'
      }
    }
    expect(JSON.parse(serializeMarketplaceControlJSON(untrustedText))).toEqual(untrustedText)
  })

  test('enforces the immutable artifact byte limit before storage', () => {
    expect(inspectMarketplaceArtifact(new Uint8Array([1])).byteLength).toBe(1)
    expect(() =>
      inspectMarketplaceArtifact(new Uint8Array(MARKETPLACE_ARTIFACT_LIMITS.maxBytes + 1))
    ).toThrow('between 1 and')
  })

  test('caps the aggregate response entry count before JSON serialization', () => {
    expect(() =>
      serializeMarketplaceControlJSON({
        items: Array.from({ length: MARKETPLACE_CONTROL_LIMITS.maxWireEntries + 1 }, () => null)
      })
    ).toThrow('too many entries')
  })
})
