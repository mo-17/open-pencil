import { describe, expect, test } from 'bun:test'

import { effectScope } from 'vue'

import { useSupabaseStagingReleaseAuthority } from '@/app/lowcode/supabase/staging-release-authority'
import {
  createSupabaseStagingTargetStore,
  SUPABASE_STAGING_TARGET_STORAGE_KEY
} from '@/app/lowcode/supabase/staging-target'
import type { CredentialStatus } from '@/app/settings/credentials/types'

const PROJECT_REF = 'enekobitnhobuiuamvqj'
const ACCOUNT_ID = 'org-staging-1'
const NOW = '2026-09-02T00:00:00.000Z'

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

describe('Supabase staging release authority composable', () => {
  test('keeps the write credential and non-secret target binding independent', async () => {
    const storage = memoryStorage()
    const writtenCredentials: string[] = []
    let status: CredentialStatus = 'missing'
    const scope = effectScope()
    const authority = scope.run(() =>
      useSupabaseStagingReleaseAuthority({
        credentialStatus: async () => status,
        async setCredential(value) {
          writtenCredentials.push(value)
          status = 'configured'
        },
        async clearCredential() {
          status = 'missing'
        },
        createTargetStore: () => createSupabaseStagingTargetStore(storage, () => NOW)
      })
    )
    if (!authority) throw new Error('Missing authority composable')
    await Promise.resolve()

    expect(authority.credentialStatus.value).toBe('missing')
    expect(authority.target.value).toBeNull()
    expect(await authority.saveCredential('write-pat-canary-1234567890')).toBe(true)
    expect(writtenCredentials).toEqual(['write-pat-canary-1234567890'])
    expect(authority.credentialStatus.value).toBe('configured')
    expect(
      authority.bindTarget({ projectRef: PROJECT_REF, accountId: ACCOUNT_ID }, PROJECT_REF, true)
    ).toBe(true)
    expect(authority.targetMatches({ projectRef: PROJECT_REF, accountId: ACCOUNT_ID })).toBe(true)
    expect(storage.getItem(SUPABASE_STAGING_TARGET_STORAGE_KEY)).not.toContain('write-pat-canary')
    expect(await authority.clearCredential()).toBe(true)
    expect(authority.credentialStatus.value).toBe('missing')
    expect(authority.target.value?.projectRef).toBe(PROJECT_REF)
    scope.stop()
  })

  test('requires both exact project confirmation and the independent-staging decision', async () => {
    const storage = memoryStorage()
    const scope = effectScope()
    const authority = scope.run(() =>
      useSupabaseStagingReleaseAuthority({
        credentialStatus: async () => 'configured',
        setCredential: async () => undefined,
        clearCredential: async () => undefined,
        createTargetStore: () => createSupabaseStagingTargetStore(storage, () => NOW)
      })
    )
    if (!authority) throw new Error('Missing authority composable')
    await Promise.resolve()
    const identity = { projectRef: PROJECT_REF, accountId: ACCOUNT_ID }

    expect(authority.bindTarget(identity, 'wrong-project-ref', true)).toBe(false)
    expect(authority.bindTarget(identity, PROJECT_REF, false)).toBe(false)
    expect(authority.target.value).toBeNull()
    expect(authority.targetError.value).toBe(true)
    expect(storage.getItem(SUPABASE_STAGING_TARGET_STORAGE_KEY)).toBeNull()

    expect(authority.bindTarget(identity, PROJECT_REF, true)).toBe(true)
    expect(authority.targetError.value).toBe(false)
    expect(authority.clearTarget()).toBe(true)
    expect(authority.target.value).toBeNull()
    expect(storage.getItem(SUPABASE_STAGING_TARGET_STORAGE_KEY)).toBeNull()
    scope.stop()
  })

  test('single-flights credential mutation and ignores a late disposed status read', async () => {
    let resolveSet: (() => void) | undefined
    let resolveStatus: ((status: CredentialStatus) => void) | undefined
    const setBarrier = new Promise<void>((resolve) => {
      resolveSet = resolve
    })
    const statusBarrier = new Promise<CredentialStatus>((resolve) => {
      resolveStatus = resolve
    })
    let setCalls = 0
    const scope = effectScope()
    const authority = scope.run(() =>
      useSupabaseStagingReleaseAuthority({
        credentialStatus: () => statusBarrier,
        async setCredential() {
          setCalls += 1
          await setBarrier
        },
        clearCredential: async () => undefined,
        createTargetStore: () => createSupabaseStagingTargetStore(memoryStorage(), () => NOW)
      })
    )
    if (!authority) throw new Error('Missing authority composable')

    const first = authority.saveCredential('write-pat-first-1234567890')
    expect(authority.credentialBusy.value).toBe(true)
    expect(await authority.saveCredential('write-pat-second-1234567890')).toBe(false)
    expect(setCalls).toBe(1)
    scope.stop()
    resolveStatus?.('configured')
    resolveSet?.()
    await first
    expect(authority.credentialStatus.value).toBe('loading')
  })
})
