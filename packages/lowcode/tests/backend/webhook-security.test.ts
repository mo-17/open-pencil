import { describe, expect, test } from 'bun:test'

import {
  BACKEND_WEBHOOK_ENDPOINT_AUTHORITY_FORMAT,
  BACKEND_WEBHOOK_ENDPOINT_OBSERVATION_FORMAT,
  BACKEND_WEBHOOK_RAW_BODY_SUBJECT_FORMAT,
  BACKEND_WEBHOOK_SECURITY_VERSION,
  canonicalBackendWebhookEndpointAuthorityV1Bytes,
  canonicalBackendWebhookRawBodyHmacBytes,
  digestBackendWebhookEndpointAuthorityV1,
  isPublicBackendWebhookAddress,
  parseBackendWebhookEndpointAuthorityV1,
  parseBackendWebhookRawBodySubjectV1,
  reviewBackendWebhookEndpointObservationV1
} from '#lowcode/backend/webhook-security'

const ENDPOINT_REF = 'credential.00000000-0000-4000-8000-000000000002'
const GENERATION = '11111111-1111-4111-8111-111111111111'
const RAW_BODY_SHA256 = 'ab'.repeat(32)

function observation() {
  return {
    format: BACKEND_WEBHOOK_ENDPOINT_OBSERVATION_FORMAT,
    version: BACKEND_WEBHOOK_SECURITY_VERSION,
    endpointCredentialRef: ENDPOINT_REF,
    credentialGeneration: GENERATION,
    endpoint: 'https://Hooks.Example.com:443/events/%7Eopen-pencil',
    resolvedAddresses: ['2606:4700:4700::1111', '93.184.216.34'],
    redirectCount: 0,
    observedAt: '2026-09-01T00:00:00Z',
    expiresAt: '2026-09-01T00:04:00Z',
    evaluatedAt: '2026-09-01T00:01:00Z'
  }
}

function rawBodySubject() {
  return {
    format: BACKEND_WEBHOOK_RAW_BODY_SUBJECT_FORMAT,
    version: BACKEND_WEBHOOK_SECURITY_VERSION,
    method: 'POST' as const,
    path: '/hooks/open-pencil',
    timestampUnixSeconds: 1_788_220_800,
    idempotencyKey: 'event.delivery-0001',
    rawBodySha256: RAW_BODY_SHA256
  }
}

describe('provider-neutral Backend webhook security contracts', () => {
  test('classifies only bounded public unicast IP addresses', () => {
    for (const address of [
      '8.8.8.8',
      '93.184.216.34',
      '1.1.1.1',
      '2606:4700:4700::1111',
      '2001:4860:4860::8888'
    ]) {
      expect(isPublicBackendWebhookAddress(address)).toBe(true)
    }
    for (const address of [
      '0.0.0.0',
      '10.0.0.1',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.1.1',
      '172.16.0.1',
      '192.168.0.1',
      '192.0.2.1',
      '198.18.0.1',
      '198.51.100.1',
      '203.0.113.1',
      '224.0.0.1',
      '255.255.255.255',
      '::',
      '::1',
      '::ffff:8.8.8.8',
      'fc00::1',
      'fe80::1',
      'ff02::1',
      '2001:db8::1',
      '2002:0808:0808::',
      '3ffe::1',
      '3fff::1'
    ]) {
      expect(isPublicBackendWebhookAddress(address)).toBe(false)
    }
  })

  test('redacts a canonical HTTPS endpoint into deterministic authority digests', async () => {
    const first = await reviewBackendWebhookEndpointObservationV1(observation())
    const second = await reviewBackendWebhookEndpointObservationV1({
      evaluatedAt: '2026-09-01T00:01:00Z',
      expiresAt: '2026-09-01T00:04:00Z',
      observedAt: '2026-09-01T00:00:00Z',
      redirectCount: 0,
      resolvedAddresses: ['93.184.216.34', '2606:4700:4700::1111'],
      endpoint: 'https://hooks.example.com/events/%7Eopen-pencil',
      credentialGeneration: GENERATION,
      endpointCredentialRef: ENDPOINT_REF,
      version: BACKEND_WEBHOOK_SECURITY_VERSION,
      format: BACKEND_WEBHOOK_ENDPOINT_OBSERVATION_FORMAT
    })

    expect(first).toEqual(second)
    expect(Object.isFrozen(first)).toBe(true)
    expect(first.hostResolutionAuthenticated).toBe(false)
    expect(first.networkAuthorityCreated).toBe(false)
    expect(first.redirectPolicy).toBe('reject')
    const serialized = JSON.stringify(first)
    expect(serialized).not.toContain('hooks.example.com')
    expect(serialized).not.toContain('/events/')
    expect(serialized).not.toContain('93.184.216.34')
    expect(serialized).not.toContain('2606:4700')
    expect(serialized).not.toContain(ENDPOINT_REF)
  })

  test('snapshots endpoint data before asynchronous hashing', async () => {
    const candidate = observation()
    const addresses = candidate.resolvedAddresses
    const pending = reviewBackendWebhookEndpointObservationV1(candidate)
    candidate.endpoint = 'https://changed.example.net/hook'
    addresses[0] = '8.8.8.8'

    expect(await pending).toEqual(await reviewBackendWebhookEndpointObservationV1(observation()))
  })

  test('rejects unsupported endpoint and DNS authorities', async () => {
    const invalidEndpoints = [
      'http://hooks.example.com/hook',
      'https://user:password@hooks.example.com/hook',
      'https://hooks.example.com/hook?token=value',
      'https://hooks.example.com/hook#fragment',
      'https://localhost/hook',
      'https://service.internal/hook',
      'https://single-label/hook',
      'https://127.0.0.1/hook',
      'https://2130706433/hook',
      'https://0x7f000001/hook',
      'https://0177.0.0.1/hook',
      'https://[::1]/hook',
      'https://[::ffff:127.0.0.1]/hook',
      'https://[2002:7f00:1::]/hook',
      'https://service.example/hook',
      'https://service.onion/hook',
      'https://hooks.example.com/a/../hook',
      'https://hooks.example.com/a/%2f/b',
      'https://hooks.example.com/a/%252E%252E/b',
      'https://hooks.example.com/a/%09/b',
      'https://hooks.example.com/a/%C0%AF/b',
      'https://hooks.example.com/a/%7e/b',
      'https://hooks.example.com/a/%ZZ/b',
      `https://hooks.example.com/a/${String.fromCharCode(0xd800)}/b`,
      'https://hooks.example.com//hook'
    ]
    for (const endpoint of invalidEndpoints) {
      await expect(
        reviewBackendWebhookEndpointObservationV1({ ...observation(), endpoint })
      ).rejects.toThrow()
    }
    await expect(
      reviewBackendWebhookEndpointObservationV1({
        ...observation(),
        resolvedAddresses: ['10.0.0.1']
      })
    ).rejects.toThrow('public unicast')
    await expect(
      reviewBackendWebhookEndpointObservationV1({
        ...observation(),
        resolvedAddresses: ['8.8.8.8', '8.8.8.8']
      })
    ).rejects.toThrow('duplicate')
    await expect(
      reviewBackendWebhookEndpointObservationV1({ ...observation(), redirectCount: 1 })
    ).rejects.toThrow('redirects')
  })

  test('requires a fresh bounded Host clock observation and literal-address pin', async () => {
    await expect(
      reviewBackendWebhookEndpointObservationV1({
        ...observation(),
        observedAt: '2026-09-01T00:00:00.000000001Z',
        expiresAt: '2026-09-01T00:05:00.000000001Z',
        evaluatedAt: '2026-09-01T00:01:00.000000001Z'
      })
    ).resolves.toMatchObject({
      observedAt: '2026-09-01T00:00:00.000000001Z',
      expiresAt: '2026-09-01T00:05:00.000000001Z'
    })
    await expect(
      reviewBackendWebhookEndpointObservationV1({
        ...observation(),
        evaluatedAt: '2026-08-31T23:59:59Z'
      })
    ).rejects.toThrow('future-dated')
    await expect(
      reviewBackendWebhookEndpointObservationV1({
        ...observation(),
        evaluatedAt: '2026-09-01T00:04:00Z'
      })
    ).rejects.toThrow('expired')
    await expect(
      reviewBackendWebhookEndpointObservationV1({
        ...observation(),
        expiresAt: '2026-09-01T00:05:00.000000001Z'
      })
    ).rejects.toThrow('too long')
    await expect(
      reviewBackendWebhookEndpointObservationV1({
        ...observation(),
        endpoint: 'https://8.8.8.8/hook',
        resolvedAddresses: ['1.1.1.1']
      })
    ).rejects.toThrow('same address')
  })

  test('rejects unknown fields, custom prototypes, and accessors without invoking them', async () => {
    await expect(
      reviewBackendWebhookEndpointObservationV1({ ...observation(), url: 'https://evil.invalid' })
    ).rejects.toThrow('unsupported fields')
    await expect(
      reviewBackendWebhookEndpointObservationV1(
        Object.assign(Object.create({ inherited: true }), observation())
      )
    ).rejects.toThrow('plain data object')

    let getterCalls = 0
    const accessor = observation()
    Object.defineProperty(accessor, 'endpoint', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'https://hooks.example.com/hook'
      }
    })
    await expect(reviewBackendWebhookEndpointObservationV1(accessor)).rejects.toThrow(
      'enumerable data property'
    )
    expect(getterCalls).toBe(0)

    const addressAccessor = observation()
    Object.defineProperty(addressAccessor.resolvedAddresses, '0', {
      enumerable: true,
      get() {
        getterCalls += 1
        return '8.8.8.8'
      }
    })
    await expect(reviewBackendWebhookEndpointObservationV1(addressAccessor)).rejects.toThrow(
      'enumerable data property'
    )
    expect(getterCalls).toBe(0)
  })

  test('strictly parses the redacted subject and pins canonical bytes and digest', async () => {
    const authority = await reviewBackendWebhookEndpointObservationV1(observation())
    expect(parseBackendWebhookEndpointAuthorityV1(authority)).toEqual(authority)
    expect(canonicalBackendWebhookEndpointAuthorityV1Bytes(authority).byteLength).toBeGreaterThan(0)
    expect(await digestBackendWebhookEndpointAuthorityV1(authority)).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(() =>
      parseBackendWebhookEndpointAuthorityV1({ ...authority, endpoint: 'https://hidden.example' })
    ).toThrow('unsupported fields')
    expect(() =>
      parseBackendWebhookEndpointAuthorityV1({
        ...authority,
        hostResolutionAuthenticated: true
      })
    ).toThrow('unsupported runtime authority')
    expect(() =>
      parseBackendWebhookEndpointAuthorityV1({
        ...authority,
        expiresAt: authority.observedAt
      })
    ).toThrow('expire after')
    expect(() =>
      parseBackendWebhookEndpointAuthorityV1({
        ...authority,
        observedAt: '2026-09-01T00:00:00.000000001Z',
        expiresAt: '2026-09-01T00:05:00.000000002Z'
      })
    ).toThrow('too long')
  })

  test('emits the exact raw-body-v1 HMAC subject without accepting a key or header map', () => {
    const subject = rawBodySubject()
    expect(parseBackendWebhookRawBodySubjectV1(subject)).toEqual(subject)
    expect(new TextDecoder().decode(canonicalBackendWebhookRawBodyHmacBytes(subject))).toBe(
      [
        'raw-body-v1',
        'POST',
        '/hooks/open-pencil',
        '1788220800',
        'event.delivery-0001',
        RAW_BODY_SHA256
      ].join('\n')
    )
    expect(() =>
      canonicalBackendWebhookRawBodyHmacBytes({ ...subject, secret: 'not-accepted' })
    ).toThrow('unsupported fields')
    expect(() => canonicalBackendWebhookRawBodyHmacBytes({ ...subject, method: 'GET' })).toThrow(
      'not supported'
    )
    expect(() => canonicalBackendWebhookRawBodyHmacBytes({ ...subject, path: '/a/../b' })).toThrow(
      'path'
    )
    for (const path of ['/a?b', '/a/%252E%252E/b', '/a/%09/b', '/a/%C0%AF/b', '/a/%7e/b']) {
      expect(() => canonicalBackendWebhookRawBodyHmacBytes({ ...subject, path })).toThrow('path')
    }
    expect(() =>
      canonicalBackendWebhookRawBodyHmacBytes({ ...subject, rawBodySha256: 'AB'.repeat(32) })
    ).toThrow('lowercase')
    expect(() =>
      canonicalBackendWebhookRawBodyHmacBytes({ ...subject, timestampUnixSeconds: -0 })
    ).toThrow('bounded')
  })

  test('does not confuse a parsed subject with authenticated crypto or network authority', async () => {
    const authority = await reviewBackendWebhookEndpointObservationV1(observation())
    expect(authority.format).toBe(BACKEND_WEBHOOK_ENDPOINT_AUTHORITY_FORMAT)
    expect('signatureVerified' in authority).toBe(false)
    expect('credentialValue' in authority).toBe(false)
    expect('endpoint' in authority).toBe(false)
    expect('resolvedAddresses' in authority).toBe(false)
  })
})
