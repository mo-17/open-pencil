import { useLocalStorage } from '@vueuse/core'
import { computed } from 'vue'

import {
  GOOGLE_DRIVE_CLIENT_ID_FIELD,
  GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
  resolveGoogleDriveClientId
} from './google-drive/config'
import { storageProviderRegistry } from './providers'
import {
  ensureS3StorageAuthority,
  markNewS3StorageProfile,
  removeS3StorageAuthority,
  rotateS3StorageAuthorization,
  S3_COMPATIBLE_STORAGE_PROVIDER_ID
} from './s3/authority'
import {
  DEFAULT_STORAGE_PROFILE_ID,
  isStorageProfileID,
  requireStorageProfileID,
  type StorageFieldID,
  type StorageProviderID
} from './types'

export type StoragePreferences = Record<StorageFieldID, string>
export type StorageProfile = Readonly<{ id: string; name: string }>

type LegacyStoragePreferences = Partial<Record<StorageProviderID, StoragePreferences>>
type ProfileStoragePreferences = Partial<
  Record<StorageProviderID, Partial<Record<string, StoragePreferences>>>
>
type StorageProfileCatalog = Partial<Record<StorageProviderID, StorageProfile[]>>

export const MAX_STORAGE_PROFILES_PER_PROVIDER = 8
export const MAX_STORAGE_PROFILE_NAME_LENGTH = 64

const DEFAULT_PROFILE_NAME = 'Default'

export const activeStorageProviderID = useLocalStorage<StorageProviderID>(
  'open-pencil:storage:provider',
  GOOGLE_DRIVE_STORAGE_PROVIDER_ID
)

const legacyStoredPreferences = useLocalStorage<LegacyStoragePreferences>(
  'open-pencil:storage:preferences',
  {}
)
const storedPreferences = useLocalStorage<ProfileStoragePreferences>(
  'open-pencil:storage:profile-preferences:v1',
  {}
)
const storedProfiles = useLocalStorage<Partial<Record<StorageProviderID, string>>>(
  'open-pencil:storage:profiles',
  {}
)
const storedProfileCatalog = useLocalStorage<StorageProfileCatalog>(
  'open-pencil:storage:profile-catalog:v1',
  {}
)

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.hasOwn(value, key)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function withoutKey<T>(value: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(value).filter(([candidate]) => candidate !== key))
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
}

function normalizeProfileName(name: string): string {
  const normalized = name.trim()
  if (
    !normalized ||
    Array.from(normalized).length > MAX_STORAGE_PROFILE_NAME_LENGTH ||
    containsControlCharacter(normalized)
  ) {
    throw new Error(
      `Storage profile name must contain 1-${MAX_STORAGE_PROFILE_NAME_LENGTH} characters`
    )
  }
  return normalized
}

function storedCatalog(providerID: StorageProviderID): StorageProfile[] {
  const rawProfiles: unknown = storedProfileCatalog.value[providerID]
  const profiles: unknown[] = Array.isArray(rawProfiles) ? rawProfiles : []
  const seen = new Set<string>()
  const valid: StorageProfile[] = []
  for (const candidate of profiles) {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== 'string' ||
      !isStorageProfileID(candidate.id) ||
      seen.has(candidate.id) ||
      typeof candidate.name !== 'string'
    ) {
      continue
    }
    const normalizedName = candidate.name.trim()
    if (
      !normalizedName ||
      Array.from(normalizedName).length > MAX_STORAGE_PROFILE_NAME_LENGTH ||
      containsControlCharacter(normalizedName)
    ) {
      continue
    }
    valid.push({ id: candidate.id, name: normalizedName })
    seen.add(candidate.id)
    if (valid.length === MAX_STORAGE_PROFILES_PER_PROVIDER) break
  }
  return valid
}

function writeCatalog(providerID: StorageProviderID, profiles: readonly StorageProfile[]): void {
  storedProfileCatalog.value = {
    ...storedProfileCatalog.value,
    [providerID]: profiles.map((profile) => ({ ...profile }))
  }
}

function ensureCatalogProfile(providerID: StorageProviderID, profileID: string): void {
  const profiles = storedCatalog(providerID)
  if (profiles.some((profile) => profile.id === profileID)) return
  if (profiles.length >= MAX_STORAGE_PROFILES_PER_PROVIDER) {
    throw new Error(
      `Storage supports at most ${MAX_STORAGE_PROFILES_PER_PROVIDER} profiles per provider`
    )
  }
  writeCatalog(providerID, [
    ...profiles,
    {
      id: profileID,
      name: profileID === DEFAULT_STORAGE_PROFILE_ID ? DEFAULT_PROFILE_NAME : profileID
    }
  ])
}

export function readActiveStorageProfileID(
  providerID: StorageProviderID = activeStorageProviderID.value
): string {
  const stored = storedProfiles.value[providerID]
  return stored && isStorageProfileID(stored) ? stored : DEFAULT_STORAGE_PROFILE_ID
}

export function writeActiveStorageProfileID(
  providerID: StorageProviderID,
  profileID: string
): void {
  storageProviderRegistry.get(providerID)
  const normalized = requireStorageProfileID(profileID)
  ensureCatalogProfile(providerID, normalized)
  storedProfiles.value = { ...storedProfiles.value, [providerID]: normalized }
}

export const activeStorageProfileID = computed({
  get: () => readActiveStorageProfileID(),
  set: (profileID: string) => writeActiveStorageProfileID(activeStorageProviderID.value, profileID)
})

export function listStorageProfiles(providerID: StorageProviderID): readonly StorageProfile[] {
  storageProviderRegistry.get(providerID)
  const activeProfileID = readActiveStorageProfileID(providerID)
  const profiles = storedCatalog(providerID)
  const result = profiles.some((profile) => profile.id === activeProfileID)
    ? profiles
    : [
        ...profiles,
        {
          id: activeProfileID,
          name:
            activeProfileID === DEFAULT_STORAGE_PROFILE_ID ? DEFAULT_PROFILE_NAME : activeProfileID
        }
      ]
  if (providerID === S3_COMPATIBLE_STORAGE_PROVIDER_ID) {
    for (const profile of result) ensureS3StorageAuthority(profile.id)
  }
  return result
}

function generatedProfileID(profiles: readonly StorageProfile[]): string {
  const existing = new Set(profiles.map((profile) => profile.id))
  for (let attempt = 0; attempt < 8; attempt++) {
    const id = `profile-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
    if (!existing.has(id)) return id
  }
  throw new Error('Could not allocate a unique storage profile ID')
}

export function createStorageProfile(
  providerID: StorageProviderID,
  name: string,
  requestedProfileID?: string
): StorageProfile {
  storageProviderRegistry.get(providerID)
  const profiles = listStorageProfiles(providerID)
  if (profiles.length >= MAX_STORAGE_PROFILES_PER_PROVIDER) {
    throw new Error(
      `Storage supports at most ${MAX_STORAGE_PROFILES_PER_PROVIDER} profiles per provider`
    )
  }
  const id = requestedProfileID
    ? requireStorageProfileID(requestedProfileID)
    : generatedProfileID(profiles)
  if (profiles.some((profile) => profile.id === id)) {
    throw new Error(`Storage profile already exists: ${id}`)
  }
  const profile = { id, name: normalizeProfileName(name) }
  if (providerID === S3_COMPATIBLE_STORAGE_PROVIDER_ID) markNewS3StorageProfile(id)
  writeCatalog(providerID, [...profiles, profile])
  storedProfiles.value = { ...storedProfiles.value, [providerID]: id }
  return profile
}

export function renameStorageProfile(
  providerID: StorageProviderID,
  profileID: string,
  name: string
): void {
  const id = requireStorageProfileID(profileID)
  const profiles = listStorageProfiles(providerID)
  if (!profiles.some((profile) => profile.id === id)) {
    throw new Error(`Unknown storage profile: ${id}`)
  }
  writeCatalog(
    providerID,
    profiles.map((profile) =>
      profile.id === id ? { id: profile.id, name: normalizeProfileName(name) } : profile
    )
  )
}

export function copyStorageProfilePreferences(
  providerID: StorageProviderID,
  sourceProfileID: string,
  targetProfileID: string
): void {
  const sourceID = requireStorageProfileID(sourceProfileID)
  const targetID = requireStorageProfileID(targetProfileID)
  const profileIDs = new Set(listStorageProfiles(providerID).map((profile) => profile.id))
  if (!profileIDs.has(sourceID) || !profileIDs.has(targetID)) {
    throw new Error('Storage preferences can only be copied between existing profiles')
  }
  const source = readStoragePreferences(providerID, sourceID)
  for (const field of storageProviderRegistry.get(providerID).preferenceFields) {
    writeStoragePreference(providerID, field.id, source[field.id] ?? '', targetID)
  }
}

export function deleteStorageProfile(providerID: StorageProviderID, profileID: string): string {
  const id = requireStorageProfileID(profileID)
  const profiles = listStorageProfiles(providerID)
  if (!profiles.some((profile) => profile.id === id)) {
    throw new Error(`Unknown storage profile: ${id}`)
  }
  const remaining = profiles.filter((profile) => profile.id !== id)
  const fallback = remaining[0]?.id ?? DEFAULT_STORAGE_PROFILE_ID
  writeCatalog(
    providerID,
    remaining.length > 0 ? remaining : [{ id: fallback, name: DEFAULT_PROFILE_NAME }]
  )

  const providerPreferences = withoutKey(storedPreferences.value[providerID] ?? {}, id)
  storedPreferences.value = { ...storedPreferences.value, [providerID]: providerPreferences }
  if (id === readActiveStorageProfileID(providerID)) {
    storedProfiles.value = { ...storedProfiles.value, [providerID]: fallback }
  }
  if (id === DEFAULT_STORAGE_PROFILE_ID && hasOwn(legacyStoredPreferences.value, providerID)) {
    legacyStoredPreferences.value = withoutKey(legacyStoredPreferences.value, providerID)
  }
  if (providerID === S3_COMPATIBLE_STORAGE_PROVIDER_ID) removeS3StorageAuthority(id)
  return fallback
}

function profilePreferences(providerID: StorageProviderID, profileID: string): StoragePreferences {
  const id = requireStorageProfileID(profileID)
  const providerPreferences = storedPreferences.value[providerID] ?? {}
  if (hasOwn(providerPreferences, id)) return { ...providerPreferences[id] }

  const legacy = legacyStoredPreferences.value[providerID]
  if (!legacy || id !== readActiveStorageProfileID(providerID)) return {}
  const migrated = Object.fromEntries(
    storageProviderRegistry
      .get(providerID)
      .preferenceFields.map((field) => [field.id, legacy[field.id]?.trim() ?? ''])
  )
  storedPreferences.value = {
    ...storedPreferences.value,
    [providerID]: { ...providerPreferences, [id]: migrated }
  }
  legacyStoredPreferences.value = withoutKey(legacyStoredPreferences.value, providerID)
  return { ...migrated }
}

export function readStoragePreferences(
  providerID: StorageProviderID,
  profileID = readActiveStorageProfileID(providerID)
): Readonly<Record<StorageFieldID, string>> {
  const stored = profilePreferences(providerID, profileID)
  if (providerID !== GOOGLE_DRIVE_STORAGE_PROVIDER_ID) return stored
  const clientId = resolveGoogleDriveClientId(stored)
  return clientId ? { ...stored, [GOOGLE_DRIVE_CLIENT_ID_FIELD]: clientId } : stored
}

export function writeStoragePreference(
  providerID: StorageProviderID,
  field: StorageFieldID,
  value: string,
  profileID = readActiveStorageProfileID(providerID)
): void {
  const provider = storageProviderRegistry.get(providerID)
  if (!provider.preferenceFields.some((definition) => definition.id === field)) {
    throw new Error(`Unknown preference field for ${providerID}: ${field}`)
  }
  const id = requireStorageProfileID(profileID)
  const providerPreferences = storedPreferences.value[providerID] ?? {}
  const current = profilePreferences(providerID, id)
  const nextValue = value.trim()
  if ((current[field] ?? '') === nextValue) return
  if (providerID === S3_COMPATIBLE_STORAGE_PROVIDER_ID) rotateS3StorageAuthorization(id)
  storedPreferences.value = {
    ...storedPreferences.value,
    [providerID]: { ...providerPreferences, [id]: { ...current, [field]: nextValue } }
  }
}

export function storagePreferencesComplete(
  providerID: StorageProviderID,
  profileID = readActiveStorageProfileID(providerID)
): boolean {
  const provider = storageProviderRegistry.get(providerID)
  const preferences = readStoragePreferences(providerID, profileID)
  return provider.preferenceFields.every(
    (field) => !field.required || Boolean(preferences[field.id]?.trim())
  )
}
