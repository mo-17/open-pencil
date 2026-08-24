import { describe, expect, test } from 'bun:test'
import { createHash, createHmac } from 'node:crypto'

import {
  assertMarketplaceOperatorAuthorization,
  assertMarketplaceOperatorImpactPreviewAuthorization,
  createMemoryMarketplaceNonceStore,
  signMarketplaceOperatorAssertion,
  verifyMarketplaceAdminAssertion,
  type MarketplaceOperatorAuthorizationV2,
  type MarketplaceOperatorOperation
} from '@open-pencil/marketplace'

const NOW = '2026-08-22T08:00:00.000Z'
const OLD_MFA = '2026-08-21T08:00:00.000Z'
const FRESH_MFA = '2026-08-22T07:55:00.000Z'
const FRESH_STEP_UP = '2026-08-22T07:59:00.000Z'
const TOKEN = 'phase7-operator-token-that-never-leaves-the-server'
const ORIGIN = 'http://127.0.0.1:43121'
const BODY = new TextEncoder().encode('{"reason":"reviewed","authorityDigest":"digest"}')
const GRANT_DIGEST = createHash('sha256').update('grant-01j5phase7operator').digest('base64url')
const RAW_OPERATOR_ID = 'user-01j5operator'
const OPERATOR_ACTOR = `portal:${createHash('sha256').update(RAW_OPERATOR_ID).digest('base64url')}`

function authorization(
  operation: MarketplaceOperatorOperation,
  overrides: Partial<MarketplaceOperatorAuthorizationV2> = {}
): MarketplaceOperatorAuthorizationV2 {
  return {
    realm: 'platform',
    role: 'reviewer',
    operation,
    mfaVerifiedAt: FRESH_MFA,
    stepUp: null,
    ...overrides
  }
}

function assertionInput(
  nonce: string,
  authorizationValue: MarketplaceOperatorAuthorizationV2,
  overrides: Partial<Parameters<typeof signMarketplaceOperatorAssertion>[0]> = {}
) {
  return {
    actor: OPERATOR_ACTOR,
    requestId: 'request_01j5phase7operator',
    correlationId: 'correlation_01j5phase7operator',
    authorization: authorizationValue,
    method: 'POST',
    url: `${ORIGIN}/admin/operator/publishers/acme/approve`,
    timestamp: NOW,
    nonce,
    body: BODY,
    ...overrides
  }
}

describe('marketplace Phase 7 V2 operator assertion', () => {
  test('binds the exact canonical authorization envelope and uses the V2 MAC domain', async () => {
    const auth = authorization('publisher.approve')
    const input = assertionInput('phase7operatornonce0001', auth)
    const assertion = signMarketplaceOperatorAssertion(input, TOKEN)
    const [version, payload, signature] = assertion.split('.')

    expect(version).toBe('v2')
    expect(signature).toBe(
      createHmac('sha256', TOKEN)
        .update(`OPENPENCIL-MARKETPLACE-ADMIN-ASSERTION-V2\n${payload}`)
        .digest('base64url')
    )
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))).toEqual({
      version: 2,
      audience: 'openpencil-marketplace-admin',
      actor: input.actor,
      requestId: input.requestId,
      correlationId: input.correlationId,
      authorization: auth,
      method: 'POST',
      target: '/admin/operator/publishers/acme/approve',
      timestamp: NOW,
      nonce: input.nonce,
      bodyDigest: createHash('sha256').update(BODY).digest('base64url')
    })

    await expect(
      verifyMarketplaceAdminAssertion(
        { assertion, method: input.method, url: input.url, body: BODY },
        {
          token: TOKEN,
          nonces: createMemoryMarketplaceNonceStore(() => Date.parse(NOW)),
          now: () => Date.parse(NOW)
        }
      )
    ).resolves.toEqual({
      actor: input.actor,
      requestId: input.requestId,
      correlationId: input.correlationId,
      expiresAt: Date.parse(NOW) + 60_000,
      authorization: auth,
      assertionTimestamp: NOW
    })
  })

  test('uses a separate replay namespace and consumes each V2 nonce once', async () => {
    const input = assertionInput(
      'phase7operatornonce0002',
      authorization('operator.publishers.read', { mfaVerifiedAt: OLD_MFA }),
      { method: 'GET', url: `${ORIGIN}/admin/operator/publishers`, body: new Uint8Array() }
    )
    const assertion = signMarketplaceOperatorAssertion(input, TOKEN)
    const nonces = createMemoryMarketplaceNonceStore(() => Date.parse(NOW))
    const verify = () =>
      verifyMarketplaceAdminAssertion(
        { assertion, method: input.method, url: input.url, body: input.body },
        { token: TOKEN, nonces, now: () => Date.parse(NOW) }
      )

    await expect(verify()).resolves.toMatchObject({ authorization: input.authorization })
    await expect(verify()).rejects.toThrow(/nonce/i)
  })

  test('requires a fixed SHA-256 actor pseudonym and canonical nested authorization fields', () => {
    expect(() =>
      signMarketplaceOperatorAssertion(
        assertionInput('phase7operatornonce0003', authorization('publisher.approve'), {
          actor: `portal:${RAW_OPERATOR_ID}`
        }),
        TOKEN
      )
    ).toThrow(/pseudonym/i)
    expect(OPERATOR_ACTOR).toMatch(/^portal:[A-Za-z0-9_-]{43}$/)
    expect(OPERATOR_ACTOR).not.toContain(RAW_OPERATOR_ID)
    expect(() =>
      signMarketplaceOperatorAssertion(
        assertionInput('phase7operatornonce0004', {
          role: 'reviewer',
          realm: 'platform',
          operation: 'publisher.approve',
          mfaVerifiedAt: FRESH_MFA,
          stepUp: null
        } as MarketplaceOperatorAuthorizationV2),
        TOKEN
      )
    ).toThrow(/canonical/i)
  })
})

describe('marketplace Phase 7 exact operator policy', () => {
  const check = { assertionTimestamp: NOW, now: Date.parse(NOW) }

  test('accepts an old active-session MFA proof for reads but not mutations', () => {
    expect(
      assertMarketplaceOperatorAuthorization(
        authorization('operator.publishers.read', { mfaVerifiedAt: OLD_MFA }),
        'operator.publishers.read',
        check
      )
    ).toMatchObject({ role: 'reviewer' })
    expect(() =>
      assertMarketplaceOperatorAuthorization(
        authorization('publisher.approve', { mfaVerifiedAt: OLD_MFA }),
        'publisher.approve',
        check
      )
    ).toThrow(/freshness/i)
  })

  test('fails closed for role overreach, wrong operation, and audit overreach', () => {
    expect(() =>
      assertMarketplaceOperatorAuthorization(
        authorization('release.publish'),
        'release.publish',
        check
      )
    ).toThrow(/role/i)
    expect(() =>
      assertMarketplaceOperatorAuthorization(
        authorization('publisher.approve'),
        'publisher.reject',
        check
      )
    ).toThrow(/route/i)
    expect(() =>
      assertMarketplaceOperatorAuthorization(
        authorization('operator.audit.read'),
        'operator.audit.read',
        check
      )
    ).toThrow(/role/i)
  })

  test('requires fresh step-up for reject and rejects surplus step-up for approve', () => {
    expect(() =>
      assertMarketplaceOperatorAuthorization(
        authorization('publisher.reject'),
        'publisher.reject',
        check
      )
    ).toThrow(/step-up is required/i)
    expect(
      assertMarketplaceOperatorAuthorization(
        authorization('publisher.reject', {
          stepUp: { verifiedAt: FRESH_STEP_UP, grantIdDigest: GRANT_DIGEST }
        }),
        'publisher.reject',
        check
      )
    ).toMatchObject({ operation: 'publisher.reject' })
    expect(() =>
      assertMarketplaceOperatorAuthorization(
        authorization('publisher.approve', {
          stepUp: { verifiedAt: FRESH_STEP_UP, grantIdDigest: GRANT_DIGEST }
        }),
        'publisher.approve',
        check
      )
    ).toThrow(/not accepted/i)
    expect(() =>
      assertMarketplaceOperatorAuthorization(
        authorization('publisher.reject', {
          stepUp: {
            verifiedAt: '2026-08-22T07:57:59.999Z',
            grantIdDigest: GRANT_DIGEST
          }
        }),
        'publisher.reject',
        check
      )
    ).toThrow(/freshness/i)
  })

  test('rejects future MFA, future assertion, and super-admin publication without step-up', () => {
    expect(() =>
      assertMarketplaceOperatorAuthorization(
        authorization('publisher.approve', { mfaVerifiedAt: '2026-08-22T08:00:00.001Z' }),
        'publisher.approve',
        check
      )
    ).toThrow(/later/i)
    expect(() =>
      assertMarketplaceOperatorAuthorization(
        authorization('operator.publishers.read'),
        'operator.publishers.read',
        { assertionTimestamp: '2026-08-22T08:00:00.001Z', now: Date.parse(NOW) }
      )
    ).toThrow(/future/i)
    expect(() =>
      assertMarketplaceOperatorAuthorization(
        authorization('publication.publish', { role: 'super_admin' }),
        'publication.publish',
        check
      )
    ).toThrow(/step-up/i)
  })

  test('preview checks the prospective action role but never accepts step-up', () => {
    expect(
      assertMarketplaceOperatorImpactPreviewAuthorization(
        authorization('operator.impact.preview', { mfaVerifiedAt: OLD_MFA }),
        'publisher.approve',
        check
      )
    ).toMatchObject({ operation: 'operator.impact.preview' })
    expect(() =>
      assertMarketplaceOperatorImpactPreviewAuthorization(
        authorization('operator.impact.preview'),
        'release.publish',
        check
      )
    ).toThrow(/cannot preview/i)
  })
})
