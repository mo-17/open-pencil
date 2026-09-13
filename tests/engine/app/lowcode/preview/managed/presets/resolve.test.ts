import { describe, expect, test } from 'bun:test'

import {
  MANAGED_BACKEND_PRESET_IDS,
  resolveManagedBackendPreset
} from '@/app/lowcode/preview-pane/managed-backend/presets'

import { EMPTY_PRESET_DRAFT, presetAuthentication } from './helpers'

describe('managed backend preset suggestions', () => {
  test('local setup supplies its reviewed settings while requiring an explicit CA selection', () => {
    const authentication = Object.freeze(presetAuthentication())
    const result = resolveManagedBackendPreset({
      presetId: 'local-keycloak',
      authentication,
      draft: EMPTY_PRESET_DRAFT
    })
    expect(result.applicable).toBe(true)
    expect(result.patch).toEqual({
      audience: 'openpencil-notes-api',
      jwksURL: 'https://127.0.0.1:18443/realms/openpencil/protocol/openid-connect/certs'
    })
    expect(result.missing).toEqual(['caFile'])
    expect(result.ready).toBe(false)
    expect(result.patch).not.toHaveProperty('caFile')
    expect(EMPTY_PRESET_DRAFT).toEqual({ audience: '', jwksURL: '', caFile: '' })
    expect(authentication.clientId).toBe('notes-public-client')
  })

  test('HTTPS Keycloak derives its own realm endpoint and retains the document resource', () => {
    const result = resolveManagedBackendPreset({
      presetId: 'https-keycloak',
      authentication: presetAuthentication({
        issuer: 'https://login.example.test/auth/realms/team-1',
        resource: 'https://api.example.test/notes'
      }),
      draft: EMPTY_PRESET_DRAFT
    })
    expect(result.patch).toEqual({
      audience: 'https://api.example.test/notes',
      jwksURL: 'https://login.example.test/auth/realms/team-1/protocol/openid-connect/certs'
    })
    expect(result.ready).toBe(true)
    expect(result.missing).toEqual([])
  })

  test('a generic OIDC issuer never implies a guessed JWKS or client ID audience', () => {
    const authentication = presetAuthentication({ issuer: 'https://identity.example.test' })
    const withoutResource = resolveManagedBackendPreset({
      presetId: 'oidc',
      authentication,
      draft: EMPTY_PRESET_DRAFT
    })
    expect(withoutResource.patch).toEqual({})
    expect(withoutResource.missing).toEqual(['audience', 'jwksURL'])
    const withResource = resolveManagedBackendPreset({
      presetId: 'oidc',
      authentication: { ...authentication, resource: 'https://api.example.test/notes' },
      draft: EMPTY_PRESET_DRAFT
    })
    expect(withResource.patch).toEqual({ audience: 'https://api.example.test/notes' })
    expect(withResource.missing).toEqual(['jwksURL'])
  })

  test.each(MANAGED_BACKEND_PRESET_IDS)('%s preserves every already entered field', (presetId) => {
    const draft = Object.freeze({
      audience: 'my-api',
      jwksURL: 'https://jwks.example.test/keys',
      caFile: '/operator/selected-ca.pem'
    })
    const authentication = presetAuthentication({
      ...(presetId === 'https-keycloak'
        ? { issuer: 'https://identity.example.test/realms/team' }
        : {}),
      resource: 'https://different.example.test/notes'
    })
    const result = resolveManagedBackendPreset({ presetId, authentication, draft })
    expect(result.patch).toEqual({})
    expect(result.ready).toBe(true)
    expect(result.issues).toEqual([])
    expect(draft.audience).toBe('my-api')
  })

  test.each([
    'https://identity.example.test/tenant',
    'https://identity.example.test/realms/team/',
    'http://127.0.0.1:18080/realms/team',
    'https://identity.example.test/realms/team?other=realm',
    'https://operator:password@identity.example.test/realms/team'
  ])('does not derive Keycloak endpoints from %s', (issuer) => {
    const result = resolveManagedBackendPreset({
      presetId: 'https-keycloak',
      authentication: presetAuthentication({ issuer }),
      draft: EMPTY_PRESET_DRAFT
    })
    expect(result.applicable).toBe(false)
    expect(result.patch).toEqual({})
    expect(result.ready).toBe(false)
  })

  test('local preset refuses a different document identity without rebinding it', () => {
    const result = resolveManagedBackendPreset({
      presetId: 'local-keycloak',
      authentication: presetAuthentication({ issuer: 'https://elsewhere.example.test' }),
      draft: EMPTY_PRESET_DRAFT
    })
    expect(result.applicable).toBe(false)
    expect(result.patch).toEqual({})
    expect(result.issues).toContain('local-keycloak-issuer-required')
  })

  test('missing document login prevents applying even fully entered settings', () => {
    const result = resolveManagedBackendPreset({
      presetId: 'oidc',
      authentication: null,
      draft: { audience: 'notes', jwksURL: 'https://issuer.example.test/jwks', caFile: '' }
    })
    expect(result.applicable).toBe(false)
    expect(result.missing).toEqual(['authentication'])
    expect(result.issues).toContain('document-authentication-required')
    expect(result.ready).toBe(false)
  })

  test.each([
    'http://127.0.0.1:18080/certs',
    'https://issuer.example.test/certs?token=private',
    'https://issuer.example.test/certs#key',
    'https://user:password@issuer.example.test/certs',
    'https://issuer.example.test/a/../certs'
  ])('reports invalid custom JWKS without replacing it: %s', (jwksURL) => {
    const result = resolveManagedBackendPreset({
      presetId: 'local-keycloak',
      authentication: presetAuthentication(),
      draft: { audience: 'notes', jwksURL, caFile: '/selected/ca.crt' }
    })
    expect(result.patch).not.toHaveProperty('jwksURL')
    expect(result.issues).toEqual(['invalid-jwks-url'])
    expect(result.ready).toBe(false)
  })

  test('reports invalid audience and relative CA paths before preparing a backend', () => {
    const result = resolveManagedBackendPreset({
      presetId: 'oidc',
      authentication: presetAuthentication(),
      draft: {
        audience: 'notes\napi',
        jwksURL: 'https://issuer.example.test/certs',
        caFile: '~/private/ca.pem'
      }
    })
    expect(result.issues).toEqual(['invalid-audience', 'invalid-ca-path'])
    expect(result.ready).toBe(false)
  })
})
