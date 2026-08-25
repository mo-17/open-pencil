import { invoke } from '@tauri-apps/api/core'

import {
  CredentialStoreError,
  type CredentialErrorCode,
  type CredentialRef,
  type CredentialStatus,
  type CredentialStore,
  type CredentialStoreAvailability
} from '@/app/settings/credentials/types'

type InvokeCredentialCommand = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

const ERROR_MESSAGES: Readonly<Record<CredentialErrorCode, string>> = {
  'invalid-reference': 'Credential reference is invalid',
  'invalid-value': 'Credential value is invalid',
  locked: 'The desktop credential store is locked',
  unavailable: 'The app-local credential store is unavailable',
  failed: 'Desktop app credential operation failed'
}

function credentialErrorCode(value: unknown): CredentialErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_MESSAGES, value)
    ? (value as CredentialErrorCode)
    : 'failed'
}

function nativeCredentialErrorCode(error: unknown): CredentialErrorCode {
  if (typeof error !== 'object' || error === null) return 'failed'
  return credentialErrorCode((error as { code?: unknown }).code)
}

export class NativeCredentialStore implements CredentialStore {
  readonly backend = 'native' as const

  constructor(private readonly invokeCommand: InvokeCredentialCommand = invoke) {}

  async availability(): Promise<CredentialStoreAvailability> {
    return this.#invoke('credential_store_availability')
  }

  async status(reference: CredentialRef): Promise<CredentialStatus> {
    return this.#invoke('credential_status', { reference })
  }

  async read(reference: CredentialRef): Promise<string | null> {
    return this.#invoke('credential_read', { reference })
  }

  async write(reference: CredentialRef, value: string): Promise<void> {
    await this.#invoke('credential_write', { reference, value })
  }

  async remove(reference: CredentialRef): Promise<void> {
    await this.#invoke('credential_remove', { reference })
  }

  async #invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return await this.invokeCommand<T>(command, args)
    } catch (error) {
      const code = nativeCredentialErrorCode(error)
      throw new CredentialStoreError(code, ERROR_MESSAGES[code])
    }
  }
}
