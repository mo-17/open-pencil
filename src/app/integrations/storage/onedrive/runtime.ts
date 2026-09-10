import { IS_TAURI } from '@open-pencil/core/constants'

import type { CredentialManager, CredentialResolver } from '@/app/settings/credentials/types'
import { oneDriveNativeBridge, oneDriveTauriTransport } from '@/app/tauri/onedrive'

import { createStorageRuntimeRegistry } from '../shared/runtime'
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

const runtimeRegistry = createStorageRuntimeRegistry<CredentialManager, RuntimeEntry>()

export function getOneDriveRuntimeServices(
  runtime: StorageProviderRuntime,
  options: OneDriveRuntimeOptions = {}
): OneDriveRuntimeServices {
  const profileId = requireStorageProfileID(runtime.profileId)
  const clientId = resolveOneDriveClientId(runtime.preferences)
  const native = options.native ?? (IS_TAURI ? oneDriveNativeBridge : undefined)
  const transport = options.transport ?? (IS_TAURI ? oneDriveTauriTransport : undefined)
  return runtimeRegistry.getOrCreate(
    runtime.credentialManager,
    profileId,
    (entry) =>
      entry.clientId === clientId &&
      entry.credentialResolver === runtime.credentialResolver &&
      entry.native === native &&
      entry.transport === transport,
    () => {
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
      return Object.freeze({
        clientId,
        profileId,
        oauth,
        client,
        adapter: createOneDriveStorageAdapter(client),
        credentialResolver: runtime.credentialResolver,
        ...(native ? { native } : {}),
        ...(transport ? { transport } : {})
      })
    }
  )
}

export function disposeOneDriveRuntimeProfile(manager: CredentialManager, profileId: string): void {
  runtimeRegistry.dispose(manager, requireStorageProfileID(profileId))
}

export function resetOneDriveRuntimeServicesForTests(): void {
  runtimeRegistry.reset()
}
