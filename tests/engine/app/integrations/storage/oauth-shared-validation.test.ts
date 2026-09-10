import { describe, expect, test } from 'bun:test'

import { parseAliyunDriveOAuthCredentials } from '@/app/integrations/storage/aliyun-drive/oauth/credentials'
import { parseBaiduNetdiskSelfHostedCredentials } from '@/app/integrations/storage/baidu-netdisk/oauth/credentials'
import {
  GOOGLE_DRIVE_OAUTH_SCOPES,
  parseGoogleDriveOAuthPublicMetadata
} from '@/app/integrations/storage/google-drive/oauth/envelope'
import {
  hasExactOAuthKeys,
  isOAuthRecord
} from '@/app/integrations/storage/oauth-shared/validation'
import { parseOneDriveRefreshTokenEnvelope } from '@/app/integrations/storage/onedrive/oauth/envelope'

describe('shared OAuth data-object validation', () => {
  test('accepts only enumerable own data properties on plain records', () => {
    const plain = { mode: 'public', clientId: 'client-1' }
    expect(isOAuthRecord(plain)).toBe(true)
    expect(hasExactOAuthKeys(plain, ['mode', 'clientId'])).toBe(true)

    const nullPrototype = Object.assign(Object.create(null), plain)
    expect(isOAuthRecord(nullPrototype)).toBe(true)
    expect(hasExactOAuthKeys(nullPrototype, ['mode', 'clientId'])).toBe(true)
  })

  test('rejects hidden fields, accessors, symbols, and custom prototypes without invoking getters', () => {
    const hidden = {}
    Object.defineProperty(hidden, 'clientId', {
      value: 'hidden-client',
      enumerable: false
    })
    expect(isOAuthRecord(hidden)).toBe(false)

    let getterReads = 0
    const accessor = {}
    Object.defineProperty(accessor, 'clientId', {
      enumerable: true,
      get() {
        getterReads += 1
        return 'swapped-client'
      }
    })
    expect(isOAuthRecord(accessor)).toBe(false)
    expect(getterReads).toBe(0)

    let proxyReads = 0
    const proxy = new Proxy(plainRecord(), {
      get(target, key, receiver) {
        proxyReads += 1
        return Reflect.get(target, key, receiver)
      }
    })
    expect(isOAuthRecord(proxy)).toBe(false)
    expect(proxyReads).toBe(0)

    expect(isOAuthRecord({ [Symbol('hidden')]: 'value' })).toBe(false)
    expect(isOAuthRecord(Object.assign(Object.create({ inherited: true }), plainRecord()))).toBe(
      false
    )
  })

  test('keeps direct provider parsers fail-closed for hidden credentials and accessors', () => {
    const hiddenAliyun = {}
    for (const [key, value] of Object.entries({
      mode: 'self-hosted-confidential',
      client_id: 'aliyun-client-123',
      client_secret: 'secret-value-123',
      redirect_uri: 'http://127.0.0.1:43127/oauth/aliyun-drive/callback'
    })) {
      Object.defineProperty(hiddenAliyun, key, { value, enumerable: false })
    }
    expect(() => parseAliyunDriveOAuthCredentials(hiddenAliyun)).toThrow(
      'The Aliyun Drive OAuth credentials file is invalid'
    )

    const hiddenBaidu = {}
    Object.defineProperties(hiddenBaidu, {
      appKey: { value: 'abcdefghijklmnopqrstuvwx', enumerable: false },
      secretKey: { value: 's'.repeat(32), enumerable: false }
    })
    expect(() => parseBaiduNetdiskSelfHostedCredentials(hiddenBaidu)).toThrow(
      'The Baidu OAuth credentials file is invalid'
    )

    let tokenReads = 0
    const oneDrive = {
      schemaVersion: 1,
      clientId: '11111111-1111-4111-8111-111111111111',
      authorizationVersion: 'a'.repeat(32),
      subject: 'microsoft-subject-a'
    }
    Object.defineProperty(oneDrive, 'refreshToken', {
      enumerable: true,
      get() {
        tokenReads += 1
        return tokenReads === 1 ? 'valid-token' : 'contains whitespace'
      }
    })
    expect(() => parseOneDriveRefreshTokenEnvelope(oneDrive)).toThrow(
      'Stored OneDrive authorization is invalid'
    )
    expect(tokenReads).toBe(0)

    let proxyTokenReads = 0
    const oneDriveProxy = new Proxy(
      {
        schemaVersion: 1,
        refreshToken: 'valid-token',
        clientId: '11111111-1111-4111-8111-111111111111',
        authorizationVersion: 'a'.repeat(32),
        subject: 'microsoft-subject-a'
      },
      {
        get(target, key, receiver) {
          if (key !== 'refreshToken') return Reflect.get(target, key, receiver)
          proxyTokenReads += 1
          return proxyTokenReads === 1 ? 'valid-token' : 'contains whitespace'
        }
      }
    )
    expect(() => parseOneDriveRefreshTokenEnvelope(oneDriveProxy)).toThrow(
      'Stored OneDrive authorization is invalid'
    )
    expect(proxyTokenReads).toBe(0)

    let emailReads = 0
    const google = {
      schemaVersion: 1,
      profileId: 'default',
      subject: 'google-subject',
      authorizationVersion: 'a'.repeat(32),
      grantedScopes: GOOGLE_DRIVE_OAUTH_SCOPES
    }
    Object.defineProperty(google, 'email', {
      enumerable: true,
      get() {
        emailReads += 1
        return emailReads < 3 ? 'person@example.com' : 'refresh-token secret'
      }
    })
    expect(() => parseGoogleDriveOAuthPublicMetadata(google)).toThrow(
      'Stored Google Drive account metadata is invalid'
    )
    expect(emailReads).toBe(0)

    let proxyEmailReads = 0
    const googleProxy = new Proxy(
      {
        schemaVersion: 1,
        profileId: 'default',
        subject: 'google-subject',
        email: 'person@example.com',
        authorizationVersion: 'a'.repeat(32),
        grantedScopes: GOOGLE_DRIVE_OAUTH_SCOPES
      },
      {
        get(target, key, receiver) {
          if (key !== 'email') return Reflect.get(target, key, receiver)
          proxyEmailReads += 1
          return proxyEmailReads < 3 ? 'person@example.com' : 'refresh-token secret'
        }
      }
    )
    expect(() => parseGoogleDriveOAuthPublicMetadata(googleProxy)).toThrow(
      'Stored Google Drive account metadata is invalid'
    )
    expect(proxyEmailReads).toBe(0)
  })
})

function plainRecord(): Record<string, unknown> {
  return { mode: 'public', clientId: 'client-1' }
}
