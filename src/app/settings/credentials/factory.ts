import { BrowserCredentialStore } from '@/app/settings/credentials/browser'
import { MemoryCredentialStore } from '@/app/settings/credentials/memory'
import { NativeCredentialStore } from '@/app/settings/credentials/native'
import type { CredentialStore } from '@/app/settings/credentials/types'

export type BrowserCredentialPersistence = 'session' | 'remembered'

export type CredentialStoreRuntime = Readonly<{
  isTauri: boolean
  browserPersistence: BrowserCredentialPersistence
}>

/**
 * Chooses the credential store once for the current runtime surface.
 *
 * Tauri uses the Rust-owned encrypted app-local vault. Browser runtimes may
 * choose encrypted IndexedDB or session memory. These are explicit runtime
 * policies and never error-triggered fallbacks.
 */
export function createRuntimeCredentialStore(runtime: CredentialStoreRuntime): CredentialStore {
  if (runtime.isTauri) return new NativeCredentialStore()
  if (runtime.browserPersistence === 'remembered') {
    return new BrowserCredentialStore()
  }
  return new MemoryCredentialStore()
}
