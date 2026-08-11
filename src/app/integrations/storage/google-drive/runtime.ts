import { IS_TAURI } from '@open-pencil/core/constants'

import type { CredentialManager, CredentialResolver } from '@/app/settings/credentials/types'
import { googleDriveTauriTransport } from '@/app/tauri/google-drive'

import { requireStorageProfileID, type StorageProviderRuntime } from '../types'
import { createGoogleDriveStorageAdapter, type GoogleDriveStorageAdapter } from './adapter'
import { GoogleDriveClient } from './client'
import { resolveGoogleDriveClientId } from './config'
import {
  createGoogleDriveOAuthSession,
  type CreateGoogleDriveOAuthSessionOptions
} from './oauth/session'
import type { GoogleDriveTransport } from './types'

type GoogleDriveOAuthSession = ReturnType<typeof createGoogleDriveOAuthSession>

export type GoogleDriveRuntimeServices = Readonly<{
  clientId: string
  profileId: string
  oauth: GoogleDriveOAuthSession
  client: GoogleDriveClient
  adapter: GoogleDriveStorageAdapter
}>

export type GoogleDriveRuntimeOptions = Readonly<{
  transport?: GoogleDriveTransport
  native?: CreateGoogleDriveOAuthSessionOptions['native']
}>

type RuntimeEntry = GoogleDriveRuntimeServices & {
  credentialResolver: CredentialResolver
  native?: CreateGoogleDriveOAuthSessionOptions['native']
  transport?: GoogleDriveTransport
}

let entriesByManager = new WeakMap<CredentialManager, Map<string, RuntimeEntry>>()
const liveEntries = new Set<RuntimeEntry>()

function missingClientId(): never {
  throw new Error(
    'Google Drive OAuth client ID is not configured. The app publisher must set VITE_GOOGLE_DRIVE_CLIENT_ID when building OpenPencil.'
  )
}

export function getGoogleDriveRuntimeServices(
  runtime: StorageProviderRuntime,
  options: GoogleDriveRuntimeOptions = {}
): GoogleDriveRuntimeServices {
  const profileId = requireStorageProfileID(runtime.profileId)
  const clientId = resolveGoogleDriveClientId(runtime.preferences) ?? missingClientId()
  const transport = options.transport ?? (IS_TAURI ? googleDriveTauriTransport : undefined)
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
    existing.native === options.native &&
    existing.transport === transport
  ) {
    return existing
  }
  existing?.oauth.dispose()
  if (existing) liveEntries.delete(existing)

  const oauth = createGoogleDriveOAuthSession({
    clientId,
    profileId,
    manager: runtime.credentialManager,
    resolver: runtime.credentialResolver,
    ...(options.native ? { native: options.native } : {})
  })
  const client = new GoogleDriveClient({
    tokenSource: oauth,
    ...(transport ? { transport } : {})
  })
  const entry: RuntimeEntry = Object.freeze({
    clientId,
    profileId,
    oauth,
    client,
    adapter: createGoogleDriveStorageAdapter(client),
    credentialResolver: runtime.credentialResolver,
    ...(options.native ? { native: options.native } : {}),
    ...(transport ? { transport } : {})
  })
  entries.set(profileId, entry)
  liveEntries.add(entry)
  return entry
}

export function disposeGoogleDriveRuntimeProfile(
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

export function resetGoogleDriveRuntimeServicesForTests(): void {
  for (const entry of liveEntries) entry.oauth.dispose()
  liveEntries.clear()
  entriesByManager = new WeakMap()
}
