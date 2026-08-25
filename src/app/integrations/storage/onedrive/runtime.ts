import { IS_TAURI } from '@open-pencil/core/constants'

import type { CredentialManager, CredentialResolver } from '@/app/settings/credentials/types'
import { oneDriveNativeBridge, oneDriveTauriTransport } from '@/app/tauri/onedrive'

import { requireStorageProfileID, type StorageProviderRuntime } from '../types'
import { createOneDriveStorageAdapter, type OneDriveStorageAdapter } from './adapter'
import { OneDriveClient } from './client'
import { resolveOneDriveClientId } from './config'
import { createOneDriveOAuthSession, type CreateOneDriveOAuthSessionOptions } from './oauth/session'
import type { OneDriveTransport } from './types'

type OneDriveOAuthSession = ReturnType<typeof createOneDriveOAuthSession>

export type OneDriveRuntimeServices = Readonly<{
  clientId: string | null
  profileId: string
  oauth: OneDriveOAuthSession
  client: OneDriveClient
  adapter: OneDriveStorageAdapter
}>

export type OneDriveRuntimeOptions = Readonly<{
  transport?: OneDriveTransport
  native?: CreateOneDriveOAuthSessionOptions['native']
}>

type RuntimeEntry = OneDriveRuntimeServices & {
  credentialResolver: CredentialResolver
  native?: CreateOneDriveOAuthSessionOptions['native']
  transport?: OneDriveTransport
}

let entriesByManager = new WeakMap<CredentialManager, Map<string, RuntimeEntry>>()
const liveEntries = new Set<RuntimeEntry>()

export function getOneDriveRuntimeServices(
  runtime: StorageProviderRuntime,
  options: OneDriveRuntimeOptions = {}
): OneDriveRuntimeServices {
  const profileId = requireStorageProfileID(runtime.profileId)
  const clientId = resolveOneDriveClientId(runtime.preferences)
  const native = options.native ?? (IS_TAURI ? oneDriveNativeBridge : undefined)
  const transport = options.transport ?? (IS_TAURI ? oneDriveTauriTransport : undefined)
  let entries = entriesByManager.get(runtime.credentialManager)
  if (!entries) {
    entries = new Map()
    entriesByManager.set(runtime.credentialManager, entries)
  }
  const existing = entries.get(profileId)
  if (
    existing &&
    existing.clientId === clientId &&
    existing.credentialResolver === runtime.credentialResolver &&
    existing.native === native &&
    existing.transport === transport
  ) {
    return existing
  }
  existing?.oauth.dispose()
  if (existing) liveEntries.delete(existing)

  const oauth = createOneDriveOAuthSession({
    clientId,
    profileId,
    manager: runtime.credentialManager,
    resolver: runtime.credentialResolver,
    ...(native ? { native } : {})
  })
  const client = new OneDriveClient({
    tokenSource: oauth,
    ...(transport ? { transport } : {})
  })
  const entry: RuntimeEntry = Object.freeze({
    clientId,
    profileId,
    oauth,
    client,
    adapter: createOneDriveStorageAdapter(client),
    credentialResolver: runtime.credentialResolver,
    ...(native ? { native } : {}),
    ...(transport ? { transport } : {})
  })
  entries.set(profileId, entry)
  liveEntries.add(entry)
  return entry
}

export function disposeOneDriveRuntimeProfile(manager: CredentialManager, profileId: string): void {
  const id = requireStorageProfileID(profileId)
  const entries = entriesByManager.get(manager)
  const entry = entries?.get(id)
  if (!entry) return
  entry.oauth.dispose()
  entries?.delete(id)
  liveEntries.delete(entry)
}

export function resetOneDriveRuntimeServicesForTests(): void {
  for (const entry of liveEntries) entry.oauth.dispose()
  liveEntries.clear()
  entriesByManager = new WeakMap()
}
