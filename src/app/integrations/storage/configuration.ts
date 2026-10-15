import type { CredentialStatus } from '@/app/settings/credentials/types'

import { requireStorageProfileID } from './types'
import type {
  StorageDocumentAuthority,
  StorageProviderID,
  StorageProviderRegistration
} from './types'

interface StorageConfigurationServices {
  provider(id: StorageProviderID): StorageProviderRegistration
  profileId(id: StorageProviderID): string
  enabled(id: StorageProviderID): boolean
  preferencesComplete(id: StorageProviderID, profileId: string): boolean
  credentialStatuses(
    id: StorageProviderID,
    profileId: string
  ): Promise<Record<string, CredentialStatus>>
  storedAuthority(
    id: StorageProviderID,
    profileId: string
  ): Promise<StorageDocumentAuthority | null>
}

/** Configuration follows the exact profile's durable grant, without refreshing access tokens. */
export function createStorageConfigurationReader(services: StorageConfigurationServices) {
  return async (providerId: StorageProviderID): Promise<boolean> => {
    const profileId = requireStorageProfileID(services.profileId(providerId))
    const current = () =>
      services.enabled(providerId) && services.profileId(providerId) === profileId
    if (!current() || !services.preferencesComplete(providerId, profileId)) return false
    const provider = services.provider(providerId)
    if (provider.authorityMode === 'account-grant') {
      const authority = await services.storedAuthority(providerId, profileId)
      return current() && services.preferencesComplete(providerId, profileId) && authority !== null
    }
    const statuses = await services.credentialStatuses(providerId, profileId)
    return (
      current() &&
      services.preferencesComplete(providerId, profileId) &&
      provider.credentialFields.every(
        (field) => !field.required || statuses[field.id] === 'configured'
      )
    )
  }
}
