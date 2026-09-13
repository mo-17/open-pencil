import { describe, expect, test } from 'bun:test'

import {
  BACKEND_OIDC_CALLBACK_PATH,
  digestBackendApplication,
  lowerBackendApplicationSpecV1ToV2,
  parseBackendApplicationSpecV1,
  parseBackendApplicationSpecV2
} from '@open-pencil/lowcode/backend'

import { browserClient } from '../browser-fixtures'
import { httpApplication } from '../fixtures'

describe('public Backend browser login configuration', () => {
  test('round-trips through both application versions and binds public identity to the digest', async () => {
    const application = httpApplication()
    const previous = await digestBackendApplication(application)
    application.httpApi.browserClient = browserClient()
    const before = structuredClone(application)
    const parsed = parseBackendApplicationSpecV1(application)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('Expected valid browser client')
    expect(parsed.value.httpApi?.browserClient?.authentication.scopes).toEqual([
      'openid',
      'profile'
    ])
    expect(application).toEqual(before)
    expect(await digestBackendApplication(application)).not.toBe(previous)
    const lowered = lowerBackendApplicationSpecV1ToV2(application)
    expect(lowered.ok).toBe(true)
    if (!lowered.ok) throw new Error('Expected valid lowered browser client')
    const v2 = parseBackendApplicationSpecV2(lowered.value)
    expect(v2.ok && v2.value.httpApi?.browserClient).toEqual(parsed.value.httpApi?.browserClient)
    application.httpApi.browserClient.authentication.clientId = 'different-public-client'
    expect(await digestBackendApplication(application)).not.toBe(
      await digestBackendApplication(before)
    )
  })

  test('retains exact issuer identity and scope set normalization', async () => {
    const left = httpApplication()
    left.httpApi.browserClient = browserClient()
    left.httpApi.browserClient.authentication.issuer = 'https://identity.example.test/'
    const right = structuredClone(left)
    right.httpApi.browserClient?.authentication.scopes.reverse()
    expect(await digestBackendApplication(left)).toBe(await digestBackendApplication(right))
    const changed = structuredClone(left)
    if (!changed.httpApi.browserClient) throw new Error('Expected browser client')
    changed.httpApi.browserClient.authentication.issuer = 'https://identity.example.test'
    expect(await digestBackendApplication(left)).not.toBe(await digestBackendApplication(changed))
  })

  test.each(['http://127.0.0.1:54321', 'http://[::1]:54321'])(
    'allows explicit local issuer %s',
    (issuer) => {
      const application = httpApplication()
      application.httpApi.browserClient = browserClient()
      application.httpApi.browserClient.authentication.issuer = issuer
      expect(parseBackendApplicationSpecV1(application).ok).toBe(true)
    }
  )

  test.each([
    ['issuer', 'http://identity.example.test'],
    ['issuer', 'http://localhost:1234'],
    ['issuer', 'https://user:password@identity.example.test'],
    ['issuer', 'https://identity.example.test?redirect=elsewhere'],
    ['issuer', 'https://identity.example.test/#fragment'],
    ['issuer', 'https://identity.example.test/../tenant'],
    ['issuer', 'https://IDENTITY.example.test'],
    ['callbackPath', '/callback'],
    ['callbackPath', '//external.example.test'],
    ['clientId', ''],
    ['clientId', 'has whitespace'],
    ['scopes', ['profile']],
    ['scopes', ['openid', 'openid']],
    ['scopes', ['openid', 'offline_access']],
    ['scopes', ['openid', 'profile email']],
    ['resource', 'http://127.0.0.1:3000'],
    ['resource', 'https://api.example.test/#fragment'],
    ['token_endpoint', 'https://elsewhere.example.test/token'],
    ['client_secret', 'not-a-public-configuration-field'],
    ['access_token', 'not-a-public-configuration-field']
  ])('rejects nonportable or private authentication field %s', (key, value) => {
    const client = browserClient()
    const application = httpApplication()
    application.httpApi.browserClient = {
      ...client,
      authentication: { ...client.authentication, [String(key)]: value }
    }
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
  })

  test.each([
    '/',
    '/_openpencil',
    BACKEND_OIDC_CALLBACK_PATH,
    '//api',
    '/api?key=x',
    '/api/../notes'
  ])('rejects API mount %s', (apiBasePath) => {
    const application = httpApplication()
    application.httpApi.browserClient = { ...browserClient(), apiBasePath }
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
  })
})
