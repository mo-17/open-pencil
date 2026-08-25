import { appCredentialServices } from '@/app/settings/credentials/app'
import { credentialRef } from '@/app/settings/credentials/reference'
import type { CredentialRef, CredentialStatus } from '@/app/settings/credentials/types'

import { ALIYUN_DRIVE_STORAGE_PROVIDER_ID } from './aliyun-drive/config'
import { getAliyunDriveRuntimeServices } from './aliyun-drive/runtime'
import { BAIDU_NETDISK_STORAGE_PROVIDER_ID } from './baidu-netdisk/config'
import { getBaiduNetdiskRuntimeServices } from './baidu-netdisk/runtime'
import { GOOGLE_DRIVE_STORAGE_PROVIDER_ID } from './google-drive/config'
import { getGoogleDriveRuntimeServices } from './google-drive/runtime'
import { ONEDRIVE_STORAGE_PROVIDER_ID } from './onedrive/config'
import { getOneDriveRuntimeServices } from './onedrive/runtime'
import { storageProviderPluginEnabled } from './plugin-gate'
import {
  activeStorageProviderID,
  listStorageProfiles,
  readActiveStorageProfileID,
  readStoragePreferences
} from './preferences'
import { storageProviderRegistry } from './providers'
import { ensureS3StorageAuthority, S3_COMPATIBLE_STORAGE_PROVIDER_ID } from './s3/authority'
import {
  requireStorageProfileID,
  type StorageAdapter,
  type StorageDocumentAuthority,
  type StorageProviderID
} from './types'

export function storageCredentialRefs(
  providerID: StorageProviderID,
  profileID?: string
): CredentialRef[] {
  const provider = storageProviderRegistry.get(providerID)
  const profileIDs =
    profileID === undefined
      ? listStorageProfiles(providerID).map((profile) => profile.id)
      : [requireStorageProfileID(profileID)]
  return profileIDs.flatMap((id) =>
    provider.credentialFields.map((field) => credentialRef(providerID, field.id, id))
  )
}

export async function storageCredentialStatuses(
  providerID: StorageProviderID,
  profileID = readActiveStorageProfileID(providerID)
): Promise<Record<string, CredentialStatus>> {
  const provider = storageProviderRegistry.get(providerID)
  const id = requireStorageProfileID(profileID)
  const entries = await Promise.all(
    provider.credentialFields.map(async (field) => {
      const status = await appCredentialServices.manager.status(
        credentialRef(providerID, field.id, id)
      )
      return [field.id, status] as const
    })
  )
  return Object.fromEntries(entries)
}

export function createActiveStorageAdapter(
  providerID: StorageProviderID = activeStorageProviderID.value,
  profileID = readActiveStorageProfileID(providerID)
): StorageAdapter {
  const id = requireStorageProfileID(profileID)
  if (!storageProviderPluginEnabled(providerID)) {
    throw new Error(`Storage provider plugin is disabled: ${providerID}`)
  }
  return storageProviderRegistry.createAdapter(providerID, {
    preferences: readStoragePreferences(providerID, id),
    credentials: appCredentialServices.resolver,
    credentialManager: appCredentialServices.manager,
    profileId: id
  })
}

/** Reads durable, non-secret account metadata without refreshing an OAuth access token. */
export async function readGoogleDriveStoredAuthority(
  profileID = readActiveStorageProfileID(GOOGLE_DRIVE_STORAGE_PROVIDER_ID)
): Promise<StorageDocumentAuthority | null> {
  const id = requireStorageProfileID(profileID)
  if (!storageProviderPluginEnabled(GOOGLE_DRIVE_STORAGE_PROVIDER_ID)) return null
  const services = getGoogleDriveRuntimeServices({
    preferences: readStoragePreferences(GOOGLE_DRIVE_STORAGE_PROVIDER_ID, id),
    profileId: id,
    credentialManager: appCredentialServices.manager,
    credentialResolver: appCredentialServices.resolver,
    resolveCredential() {
      return Promise.reject(new Error('Google Drive does not expose raw credentials'))
    }
  })
  const status = await services.oauth.status()
  return status.state === 'connected'
    ? {
        accountId: status.subject,
        authorizationVersion: status.authorizationVersion
      }
    : null
}

/** Reads durable OneDrive account metadata without refreshing an access token. */
export async function readOneDriveStoredAuthority(
  profileID = readActiveStorageProfileID(ONEDRIVE_STORAGE_PROVIDER_ID)
): Promise<StorageDocumentAuthority | null> {
  const id = requireStorageProfileID(profileID)
  if (!storageProviderPluginEnabled(ONEDRIVE_STORAGE_PROVIDER_ID)) return null
  const services = getOneDriveRuntimeServices({
    preferences: readStoragePreferences(ONEDRIVE_STORAGE_PROVIDER_ID, id),
    profileId: id,
    credentialManager: appCredentialServices.manager,
    credentialResolver: appCredentialServices.resolver,
    resolveCredential() {
      return Promise.reject(new Error('OneDrive does not expose raw credentials'))
    }
  })
  const status = await services.oauth.status()
  return status.state === 'connected'
    ? {
        accountId: status.subject,
        authorizationVersion: status.authorizationVersion
      }
    : null
}

/** Reads durable Aliyun Drive account metadata without refreshing an access token. */
export async function readAliyunDriveStoredAuthority(
  profileID = readActiveStorageProfileID(ALIYUN_DRIVE_STORAGE_PROVIDER_ID)
): Promise<StorageDocumentAuthority | null> {
  const id = requireStorageProfileID(profileID)
  if (!storageProviderPluginEnabled(ALIYUN_DRIVE_STORAGE_PROVIDER_ID)) return null
  const services = getAliyunDriveRuntimeServices({
    preferences: readStoragePreferences(ALIYUN_DRIVE_STORAGE_PROVIDER_ID, id),
    profileId: id,
    credentialManager: appCredentialServices.manager,
    credentialResolver: appCredentialServices.resolver,
    resolveCredential() {
      return Promise.reject(new Error('Aliyun Drive does not expose raw credentials'))
    }
  })
  const status = await services.oauth.status()
  return status.state === 'connected' || status.state === 'expired'
    ? {
        accountId: status.subject,
        authorizationVersion: status.authorizationVersion
      }
    : null
}

/** Reads durable Baidu Netdisk account metadata without refreshing an access token. */
export async function readBaiduNetdiskStoredAuthority(
  profileID = readActiveStorageProfileID(BAIDU_NETDISK_STORAGE_PROVIDER_ID)
): Promise<StorageDocumentAuthority | null> {
  const id = requireStorageProfileID(profileID)
  if (!storageProviderPluginEnabled(BAIDU_NETDISK_STORAGE_PROVIDER_ID)) return null
  const services = getBaiduNetdiskRuntimeServices({
    preferences: readStoragePreferences(BAIDU_NETDISK_STORAGE_PROVIDER_ID, id),
    profileId: id,
    credentialManager: appCredentialServices.manager,
    credentialResolver: appCredentialServices.resolver,
    resolveCredential() {
      return Promise.reject(new Error('Baidu Netdisk does not expose raw credentials'))
    }
  })
  const status = await services.oauth.status()
  return status.state === 'connected' ? status.authority : null
}

/** Reads the current durable authority without resolving provider secrets or making a request. */
export async function readStoredStorageAuthority(
  providerID: StorageProviderID,
  profileID = readActiveStorageProfileID(providerID)
): Promise<StorageDocumentAuthority | null> {
  const id = requireStorageProfileID(profileID)
  if (!storageProviderPluginEnabled(providerID)) return null
  if (providerID === S3_COMPATIBLE_STORAGE_PROVIDER_ID) {
    return ensureS3StorageAuthority(id)
  }
  if (providerID === GOOGLE_DRIVE_STORAGE_PROVIDER_ID) {
    return readGoogleDriveStoredAuthority(id)
  }
  if (providerID === ONEDRIVE_STORAGE_PROVIDER_ID) {
    return readOneDriveStoredAuthority(id)
  }
  if (providerID === ALIYUN_DRIVE_STORAGE_PROVIDER_ID) {
    return readAliyunDriveStoredAuthority(id)
  }
  if (providerID === BAIDU_NETDISK_STORAGE_PROVIDER_ID) {
    return readBaiduNetdiskStoredAuthority(id)
  }
  return null
}
