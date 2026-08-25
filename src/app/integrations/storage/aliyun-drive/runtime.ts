import { IS_TAURI } from '@open-pencil/core/constants'

import type { CredentialManager, CredentialResolver } from '@/app/settings/credentials/types'
import {
  aliyunDriveNativeBridge,
  aliyunDriveTauriTransport
} from '@/app/tauri/aliyun-drive'

import { requireStorageProfileID, type StorageProviderRuntime } from '../types'
import { createAliyunDriveStorageAdapter, type AliyunDriveStorageAdapter } from './adapter'
import { AliyunDriveClient } from './client'
import {
  resolveAliyunDrivePublisherOAuthConfig,
  type AliyunDrivePublisherOAuthBuildConfig
} from './config'
import {
  aliyunDriveOAuthMetadataStore,
  type AliyunDriveOAuthMetadataStore
} from './oauth/metadata'
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

let entriesByManager = new WeakMap<CredentialManager, Map<string, RuntimeEntry>>()
const liveEntries = new Set<RuntimeEntry>()

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
    existing.transport === transport &&
    existing.metadataStore === metadataStore
  ) {
    return existing
  }
  existing?.oauth.dispose()
  if (existing) liveEntries.delete(existing)

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
  const entry: RuntimeEntry = Object.freeze({
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
  entries.set(profileId, entry)
  liveEntries.add(entry)
  return entry
}

export function disposeAliyunDriveRuntimeProfile(
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

export function resetAliyunDriveRuntimeServicesForTests(): void {
  for (const entry of liveEntries) entry.oauth.dispose()
  liveEntries.clear()
  entriesByManager = new WeakMap()
}
