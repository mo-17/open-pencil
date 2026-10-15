import { describe, expect, test } from 'bun:test'

import { createStorageConfigurationReader } from '@/app/integrations/storage/configuration'
import {
  GOOGLE_DRIVE_STORAGE_PROVIDER,
  S3_STORAGE_PROVIDER
} from '@/app/integrations/storage/providers'
import type { StorageDocumentAuthority, StorageProviderID } from '@/app/integrations/storage/types'
import type { CredentialStatus } from '@/app/settings/credentials/types'

function fixture(providerId: StorageProviderID = 'google-drive') {
  let profileId = 'default'
  let enabled = true
  let preferencesComplete = true
  const authorities = new Map<string, StorageDocumentAuthority>()
  let statuses: Record<string, CredentialStatus> = {}
  const calls: string[] = []
  const services = {
    provider: (id: StorageProviderID) =>
      id === 'google-drive' ? GOOGLE_DRIVE_STORAGE_PROVIDER : S3_STORAGE_PROVIDER,
    profileId: () => profileId,
    enabled: () => enabled,
    preferencesComplete: () => preferencesComplete,
    credentialStatuses: async (id: StorageProviderID, profile: string) => {
      calls.push(`credentials:${id}:${profile}`)
      return statuses
    },
    storedAuthority: async (id: StorageProviderID, profile: string) => {
      calls.push(`authority:${id}:${profile}`)
      return authorities.get(profile) ?? null
    }
  }
  const read = createStorageConfigurationReader(services)
  return {
    read: () => read(providerId),
    services,
    authorities,
    calls,
    profile: (value: string) => {
      profileId = value
    },
    enable: (value: boolean) => {
      enabled = value
    },
    preferences: (value: boolean) => {
      preferencesComplete = value
    },
    credentials: (value: Record<string, CredentialStatus>) => {
      statuses = value
    }
  }
}
const authority: StorageDocumentAuthority = {
  accountId: 'fixture-account',
  authorizationVersion: 'fixture-grant-v1'
}

describe('storage configuration reads the current profile authority', () => {
  test('an account provider without a connected grant is unconfigured even with no declared credentials', async () => {
    const f = fixture()
    expect(await f.read()).toBe(false)
    expect(f.calls).toEqual(['authority:google-drive:default'])
  })
  test('a valid grant for the current profile is ready without resolving credential fields', async () => {
    const f = fixture()
    f.authorities.set('default', authority)
    expect(await f.read()).toBe(true)
    expect(f.calls).toEqual(['authority:google-drive:default'])
  })
  test('an old profile grant does not configure the selected profile, and disconnection clears readiness', async () => {
    const f = fixture()
    f.authorities.set('old-profile', authority)
    expect(await f.read()).toBe(false)
    f.profile('old-profile')
    expect(await f.read()).toBe(true)
    f.authorities.delete('old-profile')
    expect(await f.read()).toBe(false)
  })
  test('a grant that finishes reading after the profile changes cannot configure the new profile', async () => {
    const f = fixture()
    const authorityRead = Promise.withResolvers<StorageDocumentAuthority | null>()
    f.services.storedAuthority = async (id, profile) => {
      f.calls.push(`authority:${id}:${profile}`)
      return authorityRead.promise
    }
    const reading = f.read()
    f.profile('next-profile')
    authorityRead.resolve(authority)
    expect(await reading).toBe(false)
    expect(f.calls).toEqual(['authority:google-drive:default'])
  })
  test('a late account grant cannot validate preferences cleared while its status was loading', async () => {
    const f = fixture()
    const authorityRead = Promise.withResolvers<StorageDocumentAuthority | null>()
    f.services.storedAuthority = async () => authorityRead.promise
    const reading = f.read()
    f.preferences(false)
    authorityRead.resolve(authority)
    expect(await reading).toBe(false)
  })
  test('a disabled provider never becomes ready from a stored grant', async () => {
    const f = fixture()
    f.authorities.set('default', authority)
    f.enable(false)
    expect(await f.read()).toBe(false)
    expect(f.calls).toEqual([])
  })
  test('S3 retains required preference and credential readiness without an account grant read', async () => {
    const f = fixture('s3-compatible')
    f.preferences(false)
    expect(await f.read()).toBe(false)
    f.preferences(true)
    f.credentials({ 'access-key-id': 'configured', 'secret-access-key': 'missing' })
    expect(await f.read()).toBe(false)
    f.credentials({ 'access-key-id': 'configured', 'secret-access-key': 'configured' })
    expect(await f.read()).toBe(true)
    expect(f.calls).toEqual([
      'credentials:s3-compatible:default',
      'credentials:s3-compatible:default'
    ])
  })
  test('late S3 credential status cannot configure another profile or a newly disabled provider', async () => {
    const f = fixture('s3-compatible')
    f.services.credentialStatuses = async () => {
      f.profile('next-profile')
      return { 'access-key-id': 'configured', 'secret-access-key': 'configured' }
    }
    expect(await f.read()).toBe(false)
    f.services.credentialStatuses = async () => {
      f.enable(false)
      return { 'access-key-id': 'configured', 'secret-access-key': 'configured' }
    }
    expect(await f.read()).toBe(false)
  })
})
