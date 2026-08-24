import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import {
  createMarketplaceSubmissionReviewerHistory,
  createMarketplaceHttpApp,
  createMarketplaceService,
  createMemoryMarketplaceArtifactStore,
  createMemoryMarketplaceNonceStore,
  createMemoryMarketplaceRepository,
  parseMarketplaceSubmissionCurrentCheckReport,
  parseMarketplaceSubmissionReviewerHistory,
  parseMarketplaceSubmissionReviewerHistoryQuery,
  signMarketplaceRequest,
  signMarketplaceOperatorAssertion,
  type MarketplaceOperatorOperation,
  type MarketplaceOperatorRole,
  type MarketplaceReleaseCoordinateV1,
  type MarketplaceService
} from '@open-pencil/marketplace'
import { signPluginManifest } from '@open-pencil/plugin-contracts'
import { exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

import { pluginPayload } from '../plugins/helpers'

const NOW = '2026-08-22T08:00:00.000Z'
const ORIGIN = 'http://localhost'
const MARKETPLACE_ID = 'openpencil-marketplace'
const OPERATOR_TOKEN = 'phase7-assurance-token-that-remains-server-only'
const OPERATOR_ACTOR = `portal:${createHash('sha256').update('phase7-assurance-user').digest('base64url')}`

interface PublishedEntry {
  publisherId: string
  keyId: string
  pluginId: string
  displayName: string
}

interface PublishedFixtureEntry extends PublishedEntry {
  pair: CryptoKeyPair
  coordinate: MarketplaceReleaseCoordinateV1
}

interface PublishedFixture {
  app: ReturnType<typeof createMarketplaceHttpApp>
  entries: ReadonlyMap<string, PublishedFixtureEntry>
  service: MarketplaceService
}

async function publishedFixture(
  entryValues: readonly PublishedEntry[] = [
    {
      publisherId: 'acme',
      keyId: 'acme.release',
      pluginId: 'acme.analytics',
      displayName: 'Acme Analytics'
    }
  ],
  options: { reviewReason?: string } = {
    reviewReason: 'Current automated and human review completed'
  }
): Promise<PublishedFixture> {
  const root = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const service = createMarketplaceService({
    repository: createMemoryMarketplaceRepository(),
    artifacts: createMemoryMarketplaceArtifactStore(),
    marketplaceId: MARKETPLACE_ID,
    publicBaseUrl: 'https://plugins.example.com/',
    now: () => new Date(NOW),
    root: {
      keyId: 'marketplace-root-2026',
      privateKey: root.privateKey,
      publicKey: root.publicKey
    }
  })
  const entries = new Map<string, PublishedFixtureEntry>()
  for (const entry of entryValues) {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    await service.registerPublisher(
      {
        publisher: { id: entry.publisherId, displayName: entry.displayName },
        key: {
          keyId: entry.keyId,
          publisherId: entry.publisherId,
          publicKeyPem: await exportEd25519PublicKeyPem(pair.publicKey),
          notBefore: '2026-01-01T00:00:00.000Z',
          notAfter: '2027-01-01T00:00:00.000Z'
        }
      },
      { actor: `publisher:${entry.publisherId}`, time: NOW }
    )
    await service.transitionPublisherKey(entry.keyId, 'active', {
      actor: 'admin:fixture',
      time: NOW
    })
    await service.transitionPublisher(entry.publisherId, 'active', {
      actor: 'admin:fixture',
      time: NOW
    })
    await service.requestOwnership(entry.pluginId, entry.publisherId, {
      actor: `publisher:${entry.publisherId}`,
      time: NOW
    })
    await service.transitionOwnership(entry.pluginId, 'active', {
      actor: 'admin:fixture',
      time: NOW
    })
    const payload = pluginPayload()
    payload.plugin = { ...payload.plugin, id: entry.pluginId, name: entry.displayName }
    payload.publisher = {
      id: entry.publisherId,
      name: entry.displayName,
      keyId: entry.keyId
    }
    const manifest = await signPluginManifest(payload, pair.privateKey)
    const submission = await service.submit(
      {
        id: `${entry.publisherId}-submission`,
        publisherId: entry.publisherId,
        channel: 'stable',
        manifest,
        listing: {
          displayName: entry.displayName,
          summary: `${entry.displayName} live listing`,
          description: `${entry.displayName} immutable publication with live availability.`,
          categories: ['analytics'],
          iconUrl: null,
          homepageUrl: null
        }
      },
      { actor: `publisher:${entry.publisherId}`, time: NOW }
    )
    await service.transitionSubmission(submission.id, 'approved', {
      actor: 'admin:fixture',
      time: NOW,
      ...(options.reviewReason ? { reason: options.reviewReason } : {})
    })
    const release = await service.publishSubmission(submission.id, {
      actor: 'admin:fixture',
      time: NOW
    })
    entries.set(entry.pluginId, {
      ...entry,
      pair,
      coordinate: release.coordinate
    })
  }
  await service.publish({ actor: 'admin:fixture', time: NOW })
  return {
    service,
    entries,
    app: createMarketplaceHttpApp({
      service,
      nonces: createMemoryMarketplaceNonceStore(() => Date.parse(NOW)),
      now: () => Date.parse(NOW),
      admin: { enabled: true, token: OPERATOR_TOKEN, requireServiceAssertion: true }
    })
  }
}

function requestHeaders(headers: Awaited<ReturnType<typeof signMarketplaceRequest>>) {
  return {
    'x-openpencil-marketplace-audience': headers.audience,
    'x-openpencil-publisher-id': headers.publisherId,
    'x-openpencil-key-id': headers.keyId,
    'x-openpencil-timestamp': headers.timestamp,
    'x-openpencil-nonce': headers.nonce,
    'x-openpencil-signature': headers.signature
  }
}

async function signedPublisherGet(
  fixture: PublishedFixture,
  pluginId: string,
  path: string,
  nonce: string
): Promise<Response> {
  const entry = fixture.entries.get(pluginId)
  if (!entry) throw new Error(`Missing fixture entry ${pluginId}`)
  const url = `${ORIGIN}${path}`
  const signed = await signMarketplaceRequest(
    {
      audience: MARKETPLACE_ID,
      publisherId: entry.publisherId,
      keyId: entry.keyId,
      method: 'GET',
      url,
      timestamp: NOW,
      nonce,
      body: new Uint8Array()
    },
    entry.pair.privateKey
  )
  return fixture.app.request(url, { headers: requestHeaders(signed) })
}

async function snapshotBytes(fixture: PublishedFixture): Promise<Uint8Array> {
  const response = await fixture.app.request(`${ORIGIN}/v1/snapshot`)
  expect(response.status).toBe(200)
  return new Uint8Array(await response.arrayBuffer())
}

let operatorNonceSequence = 0

async function operatorGet(
  fixture: PublishedFixture,
  path: string,
  operation: MarketplaceOperatorOperation,
  role: MarketplaceOperatorRole
): Promise<Response> {
  operatorNonceSequence++
  const suffix = String(operatorNonceSequence).padStart(8, '0')
  const assertion = signMarketplaceOperatorAssertion(
    {
      actor: OPERATOR_ACTOR,
      requestId: `assurance_request_${suffix}`,
      correlationId: `assurance_correlation_${suffix}`,
      authorization: {
        realm: 'platform',
        role,
        operation,
        mfaVerifiedAt: '2026-08-01T00:00:00.000Z',
        stepUp: null
      },
      method: 'GET',
      url: `${ORIGIN}${path}`,
      timestamp: NOW,
      nonce: `assurance_nonce_${suffix}`,
      body: new Uint8Array()
    },
    OPERATOR_TOKEN
  )
  return fixture.app.request(`${ORIGIN}${path}`, {
    headers: { 'x-openpencil-admin-assertion': assertion }
  })
}

async function expectPublicListingHidden(
  fixture: PublishedFixture,
  pluginId: string
): Promise<void> {
  const list = await fixture.app.request(`${ORIGIN}/v1/plugins`)
  expect(list.status).toBe(200)
  expect(list.headers.get('cache-control')).toBe('no-store')
  expect(await list.json()).toEqual([])
  const detail = await fixture.app.request(`${ORIGIN}/v1/plugins/${pluginId}`)
  expect(detail.status).toBe(404)
  expect(detail.headers.get('cache-control')).toBe('no-store')
}

describe('Phase 7 public live listing overlay', () => {
  test('removes suspended publishers without rewriting the signed snapshot and rejects new signed reads', async () => {
    const fixture = await publishedFixture()
    const immutableBefore = await snapshotBytes(fixture)
    const baseline = await fixture.app.request(`${ORIGIN}/v1/plugins/acme.analytics`)
    expect(baseline.status).toBe(200)
    expect(baseline.headers.get('cache-control')).toBe('no-store')

    await fixture.service.transitionPublisher('acme', 'suspended', {
      actor: 'admin:fixture',
      time: NOW,
      reason: 'Security suspension after publication'
    })
    await expectPublicListingHidden(fixture, 'acme.analytics')
    expect(await snapshotBytes(fixture)).toEqual(immutableBefore)
    const publisherRead = await signedPublisherGet(
      fixture,
      'acme.analytics',
      '/v1/publishers/me',
      'phase7suspendread0001'
    )
    expect(publisherRead.status).toBe(401)
  })

  test('removes releases whose submission signing key is revoked and rejects that key immediately', async () => {
    const fixture = await publishedFixture()
    await fixture.service.transitionPublisherKey('acme.release', 'revoked', {
      actor: 'admin:fixture',
      time: NOW,
      reason: 'Signing key compromise after publication'
    })
    await expectPublicListingHidden(fixture, 'acme.analytics')
    const publisherRead = await signedPublisherGet(
      fixture,
      'acme.analytics',
      '/v1/publishers/me/keys?limit=100',
      'phase7revokedread0001'
    )
    expect(publisherRead.status).toBe(401)
  })

  test('removes yanked releases while Publisher scoped reads expose the live yank state', async () => {
    const fixture = await publishedFixture()
    const immutableBefore = await snapshotBytes(fixture)
    const entry = fixture.entries.get('acme.analytics')
    if (!entry) throw new Error('Missing Acme fixture entry')
    await fixture.service.yankRelease(entry.coordinate, {
      actor: 'admin:fixture',
      time: NOW,
      reason: 'Post-publication incident response'
    })
    await expectPublicListingHidden(fixture, 'acme.analytics')
    expect(await snapshotBytes(fixture)).toEqual(immutableBefore)
    const publisherRead = await signedPublisherGet(
      fixture,
      'acme.analytics',
      '/v1/publishers/me/releases?limit=100',
      'phase7yankedread00001'
    )
    expect(publisherRead.status).toBe(200)
    expect(await publisherRead.json()).toMatchObject({
      items: [{ coordinate: entry.coordinate, yankReason: 'Post-publication incident response' }]
    })
  })

  test('removes listings after live ownership revocation while scoped reads expose revocation', async () => {
    const fixture = await publishedFixture()
    await fixture.service.transitionOwnership('acme.analytics', 'revoked', {
      actor: 'admin:fixture',
      time: NOW,
      reason: 'Ownership authority revoked after publication'
    })
    await expectPublicListingHidden(fixture, 'acme.analytics')
    const publisherRead = await signedPublisherGet(
      fixture,
      'acme.analytics',
      '/v1/publishers/me/ownerships?limit=100',
      'phase7ownershipread01'
    )
    expect(publisherRead.status).toBe(200)
    expect(await publisherRead.json()).toMatchObject({
      items: [{ pluginId: 'acme.analytics', status: 'revoked' }]
    })
  })

  test('applies live availability before search limit and retains later valid listings', async () => {
    const fixture = await publishedFixture([
      {
        publisherId: 'alpha',
        keyId: 'alpha.release',
        pluginId: 'alpha.invalid',
        displayName: 'Alpha Invalid'
      },
      {
        publisherId: 'zeta',
        keyId: 'zeta.release',
        pluginId: 'zeta.valid',
        displayName: 'Zeta Valid'
      }
    ])
    await fixture.service.transitionPublisherKey('alpha.release', 'revoked', {
      actor: 'admin:fixture',
      time: NOW,
      reason: 'Alpha key revoked'
    })
    const response = await fixture.app.request(`${ORIGIN}/v1/plugins?limit=1`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject([{ pluginId: 'zeta.valid' }])
  })
})

describe('Phase 7 current Submission assurance and reviewer history', () => {
  test('returns a digest-bound current report to every operator role and separates live trust', async () => {
    const fixture = await publishedFixture()
    let report: ReturnType<typeof parseMarketplaceSubmissionCurrentCheckReport> | null = null
    for (const role of ['reviewer', 'releaser', 'security_admin', 'super_admin'] as const) {
      const response = await operatorGet(
        fixture,
        '/admin/operator/submissions/acme-submission/current-check-report',
        'operator.submission.current-check-report.read',
        role
      )
      expect(response.status).toBe(200)
      report = parseMarketplaceSubmissionCurrentCheckReport(await response.json())
      expect(report).toMatchObject({
        schemaVersion: 1,
        scope: 'current',
        evaluatedAt: NOW,
        binding: {
          submissionId: 'acme-submission',
          revision: 1,
          publisherId: 'acme',
          signingKeyId: 'acme.release',
          coordinate: { pluginId: 'acme.analytics', version: '1.0.0', channel: 'stable' },
          runtime: null
        },
        valid: true
      })
      expect(report.checks.map(({ id, status }) => ({ id, status }))).toEqual([
        { id: 'publisher-active', status: 'pass' },
        { id: 'ownership-active', status: 'pass' },
        { id: 'signing-key-active', status: 'pass' },
        { id: 'listing-digest-binding', status: 'pass' },
        { id: 'manifest-artifact-signature-binding', status: 'pass' },
        { id: 'runtime-artifact-signature-binding', status: 'not_applicable' }
      ])
    }
    if (!report) throw new Error('Expected current check report')
    expect(() =>
      parseMarketplaceSubmissionCurrentCheckReport({ ...report, rawBody: 'forbidden' })
    ).toThrow(/field/i)
    expect(() =>
      parseMarketplaceSubmissionCurrentCheckReport({
        ...report,
        binding: { ...report.binding, signingKeyId: null }
      })
    ).toThrow(/signing-key binding/i)
    const missing = await operatorGet(
      fixture,
      '/admin/operator/submissions/missing/current-check-report',
      'operator.submission.current-check-report.read',
      'reviewer'
    )
    expect(missing.status).toBe(404)
    const wrongOperation = await operatorGet(
      fixture,
      '/admin/operator/submissions/acme-submission/current-check-report',
      'operator.submission.read',
      'reviewer'
    )
    expect(wrongOperation.status).toBe(403)

    await fixture.service.transitionPublisherKey('acme.release', 'revoked', {
      actor: 'admin:fixture',
      time: NOW,
      reason: 'Current trust revocation after immutable verification'
    })
    const revoked = await fixture.service.submissionCurrentCheckReport('acme-submission')
    expect(revoked).toMatchObject({ valid: false })
    expect(revoked?.checks.find(({ id }) => id === 'signing-key-active')?.status).toBe('fail')
    expect(
      revoked?.checks.find(({ id }) => id === 'manifest-artifact-signature-binding')?.status
    ).toBe('pass')
  })

  test('projects uniquely verified review decisions for every role without correlation data', async () => {
    const fixture = await publishedFixture()
    let lastHistory: ReturnType<typeof parseMarketplaceSubmissionReviewerHistory> | null = null
    for (const role of ['reviewer', 'releaser', 'security_admin', 'super_admin'] as const) {
      const response = await operatorGet(
        fixture,
        '/admin/operator/submissions/acme-submission/reviewer-history?limit=1',
        'operator.submission.reviewer-history.read',
        role
      )
      expect(response.status).toBe(200)
      const text = await response.text()
      expect(text).not.toContain('correlation')
      const history = parseMarketplaceSubmissionReviewerHistory(JSON.parse(text))
      lastHistory = history
      expect(history).toMatchObject({
        schemaVersion: 1,
        submissionId: 'acme-submission',
        complete: true,
        omittedCount: 0,
        omittedSequences: [],
        nextBeforeSequence: null,
        items: [
          {
            actor: 'admin:fixture',
            action: 'submission.review.decision',
            decision: 'approved',
            from: 'awaiting_review',
            to: 'approved',
            reason: 'Current automated and human review completed'
          }
        ]
      })
      expect(() =>
        parseMarketplaceSubmissionReviewerHistory({ ...history, correlationId: 'forbidden' })
      ).toThrow(/field/i)
    }
    if (!lastHistory) throw new Error('Expected reviewer history')
    const [decision] = lastHistory.items
    if (!decision) throw new Error('Expected a review decision')
    expect(() =>
      parseMarketplaceSubmissionReviewerHistory({
        ...lastHistory,
        items: [{ ...decision, reason: 'x'.repeat(20_000) }]
      })
    ).toThrow(/reason/i)
    expect(() =>
      parseMarketplaceSubmissionReviewerHistory({
        ...lastHistory,
        complete: false
      })
    ).toThrow(/complete/i)
    expect(() =>
      parseMarketplaceSubmissionReviewerHistory({
        ...lastHistory,
        nextBeforeSequence: decision.sequence + 1
      })
    ).toThrow(/page boundary/i)
    expect(() =>
      parseMarketplaceSubmissionReviewerHistory({
        ...lastHistory,
        complete: false,
        omittedCount: 1,
        omittedSequences: [decision.sequence]
      })
    ).toThrow(/overlap/i)

    expect(() => parseMarketplaceSubmissionReviewerHistoryQuery('?limit=101')).toThrow(/range/i)
    expect(() => parseMarketplaceSubmissionReviewerHistoryQuery('?limit=1&limit=2')).toThrow(
      /repeat/i
    )
    expect(() => parseMarketplaceSubmissionReviewerHistoryQuery('?beforeSequence=0')).toThrow(
      /positive/i
    )
    const unsupported = await operatorGet(
      fixture,
      '/admin/operator/submissions/acme-submission/reviewer-history?cursor=forbidden',
      'operator.submission.reviewer-history.read',
      'reviewer'
    )
    expect(unsupported.status).toBe(400)
  })

  test('marks missing decision context incomplete and rejects tampered audit evidence', async () => {
    const fixture = await publishedFixture(undefined, {})
    const history = await fixture.service.submissionReviewerHistory('acme-submission', {
      limit: 50
    })
    expect(history).toMatchObject({
      complete: false,
      omittedCount: 1,
      items: []
    })
    expect(history?.omittedSequences).toHaveLength(1)

    const state = await fixture.service.snapshot()
    const decisionSequence = state.auditEvents.find(
      ({ action, subject }) =>
        action === 'submission.status_changed' && subject === 'submission:acme-submission'
    )?.sequence
    if (!decisionSequence) throw new Error('Expected submission status audit evidence')
    const tampered = {
      ...state,
      auditEvents: state.auditEvents.map((event) =>
        event.sequence === decisionSequence ? { ...event, payloadDigest: 'A'.repeat(43) } : event
      )
    }
    await expect(
      createMarketplaceSubmissionReviewerHistory(tampered, 'acme-submission', { limit: 50 })
    ).rejects.toThrow(/audit|hash/i)
  })
})
