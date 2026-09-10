import { IS_TAURI } from '@open-pencil/core/constants'

import type { CredentialManager, CredentialResolver } from '@/app/settings/credentials/types'
import { baiduNetdiskNativeBridge, baiduNetdiskTauriTransport } from '@/app/tauri/baidu-netdisk'

import { createStorageRuntimeRegistry } from '../shared/runtime'
import { requireStorageProfileID, type StorageProviderRuntime } from '../types'
import { createBaiduNetdiskStorageAdapter, type BaiduNetdiskStorageAdapter } from './adapter'
import { BaiduNetdiskClient } from './client'
import {
  resolveBaiduNetdiskPublisherOAuthConfig,
  type BaiduNetdiskPublisherOAuthConfig
} from './config'
import {
  createBaiduNetdiskOAuthSession,
  type CreateBaiduNetdiskOAuthSessionOptions
} from './oauth/session'
import type { BaiduNetdiskTransport } from './types'

type BaiduNetdiskOAuthSession = ReturnType<typeof createBaiduNetdiskOAuthSession>

export type BaiduNetdiskRuntimeServices = Readonly<{
  publisherConfig: BaiduNetdiskPublisherOAuthConfig | null
  profileId: string
  oauth: BaiduNetdiskOAuthSession
  client: BaiduNetdiskClient
  adapter: BaiduNetdiskStorageAdapter
}>

export type BaiduNetdiskRuntimeOptions = Readonly<{
  transport?: BaiduNetdiskTransport
  native?: CreateBaiduNetdiskOAuthSessionOptions['native']
}>

type RuntimeEntry = BaiduNetdiskRuntimeServices & {
  credentialResolver: CredentialResolver
  native?: CreateBaiduNetdiskOAuthSessionOptions['native']
  transport?: BaiduNetdiskTransport
}

const runtimeRegistry = createStorageRuntimeRegistry<CredentialManager, RuntimeEntry>()

function publisherConfigsEqual(
  left: BaiduNetdiskPublisherOAuthConfig | null,
  right: BaiduNetdiskPublisherOAuthConfig | null
): boolean {
  return left?.appKey === right?.appKey
}

export function getBaiduNetdiskRuntimeServices(
  runtime: StorageProviderRuntime,
  options: BaiduNetdiskRuntimeOptions = {}
): BaiduNetdiskRuntimeServices {
  const profileId = requireStorageProfileID(runtime.profileId)
  const publisherConfig = resolveBaiduNetdiskPublisherOAuthConfig(runtime.preferences)
  const native = options.native ?? (IS_TAURI ? baiduNetdiskNativeBridge : undefined)
  const transport = options.transport ?? (IS_TAURI ? baiduNetdiskTauriTransport : undefined)
  return runtimeRegistry.getOrCreate(
    runtime.credentialManager,
    profileId,
    (entry) =>
      publisherConfigsEqual(entry.publisherConfig, publisherConfig) &&
      entry.credentialResolver === runtime.credentialResolver &&
      entry.native === native &&
      entry.transport === transport,
    () => {
      const oauth = createBaiduNetdiskOAuthSession({
        publisherConfig,
        profileId,
        manager: runtime.credentialManager,
        resolver: runtime.credentialResolver,
        ...(native ? { native } : {})
      })
      const client = new BaiduNetdiskClient({
        resolveAccessToken: (signal) => oauth.accessToken(signal),
        ...(transport ? { transport } : {})
      })
      return Object.freeze({
        publisherConfig,
        profileId,
        oauth,
        client,
        adapter: createBaiduNetdiskStorageAdapter(client),
        credentialResolver: runtime.credentialResolver,
        ...(native ? { native } : {}),
        ...(transport ? { transport } : {})
      })
    }
  )
}

export function disposeBaiduNetdiskRuntimeProfile(
  manager: CredentialManager,
  profileId: string
): void {
  runtimeRegistry.dispose(manager, requireStorageProfileID(profileId))
}

export function resetBaiduNetdiskRuntimeServicesForTests(): void {
  runtimeRegistry.reset()
}
