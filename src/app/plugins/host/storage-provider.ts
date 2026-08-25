import type {
  PluginStorageProviderCapabilityV2,
  PluginStorageProviderContributionV2
} from '@open-pencil/plugin-contracts'

import {
  ALIYUN_DRIVE_STORAGE_ADAPTER_ID,
  ALIYUN_DRIVE_STORAGE_PLUGIN_ID,
  ALIYUN_DRIVE_STORAGE_PROVIDER_ID
} from '@/app/integrations/storage/aliyun-drive/config'
import {
  BAIDU_NETDISK_STORAGE_ADAPTER_ID,
  BAIDU_NETDISK_STORAGE_PLUGIN_ID,
  BAIDU_NETDISK_STORAGE_PROVIDER_ID
} from '@/app/integrations/storage/baidu-netdisk/config'
import {
  GOOGLE_DRIVE_STORAGE_ADAPTER_ID,
  GOOGLE_DRIVE_STORAGE_PLUGIN_ID,
  GOOGLE_DRIVE_STORAGE_PROVIDER_ID
} from '@/app/integrations/storage/google-drive/config'
import {
  ONEDRIVE_STORAGE_ADAPTER_ID,
  ONEDRIVE_STORAGE_PLUGIN_ID,
  ONEDRIVE_STORAGE_PROVIDER_ID
} from '@/app/integrations/storage/onedrive/config'

import {
  ALIYUN_DRIVE_STORAGE_CAPABILITIES,
  ALIYUN_DRIVE_STORAGE_CONFIG_VERSION,
  BAIDU_NETDISK_STORAGE_CAPABILITIES,
  BAIDU_NETDISK_STORAGE_CONFIG_VERSION,
  GOOGLE_DRIVE_STORAGE_CAPABILITIES,
  GOOGLE_DRIVE_STORAGE_CONFIG_VERSION,
  ONEDRIVE_STORAGE_CAPABILITIES,
  ONEDRIVE_STORAGE_CONFIG_VERSION
} from './ids'

export type AppPluginStorageProviderCompatibilityStatus =
  | 'compatible'
  | 'untrusted-adapter'
  | 'plugin-identity-mismatch'
  | 'contribution-identity-mismatch'
  | 'config-version-mismatch'
  | 'capabilities-mismatch'

export type AppPluginStorageProviderCompatibility =
  | Readonly<{ ok: true; status: 'compatible' }>
  | Readonly<{
      ok: false
      status: Exclude<AppPluginStorageProviderCompatibilityStatus, 'compatible'>
      reason: string
    }>

interface TrustedStorageProviderAdapter {
  pluginId: string
  providerId: string
  configVersion: number
  capabilities: readonly PluginStorageProviderCapabilityV2[]
}

const TRUSTED_STORAGE_PROVIDER_ADAPTERS = new Map<string, TrustedStorageProviderAdapter>([
  [
    GOOGLE_DRIVE_STORAGE_ADAPTER_ID,
    {
      pluginId: GOOGLE_DRIVE_STORAGE_PLUGIN_ID,
      providerId: GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
      configVersion: GOOGLE_DRIVE_STORAGE_CONFIG_VERSION,
      capabilities: GOOGLE_DRIVE_STORAGE_CAPABILITIES
    }
  ],
  [
    ONEDRIVE_STORAGE_ADAPTER_ID,
    {
      pluginId: ONEDRIVE_STORAGE_PLUGIN_ID,
      providerId: ONEDRIVE_STORAGE_PROVIDER_ID,
      configVersion: ONEDRIVE_STORAGE_CONFIG_VERSION,
      capabilities: ONEDRIVE_STORAGE_CAPABILITIES
    }
  ],
  [
    ALIYUN_DRIVE_STORAGE_ADAPTER_ID,
    {
      pluginId: ALIYUN_DRIVE_STORAGE_PLUGIN_ID,
      providerId: ALIYUN_DRIVE_STORAGE_PROVIDER_ID,
      configVersion: ALIYUN_DRIVE_STORAGE_CONFIG_VERSION,
      capabilities: ALIYUN_DRIVE_STORAGE_CAPABILITIES
    }
  ],
  [
    BAIDU_NETDISK_STORAGE_ADAPTER_ID,
    {
      pluginId: BAIDU_NETDISK_STORAGE_PLUGIN_ID,
      providerId: BAIDU_NETDISK_STORAGE_PROVIDER_ID,
      configVersion: BAIDU_NETDISK_STORAGE_CONFIG_VERSION,
      capabilities: BAIDU_NETDISK_STORAGE_CAPABILITIES
    }
  ]
])

function incompatible(
  status: Exclude<AppPluginStorageProviderCompatibilityStatus, 'compatible'>,
  reason: string
): AppPluginStorageProviderCompatibility {
  return { ok: false, status, reason }
}

function sameCapabilities(
  actual: readonly PluginStorageProviderCapabilityV2[],
  expected: readonly PluginStorageProviderCapabilityV2[]
): boolean {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    expected.every((capability) => actual.includes(capability))
  )
}

/** Accept only the exact host-owned adapter authority; manifests cannot supply implementation. */
export function inspectPluginStorageProviderCompatibility(
  pluginId: string,
  contribution: PluginStorageProviderContributionV2
): AppPluginStorageProviderCompatibility {
  const adapter = TRUSTED_STORAGE_PROVIDER_ADAPTERS.get(contribution.adapterId)
  if (!adapter) {
    return incompatible(
      'untrusted-adapter',
      `Plugin storage adapter is not trusted: ${contribution.adapterId}`
    )
  }
  if (adapter.pluginId !== pluginId) {
    return incompatible(
      'plugin-identity-mismatch',
      `Plugin ${pluginId} is not authorized to use storage adapter ${contribution.adapterId}`
    )
  }
  if (adapter.providerId !== contribution.providerId) {
    return incompatible(
      'contribution-identity-mismatch',
      `Adapter ${contribution.adapterId} does not authorize provider ${contribution.providerId}`
    )
  }
  if (adapter.configVersion !== contribution.configVersion) {
    return incompatible(
      'config-version-mismatch',
      `Adapter ${contribution.adapterId} requires config version ${adapter.configVersion}`
    )
  }
  if (!sameCapabilities(contribution.capabilities, adapter.capabilities)) {
    return incompatible(
      'capabilities-mismatch',
      `Adapter ${contribution.adapterId} requires its exact trusted capability set`
    )
  }
  return { ok: true, status: 'compatible' }
}
