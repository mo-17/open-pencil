import { IS_TAURI } from '@open-pencil/core/constants'

import type { CredentialManager, CredentialResolver } from '@/app/settings/credentials/types'
import { aliyunDriveNativeBridge, aliyunDriveTauriTransport } from '@/app/tauri/aliyun-drive'

import { createStorageRuntimeRegistry } from '../shared/runtime'
import { requireStorageProfileID, type StorageProviderRuntime } from '../types'
import { createAliyunDriveStorageAdapter, type AliyunDriveStorageAdapter } from './adapter'
import { AliyunDriveClient } from './client'
import {
  resolveAliyunDrivePublisherOAuthConfig,
  type AliyunDrivePublisherOAuthBuildConfig
} from './config'
import { aliyunDriveOAuthMetadataStore, type AliyunDriveOAuthMetadataStore } from './oauth/metadata'
import {
  createAliyunDriveOAuthSession,
  type CreateAliyunDriveOAuthSessionOptions
} from './oauth/session'
import type { AliyunDriveTransport } from './types'

type AliyunDriveOAuthSession = ReturnType<typeof createAliyunDriveOAuthSession>

export type AliyunDriveRuntimeServices = Readonly<{
  publisherConfig: AliyunDrivePublisherOAuthBuildConfig | null
  profileId: string
  oauth: AliyunDriveOAuthSession
  client: AliyunDriveClient
  adapter: AliyunDriveStorageAdapter
}>

export type AliyunDriveRuntimeOptions = Readonly<{
  transport?: AliyunDriveTransport
  native?: CreateAliyunDriveOAuthSessionOptions['native']
  metadataStore?: AliyunDriveOAuthMetadataStore
}>

type RuntimeEntry = AliyunDriveRuntimeServices & {
  credentialResolver: CredentialResolver
  native?: CreateAliyunDriveOAuthSessionOptions['native']
  transport?: AliyunDriveTransport
  metadataStore: AliyunDriveOAuthMetadataStore
}

const runtimeRegistry = createStorageRuntimeRegistry<CredentialManager, RuntimeEntry>()

function publisherConfigsEqual(
  left: AliyunDrivePublisherOAuthBuildConfig | null,
  right: AliyunDrivePublisherOAuthBuildConfig | null
): boolean {
  return left?.clientId === right?.clientId
}

export function getAliyunDriveRuntimeServices(
  runtime: StorageProviderRuntime,
  options: AliyunDriveRuntimeOptions = {}
): AliyunDriveRuntimeServices {
  const profileId = requireStorageProfileID(runtime.profileId)
  const publisherConfig = resolveAliyunDrivePublisherOAuthConfig(runtime.preferences)
  const native = options.native ?? (IS_TAURI ? aliyunDriveNativeBridge : undefined)
  const transport = options.transport ?? (IS_TAURI ? aliyunDriveTauriTransport : undefined)
  const metadataStore = options.metadataStore ?? aliyunDriveOAuthMetadataStore
  return runtimeRegistry.getOrCreate(
    runtime.credentialManager,
    profileId,
    (entry) =>
      publisherConfigsEqual(entry.publisherConfig, publisherConfig) &&
      entry.credentialResolver === runtime.credentialResolver &&
      entry.native === native &&
      entry.transport === transport &&
      entry.metadataStore === metadataStore,
    () => {
      const oauth = createAliyunDriveOAuthSession({
        publisherConfig,
        profileId,
        manager: runtime.credentialManager,
        resolver: runtime.credentialResolver,
        metadataStore,
        ...(native ? { native } : {})
      })
      const client = new AliyunDriveClient({
        resolveAccessToken: (signal) => oauth.getAccessToken(signal),
        ...(transport ? { transport } : {})
      })
      return Object.freeze({
        publisherConfig,
        profileId,
        oauth,
        client,
        adapter: createAliyunDriveStorageAdapter(client),
        credentialResolver: runtime.credentialResolver,
        metadataStore,
        ...(native ? { native } : {}),
        ...(transport ? { transport } : {})
      })
    }
  )
}

export function disposeAliyunDriveRuntimeProfile(
  manager: CredentialManager,
  profileId: string
): void {
  runtimeRegistry.dispose(manager, requireStorageProfileID(profileId))
}

export function resetAliyunDriveRuntimeServicesForTests(): void {
  runtimeRegistry.reset()
}
