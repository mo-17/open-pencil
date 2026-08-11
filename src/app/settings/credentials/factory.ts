import { BrowserCredentialStore } from '@/app/settings/credentials/browser'
import { MemoryCredentialStore } from '@/app/settings/credentials/memory'
import type { CredentialStore } from '@/app/settings/credentials/types'

export type BrowserCredentialPersistence = 'session' | 'remembered'

export type CredentialStoreRuntime = Readonly<{
  isTauri: boolean
  browserPersistence: BrowserCredentialPersistence
}>

/**
 * Chooses the credential store once for the current runtime surface.
 *
 * Tauri deliberately uses encrypted app-local IndexedDB instead of the macOS
 * login Keychain. Development binaries are ad-hoc signed, so their changing
 * code identity otherwise causes a password prompt after every rebuild. This
 * is an explicit product policy, never an error-triggered fallback.
 */
export function createRuntimeCredentialStore(runtime: CredentialStoreRuntime): CredentialStore {
  if (runtime.isTauri || runtime.browserPersistence === 'remembered') {
    return new BrowserCredentialStore()
  }
  return new MemoryCredentialStore()
}
