import { describe, expect, test } from 'bun:test'

import {
  LocalAliyunDriveOAuthMetadataStore,
  MemoryAliyunDriveOAuthMetadataStore
} from '@/app/integrations/storage/aliyun-drive/oauth/metadata'

const CLIENT_ID = 'aliyun-client-123'
const AUTHORIZATION_VERSION = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const STORAGE_KEY = 'open-pencil:aliyun-drive-oauth:v1:default'

function metadata() {
  return {
    schemaVersion: 1 as const,
    profileId: 'default',
    subject: 'aliyun-user-1',
    email: 'person@example.com',
    authorizationVersion: AUTHORIZATION_VERSION,
    oauthClient: {
      mode: 'publisher-broker-confidential' as const,
      clientId: CLIENT_ID
    },
    grantType: 'refresh-grant' as const
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

describe('Aliyun Drive OAuth metadata store', () => {
  test('persists only strict profile-scoped public account metadata', async () => {
    const storage = memoryStorage()
    const store = new LocalAliyunDriveOAuthMetadataStore(storage)

    await store.write(metadata())

    expect(await store.read('default')).toEqual(metadata())
    const serialized = storage.getItem(STORAGE_KEY) ?? ''
    expect(serialized).toContain(CLIENT_ID)
    expect(serialized).toContain('aliyun-user-1')
    for (const sensitive of [
      'clientSecret',
      'accessToken',
      'refreshToken',
      'redirectUri',
      'endpoint',
      'scope'
    ]) {
      expect(serialized).not.toContain(sensitive)
    }
  })

  test('rejects malformed, oversized, and cross-profile records', async () => {
    const storage = memoryStorage()
    const store = new LocalAliyunDriveOAuthMetadataStore(storage)
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...metadata(), refreshToken: 'must-not-leak' }))
    await expect(store.read('default')).rejects.toThrow(
      'Stored Aliyun Drive account metadata is invalid'
    )
    storage.setItem(STORAGE_KEY, 'x'.repeat(4 * 1024 + 1))
    await expect(store.read('default')).rejects.toThrow(
      'Stored Aliyun Drive account metadata is invalid'
    )
    expect(() => store.read('../escape')).toThrow('Storage profile ID')
  })

  test('supports isolated memory persistence and removal for tests', async () => {
    const store = new MemoryAliyunDriveOAuthMetadataStore()
    await store.write(metadata())
    expect(await store.read('other')).toBeNull()
    await store.remove('default')
    expect(await store.read('default')).toBeNull()
  })

  test('fails writes when app-local storage is unavailable', async () => {
    const store = new LocalAliyunDriveOAuthMetadataStore(null)
    await expect(store.write(metadata())).rejects.toThrow('metadata storage is unavailable')
  })
})
