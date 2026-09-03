import { onScopeDispose, readonly, ref, shallowReadonly, shallowRef } from 'vue'

import type { CredentialStatus } from '@/app/settings/credentials/types'

import {
  clearSupabaseManagementDatabaseWritePat,
  setSupabaseManagementDatabaseWritePat,
  supabaseManagementDatabaseWritePatStatus
} from './credentials'
import {
  createSupabaseStagingTargetStore,
  type SupabaseStagingTargetBindingV1,
  type SupabaseStagingTargetStore
} from './staging-target'

export interface SupabaseStagingReleaseAuthorityIdentity {
  readonly projectRef: string
  readonly accountId: string
}

export interface SupabaseStagingReleaseAuthorityDependencies {
  credentialStatus(): Promise<CredentialStatus>
  setCredential(value: string): Promise<void>
  clearCredential(): Promise<void>
  createTargetStore(): SupabaseStagingTargetStore
}

const DEFAULT_DEPENDENCIES: SupabaseStagingReleaseAuthorityDependencies = Object.freeze({
  credentialStatus: supabaseManagementDatabaseWritePatStatus,
  setCredential: setSupabaseManagementDatabaseWritePat,
  clearCredential: clearSupabaseManagementDatabaseWritePat,
  createTargetStore: createSupabaseStagingTargetStore
})

export function useSupabaseStagingReleaseAuthority(
  dependencyOverrides: Partial<SupabaseStagingReleaseAuthorityDependencies> = {}
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides }
  const credentialStatus = ref<CredentialStatus | 'loading'>('loading')
  const credentialBusy = ref(false)
  const credentialError = ref(false)
  const target = shallowRef<SupabaseStagingTargetBindingV1 | null>(null)
  const targetBusy = ref(false)
  const targetError = ref(false)
  let credentialVersion = 0
  let disposed = false

  async function refreshCredentialStatus(): Promise<void> {
    const version = ++credentialVersion
    credentialStatus.value = 'loading'
    credentialError.value = false
    try {
      const status = await dependencies.credentialStatus()
      if (!disposed && version === credentialVersion) credentialStatus.value = status
    } catch {
      if (disposed || version !== credentialVersion) return
      credentialStatus.value = 'unavailable'
      credentialError.value = true
    }
  }

  function refreshTarget(): void {
    targetError.value = false
    try {
      target.value = dependencies.createTargetStore().read()
    } catch {
      target.value = null
      targetError.value = true
    }
  }

  async function saveCredential(value: string): Promise<boolean> {
    let personalAccessToken = value
    value = ''
    if (!personalAccessToken.trim() || credentialBusy.value) {
      personalAccessToken = ''
      credentialError.value = true
      return false
    }
    credentialBusy.value = true
    credentialError.value = false
    try {
      await dependencies.setCredential(personalAccessToken)
      await refreshCredentialStatus()
      return true
    } catch {
      credentialError.value = true
      return false
    } finally {
      personalAccessToken = ''
      credentialBusy.value = false
    }
  }

  async function clearCredential(): Promise<boolean> {
    if (credentialBusy.value) return false
    credentialBusy.value = true
    credentialError.value = false
    try {
      await dependencies.clearCredential()
      await refreshCredentialStatus()
      return true
    } catch {
      credentialError.value = true
      return false
    } finally {
      credentialBusy.value = false
    }
  }

  function bindTarget(
    identity: SupabaseStagingReleaseAuthorityIdentity,
    projectRefConfirmation: string,
    confirmedIndependentStaging: boolean
  ): boolean {
    if (targetBusy.value) return false
    targetBusy.value = true
    targetError.value = false
    try {
      if (!confirmedIndependentStaging) throw new TypeError('Independent staging is unconfirmed')
      target.value = dependencies.createTargetStore().bind({
        projectRef: identity.projectRef,
        accountId: identity.accountId,
        projectRefConfirmation,
        confirmedIndependentStaging: true
      })
      return true
    } catch {
      target.value = null
      targetError.value = true
      return false
    } finally {
      targetBusy.value = false
    }
  }

  function clearTarget(): boolean {
    if (targetBusy.value) return false
    targetBusy.value = true
    targetError.value = false
    try {
      dependencies.createTargetStore().clear()
      target.value = null
      return true
    } catch {
      targetError.value = true
      return false
    } finally {
      targetBusy.value = false
    }
  }

  function targetMatches(identity: SupabaseStagingReleaseAuthorityIdentity): boolean {
    return (
      target.value?.projectRef === identity.projectRef &&
      target.value.accountId === identity.accountId
    )
  }

  void refreshCredentialStatus()
  refreshTarget()

  onScopeDispose(() => {
    disposed = true
    credentialVersion += 1
  })

  return {
    credentialStatus: readonly(credentialStatus),
    credentialBusy: readonly(credentialBusy),
    credentialError: readonly(credentialError),
    target: shallowReadonly(target),
    targetBusy: readonly(targetBusy),
    targetError: readonly(targetError),
    refreshCredentialStatus,
    refreshTarget,
    saveCredential,
    clearCredential,
    bindTarget,
    clearTarget,
    targetMatches
  }
}
