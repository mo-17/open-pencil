import { describe, expect, test } from 'bun:test'

import {
  GOOGLE_DRIVE_OAUTH_SCOPES,
  googleDriveOAuthClientPublic,
  googleDriveOAuthPublicClientsEqual,
  parseGoogleDriveOAuthClient,
  parseGoogleDriveOAuthPublicMetadata,
  parseGoogleDriveRefreshTokenEnvelope,
  parseGoogleDriveRefreshTokenEnvelopeJSON,
  serializeGoogleDriveRefreshTokenEnvelope,
  type GoogleDriveOAuthPublicMetadataV2,
  type GoogleDriveRefreshTokenEnvelopeV2
} from '@/app/integrations/storage/google-drive/oauth/envelope'
import { LocalGoogleDriveOAuthMetadataStore } from '@/app/integrations/storage/google-drive/oauth/metadata'

const CLIENT_ID = '1234567890-openpencil.apps.googleusercontent.com'
const VERSION = 'a'.repeat(32)

function v1(refreshToken = 'legacy-refresh-token') {
  return {
    schemaVersion: 1,
    refreshToken,
    authorizationVersion: VERSION,
    subject: 'google-subject'
  } as const
}

function v2(
  oauthClient: GoogleDriveRefreshTokenEnvelopeV2['oauthClient'] = {
    mode: 'publisher-broker',
    clientId: CLIENT_ID
  },
  refreshToken = 'current-refresh-token'
): GoogleDriveRefreshTokenEnvelopeV2 {
  return {
    schemaVersion: 2,
    refreshToken,
    authorizationVersion: VERSION,
    subject: 'google-subject',
    oauthClient
  }
}

function metadataV2(
  oauthClient: GoogleDriveOAuthPublicMetadataV2['oauthClient'] = {
    mode: 'publisher-broker',
    clientId: CLIENT_ID
  }
): GoogleDriveOAuthPublicMetadataV2 {
  return {
    schemaVersion: 2,
    profileId: 'default',
    subject: 'google-subject',
    email: 'person@example.com',
    authorizationVersion: VERSION,
    grantedScopes: GOOGLE_DRIVE_OAUTH_SCOPES,
    oauthClient
  }
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

describe('Google Drive OAuth authorization envelopes', () => {
  test('keeps schema v1 exact and publisher-legacy only', () => {
    expect(parseGoogleDriveRefreshTokenEnvelope(v1())).toEqual(v1())
    expect(() =>
      parseGoogleDriveRefreshTokenEnvelope({
        ...v1(),
        oauthClient: { mode: 'publisher-broker', clientId: CLIENT_ID }
      })
    ).toThrow('Stored Google Drive authorization is invalid')
  })

  test('binds schema v2 to an exact publisher or self-hosted OAuth client', () => {
    const publisher = parseGoogleDriveRefreshTokenEnvelope(v2())
    expect(publisher).toEqual(v2())

    const selfHosted = v2({
      mode: 'self-hosted-desktop',
      clientId: CLIENT_ID,
      clientSecret: 'desktop-client-secret'
    })
    const parsed = parseGoogleDriveRefreshTokenEnvelope(selfHosted)
    expect(parsed).toEqual(selfHosted)
    expect(
      parseGoogleDriveRefreshTokenEnvelopeJSON(serializeGoogleDriveRefreshTokenEnvelope(parsed))
    ).toEqual(selfHosted)

    expect(() =>
      parseGoogleDriveRefreshTokenEnvelope(
        v2({
          mode: 'publisher-broker',
          clientId: CLIENT_ID,
          clientSecret: 'must-not-be-accepted'
        } as never)
      )
    ).toThrow('Stored Google Drive authorization is invalid')
    expect(() =>
      parseGoogleDriveRefreshTokenEnvelope(
        v2({ mode: 'self-hosted-desktop', clientId: CLIENT_ID } as never)
      )
    ).toThrow('Stored Google Drive authorization is invalid')
  })

  test('enforces byte and character bounds for client identity and tokens', () => {
    expect(
      parseGoogleDriveOAuthClient({
        mode: 'publisher-broker',
        clientId: `${'a'.repeat(10)}.apps.googleusercontent.com`
      }).clientId
    ).toContain('.apps.googleusercontent.com')
    expect(
      parseGoogleDriveOAuthClient({
        mode: 'publisher-broker',
        clientId: `${'a'.repeat(200)}.apps.googleusercontent.com`
      }).clientId
    ).toContain('.apps.googleusercontent.com')
    for (const prefix of ['a'.repeat(9), 'a'.repeat(201), 'invalid.client']) {
      expect(() =>
        parseGoogleDriveOAuthClient({
          mode: 'publisher-broker',
          clientId: `${prefix}.apps.googleusercontent.com`
        })
      ).toThrow('Stored Google Drive authorization is invalid')
    }

    expect(
      parseGoogleDriveRefreshTokenEnvelope(v1('é'.repeat(6 * 1024))).refreshToken
    ).toHaveLength(6 * 1024)
    expect(() => parseGoogleDriveRefreshTokenEnvelope(v1('é'.repeat(6 * 1024 + 1)))).toThrow(
      'Stored Google Drive authorization is invalid'
    )
    expect(
      parseGoogleDriveRefreshTokenEnvelope(v2(undefined, 'r'.repeat(8 * 1024))).refreshToken
    ).toHaveLength(8 * 1024)
    expect(
      parseGoogleDriveRefreshTokenEnvelope(v2(undefined, 'é'.repeat(4 * 1024))).refreshToken
    ).toHaveLength(4 * 1024)
    for (const token of [
      'r'.repeat(8 * 1024 + 1),
      'é'.repeat(4 * 1024 + 1),
      'refresh token',
      'refresh\ntoken'
    ]) {
      expect(() => parseGoogleDriveRefreshTokenEnvelope(v2(undefined, token))).toThrow(
        'Stored Google Drive authorization is invalid'
      )
    }

    expect(
      parseGoogleDriveOAuthClient({
        mode: 'self-hosted-desktop',
        clientId: CLIENT_ID,
        clientSecret: 's'.repeat(8)
      }).mode
    ).toBe('self-hosted-desktop')
    for (const clientSecret of [
      's'.repeat(7),
      's'.repeat(4 * 1024 + 1),
      'secret value',
      'secret\nvalue',
      '秘密'
    ]) {
      expect(() =>
        parseGoogleDriveOAuthClient({
          mode: 'self-hosted-desktop',
          clientId: CLIENT_ID,
          clientSecret
        })
      ).toThrow('Stored Google Drive authorization is invalid')
    }
  })

  test('enforces the 16 KiB serialized credential bound before parsing', () => {
    const padded = `${JSON.stringify(v1('r'.repeat(12 * 1024)))}${' '.repeat(5 * 1024)}`
    expect(() => parseGoogleDriveRefreshTokenEnvelopeJSON(padded)).toThrow(
      'Stored Google Drive authorization is invalid'
    )
  })
})

describe('Google Drive OAuth public metadata', () => {
  test('keeps v1 exact and stores only the public v2 OAuth client projection', async () => {
    const legacy = {
      schemaVersion: 1,
      profileId: 'default',
      subject: 'google-subject',
      authorizationVersion: VERSION,
      grantedScopes: GOOGLE_DRIVE_OAUTH_SCOPES
    } as const
    expect(parseGoogleDriveOAuthPublicMetadata(legacy)).toEqual(legacy)
    expect(() =>
      parseGoogleDriveOAuthPublicMetadata({
        ...legacy,
        oauthClient: { mode: 'publisher-broker', clientId: CLIENT_ID }
      })
    ).toThrow('Stored Google Drive account metadata is invalid')

    const secretClient = parseGoogleDriveOAuthClient({
      mode: 'self-hosted-desktop',
      clientId: CLIENT_ID,
      clientSecret: 'metadata-must-not-store-this-secret'
    })
    const publicClient = googleDriveOAuthClientPublic(secretClient)
    expect(publicClient).toEqual({ mode: 'self-hosted-desktop', clientId: CLIENT_ID })
    expect(googleDriveOAuthPublicClientsEqual(publicClient, { ...publicClient })).toBeTrue()
    expect(
      googleDriveOAuthPublicClientsEqual(publicClient, {
        mode: 'publisher-broker',
        clientId: CLIENT_ID
      })
    ).toBeFalse()

    const metadata = metadataV2(publicClient)
    expect(parseGoogleDriveOAuthPublicMetadata(metadata)).toEqual(metadata)
    expect(() =>
      parseGoogleDriveOAuthPublicMetadata({
        ...metadata,
        oauthClient: { ...publicClient, clientSecret: 'must-not-be-public' }
      })
    ).toThrow('Stored Google Drive account metadata is invalid')

    const storage = memoryStorage()
    const store = new LocalGoogleDriveOAuthMetadataStore(storage)
    await store.write(metadata)
    const serialized = storage.getItem('open-pencil:google-drive-oauth:v1:default')
    expect(serialized).not.toBeNull()
    expect(serialized).not.toContain('metadata-must-not-store-this-secret')
    await expect(store.read('default')).resolves.toEqual(metadata)
  })
})
