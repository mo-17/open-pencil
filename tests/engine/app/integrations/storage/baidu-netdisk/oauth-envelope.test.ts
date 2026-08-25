import { describe, expect, test } from 'bun:test'

import { resolveBaiduNetdiskPublisherOAuthConfig } from '@/app/integrations/storage/baidu-netdisk/config'
import { parseBaiduNetdiskSelfHostedCredentialsJSON } from '@/app/integrations/storage/baidu-netdisk/oauth/credentials'
import {
  baiduNetdiskOAuthClientPublic,
  BAIDU_NETDISK_OAUTH_SCOPES,
  parseBaiduNetdiskOAuthPublicMetadata,
  parseBaiduNetdiskRefreshTokenEnvelope,
  parseBaiduNetdiskRefreshTokenEnvelopeJSON,
  serializeBaiduNetdiskRefreshTokenEnvelope
} from '@/app/integrations/storage/baidu-netdisk/oauth/envelope'
import { LocalBaiduNetdiskOAuthMetadataStore } from '@/app/integrations/storage/baidu-netdisk/oauth/metadata'

const APP_KEY = 'abcdefghijklmnopqrstuvwx'
const SECRET_KEY = 's'.repeat(32)
const VERSION = 'a'.repeat(32)

const selfHostedClient = Object.freeze({
  mode: 'self-hosted' as const,
  appKey: APP_KEY,
  secretKey: SECRET_KEY
})

function envelope() {
  return {
    schemaVersion: 1,
    refreshToken: 'refresh-token-a',
    oauthClient: selfHostedClient,
    uk: '20828103601234567890',
    authorizationVersion: VERSION
  } as const
}

function metadata() {
  return {
    schemaVersion: 1,
    profileId: 'default',
    uk: '20828103601234567890',
    netdiskName: 'person',
    authorizationVersion: VERSION,
    grantedScopes: BAIDU_NETDISK_OAUTH_SCOPES,
    oauthClient: baiduNetdiskOAuthClientPublic(selfHostedClient)
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

describe('Baidu Netdisk OAuth envelope', () => {
  test('keeps the exact client and refresh token only in the encrypted envelope', () => {
    const parsed = parseBaiduNetdiskRefreshTokenEnvelope(envelope())
    expect(
      parseBaiduNetdiskRefreshTokenEnvelopeJSON(serializeBaiduNetdiskRefreshTokenEnvelope(parsed))
    ).toEqual(envelope())

    for (const unexpected of [
      { accessToken: 'must-stay-in-memory' },
      { endpoint: 'https://evil.example' },
      { scopes: ['basic', 'netdisk'] },
      { sourcePath: '/tmp/credentials.json' }
    ]) {
      expect(() => parseBaiduNetdiskRefreshTokenEnvelope({ ...envelope(), ...unexpected })).toThrow(
        'Stored Baidu Netdisk authorization is invalid'
      )
    }
  })

  test('strictly imports only appKey and secretKey', () => {
    expect(
      parseBaiduNetdiskSelfHostedCredentialsJSON(
        JSON.stringify({ appKey: APP_KEY, secretKey: SECRET_KEY })
      )
    ).toEqual(selfHostedClient)

    for (const value of [
      { installed: { appKey: APP_KEY, secretKey: SECRET_KEY } },
      { appKey: APP_KEY, secretKey: SECRET_KEY, scope: 'basic netdisk' },
      { appKey: APP_KEY, secretKey: SECRET_KEY, tokenUrl: 'https://evil.example' },
      { appKey: 'short', secretKey: SECRET_KEY },
      { appKey: APP_KEY, secretKey: 'contains whitespace' }
    ]) {
      expect(() => parseBaiduNetdiskSelfHostedCredentialsJSON(JSON.stringify(value))).toThrow(
        'The Baidu OAuth credentials file is invalid'
      )
    }
  })

  test('stores only public client identity and account metadata outside the vault', async () => {
    expect(parseBaiduNetdiskOAuthPublicMetadata(metadata())).toEqual(metadata())
    expect(() =>
      parseBaiduNetdiskOAuthPublicMetadata({
        ...metadata(),
        oauthClient: { ...metadata().oauthClient, secretKey: SECRET_KEY }
      })
    ).toThrow('Stored Baidu Netdisk account metadata is invalid')

    const storage = memoryStorage()
    const store = new LocalBaiduNetdiskOAuthMetadataStore(storage)
    await store.write(metadata())
    const serialized = storage.getItem('open-pencil:baidu-netdisk-oauth:v1:default')
    expect(serialized).toContain(APP_KEY)
    expect(serialized).toContain('20828103601234567890')
    expect(serialized).not.toContain(SECRET_KEY)
    expect(serialized).not.toContain('refresh-token')
  })

  test('fixes publisher identity to the build AppKey without exposing a Broker coordinate', () => {
    expect(
      resolveBaiduNetdiskPublisherOAuthConfig(
        { appKey: 'renderer-override', brokerOrigin: 'https://evil.example' },
        APP_KEY
      )
    ).toEqual({ appKey: APP_KEY })
    expect(resolveBaiduNetdiskPublisherOAuthConfig({}, 'short')).toBeNull()
    expect(() =>
      parseBaiduNetdiskRefreshTokenEnvelope({
        ...envelope(),
        oauthClient: {
          mode: 'publisher-broker',
          appKey: APP_KEY,
          brokerOrigin: 'https://oauth.openpencil.dev'
        }
      })
    ).toThrow('Stored Baidu Netdisk authorization is invalid')
  })
})
