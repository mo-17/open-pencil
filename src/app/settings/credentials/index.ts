import { IS_TAURI } from '@open-pencil/core/constants'

import {
  createRuntimeCredentialStore,
  type BrowserCredentialPersistence
} from '@/app/settings/credentials/factory'
import { createCredentialServices } from '@/app/settings/credentials/services'
import type { CredentialStore } from '@/app/settings/credentials/types'

export function createCredentialStore(
  browserPersistence: BrowserCredentialPersistence = 'session'
): CredentialStore {
  return createRuntimeCredentialStore({ isTauri: IS_TAURI, browserPersistence })
}

export const sessionCredentialServices = createCredentialServices(createCredentialStore())

export { credentialRef } from '@/app/settings/credentials/reference'
export { createCredentialServices } from '@/app/settings/credentials/services'
export type { BrowserCredentialPersistence } from '@/app/settings/credentials/factory'
export type {
  CredentialBackend,
  CredentialErrorCode,
  CredentialManager,
  CredentialRef,
  CredentialResolver,
  CredentialStatus,
  CredentialStore,
  CredentialStoreAvailability
} from '@/app/settings/credentials/types'
export { CredentialStoreError } from '@/app/settings/credentials/types'
