import {
  GOOGLE_DRIVE_STORAGE_PLUGIN_ID,
  GOOGLE_DRIVE_STORAGE_PROVIDER_ID
} from '@/app/integrations/storage/google-drive/config'
import { appPluginStore, appPluginStoreSnapshot } from '@/app/plugins/app'
import { inspectPluginStorageProviderCompatibility } from '@/app/plugins/host/storage-provider'

import type { StorageProviderID } from './types'

export type StorageProviderPluginState = 'loading' | 'enabled' | 'disabled'

/** Storage implementation stays host-owned; this gate only follows accepted plugin lifecycle state. */
export function storageProviderPluginState(
  providerId: StorageProviderID
): StorageProviderPluginState {
  if (providerId !== GOOGLE_DRIVE_STORAGE_PROVIDER_ID) return 'enabled'
  const snapshot = appPluginStoreSnapshot.value
  if (!snapshot.ready) return 'loading'
  const installed = appPluginStore.storageProvider(
    GOOGLE_DRIVE_STORAGE_PLUGIN_ID,
    GOOGLE_DRIVE_STORAGE_PROVIDER_ID
  )
  return installed &&
    inspectPluginStorageProviderCompatibility(
      installed.plugin.package.manifest.plugin.id,
      installed.contribution
    ).ok
    ? 'enabled'
    : 'disabled'
}

export function storageProviderPluginEnabled(providerId: StorageProviderID): boolean {
  return storageProviderPluginState(providerId) === 'enabled'
}
