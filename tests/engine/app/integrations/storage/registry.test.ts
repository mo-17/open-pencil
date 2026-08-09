import { describe, expect, test } from 'bun:test'

import {
  defineStorageProvider,
  storageProviderRegistry,
  StorageProviderRegistry,
  type StorageAdapter,
  type StorageProviderRuntime
} from '@/app/integrations/storage'
import { appCredentialRefs } from '@/app/settings/credentials/persistence'
import { credentialKey } from '@/app/settings/credentials/reference'
import type {
  CredentialManager,
  CredentialRef,
  CredentialResolver
} from '@/app/settings/credentials/types'

const credentialManager: CredentialManager = {
  backend: 'memory',
  availability: () => Promise.resolve('available'),
  status: () => Promise.resolve('missing'),
  set: () => Promise.resolve(),
  clear: () => Promise.resolve()
}

class TestStorageAdapter implements StorageAdapter {
  constructor(private readonly runtime: StorageProviderRuntime) {}

  async testConnection() {
    const secret = await this.runtime.resolveCredential('secret')
    return { ok: Boolean(secret), message: secret ? 'Connected' : 'Missing credential' }
  }

  listDocuments() {
    return Promise.resolve([])
  }

  getDocument() {
    return Promise.resolve({
      bytes: new Uint8Array(),
      metadata: { name: 'Test', updatedAt: new Date(0).toISOString() },
      remoteRevision: null
    })
  }

  putDocument() {
    return Promise.resolve({ outcome: 'updated' as const, remoteRevision: null })
  }

  deleteDocument() {
    return Promise.resolve()
  }

  getUsage() {
    return Promise.resolve({ bytesUsed: 0, objectCount: 0, documentCount: 0 })
  }
}

function testProvider() {
  return defineStorageProvider({
    id: 'test-storage',
    label: 'Test storage',
    description: 'Storage used by registry tests',
    preferenceFields: [{ id: 'endpoint', label: 'Endpoint', kind: 'url', required: true }],
    credentialFields: [{ id: 'secret', label: 'Secret', required: true }],
    createAdapter: (runtime) => new TestStorageAdapter(runtime)
  })
}

describe('storage provider registry', () => {
  test('registers S3 preferences separately from credential fields', () => {
    const provider = storageProviderRegistry.get('s3-compatible')

    expect(provider.preferenceFields.map((field) => field.id)).toEqual([
      'endpoint',
      'bucket',
      'region'
    ])
    expect(provider.credentialFields.map((field) => field.id)).toEqual([
      'access-key-id',
      'secret-access-key'
    ])
    expect(appCredentialRefs().map(credentialKey)).toContain(
      'v1:s3-compatible:default:secret-access-key'
    )
  })

  test('registers Google Drive as a reviewed OAuth provider without secret fields', () => {
    const provider = storageProviderRegistry.get('google-drive')

    expect(provider.preferenceFields.map((field) => field.id)).toEqual(['client-id'])
    expect(provider.credentialFields).toEqual([])
    expect(provider.description).toContain('Google Drive')
  })

  test('lists provider schemas without resolving credentials', () => {
    let resolutionCount = 0
    const credentials: CredentialResolver = {
      resolve() {
        resolutionCount++
        return Promise.resolve('secret-value')
      }
    }
    const registry = new StorageProviderRegistry([testProvider()])

    expect(registry.list().map((provider) => provider.id)).toEqual(['test-storage'])
    const adapter = registry.createAdapter('test-storage', {
      preferences: { endpoint: 'https://storage.example.com' },
      credentials,
      credentialManager
    })

    expect(resolutionCount).toBe(0)
    expect(adapter).toBeInstanceOf(TestStorageAdapter)
  })

  test('resolves declared credentials only when an adapter operation needs them', async () => {
    const resolved: CredentialRef[] = []
    const credentials: CredentialResolver = {
      resolve(reference) {
        resolved.push(reference)
        return Promise.resolve('secret-value')
      }
    }
    const registry = new StorageProviderRegistry([testProvider()])
    const adapter = registry.createAdapter('test-storage', {
      preferences: { endpoint: 'https://storage.example.com' },
      credentials,
      credentialManager,
      profileId: 'work'
    })

    expect(await adapter.testConnection()).toEqual({ ok: true, message: 'Connected' })
    expect(resolved.map(credentialKey)).toEqual(['v1:test-storage:work:secret'])
  })

  test('rejects duplicate providers and undeclared credential fields', async () => {
    const provider = testProvider()
    expect(() => new StorageProviderRegistry([provider, provider])).toThrow(
      'Storage provider IDs must be unique'
    )

    const invalidProvider = defineStorageProvider({
      ...provider,
      createAdapter(runtime) {
        return new TestStorageAdapter({
          ...runtime,
          resolveCredential: () => runtime.resolveCredential('undeclared')
        })
      }
    })
    const registry = new StorageProviderRegistry([invalidProvider])
    const adapter = registry.createAdapter('test-storage', {
      preferences: {},
      credentials: { resolve: () => Promise.resolve('secret-value') },
      credentialManager
    })

    await expect(adapter.testConnection()).rejects.toThrow(
      'Unknown credential field for test-storage: undeclared'
    )
  })
})
