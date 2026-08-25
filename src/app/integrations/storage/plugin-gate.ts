import {
  ALIYUN_DRIVE_STORAGE_PLUGIN_ID,
  ALIYUN_DRIVE_STORAGE_PROVIDER_ID
} from '@/app/integrations/storage/aliyun-drive/config'
import {
  BAIDU_NETDISK_STORAGE_PLUGIN_ID,
  BAIDU_NETDISK_STORAGE_PROVIDER_ID
} from '@/app/integrations/storage/baidu-netdisk/config'
import {
  GOOGLE_DRIVE_STORAGE_PLUGIN_ID,
  GOOGLE_DRIVE_STORAGE_PROVIDER_ID
} from '@/app/integrations/storage/google-drive/config'
import {
  ONEDRIVE_STORAGE_PLUGIN_ID,
  ONEDRIVE_STORAGE_PROVIDER_ID
} from '@/app/integrations/storage/onedrive/config'
import { appPluginStore, appPluginStoreSnapshot } from '@/app/plugins/app'
import { inspectPluginStorageProviderCompatibility } from '@/app/plugins/host/storage-provider'

import type { StorageProviderID } from './types'

export type StorageProviderPluginState = 'loading' | 'enabled' | 'disabled'

const PLUGIN_BY_STORAGE_PROVIDER = new Map<string, string>([
  [GOOGLE_DRIVE_STORAGE_PROVIDER_ID, GOOGLE_DRIVE_STORAGE_PLUGIN_ID],
  [ONEDRIVE_STORAGE_PROVIDER_ID, ONEDRIVE_STORAGE_PLUGIN_ID],
  [ALIYUN_DRIVE_STORAGE_PROVIDER_ID, ALIYUN_DRIVE_STORAGE_PLUGIN_ID],
  [BAIDU_NETDISK_STORAGE_PROVIDER_ID, BAIDU_NETDISK_STORAGE_PLUGIN_ID]
])

/** Storage implementation stays host-owned; this gate only follows accepted plugin lifecycle state. */
export function storageProviderPluginState(
  providerId: StorageProviderID
): StorageProviderPluginState {
  const pluginId = PLUGIN_BY_STORAGE_PROVIDER.get(providerId)
  if (!pluginId) return 'enabled'
  const snapshot = appPluginStoreSnapshot.value
  if (!snapshot.ready) return 'loading'
  const installed = appPluginStore.storageProvider(pluginId, providerId)
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
