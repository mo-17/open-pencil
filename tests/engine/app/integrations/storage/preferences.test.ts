import { afterAll, describe, expect, test } from 'bun:test'

import {
  activeStorageProviderID,
  copyStorageProfilePreferences,
  createStorageProfile,
  deleteStorageProfile,
  isStorageProfileID,
  listStorageProfiles,
  MAX_STORAGE_PROFILES_PER_PROVIDER,
  readActiveStorageProfileID,
  readStoragePreferences,
  renameStorageProfile,
  resolveStorageDocumentBinding,
  storageCredentialRefs,
  writeActiveStorageProfileID,
  writeStoragePreference
} from '@/app/integrations/storage'

import { repoPath } from '#tests/helpers/paths'

const PROVIDER_ID = 's3-compatible'
const originalProvider = activeStorageProviderID.value
const originalProfile = readActiveStorageProfileID(PROVIDER_ID)
const createdProfileIDs: string[] = []

afterAll(() => {
  for (const profileID of createdProfileIDs) {
    if (listStorageProfiles(PROVIDER_ID).some((profile) => profile.id === profileID)) {
      deleteStorageProfile(PROVIDER_ID, profileID)
    }
  }
  writeActiveStorageProfileID(PROVIDER_ID, originalProfile)
  activeStorageProviderID.value = originalProvider
})

describe('storage profile preferences', () => {
  test('keeps the existing provider key while making Google Drive the fresh fallback', async () => {
    const source = await Bun.file(repoPath('src/app/integrations/storage/preferences.ts')).text()
    expect(activeStorageProviderID.value).toBe('google-drive')
    expect(source).toContain("'open-pencil:storage:provider'")
    expect(source).toContain('GOOGLE_DRIVE_STORAGE_PROVIDER_ID')
    expect(source).not.toContain("'open-pencil:storage:provider:v2'")
  })

  test('strictly validates profile IDs at every durable binding boundary', () => {
    expect(isStorageProfileID('team-2.us')).toBe(true)
    for (const invalid of ['', ' Team', 'UPPER', '-leading', 'constructor', 'a'.repeat(65)]) {
      expect(isStorageProfileID(invalid)).toBe(false)
      expect(() => writeActiveStorageProfileID(PROVIDER_ID, invalid)).toThrow()
      expect(() =>
        resolveStorageDocumentBinding({
          providerId: PROVIDER_ID,
          profileId: invalid,
          documentId: 'document-1'
        })
      ).toThrow()
    }
  })

  test('creates, selects, renames, and deletes bounded profiles with isolated preferences', () => {
    expect(MAX_STORAGE_PROFILES_PER_PROVIDER).toBe(8)
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10)
    const first = createStorageProfile(PROVIDER_ID, 'Personal', `test-${suffix}-a`)
    const second = createStorageProfile(PROVIDER_ID, 'Client', `test-${suffix}-b`)
    createdProfileIDs.push(first.id, second.id)

    expect(readActiveStorageProfileID(PROVIDER_ID)).toBe(second.id)
    const persistedCredentialProfiles = new Set(
      storageCredentialRefs(PROVIDER_ID).map((reference) => reference.profileId)
    )
    expect(persistedCredentialProfiles.has(first.id)).toBe(true)
    expect(persistedCredentialProfiles.has(second.id)).toBe(true)
    expect(() => storageCredentialRefs(PROVIDER_ID, '')).toThrow()
    renameStorageProfile(PROVIDER_ID, first.id, 'Personal renamed')
    expect(listStorageProfiles(PROVIDER_ID)).toContainEqual({
      id: first.id,
      name: 'Personal renamed'
    })

    writeStoragePreference(PROVIDER_ID, 'endpoint', 'https://one.example', first.id)
    writeStoragePreference(PROVIDER_ID, 'endpoint', 'https://two.example', second.id)
    writeStoragePreference(PROVIDER_ID, 'bucket', 'one', first.id)
    writeStoragePreference(PROVIDER_ID, 'bucket', 'two', second.id)

    expect(readStoragePreferences(PROVIDER_ID, first.id)).toMatchObject({
      endpoint: 'https://one.example',
      bucket: 'one'
    })
    expect(readStoragePreferences(PROVIDER_ID, second.id)).toMatchObject({
      endpoint: 'https://two.example',
      bucket: 'two'
    })

    copyStorageProfilePreferences(PROVIDER_ID, first.id, second.id)
    expect(readStoragePreferences(PROVIDER_ID, second.id)).toMatchObject({
      endpoint: 'https://one.example',
      bucket: 'one'
    })
    writeStoragePreference(PROVIDER_ID, 'bucket', 'still-isolated', second.id)
    expect(readStoragePreferences(PROVIDER_ID, first.id).bucket).toBe('one')

    writeActiveStorageProfileID(PROVIDER_ID, first.id)
    const fallback = deleteStorageProfile(PROVIDER_ID, first.id)
    expect(readActiveStorageProfileID(PROVIDER_ID)).toBe(fallback)
    expect(readStoragePreferences(PROVIDER_ID, first.id)).toEqual({})
    createdProfileIDs.splice(createdProfileIDs.indexOf(first.id), 1)
  })

  test('rejects empty, control-filled, and overlong profile names', () => {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10)
    expect(() => createStorageProfile(PROVIDER_ID, '', `test-${suffix}-empty`)).toThrow()
    expect(() =>
      createStorageProfile(PROVIDER_ID, 'bad\u0000name', `test-${suffix}-control`)
    ).toThrow()
    expect(() =>
      createStorageProfile(PROVIDER_ID, '界'.repeat(65), `test-${suffix}-long`)
    ).toThrow()
  })

  test('enforces the per-provider profile bound', () => {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 8)
    let index = 0
    while (listStorageProfiles(PROVIDER_ID).length < MAX_STORAGE_PROFILES_PER_PROVIDER) {
      const profile = createStorageProfile(
        PROVIDER_ID,
        `Bounded ${index + 1}`,
        `test-${suffix}-${index++}`
      )
      createdProfileIDs.push(profile.id)
    }
    expect(() =>
      createStorageProfile(PROVIDER_ID, 'One too many', `test-${suffix}-overflow`)
    ).toThrow()
  })
})
