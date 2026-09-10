import 'fake-indexeddb/auto'
import { describe, expect, test } from 'bun:test'

import { openDB } from 'idb'

import {
  SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL,
  SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL,
  SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL,
  resolveSupabaseManagementDatabaseWriteCredentialIncarnation,
  resolveSupabaseManagementDatabaseWritePat,
  resolveSupabaseManagementGrantGeneration,
  setSupabaseManagementDatabaseWritePat
} from '@/app/lowcode/supabase/credentials'
import { REVIEWED_EXTERNAL_SERVICE_CONNECTORS } from '@/app/plugins/connectors/services'
import { REVIEWED_DEPLOYMENT_PLUGINS } from '@/app/plugins/host/deployment/contract'
import { BrowserCredentialStore } from '@/app/settings/credentials/browser'
import { createRuntimeCredentialStore } from '@/app/settings/credentials/factory'
import { MemoryCredentialStore } from '@/app/settings/credentials/memory'
import { appCredentialRefs } from '@/app/settings/credentials/persistence'
import { credentialKey, credentialRef } from '@/app/settings/credentials/reference'
import { createCredentialServices } from '@/app/settings/credentials/services'
import { SwitchableCredentialStore } from '@/app/settings/credentials/switchable'
import type {
  CredentialBackend,
  CredentialRef,
  CredentialStatus,
  CredentialStore,
  CredentialStoreAvailability
} from '@/app/settings/credentials/types'

const API_KEY = credentialRef('openai-compatible', 'api-key')
const MEDIA_KEY = credentialRef('pexels', 'api-key')

class TestCredentialStore implements CredentialStore {
  readonly #values = new Map<string, string>()
  readonly reads: string[] = []
  beforeWrite?: (reference: CredentialRef, value: string) => Promise<void> | void
  failWriteFor?: string
  failRemoveFor?: string

  constructor(readonly backend: CredentialBackend) {}

  availability(): Promise<CredentialStoreAvailability> {
    return Promise.resolve('available')
  }

  status(reference: CredentialRef): Promise<CredentialStatus> {
    return Promise.resolve(this.#values.has(credentialKey(reference)) ? 'configured' : 'missing')
  }

  read(reference: CredentialRef): Promise<string | null> {
    this.reads.push(credentialKey(reference))
    return Promise.resolve(this.#values.get(credentialKey(reference)) ?? null)
  }

  async write(reference: CredentialRef, value: string): Promise<void> {
    await this.beforeWrite?.(reference, value)
    const key = credentialKey(reference)
    if (key === this.failWriteFor) throw new Error('write failed')
    this.#values.set(key, value)
  }

  remove(reference: CredentialRef): Promise<void> {
    const key = credentialKey(reference)
    if (key === this.failRemoveFor) return Promise.reject(new Error('remove failed'))
    this.#values.delete(key)
    return Promise.resolve()
  }
}

describe('credential references', () => {
  test('creates stable versioned keys', () => {
    expect(credentialKey(API_KEY)).toBe('v1:openai-compatible:default:api-key')
  })

  test('rejects account-path injection', () => {
    expect(() => credentialRef('../../other-app', 'api-key')).toThrow(
      'Credential reference is invalid'
    )
  })

  test('includes every reviewed external-service and deployment credential in persistence moves', () => {
    const persistentKeys = new Set(appCredentialRefs().map(credentialKey))
    for (const connector of REVIEWED_EXTERNAL_SERVICE_CONNECTORS) {
      for (const reference of Object.values(connector.credentialRefs())) {
        expect(persistentKeys.has(credentialKey(reference))).toBe(true)
      }
    }
    for (const definition of REVIEWED_DEPLOYMENT_PLUGINS) {
      expect(persistentKeys.has(credentialKey(definition.credentialRef))).toBe(true)
    }
  })
})

describe('credential service roles', () => {
  test('uses the Rust app-local vault for Tauri without a browser or Keychain fallback', () => {
    expect(
      createRuntimeCredentialStore({ isTauri: true, browserPersistence: 'session' }).backend
    ).toBe('native')
    expect(
      createRuntimeCredentialStore({ isTauri: true, browserPersistence: 'remembered' }).backend
    ).toBe('native')
  })

  test('keeps the browser session-only choice in memory', () => {
    expect(
      createRuntimeCredentialStore({ isTauri: false, browserPersistence: 'session' }).backend
    ).toBe('memory')
    expect(
      createRuntimeCredentialStore({ isTauri: false, browserPersistence: 'remembered' }).backend
    ).toBe('browser')
  })

  test('settings can manage status without receiving read access', async () => {
    const { manager, resolver } = createCredentialServices(new MemoryCredentialStore())

    expect('resolve' in manager).toBeFalse()
    expect(await manager.status(API_KEY)).toBe('missing')
    await expect(manager.set(API_KEY, '')).rejects.toThrow('Credential value is invalid')
    await manager.set(API_KEY, 'secret')
    expect(await manager.status(API_KEY)).toBe('configured')
    expect(await resolver.resolve(API_KEY)).toBe('secret')
    await manager.clear(API_KEY)
    expect(await resolver.resolve(API_KEY)).toBeNull()
  })

  test('switches persistence without changing service consumers', async () => {
    const store = new SwitchableCredentialStore(new MemoryCredentialStore())
    const { manager, resolver } = createCredentialServices(store)
    await manager.set(API_KEY, 'move-me')

    await store.switchTo(new BrowserCredentialStore(), [API_KEY])

    expect(manager.backend).toBe('browser')
    expect(await resolver.resolve(API_KEY)).toBe('move-me')
    await manager.clear(API_KEY)
  })

  test('keeps the previous backend active when copying fails', async () => {
    const previous = new TestCredentialStore('memory')
    const next = new TestCredentialStore('browser')
    next.failWriteFor = credentialKey(MEDIA_KEY)
    await previous.write(API_KEY, 'ai-secret')
    await previous.write(MEDIA_KEY, 'media-secret')
    const store = new SwitchableCredentialStore(previous)

    await expect(store.switchTo(next, [API_KEY, MEDIA_KEY])).rejects.toThrow('write failed')

    expect(store.backend).toBe('memory')
    expect(await store.read(API_KEY)).toBe('ai-secret')
    expect(await store.read(MEDIA_KEY)).toBe('media-secret')
    expect(await next.read(API_KEY)).toBeNull()
  })

  test('restores the previous backend when persistent cleanup fails', async () => {
    const previous = new TestCredentialStore('browser')
    const next = new TestCredentialStore('memory')
    previous.failRemoveFor = credentialKey(MEDIA_KEY)
    await previous.write(API_KEY, 'ai-secret')
    await previous.write(MEDIA_KEY, 'media-secret')
    const store = new SwitchableCredentialStore(previous)

    await expect(
      store.switchTo(next, [API_KEY, MEDIA_KEY], { clearPrevious: true })
    ).rejects.toThrow('remove failed')

    expect(store.backend).toBe('browser')
    expect(await store.read(API_KEY)).toBe('ai-secret')
    expect(await store.read(MEDIA_KEY)).toBe('media-secret')
    expect(await next.read(API_KEY)).toBeNull()
    expect(await next.read(MEDIA_KEY)).toBeNull()
  })

  test('finishes a captured persistence snapshot before rotating credentials on the new delegate', async () => {
    const previous = new TestCredentialStore('memory')
    const next = new TestCredentialStore('browser')
    const store = new SwitchableCredentialStore(previous)
    const services = createCredentialServices(store)
    const references = [
      SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL,
      SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL,
      SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL
    ]
    const oldPAT = 'old-write-token-000001'
    const newPAT = 'new-write-token-000001'
    await setSupabaseManagementDatabaseWritePat(oldPAT, services)
    const oldSharedGeneration = await resolveSupabaseManagementGrantGeneration(services)
    const oldWriteIncarnation =
      await resolveSupabaseManagementDatabaseWriteCredentialIncarnation(services)
    if (!oldSharedGeneration || !oldWriteIncarnation) throw new Error('fixture failed')
    previous.reads.length = 0

    let blockFirstCopy = true
    let markSnapshotCaptured: () => void = () => undefined
    let releaseCopy: () => void = () => undefined
    const snapshotCaptured = new Promise<void>((resolve) => {
      markSnapshotCaptured = resolve
    })
    const copyGate = new Promise<void>((resolve) => {
      releaseCopy = resolve
    })
    next.beforeWrite = async () => {
      if (!blockFirstCopy) return
      blockFirstCopy = false
      markSnapshotCaptured()
      await copyGate
    }

    const switching = store.switchTo(next, references)
    await snapshotCaptured
    expect(previous.reads).toEqual(references.map(credentialKey))

    let rotationSettled = false
    const rotation = (async () => {
      await setSupabaseManagementDatabaseWritePat(newPAT, services)
      rotationSettled = true
    })()
    await Promise.resolve()
    await Promise.resolve()
    expect(rotationSettled).toBe(false)
    expect(await previous.read(SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL)).toBe(oldPAT)
    expect(await previous.read(SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL)).toBe(
      oldSharedGeneration
    )
    expect(
      await previous.read(SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL)
    ).toBe(oldWriteIncarnation)

    releaseCopy()
    await Promise.all([switching, rotation])
    expect(store.backend).toBe('browser')
    expect(await resolveSupabaseManagementDatabaseWritePat(services)).toBe(newPAT)
    expect(await resolveSupabaseManagementGrantGeneration(services)).not.toBe(oldSharedGeneration)
    expect(await resolveSupabaseManagementDatabaseWriteCredentialIncarnation(services)).not.toBe(
      oldWriteIncarnation
    )
  })

  test('copies the new credential tuple when rotation owns the persistence gate first', async () => {
    const previous = new TestCredentialStore('memory')
    const next = new TestCredentialStore('browser')
    const store = new SwitchableCredentialStore(previous)
    const services = createCredentialServices(store)
    const references = [
      SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL,
      SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL,
      SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL
    ]
    await setSupabaseManagementDatabaseWritePat('old-write-token-000002', services)

    let holdNewPAT = true
    let markRotationBlocked: () => void = () => undefined
    let releaseRotation: () => void = () => undefined
    const rotationBlocked = new Promise<void>((resolve) => {
      markRotationBlocked = resolve
    })
    const rotationGate = new Promise<void>((resolve) => {
      releaseRotation = resolve
    })
    const newPAT = 'new-write-token-000002'
    previous.beforeWrite = async (reference, value) => {
      if (
        !holdNewPAT ||
        reference !== SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL ||
        value !== newPAT
      ) {
        return
      }
      holdNewPAT = false
      markRotationBlocked()
      await rotationGate
    }

    const rotation = setSupabaseManagementDatabaseWritePat(newPAT, services)
    await rotationBlocked
    const switching = store.switchTo(next, references)
    await Promise.resolve()
    await Promise.resolve()
    expect(next.reads).toEqual([])

    releaseRotation()
    await Promise.all([rotation, switching])
    const expectedSharedGeneration = await resolveSupabaseManagementGrantGeneration(services)
    const expectedWriteIncarnation =
      await resolveSupabaseManagementDatabaseWriteCredentialIncarnation(services)
    expect(store.backend).toBe('browser')
    expect(await next.read(SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL)).toBe(newPAT)
    expect(await next.read(SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL)).toBe(
      expectedSharedGeneration
    )
    expect(
      await next.read(SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL)
    ).toBe(expectedWriteIncarnation)
  })
})

describe('browser credential store', () => {
  test('encrypts remembered credentials in IndexedDB', async () => {
    const store = new BrowserCredentialStore()

    expect(await store.availability()).toBe('available')
    await store.write(API_KEY, 'browser-secret')
    expect(await store.read(API_KEY)).toBe('browser-secret')

    const database = await openDB('open-pencil-credentials', 1)
    const record = await database.get('credentials', credentialKey(API_KEY))
    expect(record).toBeDefined()
    expect(JSON.stringify(record)).not.toContain('browser-secret')
    database.close()

    await store.remove(API_KEY)
    expect(await store.status(API_KEY)).toBe('missing')
  })
})
