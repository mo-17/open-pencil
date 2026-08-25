<script setup lang="ts">
/* eslint-disable max-lines -- OAuth, durable grant repair, and connection UI share one lifecycle boundary. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from '@open-pencil/vue'

import type { StorageDocumentAuthority } from '@/app/integrations/storage/types'
import { activeStorageProfileID } from '@/app/integrations/storage/preferences'
import {
  ONEDRIVE_STORAGE_PROVIDER_ID,
  resolveOneDriveClientId
} from '@/app/integrations/storage/onedrive/config'
import { LocalOneDriveOAuthMetadataStore } from '@/app/integrations/storage/onedrive/oauth/metadata'
import {
  OneDriveOAuthError,
  oneDriveRefreshTokenCredentialRef,
  oneDriveSingleAccountId,
  type OneDriveOAuthStatus
} from '@/app/integrations/storage/onedrive/oauth/session'
import {
  disposeOneDriveRuntimeProfile,
  getOneDriveRuntimeServices
} from '@/app/integrations/storage/onedrive/runtime'
import { appCredentialServices } from '@/app/settings/credentials/app'
import { credentialRef } from '@/app/settings/credentials/reference'
import {
  StorageDurabilityUnavailableError,
  withDurableStorageProfileMutationDrain
} from '@/app/storage/durability'
import {
  StorageProfileOpenDocumentsError,
  storageProfileHasOpenTabs
} from '@/app/storage/mutation-drain'
import {
  adoptStorageAuthorizationWork,
  listStaleStorageAuthorizationWork,
  listStorageProfileAuthorizationWork,
  resumeStorageSync,
  type StorageAuthorizationWorkInspection
} from '@/app/storage/sync'
import { getTabsSnapshot } from '@/app/tabs'

type Operation = 'idle' | 'connecting' | 'committing' | 'checking' | 'disconnecting' | 'repairing'
type Feedback = Readonly<{ tone: 'success' | 'error' | 'neutral'; message: string }>
type DialogEntry = string | ((parameters: Record<string, unknown>) => string)

class OneDriveUnfinishedAuthorizationWorkError extends Error {
  constructor() {
    super('OneDrive profile still has unfinished durable work')
    this.name = 'OneDriveUnfinishedAuthorizationWorkError'
  }
}

const emit = defineEmits<{
  ready: [providerId: typeof ONEDRIVE_STORAGE_PROVIDER_ID, ready: boolean]
}>()

const { dialogs } = useI18n()
const buildClientId = resolveOneDriveClientId()
const metadataStore = new LocalOneDriveOAuthMetadataStore()
const connectionState = ref<OneDriveOAuthStatus>({
  state: 'setup',
  profileId: activeStorageProfileID.value
})
const operation = ref<Operation>('idle')
const feedback = ref<Feedback | null>(null)
const staleAuthorizationWork = ref<StorageAuthorizationWorkInspection[]>([])
let controller: AbortController | null = null
let generation = 0
let mounted = false

function message(key: string, fallback: string, parameters: Record<string, unknown> = {}): string {
  const entry = Reflect.get(dialogs.value, key) as DialogEntry | undefined
  if (typeof entry === 'function') return entry(parameters)
  return typeof entry === 'string' ? entry : fallback
}

const connected = computed(() => connectionState.value.state === 'connected')
const busy = computed(() => operation.value !== 'idle')
const staleWorkCount = computed(() =>
  staleAuthorizationWork.value.reduce(
    (count, inspection) => count + Math.max(inspection.documentCount, inspection.jobCount),
    0
  )
)
const statusTitle = computed(() => {
  const state = connectionState.value
  if (state.state === 'connected') {
    return message('storageOneDriveConnectedAs', `Connected as ${state.accountLabel}`, {
      account: state.accountLabel
    })
  }
  if (state.state === 'unsupported') {
    return message('storageOneDriveDesktopOnly', 'OneDrive is available in the desktop app')
  }
  if (state.state === 'setup') {
    return message('storageOneDriveSetupRequired', 'OneDrive setup is required')
  }
  if (state.state === 'locked') {
    return message('storageOneDriveCredentialLocked', 'Credential storage is locked')
  }
  if (state.state === 'unavailable') {
    return message('storageOneDriveCredentialUnavailable', 'Credential storage is unavailable')
  }
  if (state.state === 'invalid') {
    return message('storageOneDriveConnectionNeedsRepair', 'Reconnect OneDrive')
  }
  return message('storageOneDriveNotConnected', 'OneDrive is not connected')
})

const statusDetail = computed(() => {
  const state = connectionState.value
  if (state.state === 'connected') {
    return message(
      'storageOneDriveConnectedDetail',
      'OpenPencil can save documents in Apps/OpenPencil on this OneDrive account.'
    )
  }
  if (state.state === 'unsupported') {
    return message(
      'storageOneDriveDesktopOnlyDetail',
      'Use the OpenPencil desktop app to authorize a personal or work/school Microsoft account.'
    )
  }
  if (state.state === 'setup') {
    return message(
      'storageOneDriveBuildConfigurationMissing',
      'This build does not include the publisher-managed Microsoft public client ID.'
    )
  }
  if (state.state === 'locked') {
    return message(
      'storageOneDriveCredentialLockedDetail',
      'Unlock encrypted credential storage, then try again.'
    )
  }
  if (state.state === 'unavailable') {
    return message(
      'storageOneDriveCredentialUnavailableDetail',
      'Encrypted credential storage could not be opened on this device.'
    )
  }
  if (state.state === 'invalid') {
    return message(
      'storageOneDriveConnectionNeedsRepairDetail',
      'The saved account metadata and encrypted grant no longer match. Reconnect this profile.'
    )
  }
  return message(
    'storageOneDriveConnectDescription',
    'Connect a personal or work/school Microsoft account in your system browser.'
  )
})

const permissionDisclosure = computed(() =>
  message(
    'storageOneDrivePermissionDisclosure',
    'OpenPencil requests Files.ReadWrite.AppFolder so Microsoft limits access to this app’s OneDrive folder.'
  )
)

function services(profileId = activeStorageProfileID.value) {
  return getOneDriveRuntimeServices({
    preferences: {},
    profileId,
    credentialManager: appCredentialServices.manager,
    credentialResolver: appCredentialServices.resolver,
    resolveCredential(field) {
      return appCredentialServices.resolver.resolve(
        credentialRef(ONEDRIVE_STORAGE_PROVIDER_ID, field, profileId)
      )
    }
  })
}

function current(requestGeneration: number, profileId: string): boolean {
  return mounted && requestGeneration === generation && profileId === activeStorageProfileID.value
}

function setReady(ready: boolean): void {
  if (mounted) emit('ready', ONEDRIVE_STORAGE_PROVIDER_ID, ready)
}

function profileHasOpenTabs(profileId: string): boolean {
  return storageProfileHasOpenTabs(
    { providerId: ONEDRIVE_STORAGE_PROVIDER_ID, profileId },
    getTabsSnapshot().map((tab) => tab.store)
  )
}

function authorizationAccount(
  inspections: readonly StorageAuthorizationWorkInspection[]
): string | undefined {
  return oneDriveSingleAccountId(inspections.map((inspection) => inspection.scope.authority))
}

function authorizationScope(profileId: string, authority: StorageDocumentAuthority) {
  return { providerId: ONEDRIVE_STORAGE_PROVIDER_ID, profileId, authority }
}

async function refreshStaleAuthorizationWork(
  profileId: string,
  authority: StorageDocumentAuthority,
  requestGeneration: number
): Promise<StorageAuthorizationWorkInspection[]> {
  const stale = await listStaleStorageAuthorizationWork(authorizationScope(profileId, authority))
  if (!current(requestGeneration, profileId)) return []
  staleAuthorizationWork.value = stale
  return stale
}

function operationError(error: unknown, signal: AbortSignal): string {
  if (signal.aborted) return message('storageOneDriveCancelled', 'OneDrive operation cancelled')
  if (error instanceof StorageProfileOpenDocumentsError) {
    return message(
      'storageOneDriveAuthorizationBlockedByOpenDocuments',
      'Close documents from this OneDrive profile before changing its authorization.'
    )
  }
  if (error instanceof OneDriveUnfinishedAuthorizationWorkError) {
    return message(
      'storageOneDriveUnfinishedWork',
      'Finish or repair pending OneDrive sync work before removing this account from the device.'
    )
  }
  if (error instanceof StorageDurabilityUnavailableError) {
    return message(
      'storageDurabilityUnavailable',
      'Durable local storage is unavailable, so the OneDrive authorization was left unchanged.'
    )
  }
  if (error instanceof OneDriveOAuthError) {
    const byCode: Partial<Record<OneDriveOAuthError['code'], string>> = {
      unsupported: message(
        'storageOneDriveDesktopOnly',
        'OneDrive is available in the desktop app'
      ),
      'setup-required': message(
        'storageOneDriveBuildConfigurationMissing',
        'This build does not include the Microsoft public client ID.'
      ),
      cancelled: message('storageOneDriveCancelled', 'OneDrive operation cancelled'),
      'credential-locked': message(
        'storageOneDriveCredentialLocked',
        'Credential storage is locked'
      ),
      'credential-unavailable': message(
        'storageOneDriveCredentialUnavailable',
        'Credential storage is unavailable'
      ),
      'inconsistent-state': message(
        'storageOneDriveMultipleAccounts',
        'This profile contains inconsistent durable account work and must be repaired before reconnecting.'
      ),
      'profile-account-mismatch': message(
        'storageOneDriveDifferentAccount',
        'Use a new storage profile for a different Microsoft account.'
      ),
      'authorization-denied': message(
        'storageOneDriveAuthorizationDenied',
        'Microsoft authorization was denied.'
      ),
      'authorization-timeout': message(
        'storageOneDriveAuthorizationTimedOut',
        'Microsoft authorization timed out.'
      ),
      'oauth-client-invalid': message(
        'storageOneDriveBuildConfigurationMissing',
        'This build does not include a valid Microsoft public client ID.'
      ),
      'authorization-grant-invalid': message(
        'storageProviderNotConnected',
        'OneDrive must be reconnected.',
        { provider: 'OneDrive' }
      ),
      'redirect-uri-mismatch': message(
        'storageOneDriveBuildConfigurationMissing',
        'Microsoft rejected this build’s local authorization callback.'
      ),
      'token-request-invalid': message(
        'storageOneDriveBuildConfigurationMissing',
        'Microsoft rejected this build’s token request.'
      ),
      'browser-open-failed': message(
        'storageOneDriveBrowserOpenFailed',
        'The system browser could not be opened.'
      ),
      'scope-mismatch': message(
        'storageOneDriveScopeMismatch',
        'Microsoft did not grant the required OneDrive file permission.'
      ),
      'network-failed': message('storageOneDriveNetworkFailed', 'OneDrive could not be reached.'),
      'rate-limited': message(
        'storageTemporaryNetworkError',
        'Microsoft temporarily rate limited OneDrive.'
      )
    }
    const translated = byCode[error.code]
    if (translated) return translated
  }
  return message('storageOneDriveOperationFailed', 'OneDrive operation failed')
}

async function refreshStatus(): Promise<void> {
  const requestGeneration = ++generation
  const profileId = activeStorageProfileID.value
  try {
    const status = await services(profileId).oauth.status()
    if (!current(requestGeneration, profileId)) return
    connectionState.value = status
    if (status.state !== 'connected') {
      staleAuthorizationWork.value = []
      setReady(false)
      return
    }
    try {
      const stale = await refreshStaleAuthorizationWork(
        profileId,
        status.authority,
        requestGeneration
      )
      if (!current(requestGeneration, profileId)) return
      setReady(stale.length === 0)
    } catch {
      if (!current(requestGeneration, profileId)) return
      staleAuthorizationWork.value = []
      setReady(false)
      feedback.value = {
        tone: 'error',
        message: message(
          'storageOneDriveAuthorizationWorkRepairFailed',
          'OpenPencil could not inspect pending OneDrive work. Try again.'
        )
      }
    }
  } catch {
    if (!current(requestGeneration, profileId)) return
    connectionState.value = { state: 'setup', profileId }
    staleAuthorizationWork.value = []
    setReady(false)
  }
}

function beginOperation(next: Exclude<Operation, 'idle'>) {
  controller?.abort()
  controller = new AbortController()
  operation.value = next
  feedback.value = null
  return {
    controller,
    requestGeneration: ++generation,
    profileId: activeStorageProfileID.value
  }
}

function finishOperation(operationController: AbortController): void {
  if (!mounted || controller !== operationController) return
  controller = null
  operation.value = 'idle'
}

async function connect(): Promise<void> {
  if (busy.value || !buildClientId) return
  const active = beginOperation('connecting')
  try {
    const result = await withDurableStorageProfileMutationDrain(
      { providerId: ONEDRIVE_STORAGE_PROVIDER_ID, profileId: active.profileId },
      async () => {
        if (profileHasOpenTabs(active.profileId)) {
          throw new StorageProfileOpenDocumentsError()
        }
        const before = await listStorageProfileAuthorizationWork({
          providerId: ONEDRIVE_STORAGE_PROVIDER_ID,
          profileId: active.profileId
        })
        const expectedSubject = authorizationAccount(before)
        const connectedAccount = await services(active.profileId).oauth.connect({
          signal: active.controller.signal,
          ...(expectedSubject ? { expectedSubject } : {}),
          onCommitStart() {
            if (current(active.requestGeneration, active.profileId)) {
              operation.value = 'committing'
            }
          }
        })

        // Re-enumerate after the durable grant commit so crash-gap rows that were not represented
        // by the old public metadata are adopted too. The profile drain prevents new writers from
        // racing this authority migration.
        const after = await listStorageProfileAuthorizationWork({
          providerId: ONEDRIVE_STORAGE_PROVIDER_ID,
          profileId: active.profileId
        })
        const durableAccount = authorizationAccount(after)
        if (durableAccount && durableAccount !== connectedAccount.authority.accountId) {
          throw new OneDriveOAuthError(
            'inconsistent-state',
            'OneDrive durable work belongs to a different Microsoft account'
          )
        }
        for (const inspection of after) {
          const previousAuthority = inspection.scope.authority
          if (
            previousAuthority.accountId !== connectedAccount.authority.accountId ||
            previousAuthority.authorizationVersion ===
              connectedAccount.authority.authorizationVersion
          ) {
            continue
          }
          await adoptStorageAuthorizationWork({
            providerId: ONEDRIVE_STORAGE_PROVIDER_ID,
            profileId: active.profileId,
            previousAuthority,
            nextAuthority: connectedAccount.authority
          })
        }
        return connectedAccount
      },
      active.controller.signal
    )
    if (!current(active.requestGeneration, active.profileId)) return
    connectionState.value = { state: 'connected', ...result }
    const runtime = services(active.profileId)
    const verification = await runtime.adapter.testConnection({
      signal: active.controller.signal
    })
    if (!current(active.requestGeneration, active.profileId)) return
    const stale = await refreshStaleAuthorizationWork(
      active.profileId,
      result.authority,
      active.requestGeneration
    )
    if (!current(active.requestGeneration, active.profileId)) return
    await resumeStorageSync()
    if (!current(active.requestGeneration, active.profileId)) return
    setReady(verification.ok && stale.length === 0)
    feedback.value = {
      tone: verification.ok ? 'success' : 'error',
      message: verification.ok
        ? message('storageOneDriveConnectionHealthy', 'OneDrive connection is healthy')
        : message(
            'storageOneDriveVerificationFailed',
            'Microsoft account connected, but OpenPencil could not verify OneDrive access.'
          )
    }
  } catch (error) {
    if (!current(active.requestGeneration, active.profileId)) return
    feedback.value = {
      tone: 'error',
      message: operationError(error, active.controller.signal)
    }
    await refreshStatus()
  } finally {
    finishOperation(active.controller)
  }
}

async function checkConnection(): Promise<void> {
  if (busy.value || !connected.value) return
  const active = beginOperation('checking')
  try {
    const result = await services(active.profileId).adapter.testConnection({
      signal: active.controller.signal
    })
    if (!current(active.requestGeneration, active.profileId)) return
    setReady(result.ok && staleAuthorizationWork.value.length === 0)
    feedback.value = {
      tone: result.ok ? 'success' : 'error',
      message: result.ok
        ? message('storageOneDriveConnectionHealthy', 'OneDrive connection is healthy')
        : message(
            'storageOneDriveVerificationFailed',
            'OpenPencil could not verify OneDrive access. Check the account permission and network.'
          )
    }
  } catch (error) {
    if (!current(active.requestGeneration, active.profileId)) return
    feedback.value = {
      tone: 'error',
      message: operationError(error, active.controller.signal)
    }
  } finally {
    finishOperation(active.controller)
  }
}

async function disconnect(): Promise<void> {
  if (busy.value) return
  const active = beginOperation('disconnecting')
  try {
    await withDurableStorageProfileMutationDrain(
      { providerId: ONEDRIVE_STORAGE_PROVIDER_ID, profileId: active.profileId },
      async () => {
        if (profileHasOpenTabs(active.profileId)) {
          throw new StorageProfileOpenDocumentsError()
        }
        const inspections = await listStorageProfileAuthorizationWork({
          providerId: ONEDRIVE_STORAGE_PROVIDER_ID,
          profileId: active.profileId
        })
        authorizationAccount(inspections)
        if (inspections.some((inspection) => inspection.requiresConfirmation)) {
          throw new OneDriveUnfinishedAuthorizationWorkError()
        }
        await services(active.profileId).oauth.disconnect(active.controller.signal)
      },
      active.controller.signal
    )
    if (!current(active.requestGeneration, active.profileId)) return
    connectionState.value = { state: 'missing', profileId: active.profileId }
    staleAuthorizationWork.value = []
    setReady(false)
    feedback.value = {
      tone: 'neutral',
      message: message('storageOneDriveRemovedLocally', 'OneDrive was removed from this device')
    }
  } catch (error) {
    if (!current(active.requestGeneration, active.profileId)) return
    feedback.value = {
      tone: 'error',
      message: operationError(error, active.controller.signal)
    }
  } finally {
    finishOperation(active.controller)
  }
}

async function repairStaleWork(): Promise<void> {
  if (busy.value || staleAuthorizationWork.value.length === 0) return
  const active = beginOperation('repairing')
  try {
    const verification = await withDurableStorageProfileMutationDrain(
      { providerId: ONEDRIVE_STORAGE_PROVIDER_ID, profileId: active.profileId },
      async () => {
        const runtime = services(active.profileId)
        const status = await runtime.oauth.status()
        if (!current(active.requestGeneration, active.profileId)) return null
        if (status.state !== 'connected') {
          throw new OneDriveOAuthError(
            'authorization-grant-invalid',
            'OneDrive authorization is missing'
          )
        }
        if (profileHasOpenTabs(active.profileId)) {
          throw new StorageProfileOpenDocumentsError()
        }
        const stale = await listStaleStorageAuthorizationWork(
          authorizationScope(active.profileId, status.authority)
        )
        if (!current(active.requestGeneration, active.profileId)) return null
        if (
          stale.some(
            (inspection) => inspection.scope.authority.accountId !== status.authority.accountId
          )
        ) {
          throw new OneDriveOAuthError(
            'inconsistent-state',
            'OneDrive durable work belongs to a different Microsoft account'
          )
        }
        for (const inspection of stale) {
          await adoptStorageAuthorizationWork({
            providerId: ONEDRIVE_STORAGE_PROVIDER_ID,
            profileId: active.profileId,
            previousAuthority: inspection.scope.authority,
            nextAuthority: status.authority
          })
          if (!current(active.requestGeneration, active.profileId)) return null
        }
        const remaining = await refreshStaleAuthorizationWork(
          active.profileId,
          status.authority,
          active.requestGeneration
        )
        if (!current(active.requestGeneration, active.profileId)) return null
        if (remaining.length > 0) {
          throw new Error('OneDrive authorization work changed during repair')
        }
        await resumeStorageSync()
        if (!current(active.requestGeneration, active.profileId)) return null
        return runtime.adapter.testConnection({ signal: active.controller.signal })
      },
      active.controller.signal
    )
    if (!current(active.requestGeneration, active.profileId) || !verification) return
    setReady(verification.ok)
    feedback.value = {
      tone: verification.ok ? 'success' : 'error',
      message: verification.ok
        ? message(
            'storageOneDriveAuthorizationWorkRecovered',
            'Pending OneDrive work was safely reconnected.'
          )
        : message(
            'storageOneDriveVerificationFailed',
            'Pending work was repaired, but OpenPencil could not verify OneDrive access.'
          )
    }
  } catch (error) {
    if (!current(active.requestGeneration, active.profileId)) return
    setReady(false)
    feedback.value = {
      tone: 'error',
      message: operationError(error, active.controller.signal)
    }
  } finally {
    finishOperation(active.controller)
  }
}

function cancelOperation(): void {
  if (operation.value === 'committing' || operation.value === 'repairing') return
  const activeController = controller
  controller = null
  generation++
  operation.value = 'idle'
  activeController?.abort(new DOMException('Cancelled by the user', 'AbortError'))
  feedback.value = {
    tone: 'neutral',
    message: message('storageOneDriveCancelled', 'OneDrive operation cancelled')
  }
}

async function removeProfile(profileId: string): Promise<void> {
  controller?.abort(new DOMException('Storage profile is being removed', 'AbortError'))
  generation++
  controller = null
  operation.value = 'idle'
  disposeOneDriveRuntimeProfile(appCredentialServices.manager, profileId)
  await Promise.all([
    appCredentialServices.manager.clear(oneDriveRefreshTokenCredentialRef(profileId)),
    metadataStore.remove(profileId)
  ])
}

defineExpose({ removeProfile })

watch(activeStorageProfileID, () => {
  generation++
  controller?.abort()
  controller = null
  operation.value = 'idle'
  feedback.value = null
  staleAuthorizationWork.value = []
  void refreshStatus()
})

onMounted(() => {
  mounted = true
  void refreshStatus()
})

onBeforeUnmount(() => {
  mounted = false
  generation++
  controller?.abort()
  controller = null
})
</script>

<template>
  <div class="flex flex-col gap-3" data-test-id="settings-storage-onedrive">
    <div
      class="rounded-lg border border-border bg-panel/50 p-3"
      :data-state="connected ? 'connected' : 'disconnected'"
    >
      <div class="flex items-start gap-3">
        <div
          class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-hover text-muted data-[state=connected]:bg-success/15 data-[state=connected]:text-success"
          :data-state="connected ? 'connected' : 'disconnected'"
        >
          <icon-lucide-cloud class="size-4" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <p class="truncate text-[11px] font-medium text-surface">{{ statusTitle }}</p>
            <span
              v-if="connected"
              class="rounded-full bg-success/15 px-1.5 py-0.5 text-[9px] font-medium text-success"
            >
              {{ message('storageConnected', 'Connected') }}
            </span>
          </div>
          <p class="mt-1 text-[10px] leading-4 text-muted">{{ statusDetail }}</p>
        </div>
      </div>

      <div class="mt-3 flex flex-wrap gap-2">
        <template v-if="connected">
          <button
            type="button"
            class="rounded bg-hover px-3 py-1.5 text-[10px] font-medium text-surface hover:bg-active disabled:opacity-50"
            :disabled="busy"
            data-test-id="settings-storage-onedrive-check"
            @click="checkConnection"
          >
            {{
              operation === 'checking'
                ? message('storageCheckingConnection', 'Checking…')
                : message('storageCheckConnection', 'Check connection')
            }}
          </button>
          <button
            type="button"
            class="rounded px-3 py-1.5 text-[10px] text-muted hover:bg-hover hover:text-surface disabled:opacity-50"
            :disabled="busy"
            data-test-id="settings-storage-onedrive-reconnect"
            @click="connect"
          >
            {{ message('storageOneDriveReconnect', 'Reconnect') }}
          </button>
          <button
            type="button"
            class="rounded px-3 py-1.5 text-[10px] text-danger hover:bg-danger/10 disabled:opacity-50"
            :disabled="busy"
            data-test-id="settings-storage-onedrive-disconnect"
            @click="disconnect"
          >
            {{ message('storageOneDriveRemoveFromDevice', 'Remove from this device') }}
          </button>
        </template>
        <button
          v-else-if="connectionState.state !== 'unsupported' && buildClientId"
          type="button"
          class="rounded bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          :disabled="busy"
          data-test-id="settings-storage-onedrive-connect"
          @click="connect"
        >
          {{
            operation === 'connecting'
              ? message('storageOneDriveWaitingForBrowser', 'Waiting for browser…')
              : message('storageOneDriveConnect', 'Connect OneDrive')
          }}
        </button>
        <button
          v-if="connectionState.state === 'invalid'"
          type="button"
          class="rounded px-3 py-1.5 text-[10px] text-danger hover:bg-danger/10 disabled:opacity-50"
          :disabled="busy"
          data-test-id="settings-storage-onedrive-remove-invalid"
          @click="disconnect"
        >
          {{ message('storageOneDriveRemoveFromDevice', 'Remove from this device') }}
        </button>
        <button
          v-if="operation === 'connecting' || operation === 'checking'"
          type="button"
          class="rounded px-3 py-1.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
          @click="cancelOperation"
        >
          {{ message('cancel', 'Cancel') }}
        </button>
      </div>
    </div>

    <div class="rounded border border-border/70 bg-panel/20 p-2.5">
      <div class="flex items-start gap-2">
        <icon-lucide-shield-check class="mt-0.5 size-3.5 shrink-0 text-muted" />
        <div class="min-w-0">
          <p class="text-[10px] font-medium text-surface">Files.ReadWrite.AppFolder</p>
          <p class="mt-1 text-[9px] leading-4 text-muted">{{ permissionDisclosure }}</p>
        </div>
      </div>
      <p class="mt-2 text-[9px] leading-4 text-muted">
        {{
          message(
            'storageOneDriveCredentialStorage',
            'The refresh token is kept in encrypted app-local credential storage. Access tokens remain only in memory. Disconnect removes the local grant but does not sign you out of Microsoft on other devices.'
          )
        }}
      </p>
    </div>

    <div
      v-if="staleAuthorizationWork.length > 0"
      class="rounded border border-warning/30 bg-warning/10 p-2.5 text-[10px] leading-4 text-muted"
      role="status"
      aria-live="polite"
    >
      <p>
        {{
          message(
            'storageOneDriveStaleWorkDescription',
            `OpenPencil found ${staleWorkCount} local OneDrive item(s) from an interrupted reconnect. Repair them before opening this workspace.`,
            { count: staleWorkCount }
          )
        }}
      </p>
      <button
        type="button"
        class="mt-2 rounded bg-hover px-2.5 py-1 text-[10px] font-medium text-surface hover:bg-active disabled:opacity-50"
        :disabled="busy"
        data-test-id="settings-storage-onedrive-repair-authorization"
        @click="repairStaleWork"
      >
        {{
          message('storageOneDriveRepairAuthorizationWork', `Repair ${staleWorkCount} item(s)`, {
            count: staleWorkCount
          })
        }}
      </button>
    </div>

    <p
      v-if="feedback"
      class="rounded border border-border bg-panel px-2 py-1.5 text-[10px] text-muted data-[tone=success]:text-success data-[tone=error]:text-danger"
      :data-tone="feedback.tone"
      role="status"
      aria-live="polite"
    >
      {{ feedback.message }}
    </p>
  </div>
</template>
