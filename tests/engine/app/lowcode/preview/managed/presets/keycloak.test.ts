import { describe, expect, test } from 'bun:test'

import { buildManagedKeycloakClientConfiguration } from '@/app/lowcode/preview-pane/managed-backend/presets'

import { EMPTY_PRESET_DRAFT, presetAuthentication } from './helpers'

describe('managed preview public Keycloak client material', () => {
  test('builds an exact browser PKCE client for the current document and selected audience', () => {
    const authentication = presetAuthentication({ clientId: 'my-preview-client' })
    const result = buildManagedKeycloakClientConfiguration(authentication, {
      audience: 'notes-audience',
      jwksURL: 'https://127.0.0.1:18443/realms/openpencil/protocol/openid-connect/certs',
      caFile: '/private/user-selected-file.crt'
    })
    expect(result).toMatchObject({
      clientId: 'my-preview-client',
      publicClient: true,
      standardFlowEnabled: true,
      implicitFlowEnabled: false,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: false,
      redirectUris: ['http://127.0.0.1:5181/_openpencil/auth/callback'],
      webOrigins: ['http://127.0.0.1:5181'],
      attributes: { 'pkce.code.challenge.method': 'S256' },
      defaultClientScopes: ['basic', 'profile', 'email'],
      optionalClientScopes: []
    })
    expect(result?.protocolMappers).toEqual([
      {
        name: 'openpencil-preview-audience',
        protocol: 'openid-connect',
        protocolMapper: 'oidc-audience-mapper',
        config: {
          'included.custom.audience': 'notes-audience',
          'access.token.claim': 'true',
          'id.token.claim': 'false'
        }
      }
    ])
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('password')
    expect(serialized).not.toContain('/private/')
    expect(serialized).not.toContain('*')
    expect(authentication.clientId).toBe('my-preview-client')
  })

  test('keeps the basic subject scope without enabling unrelated browser scopes', () => {
    const result = buildManagedKeycloakClientConfiguration(
      presetAuthentication({
        scopes: ['openid'],
        issuer: 'https://login.example.test/realms/team'
      }),
      { ...EMPTY_PRESET_DRAFT, audience: 'https://api.example.test/notes' }
    )
    expect(result?.defaultClientScopes).toEqual(['basic'])
    expect(result?.optionalClientScopes).toEqual([])
  })

  test('refuses a non-Keycloak issuer, absent document identity or missing API audience', () => {
    const draft = { ...EMPTY_PRESET_DRAFT, audience: 'notes' }
    expect(buildManagedKeycloakClientConfiguration(null, draft)).toBeNull()
    expect(
      buildManagedKeycloakClientConfiguration(
        presetAuthentication({ issuer: 'https://oidc.example.test/tenant' }),
        draft
      )
    ).toBeNull()
    expect(
      buildManagedKeycloakClientConfiguration(presetAuthentication(), EMPTY_PRESET_DRAFT)
    ).toBeNull()
    expect(
      buildManagedKeycloakClientConfiguration(presetAuthentication({ clientId: '' }), draft)
    ).toBeNull()
  })
})
