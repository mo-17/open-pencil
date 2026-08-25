import { describe, expect, test } from 'bun:test'

import {
  AliyunDriveOAuthCredentialsError,
  parseAliyunDriveOAuthCredentials,
  parseAliyunDriveOAuthCredentialsJSON
} from '@/app/integrations/storage/aliyun-drive/oauth/credentials'
import {
  aliyunDriveOAuthClientPublic,
  parseAliyunDriveAuthorizationEnvelope,
  parseAliyunDriveAuthorizationEnvelopeJSON,
  parseAliyunDriveOAuthPublicMetadata,
  serializeAliyunDriveAuthorizationEnvelope
} from '@/app/integrations/storage/aliyun-drive/oauth/envelope'

const REDIRECT_URI = 'http://127.0.0.1:43127/oauth/aliyun-drive/callback'
const AUTHORIZATION_VERSION = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

describe('Aliyun Drive OAuth credentials parser', () => {
  test('accepts only the two self-hosted schemas', () => {
    expect(
      parseAliyunDriveOAuthCredentials({
        mode: 'self-hosted-confidential',
        client_id: 'aliyun-client-123',
        client_secret: 'secret-value-123',
        redirect_uri: REDIRECT_URI
      })
    ).toEqual({
      mode: 'self-hosted-confidential',
      clientId: 'aliyun-client-123',
      clientSecret: 'secret-value-123',
      redirectUri: REDIRECT_URI
    })
    expect(
      parseAliyunDriveOAuthCredentialsJSON(
        JSON.stringify({
          mode: 'self-hosted-public',
          client_id: 'aliyun-client-456',
          redirect_uri: REDIRECT_URI
        })
      )
    ).toEqual({
      mode: 'self-hosted-public',
      clientId: 'aliyun-client-456',
      redirectUri: REDIRECT_URI
    })
  })

  test('rejects endpoints, scopes, tokens, unknown fields, and cross-mode secrets', () => {
    const base = {
      mode: 'self-hosted-public',
      client_id: 'aliyun-client-456',
      redirect_uri: REDIRECT_URI
    }
    for (const extra of [
      { token_endpoint: 'https://evil.example/token' },
      { authorization_endpoint: 'https://evil.example/authorize' },
      { scope: 'file:all' },
      { access_token: 'token' },
      { client_secret: 'must-not-be-accepted' },
      { extra: true }
    ]) {
      expect(() => parseAliyunDriveOAuthCredentials({ ...base, ...extra })).toThrow(
        AliyunDriveOAuthCredentialsError
      )
    }
    expect(() =>
      parseAliyunDriveOAuthCredentials({
        ...base,
        mode: 'publisher-broker-confidential'
      })
    ).toThrow(AliyunDriveOAuthCredentialsError)
  })

  test('requires a fixed registered 127.0.0.1 port and non-root callback path', () => {
    for (const redirect_uri of [
      'http://localhost:43127/oauth/aliyun-drive/callback',
      'http://127.0.0.1/oauth/aliyun-drive/callback',
      'http://127.0.0.1:43127/',
      'https://127.0.0.1:43127/oauth/aliyun-drive/callback'
    ]) {
      expect(() =>
        parseAliyunDriveOAuthCredentials({
          mode: 'self-hosted-public',
          client_id: 'aliyun-client-456',
          redirect_uri
        })
      ).toThrow(AliyunDriveOAuthCredentialsError)
    }
  })
})

describe('Aliyun Drive OAuth encrypted envelope and public metadata', () => {
  test('round-trips refresh and access grants with strict mode compatibility', () => {
    const confidential = {
      mode: 'self-hosted-confidential' as const,
      clientId: 'aliyun-client-123',
      clientSecret: 'secret-value-123',
      redirectUri: REDIRECT_URI
    }
    const refresh = parseAliyunDriveAuthorizationEnvelope({
      schemaVersion: 1,
      grantType: 'refresh-grant',
      subject: 'user-1',
      authorizationVersion: AUTHORIZATION_VERSION,
      oauthClient: confidential,
      refreshToken: 'refresh-1',
      accessToken: 'access-1',
      accessExpiresAt: 2_000_000_000_000
    })
    expect(
      parseAliyunDriveAuthorizationEnvelopeJSON(
        serializeAliyunDriveAuthorizationEnvelope(refresh)
      )
    ).toEqual(refresh)

    const publicClient = {
      mode: 'self-hosted-public' as const,
      clientId: 'aliyun-client-456',
      redirectUri: REDIRECT_URI
    }
    expect(
      parseAliyunDriveAuthorizationEnvelope({
        schemaVersion: 1,
        grantType: 'access-grant',
        subject: 'user-2',
        authorizationVersion: AUTHORIZATION_VERSION,
        oauthClient: publicClient,
        accessToken: 'access-2',
        accessExpiresAt: 2_000_000_000_000
      }).grantType
    ).toBe('access-grant')
    expect(() =>
      parseAliyunDriveAuthorizationEnvelope({
        ...refresh,
        grantType: 'access-grant'
      })
    ).toThrow(TypeError)
  })

  test('public metadata contains no secret, token, endpoint, redirect, or scope', () => {
    const client = {
      mode: 'self-hosted-confidential' as const,
      clientId: 'aliyun-client-123',
      clientSecret: 'secret-value-123',
      redirectUri: REDIRECT_URI
    }
    const metadata = parseAliyunDriveOAuthPublicMetadata({
      schemaVersion: 1,
      profileId: 'default',
      subject: 'user-1',
      email: 'person@example.com',
      authorizationVersion: AUTHORIZATION_VERSION,
      oauthClient: aliyunDriveOAuthClientPublic(client),
      grantType: 'refresh-grant'
    })
    const serialized = JSON.stringify(metadata)

    expect(metadata.oauthClient).toEqual({
      mode: 'self-hosted-confidential',
      clientId: 'aliyun-client-123'
    })
    for (const forbidden of [
      'secret-value-123',
      'clientSecret',
      'accessToken',
      'refreshToken',
      'redirectUri',
      'brokerOrigin',
      'scope',
      'endpoint'
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  test('rejects unknown envelope and metadata fields', () => {
    expect(() =>
      parseAliyunDriveAuthorizationEnvelope({
        schemaVersion: 1,
        grantType: 'access-grant',
        subject: 'user-1',
        authorizationVersion: AUTHORIZATION_VERSION,
        oauthClient: {
          mode: 'self-hosted-public',
          clientId: 'aliyun-client-456',
          redirectUri: REDIRECT_URI
        },
        accessToken: 'access',
        accessExpiresAt: 2_000_000_000_000,
        tokenEndpoint: 'https://evil.example'
      })
    ).toThrow(TypeError)
    expect(() =>
      parseAliyunDriveOAuthPublicMetadata({
        schemaVersion: 1,
        profileId: 'default',
        subject: 'user-1',
        authorizationVersion: AUTHORIZATION_VERSION,
        oauthClient: { mode: 'self-hosted-public', clientId: 'aliyun-client-456' },
        grantType: 'access-grant',
        accessExpiresAt: 2_000_000_000_000,
        scopes: ['file:all:write']
      })
    ).toThrow(TypeError)
  })
})
