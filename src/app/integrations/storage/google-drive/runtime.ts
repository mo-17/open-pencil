import { IS_TAURI } from '@open-pencil/core/constants'

import type { CredentialManager, CredentialResolver } from '@/app/settings/credentials/types'
import { googleDriveTauriTransport } from '@/app/tauri/google-drive'

import { createStorageRuntimeRegistry } from '../shared/runtime'
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
  /** Publisher-managed Desktop client ID. Self-hosted profiles can operate without it. */
  clientId: string | null
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

const runtimeRegistry = createStorageRuntimeRegistry<CredentialManager, RuntimeEntry>()

export function getGoogleDriveRuntimeServices(
  runtime: StorageProviderRuntime,
  options: GoogleDriveRuntimeOptions = {}
): GoogleDriveRuntimeServices {
  const profileId = requireStorageProfileID(runtime.profileId)
  const clientId = resolveGoogleDriveClientId(runtime.preferences)
  const transport = options.transport ?? (IS_TAURI ? googleDriveTauriTransport : undefined)
  return runtimeRegistry.getOrCreate(
    runtime.credentialManager,
    profileId,
    (entry) =>
      entry.clientId === clientId &&
      entry.credentialResolver === runtime.credentialResolver &&
      entry.native === options.native &&
      entry.transport === transport,
    () => {
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
      return Object.freeze({
        clientId,
        profileId,
        oauth,
        client,
        adapter: createGoogleDriveStorageAdapter(client),
        credentialResolver: runtime.credentialResolver,
        ...(options.native ? { native: options.native } : {}),
        ...(transport ? { transport } : {})
      })
    }
  )
}

export function disposeGoogleDriveRuntimeProfile(
  manager: CredentialManager,
  profileId: string
): void {
  runtimeRegistry.dispose(manager, requireStorageProfileID(profileId))
}

export function resetGoogleDriveRuntimeServicesForTests(): void {
  runtimeRegistry.reset()
}
