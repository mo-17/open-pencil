import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import {
  MARKETPLACE_ADMIN_ASSERTION_HEADER,
  createMarketplaceHttpApp,
  createMarketplaceService,
  createMemoryMarketplaceArtifactStore,
  createMemoryMarketplaceNonceStore,
  createMemoryMarketplaceRepository,
  signMarketplaceOperatorAssertion,
  verifyMarketplaceAuditChain,
  type MarketplaceOperatorAuthorizationV2,
  type MarketplaceOperatorOperation,
  type MarketplaceOperatorRole
} from '@open-pencil/marketplace'
import { exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

const NOW = '2026-08-22T08:00:00.000Z'
const BEFORE = '2026-08-22T07:58:00.000Z'
const OLD_MFA = '2026-08-01T00:00:00.000Z'
const FRESH_MFA = '2026-08-22T07:55:00.000Z'
const FRESH_STEP_UP = '2026-08-22T07:59:00.000Z'
const KEY_EXPIRY_THRESHOLD = '2026-09-21T08:00:00.000Z'
const ORIGIN = 'http://127.0.0.1:43121'
const TOKEN = 'phase7-http-operator-token-that-remains-server-only'
const GRANT_DIGEST = createHash('sha256').update('phase7-http-step-up-grant').digest('base64url')
const RAW_OPERATOR_ID = 'user-01j5phase7operator'
const OPERATOR_ACTOR = `portal:${createHash('sha256').update(RAW_OPERATOR_ID).digest('base64url')}`
const encoder = new TextEncoder()

interface OperatorOverviewResponse {
  auditAccess: unknown
  recentAudit: unknown[]
}

interface OperatorAuditPageResponse {
  items: Array<{
    schemaVersion: number
    reason: string | null
    correlationId: string | null
    contextDigest: string | null
    chainStatus: string
  }>
}

let nonceSequence = 0

function operatorAuthorization(
  operation: MarketplaceOperatorOperation,
  role: MarketplaceOperatorRole,
  options: { oldMfa?: boolean; stepUp?: boolean } = {}
): MarketplaceOperatorAuthorizationV2 {
  return {
    realm: 'platform',
    role,
    operation,
    mfaVerifiedAt: options.oldMfa ? OLD_MFA : FRESH_MFA,
    stepUp: options.stepUp ? { verifiedAt: FRESH_STEP_UP, grantIdDigest: GRANT_DIGEST } : null
  }
}

function nextNonce(): string {
  nonceSequence++
  return `phase7httpnonce${String(nonceSequence).padStart(8, '0')}`
}

async function operatorRequest(
  app: ReturnType<typeof createMarketplaceHttpApp>,
  path: string,
  operation: MarketplaceOperatorOperation,
  role: MarketplaceOperatorRole,
  options: {
    body?: string
    oldMfa?: boolean
    stepUp?: boolean
    assertion?: string
  } = {}
): Promise<{ response: Response; assertion: string }> {
  const body = options.body ?? ''
  const method = body.length === 0 ? 'GET' : 'POST'
  const assertion =
    options.assertion ??
    signMarketplaceOperatorAssertion(
      {
        actor: OPERATOR_ACTOR,
        requestId: `request_${nextNonce()}`,
        correlationId: `correlation_${nextNonce()}`,
        authorization: operatorAuthorization(operation, role, options),
        method,
        url: `${ORIGIN}${path}`,
        timestamp: NOW,
        nonce: nextNonce(),
        body: encoder.encode(body)
      },
      TOKEN
    )
  const response = await app.request(`${ORIGIN}${path}`, {
    method,
    headers: {
      [MARKETPLACE_ADMIN_ASSERTION_HEADER]: assertion,
      ...(body.length === 0 ? {} : { 'content-type': 'application/json' })
    },
    ...(body.length === 0 ? {} : { body })
  })
  return { response, assertion }
}

async function fixture() {
  const repository = createMemoryMarketplaceRepository()
  const service = createMarketplaceService({
    repository,
    artifacts: createMemoryMarketplaceArtifactStore(),
    marketplaceId: 'openpencil-marketplace',
    publicBaseUrl: 'https://plugins.example.com/',
    now: () => new Date(NOW)
  })
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  await service.registerPublisher(
    {
      publisher: { id: 'acme', displayName: 'Acme Plugins' },
      key: {
        keyId: 'acme.release',
        publisherId: 'acme',
        publicKeyPem: await exportEd25519PublicKeyPem(pair.publicKey),
        notBefore: '2026-01-01T00:00:00.000Z',
        notAfter: KEY_EXPIRY_THRESHOLD
      }
    },
    { actor: 'admin:fixture', time: BEFORE }
  )
  await service.transitionPublisherKey('acme.release', 'active', {
    actor: 'admin:fixture',
    time: BEFORE
  })
  for (const [keyId, notAfter, revoke] of [
    ['acme.expired', NOW, false],
    ['acme.revoked', '2027-01-01T00:00:00.000Z', true]
  ] as const) {
    const extraPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    await service.registerPublisherKey(
      {
        keyId,
        publisherId: 'acme',
        publicKeyPem: await exportEd25519PublicKeyPem(extraPair.publicKey),
        notBefore: '2026-01-01T00:00:00.000Z',
        notAfter
      },
      { actor: 'admin:fixture', time: BEFORE }
    )
    await service.transitionPublisherKey(keyId, 'active', {
      actor: 'admin:fixture',
      time: BEFORE
    })
    if (revoke) {
      await service.transitionPublisherKey(keyId, 'revoked', {
        actor: 'admin:fixture',
        time: BEFORE,
        reason: 'Fixture revocation'
      })
    }
  }
  const app = createMarketplaceHttpApp({
    service,
    nonces: createMemoryMarketplaceNonceStore(() => Date.parse(NOW)),
    now: () => Date.parse(NOW),
    admin: { enabled: true, token: TOKEN, requireServiceAssertion: true }
  })
  return { app, service }
}

describe('marketplace Phase 7 operator HTTP boundary', () => {
  test('returns an atomic overview with exact risk counts and role-aware audit projection', async () => {
    const { app } = await fixture()
    const reviewer = await operatorRequest(
      app,
      '/admin/operator/overview',
      'operator.overview.read',
      'reviewer',
      { oldMfa: true }
    )
    expect(reviewer.response.status).toBe(200)
    expect(await reviewer.response.json()).toMatchObject({
      schemaVersion: 1,
      source: 'marketplace',
      generatedAt: NOW,
      keyExpiryThresholdAt: KEY_EXPIRY_THRESHOLD,
      pending: { publishers: 1, publisherKeys: 0, ownerships: 0, submissions: 0 },
      risk: {
        suspendedPublishers: 0,
        revokedPublisherKeys: 1,
        expiringPublisherKeys: 1,
        yankedReleases: 0
      },
      auditAccess: 'restricted',
      recentAudit: [],
      auditChain: { status: 'valid', verificationSource: 'marketplace' }
    })

    const security = await operatorRequest(
      app,
      '/admin/operator/overview',
      'operator.overview.read',
      'security_admin',
      { oldMfa: true }
    )
    expect(security.response.status).toBe(200)
    const available = (await security.response.json()) as OperatorOverviewResponse
    expect(available.auditAccess).toBe('available')
    expect(available.recentAudit.length).toBeGreaterThan(0)
  })

  test('persists signed actor/reason/correlation privately while public audit strips plaintext', async () => {
    const { app, service } = await fixture()
    const reason = 'Publisher identity evidence was reviewed and approved'
    const preview = await service.previewImpact({
      operation: 'publisher.status',
      publisherId: 'acme',
      status: 'active',
      reason
    })
    const body = JSON.stringify({ reason, authorityDigest: preview.authorityDigest })
    const approved = await operatorRequest(
      app,
      '/admin/operator/publishers/acme/approve',
      'publisher.approve',
      'reviewer',
      { body }
    )
    expect(approved.response.status).toBe(200)
    const state = await service.snapshot()
    const event = state.auditEvents.at(-1)
    const auditContext = state.auditContexts.at(-1)
    if (!event || !auditContext) throw new Error('Expected contextual audit evidence')
    expect(event.actor).toBe(OPERATOR_ACTOR)
    expect(event.contextDigest).toBe(auditContext.contextDigest)
    expect(auditContext).toMatchObject({ reason })

    const publicAudit = await app.request(`${ORIGIN}/v1/audit`)
    expect(publicAudit.status).toBe(200)
    const publicText = await publicAudit.text()
    expect(publicText).not.toContain(reason)
    expect(publicText).not.toContain(RAW_OPERATOR_ID)
    expect(publicText).not.toContain(auditContext.correlationId as string)
    expect(publicText).toContain(event.contextDigest as string)
    await expect(
      verifyMarketplaceAuditChain((JSON.parse(publicText) as { events: unknown }).events)
    ).resolves.toHaveLength(state.auditEvents.length)

    const privateAudit = await operatorRequest(
      app,
      '/admin/operator/audit?limit=100',
      'operator.audit.read',
      'security_admin',
      { oldMfa: true }
    )
    expect(privateAudit.response.status).toBe(200)
    const privatePage = (await privateAudit.response.json()) as OperatorAuditPageResponse
    expect(privatePage.items.at(-1)).toMatchObject({
      schemaVersion: 1,
      reason,
      correlationId: auditContext.correlationId,
      contextDigest: event.contextDigest,
      chainStatus: 'verified'
    })
  })

  test('denies role overreach, missing step-up, stale MFA, wrong operation, and replay', async () => {
    const { app } = await fixture()
    const impossibleDigest = 'A'.repeat(43)
    const approveBody = JSON.stringify({
      reason: 'Attempted approval',
      authorityDigest: impossibleDigest
    })
    const overreach = await operatorRequest(
      app,
      '/admin/operator/publishers/acme/approve',
      'publisher.approve',
      'releaser',
      { body: approveBody }
    )
    expect(overreach.response.status).toBe(403)

    const suspendBody = JSON.stringify({
      reason: 'Security suspension',
      typedIdentifier: 'publisher:acme',
      authorityDigest: impossibleDigest
    })
    const noStepUp = await operatorRequest(
      app,
      '/admin/operator/publishers/acme/suspend',
      'publisher.suspend',
      'security_admin',
      { body: suspendBody }
    )
    expect(noStepUp.response.status).toBe(403)
    const staleMfa = await operatorRequest(
      app,
      '/admin/operator/publishers/acme/suspend',
      'publisher.suspend',
      'security_admin',
      { body: suspendBody, oldMfa: true, stepUp: true }
    )
    expect(staleMfa.response.status).toBe(403)
    const wrongOperation = await operatorRequest(
      app,
      '/admin/operator/publishers/acme/reject',
      'publisher.approve',
      'reviewer',
      { body: suspendBody }
    )
    expect(wrongOperation.response.status).toBe(403)

    const first = await operatorRequest(
      app,
      '/admin/operator/publishers?limit=1',
      'operator.publishers.read',
      'reviewer',
      { oldMfa: true }
    )
    expect(first.response.status).toBe(200)
    const replay = await operatorRequest(
      app,
      '/admin/operator/publishers?limit=1',
      'operator.publishers.read',
      'reviewer',
      { oldMfa: true, assertion: first.assertion }
    )
    expect(replay.response.status).toBe(401)
  })

  test('keeps unscoped submission presentation routes V2-only with exact read operations', async () => {
    const { app } = await fixture()
    const presentation = await operatorRequest(
      app,
      '/admin/operator/submissions/missing-submission/presentation',
      'operator.submission.presentation.read',
      'reviewer',
      { oldMfa: true }
    )
    expect(presentation.response.status).toBe(404)

    const revisionDiff = await operatorRequest(
      app,
      '/admin/operator/submissions/missing-submission/revision-diff/1/2',
      'operator.submission.revision-diff.read',
      'reviewer',
      { oldMfa: true }
    )
    expect(revisionDiff.response.status).toBe(404)

    const wrongOperation = await operatorRequest(
      app,
      '/admin/operator/submissions/missing-submission/presentation',
      'operator.submission.read',
      'reviewer',
      { oldMfa: true }
    )
    expect(wrongOperation.response.status).toBe(403)

    const v1 = await app.request(
      `${ORIGIN}/admin/operator/submissions/missing-submission/presentation`
    )
    expect(v1.status).toBe(401)
  })

  test('binds approve and reactivate to their exact current publisher states in transaction', async () => {
    const { app, service } = await fixture()
    const pendingReason = 'Attempted pending publisher reactivation'
    const pendingPreview = await service.previewImpact({
      operation: 'publisher.status',
      publisherId: 'acme',
      status: 'active',
      reason: pendingReason
    })
    const auditBeforePending = (await service.snapshot()).auditEvents.length
    const pendingReactivate = await operatorRequest(
      app,
      '/admin/operator/publishers/acme/reactivate',
      'publisher.reactivate',
      'security_admin',
      {
        body: JSON.stringify({
          reason: pendingReason,
          typedIdentifier: 'publisher:acme',
          authorityDigest: pendingPreview.authorityDigest
        }),
        stepUp: true
      }
    )
    expect(pendingReactivate.response.status).toBe(409)
    expect((await service.control.publisher('acme'))?.status).toBe('pending')
    expect((await service.snapshot()).auditEvents).toHaveLength(auditBeforePending)

    const activateReason = 'Fixture approval before suspension'
    const activatePreview = await service.previewImpact({
      operation: 'publisher.status',
      publisherId: 'acme',
      status: 'active',
      reason: activateReason
    })
    await service.transitionPublisher(
      'acme',
      'active',
      { actor: 'admin:fixture', time: NOW, reason: activateReason },
      activatePreview.authorityDigest
    )
    const suspendReason = 'Fixture security suspension'
    const suspendPreview = await service.previewImpact({
      operation: 'publisher.status',
      publisherId: 'acme',
      status: 'suspended',
      reason: suspendReason
    })
    await service.transitionPublisher(
      'acme',
      'suspended',
      { actor: 'admin:fixture', time: NOW, reason: suspendReason },
      suspendPreview.authorityDigest
    )

    const suspendedReason = 'Attempted suspended publisher approval'
    const suspendedPreview = await service.previewImpact({
      operation: 'publisher.status',
      publisherId: 'acme',
      status: 'active',
      reason: suspendedReason
    })
    const auditBeforeSuspended = (await service.snapshot()).auditEvents.length
    const suspendedApprove = await operatorRequest(
      app,
      '/admin/operator/publishers/acme/approve',
      'publisher.approve',
      'reviewer',
      {
        body: JSON.stringify({
          reason: suspendedReason,
          authorityDigest: suspendedPreview.authorityDigest
        })
      }
    )
    expect(suspendedApprove.response.status).toBe(409)
    expect((await service.control.publisher('acme'))?.status).toBe('suspended')
    expect((await service.snapshot()).auditEvents).toHaveLength(auditBeforeSuspended)
  })

  test('checks preview prospective roles and rejects stale authority, typed ID spoof, and online root signing', async () => {
    const { app, service } = await fixture()
    const approval = await service.previewImpact({
      operation: 'publisher.status',
      publisherId: 'acme',
      status: 'active',
      reason: 'Approved fixture publisher'
    })
    await service.transitionPublisher(
      'acme',
      'active',
      { actor: 'admin:fixture', time: BEFORE, reason: 'Approved fixture publisher' },
      approval.authorityDigest
    )
    const previewBody = JSON.stringify({
      operation: 'publisher.status',
      subject: { publisherId: 'acme' },
      target: { status: 'suspended', reason: 'Security investigation' }
    })
    const reviewerPreview = await operatorRequest(
      app,
      '/admin/operator/impact-preview',
      'operator.impact.preview',
      'reviewer',
      { body: previewBody, oldMfa: true }
    )
    expect(reviewerPreview.response.status).toBe(403)
    const securityPreview = await operatorRequest(
      app,
      '/admin/operator/impact-preview',
      'operator.impact.preview',
      'security_admin',
      { body: previewBody, oldMfa: true }
    )
    expect(securityPreview.response.status).toBe(200)
    const preview = (await securityPreview.response.json()) as { authorityDigest: string }

    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    await service.registerPublisher(
      {
        publisher: { id: 'other', displayName: 'Other Publisher' },
        key: {
          keyId: 'other.release',
          publisherId: 'other',
          publicKeyPem: await exportEd25519PublicKeyPem(pair.publicKey),
          notBefore: '2026-01-01T00:00:00.000Z',
          notAfter: '2027-01-01T00:00:00.000Z'
        }
      },
      { actor: 'admin:fixture', time: BEFORE }
    )
    const staleBody = JSON.stringify({
      reason: 'Security investigation',
      typedIdentifier: 'publisher:acme',
      authorityDigest: preview.authorityDigest
    })
    const stale = await operatorRequest(
      app,
      '/admin/operator/publishers/acme/suspend',
      'publisher.suspend',
      'security_admin',
      { body: staleBody, stepUp: true }
    )
    expect(stale.response.status).toBe(409)

    const current = await service.previewImpact({
      operation: 'publisher.status',
      publisherId: 'acme',
      status: 'suspended',
      reason: 'Security investigation'
    })
    const spoofBody = JSON.stringify({
      reason: 'Security investigation',
      typedIdentifier: 'publisher:other',
      authorityDigest: current.authorityDigest,
      actor: 'admin:browser-forged'
    })
    const spoof = await operatorRequest(
      app,
      '/admin/operator/publishers/acme/suspend',
      'publisher.suspend',
      'security_admin',
      { body: spoofBody, stepUp: true }
    )
    expect(spoof.response.status).toBe(400)
    expect((await service.control.publisher('acme'))?.status).toBe('active')

    const publication = await operatorRequest(
      app,
      '/admin/operator/publications/publish',
      'publication.publish',
      'super_admin',
      {
        body: JSON.stringify({
          reason: 'Offline publication rehearsal',
          typedIdentifier: 'publication:global',
          authorityDigest: 'A'.repeat(43)
        }),
        stepUp: true
      }
    )
    expect(publication.response.status).toBe(404)
  })
})
