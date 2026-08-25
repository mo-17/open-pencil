import { IS_TAURI } from '@open-pencil/core/constants'

import type { CredentialManager, CredentialResolver } from '@/app/settings/credentials/types'
import { baiduNetdiskNativeBridge, baiduNetdiskTauriTransport } from '@/app/tauri/baidu-netdisk'

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

let entriesByManager = new WeakMap<CredentialManager, Map<string, RuntimeEntry>>()
const liveEntries = new Set<RuntimeEntry>()

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
  let entries = entriesByManager.get(runtime.credentialManager)
  if (!entries) {
    entries = new Map()
    entriesByManager.set(runtime.credentialManager, entries)
  }
  const existing = entries.get(profileId)
  if (
    existing &&
    publisherConfigsEqual(existing.publisherConfig, publisherConfig) &&
    existing.credentialResolver === runtime.credentialResolver &&
    existing.native === native &&
    existing.transport === transport
  ) {
    return existing
  }
  existing?.oauth.dispose()
  if (existing) liveEntries.delete(existing)

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
  const entry: RuntimeEntry = Object.freeze({
    publisherConfig,
    profileId,
    oauth,
    client,
    adapter: createBaiduNetdiskStorageAdapter(client),
    credentialResolver: runtime.credentialResolver,
    ...(native ? { native } : {}),
    ...(transport ? { transport } : {})
  })
  entries.set(profileId, entry)
  liveEntries.add(entry)
  return entry
}

export function disposeBaiduNetdiskRuntimeProfile(
  manager: CredentialManager,
  profileId: string
): void {
  const id = requireStorageProfileID(profileId)
  const entries = entriesByManager.get(manager)
  const entry = entries?.get(id)
  if (!entry) return
  entry.oauth.dispose()
  entries?.delete(id)
  liveEntries.delete(entry)
}

export function resetBaiduNetdiskRuntimeServicesForTests(): void {
  for (const entry of liveEntries) entry.oauth.dispose()
  liveEntries.clear()
  entriesByManager = new WeakMap()
}
