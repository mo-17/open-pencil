import { describe, expect, test } from 'bun:test'

import {
  createS3StorageAdapter,
  createStorageProfile,
  deleteStorageProfile,
  ensureS3StorageAuthority,
  removeS3StorageAuthority,
  rotateS3StorageAuthorization,
  setS3StorageCredential,
  storageDocumentKey,
  clearS3StorageCredential,
  writeStoragePreference,
  type StorageProviderRuntime
} from '@/app/integrations/storage'
import type {
  CredentialManager,
  CredentialRef,
  CredentialStatus
} from '@/app/settings/credentials/types'
import { createMemoryOutbox } from '@/app/storage/sync/outbox'

import { repoPath } from '#tests/helpers/paths'

const PROVIDER_ID = 's3-compatible'

function uniqueProfile(name: string): string {
  const id = `s3-authority-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`
  createStorageProfile(PROVIDER_ID, name, id)
  return id
}

function runtime(profileId: string, onResolve?: () => void): StorageProviderRuntime {
  const manager: CredentialManager = {
    backend: 'memory',
    availability: () => Promise.resolve('available'),
    status: () => Promise.resolve('configured'),
    set: () => Promise.resolve(),
    clear: () => Promise.resolve()
  }
  return {
    preferences: {
      endpoint: 'https://s3.example.com',
      bucket: 'documents',
      region: 'auto'
    },
    profileId,
    credentialManager: manager,
    credentialResolver: { resolve: () => Promise.resolve('secret') },
    resolveCredential() {
      onResolve?.()
      return Promise.resolve('secret')
    }
  }
}

describe('S3 profile authorization generations', () => {
  test('keeps a stable random profile incarnation and rotates only changed preferences', () => {
    const profileId = uniqueProfile('Preference generation')
    try {
      const initial = ensureS3StorageAuthority(profileId)
      expect(ensureS3StorageAuthority(profileId)).toEqual(initial)

      writeStoragePreference(PROVIDER_ID, 'endpoint', 'https://first.example.com', profileId)
      const changed = ensureS3StorageAuthority(profileId)
      expect(changed.accountId).toBe(initial.accountId)
      expect(changed.authorizationVersion).not.toBe(initial.authorizationVersion)

      writeStoragePreference(PROVIDER_ID, 'endpoint', ' https://first.example.com ', profileId)
      expect(ensureS3StorageAuthority(profileId)).toEqual(changed)

      writeStoragePreference(PROVIDER_ID, 'bucket', 'next-bucket', profileId)
      const secondChange = ensureS3StorageAuthority(profileId)
      expect(secondChange.accountId).toBe(initial.accountId)
      expect(secondChange.authorizationVersion).not.toBe(changed.authorizationVersion)
      expect(
        storageDocumentKey({
          providerId: PROVIDER_ID,
          profileId,
          documentId: 'same-document',
          authority: changed
        })
      ).not.toBe(
        storageDocumentKey({
          providerId: PROVIDER_ID,
          profileId,
          documentId: 'same-document',
          authority: secondChange
        })
      )
      expect(
        storageDocumentKey({
          providerId: 'google-drive',
          profileId,
          documentId: 'same-document',
          authority: changed
        })
      ).toBe(
        storageDocumentKey({
          providerId: 'google-drive',
          profileId,
          documentId: 'same-document',
          authority: secondChange
        })
      )
    } finally {
      deleteStorageProfile(PROVIDER_ID, profileId)
    }
  })

  test('rotates before secret replacement or clearing without reading the secret', async () => {
    const profileId = uniqueProfile('Credential generation')
    let status: CredentialStatus = 'configured'
    let expectedBeforeMutation = ensureS3StorageAuthority(profileId).authorizationVersion
    const writes: CredentialRef[] = []
    const clears: CredentialRef[] = []
    const manager: CredentialManager = {
      backend: 'memory',
      availability: () => Promise.resolve('available'),
      status: () => Promise.resolve(status),
      async set(reference) {
        expect(ensureS3StorageAuthority(profileId).authorizationVersion).not.toBe(
          expectedBeforeMutation
        )
        writes.push(reference)
      },
      async clear(reference) {
        expect(ensureS3StorageAuthority(profileId).authorizationVersion).not.toBe(
          expectedBeforeMutation
        )
        clears.push(reference)
        status = 'missing'
      }
    }

    try {
      await setS3StorageCredential(manager, profileId, 'access-key-id', 'replacement')
      expect(writes).toHaveLength(1)
      expectedBeforeMutation = ensureS3StorageAuthority(profileId).authorizationVersion

      await clearS3StorageCredential(manager, profileId, 'secret-access-key')
      expect(clears).toHaveLength(1)
      expectedBeforeMutation = ensureS3StorageAuthority(profileId).authorizationVersion

      await clearS3StorageCredential(manager, profileId, 'secret-access-key')
      expect(clears).toHaveLength(1)
      expect(ensureS3StorageAuthority(profileId).authorizationVersion).toBe(expectedBeforeMutation)
    } finally {
      deleteStorageProfile(PROVIDER_ID, profileId)
    }
  })

  test('keeps durable jobs isolated across S3 configuration generations', async () => {
    const profileId = uniqueProfile('Outbox generation')
    const previousAuthority = ensureS3StorageAuthority(profileId)
    const nextAuthority = rotateS3StorageAuthorization(profileId)
    const outbox = createMemoryOutbox()
    try {
      await outbox.enqueue({
        binding: {
          providerId: PROVIDER_ID,
          profileId,
          documentId: 'same-document',
          authority: previousAuthority
        },
        type: 'putCanvas',
        revision: 1
      })
      await outbox.enqueue({
        binding: {
          providerId: PROVIDER_ID,
          profileId,
          documentId: 'same-document',
          authority: nextAuthority
        },
        type: 'putCanvas',
        revision: 2
      })

      expect(await outbox.list()).toHaveLength(2)
    } finally {
      deleteStorageProfile(PROVIDER_ID, profileId)
    }
  })

  test('rejects authority-less and stale durable mutations before resolving credentials', async () => {
    const profileId = uniqueProfile('Adapter generation')
    let resolutions = 0
    const adapter = createS3StorageAdapter(runtime(profileId, () => resolutions++))
    const original = await adapter.getAuthority()
    expect(original).toEqual(ensureS3StorageAuthority(profileId))

    try {
      await expect(
        adapter.putDocument(
          'document-1',
          new Uint8Array([1]),
          { name: 'Document', updatedAt: new Date(0).toISOString() },
          undefined
        )
      ).rejects.toThrow('requires an exact profile authorization')
      expect(resolutions).toBe(0)

      rotateS3StorageAuthorization(profileId)
      await expect(
        adapter.deleteDocument('document-1', { expectedAuthority: original ?? undefined })
      ).rejects.toThrow('configuration changed')
      expect(resolutions).toBe(0)
    } finally {
      deleteStorageProfile(PROVIDER_ID, profileId)
    }
  })

  test('blocks configuration rotation and remote mutation until legacy review completes', async () => {
    const profileId = `legacy-block-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`
    const authority = ensureS3StorageAuthority(profileId)
    let resolutions = 0
    const adapter = createS3StorageAdapter(runtime(profileId, () => resolutions++))
    try {
      expect(() => rotateS3StorageAuthorization(profileId)).toThrow('must be reviewed and migrated')
      await expect(
        adapter.putDocument(
          'legacy-document',
          new Uint8Array([1]),
          { name: 'Legacy', updatedAt: new Date(0).toISOString() },
          { expectedAuthority: authority }
        )
      ).rejects.toThrow('must be reviewed and migrated')
      expect(resolutions).toBe(0)
    } finally {
      removeS3StorageAuthority(profileId)
    }
  })

  test('checks durable work before settings mutate preferences or credentials', async () => {
    const source = await Bun.file(
      repoPath('src/components/settings/storage/S3CompatibleStorageSettings.vue')
    ).text()
    const preferences = source.slice(
      source.indexOf('async function savePreferences'),
      source.indexOf('async function saveCredential')
    )
    const credentials = source.slice(
      source.indexOf('async function saveCredential'),
      source.indexOf('async function clearCredential')
    )
    const clearCredential = source.slice(
      source.indexOf('async function clearCredential'),
      source.indexOf('async function testConnection')
    )
    const mutationGuard = source.slice(
      source.indexOf('async function mutationAllowed'),
      source.indexOf('async function savePreferences')
    )

    expect(preferences.indexOf('await mutationAllowed')).toBeLessThan(
      preferences.indexOf('writeStoragePreference')
    )
    expect(credentials.indexOf('await mutationAllowed')).toBeLessThan(
      credentials.indexOf('setS3StorageCredential')
    )
    expect(clearCredential.indexOf('await mutationAllowed')).toBeLessThan(
      clearCredential.indexOf('clearS3StorageCredential')
    )
    expect(source).toContain('withDurableStorageProfileMutationDrain')
    expect(source).toContain('if (profileHasOpenTabs(profileId))')
    expect(mutationGuard.indexOf('profileHasOpenTabs(profileId)')).toBeLessThan(
      mutationGuard.indexOf('inspectStorageAuthorizationWork')
    )
    expect(source).toContain('prepareS3LegacyMigration')
    expect(source).toContain('dialogs.value.storageS3MutationBlockedByUnsyncedWork')
    expect(source).toContain('dialogs.value.storageS3MutationBlockedByOpenDocuments')
    expect(source.match(/if \(!\(await savePreferences\(profileId\)\)\) return/g)).toHaveLength(1)

    const engine = await Bun.file(repoPath('src/app/storage/sync/engine.ts')).text()
    const authorizedAdapter = engine.slice(
      engine.indexOf('async function createAuthorizedStorageAdapter'),
      engine.indexOf('async function runDeleteJob')
    )
    expect(authorizedAdapter.indexOf('assertS3LegacyMigrationComplete')).toBeLessThan(
      authorizedAdapter.indexOf('storageCredentialStatuses')
    )
  })
})
