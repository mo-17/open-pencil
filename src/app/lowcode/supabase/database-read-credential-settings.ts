import {
  supabaseDatabaseReadCredentialNativeBridge,
  type SupabaseDatabaseReadCredentialCommitDurabilityV1,
  type SupabaseDatabaseReadCredentialMutationReceiptV1,
  type SupabaseDatabaseReadCredentialNativeBridge,
  type SupabaseDatabaseReadCredentialStatusV1
} from '@/app/tauri/supabase-database-read-credentials'

import { resolveSupabaseManagementGrantGeneration } from './credentials'
import {
  createSupabaseDatabaseReadConnectionProfileV1,
  type SupabaseDatabaseReadConnectionProfileInputV1
} from './database-read-connection-profile'

export type SupabaseDatabaseReadCredentialSettingsOperationV1 = 'status' | 'replace' | 'clear'

export type SupabaseDatabaseReadCredentialSettingsStatusV1 =
  | SupabaseDatabaseReadCredentialStatusV1
  | 'management-pat-required'
  | 'reconciliation-required'

export interface SupabaseDatabaseReadCredentialReconciliationV1 {
  readonly expectedGrantGeneration: string
  readonly nextGrantGeneration: string
}

export interface SupabaseDatabaseReadCredentialSettingsSnapshotV1 {
  readonly status: SupabaseDatabaseReadCredentialSettingsStatusV1
  readonly pendingOperation: SupabaseDatabaseReadCredentialSettingsOperationV1 | null
  readonly error: string | null
  readonly receipt: SupabaseDatabaseReadCredentialMutationReceiptV1 | null
  readonly reconciliation: SupabaseDatabaseReadCredentialReconciliationV1 | null
}

export interface SupabaseDatabaseReadCredentialSettingsDependenciesV1 {
  readonly bridge: SupabaseDatabaseReadCredentialNativeBridge
  readonly resolveGrantGeneration: () => Promise<string | null>
}

export interface SupabaseDatabaseReadCredentialSettingsControllerV1 {
  snapshot(): SupabaseDatabaseReadCredentialSettingsSnapshotV1
  refreshStatus(): Promise<SupabaseDatabaseReadCredentialSettingsSnapshotV1>
  replace(
    profileInput: SupabaseDatabaseReadConnectionProfileInputV1,
    password: string
  ): Promise<SupabaseDatabaseReadCredentialSettingsSnapshotV1>
  clear(): Promise<SupabaseDatabaseReadCredentialSettingsSnapshotV1>
}

const DEFAULT_DEPENDENCIES: SupabaseDatabaseReadCredentialSettingsDependenciesV1 = Object.freeze({
  bridge: supabaseDatabaseReadCredentialNativeBridge,
  resolveGrantGeneration: resolveSupabaseManagementGrantGeneration
})

function initialSnapshot(): SupabaseDatabaseReadCredentialSettingsSnapshotV1 {
  return Object.freeze({
    status: 'management-pat-required',
    pendingOperation: null,
    error: null,
    receipt: null,
    reconciliation: null
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Supabase database-read credential operation failed'
}

/**
 * Keeps renderer UI state separate from the Tauri credential boundary. The controller never stores
 * a password; callers provide it only for the awaited replace invocation and clear their DOM value.
 */
export function createSupabaseDatabaseReadCredentialSettingsController(
  dependencies: SupabaseDatabaseReadCredentialSettingsDependenciesV1 = DEFAULT_DEPENDENCIES
): SupabaseDatabaseReadCredentialSettingsControllerV1 {
  let current = initialSnapshot()

  function update(
    next: Partial<SupabaseDatabaseReadCredentialSettingsSnapshotV1>
  ): SupabaseDatabaseReadCredentialSettingsSnapshotV1 {
    current = Object.freeze({ ...current, ...next })
    return current
  }

  function begin(operation: SupabaseDatabaseReadCredentialSettingsOperationV1): boolean {
    if (current.pendingOperation !== null) return false
    update({ pendingOperation: operation, error: null })
    return true
  }

  function finish(): void {
    update({ pendingOperation: null })
  }

  async function currentGrantGeneration(): Promise<string | null> {
    const generation = await dependencies.resolveGrantGeneration()
    if (generation) return generation
    update({ status: 'management-pat-required' })
    return null
  }

  function recordReceipt(
    receipt: SupabaseDatabaseReadCredentialMutationReceiptV1,
    expectedGrantGeneration: string
  ): void {
    const reconciliation =
      receipt.commitDurability === 'unconfirmed'
        ? Object.freeze({
            expectedGrantGeneration,
            nextGrantGeneration: receipt.grantGeneration
          })
        : null
    let status: SupabaseDatabaseReadCredentialSettingsStatusV1
    if (reconciliation) status = 'reconciliation-required'
    else if (receipt.configured) status = 'configured'
    else status = 'missing'
    update({
      status,
      receipt,
      reconciliation
    })
  }

  function mutationBlocked(): boolean {
    if (!current.reconciliation) return false
    update({
      status: 'reconciliation-required',
      error:
        'The previous credential mutation has unconfirmed durability. Restart and reconcile it before another mutation.'
    })
    return true
  }

  return Object.freeze({
    snapshot: () => current,

    async refreshStatus(): Promise<SupabaseDatabaseReadCredentialSettingsSnapshotV1> {
      if (!begin('status')) return current
      try {
        const generation = await currentGrantGeneration()
        if (!generation) return current
        const status = await dependencies.bridge.statusV1(generation)
        update({ status: current.reconciliation ? 'reconciliation-required' : status })
      } catch (error) {
        update({
          error: errorMessage(error),
          status: current.reconciliation ? 'reconciliation-required' : 'unavailable'
        })
      } finally {
        finish()
      }
      return current
    },

    async replace(
      profileInput: SupabaseDatabaseReadConnectionProfileInputV1,
      password: string
    ): Promise<SupabaseDatabaseReadCredentialSettingsSnapshotV1> {
      if (mutationBlocked() || !begin('replace')) return current
      let passwordForBridge = password
      try {
        if (passwordForBridge.length === 0) throw new TypeError('A database password is required')
        const generation = await currentGrantGeneration()
        if (!generation) return current
        const connectionProfile = createSupabaseDatabaseReadConnectionProfileV1(profileInput)
        const receipt = await dependencies.bridge.replaceV1({
          expectedGrantGeneration: generation,
          password: passwordForBridge,
          connectionProfile
        })
        recordReceipt(receipt, generation)
      } catch (error) {
        update({ error: errorMessage(error) })
      } finally {
        passwordForBridge = ''
        finish()
      }
      return current
    },

    async clear(): Promise<SupabaseDatabaseReadCredentialSettingsSnapshotV1> {
      if (mutationBlocked() || !begin('clear')) return current
      try {
        const generation = await currentGrantGeneration()
        if (!generation) return current
        recordReceipt(await dependencies.bridge.clearV1(generation), generation)
      } catch (error) {
        update({ error: errorMessage(error) })
      } finally {
        finish()
      }
      return current
    }
  })
}

export type { SupabaseDatabaseReadCredentialCommitDurabilityV1 }
