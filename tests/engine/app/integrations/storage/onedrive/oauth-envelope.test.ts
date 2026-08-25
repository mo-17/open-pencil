import { describe, expect, test } from 'bun:test'

import {
  canonicalizeOneDriveOAuthScopes,
  ONEDRIVE_OAUTH_SCOPES,
  parseOneDriveOAuthPublicMetadata,
  parseOneDriveRefreshTokenEnvelope,
  parseOneDriveRefreshTokenEnvelopeJSON,
  serializeOneDriveRefreshTokenEnvelope
} from '@/app/integrations/storage/onedrive/oauth/envelope'
import { LocalOneDriveOAuthMetadataStore } from '@/app/integrations/storage/onedrive/oauth/metadata'

const CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const VERSION = 'a'.repeat(32)

function envelope(refreshToken = 'refresh-token-a') {
  return {
    schemaVersion: 1,
    refreshToken,
    clientId: CLIENT_ID,
    authorizationVersion: VERSION,
    subject: 'microsoft-subject-a'
  } as const
}

function metadata() {
  return {
    schemaVersion: 1,
    profileId: 'default',
    subject: 'microsoft-subject-a',
    email: 'person@example.com',
    authorizationVersion: VERSION,
    grantedScopes: ONEDRIVE_OAUTH_SCOPES
  } as const
}

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key) {
      return values.get(key) ?? null
    },
    key(index) {
      return [...values.keys()][index] ?? null
    },
    removeItem(key) {
      values.delete(key)
    },
    setItem(key, value) {
      values.set(key, value)
    }
  }
}

describe('OneDrive OAuth authorization envelope', () => {
  test('accepts only an exact public-client refresh-token record', () => {
    expect(parseOneDriveRefreshTokenEnvelope(envelope())).toEqual(envelope())
    expect(
      parseOneDriveRefreshTokenEnvelopeJSON(
        serializeOneDriveRefreshTokenEnvelope(parseOneDriveRefreshTokenEnvelope(envelope()))
      )
    ).toEqual(envelope())

    for (const unexpected of [
      { clientSecret: 'must-never-exist' },
      { accessToken: 'must-stay-in-memory' },
      { tenant: 'common' },
      { scopes: ONEDRIVE_OAUTH_SCOPES }
    ]) {
      expect(() => parseOneDriveRefreshTokenEnvelope({ ...envelope(), ...unexpected })).toThrow(
        'Stored OneDrive authorization is invalid'
      )
    }
  })

  test('bounds and validates client IDs, refresh tokens, and grant identity', () => {
    for (const invalid of [
      { ...envelope(), clientId: 'not-a-microsoft-client-id' },
      { ...envelope(), refreshToken: 'refresh token' },
      { ...envelope(), refreshToken: 'r'.repeat(12 * 1024 + 1) },
      { ...envelope(), authorizationVersion: 'not-a-grant' },
      { ...envelope(), subject: 'subject\nvalue' }
    ]) {
      expect(() => parseOneDriveRefreshTokenEnvelope(invalid)).toThrow(
        'Stored OneDrive authorization is invalid'
      )
    }
  })

  test('canonicalizes the Graph permission URI but keeps public metadata canonical', () => {
    const graphScopes = [
      'openid',
      'profile',
      'email',
      'offline_access',
      'https://graph.microsoft.com/Files.ReadWrite.AppFolder'
    ]
    expect(canonicalizeOneDriveOAuthScopes(graphScopes)).toEqual(ONEDRIVE_OAUTH_SCOPES)
    expect(canonicalizeOneDriveOAuthScopes([...graphScopes, 'User.Read'])).toBeNull()
    expect(canonicalizeOneDriveOAuthScopes(graphScopes.slice(1))).toBeNull()

    expect(parseOneDriveOAuthPublicMetadata(metadata())).toEqual(metadata())
    expect(() =>
      parseOneDriveOAuthPublicMetadata({ ...metadata(), grantedScopes: graphScopes })
    ).toThrow('Stored OneDrive account metadata is invalid')
  })

  test('stores only bounded non-secret account metadata outside the credential vault', async () => {
    const storage = memoryStorage()
    const store = new LocalOneDriveOAuthMetadataStore(storage)
    await store.write(metadata())

    const serialized = storage.getItem('open-pencil:onedrive-oauth:v1:default')
    expect(serialized).not.toBeNull()
    expect(serialized).toContain('microsoft-subject-a')
    expect(serialized).not.toContain('refresh-token')
    expect(serialized).not.toContain('accessToken')
    await expect(store.read('default')).resolves.toEqual(metadata())
  })
})
