<script setup lang="ts">
/* eslint-disable max-lines -- OAuth, durable grant repair, and connection UI share one lifecycle boundary. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from '@open-pencil/vue'

import type { StorageDocumentAuthority } from '@/app/integrations/storage/types'
import { activeStorageProfileID } from '@/app/integrations/storage/preferences'
import {
  BAIDU_NETDISK_STORAGE_PROVIDER_ID,
  resolveBaiduNetdiskPublisherOAuthConfig
} from '@/app/integrations/storage/baidu-netdisk/config'
import {
  MAX_BAIDU_NETDISK_SELF_HOSTED_CREDENTIALS_BYTES,
  parseBaiduNetdiskSelfHostedCredentialsJSON
} from '@/app/integrations/storage/baidu-netdisk/oauth/credentials'
import { LocalBaiduNetdiskOAuthMetadataStore } from '@/app/integrations/storage/baidu-netdisk/oauth/metadata'
import {
  BaiduNetdiskOAuthError,
  baiduNetdiskRefreshTokenCredentialRef,
  baiduNetdiskSingleAccountId,
  type BaiduNetdiskOAuthStatus
} from '@/app/integrations/storage/baidu-netdisk/oauth/session'
import {
  disposeBaiduNetdiskRuntimeProfile,
  getBaiduNetdiskRuntimeServices
} from '@/app/integrations/storage/baidu-netdisk/runtime'
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
type ConnectionState = BaiduNetdiskOAuthStatus | Readonly<{ state: 'setup'; profileId: string }>
type ConnectionMode = 'publisher-broker' | 'self-hosted'

class BaiduNetdiskUnfinishedAuthorizationWorkError extends Error {
  constructor() {
    super('Baidu Netdisk profile still has unfinished durable work')
    this.name = 'BaiduNetdiskUnfinishedAuthorizationWorkError'
  }
}

const emit = defineEmits<{
  ready: [providerId: typeof BAIDU_NETDISK_STORAGE_PROVIDER_ID, ready: boolean]
}>()

const { dialogs } = useI18n()
const publisherConfig = resolveBaiduNetdiskPublisherOAuthConfig()
const metadataStore = new LocalBaiduNetdiskOAuthMetadataStore()
const connectionState = ref<ConnectionState>({
  state: 'setup',
  profileId: activeStorageProfileID.value
})
const operation = ref<Operation>('idle')
const feedback = ref<Feedback | null>(null)
const staleAuthorizationWork = ref<StorageAuthorizationWorkInspection[]>([])
const credentialsInput = ref<HTMLInputElement | null>(null)
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
const connectedMode = computed<ConnectionMode | null>(() =>
  connectionState.value.state === 'connected' ? connectionState.value.clientMode : null
)
const staleWorkCount = computed(() =>
  staleAuthorizationWork.value.reduce(
    (count, inspection) => count + Math.max(inspection.documentCount, inspection.jobCount),
    0
  )
)
const statusTitle = computed(() => {
  const state = connectionState.value
  if (state.state === 'connected') {
    return message('storageBaiduNetdiskConnectedAs', `Connected as ${state.accountLabel}`, {
      account: state.accountLabel
    })
  }
  if (state.state === 'unsupported') {
    return message(
      'storageBaiduNetdiskDesktopOnly',
      'Baidu Netdisk is available in the desktop app'
    )
  }
  if (state.state === 'setup') {
    return message('storageBaiduNetdiskSetupRequired', 'Baidu Netdisk setup is required')
  }
  if (state.state === 'locked') {
    return message('storageBaiduNetdiskCredentialLocked', 'Credential storage is locked')
  }
  if (state.state === 'unavailable') {
    return message('storageBaiduNetdiskCredentialUnavailable', 'Credential storage is unavailable')
  }
  if (state.state === 'invalid') {
    return message('storageBaiduNetdiskConnectionNeedsRepair', 'Reconnect Baidu Netdisk')
  }
  return message('storageBaiduNetdiskNotConnected', 'Baidu Netdisk is not connected')
})

const statusDetail = computed(() => {
  const state = connectionState.value
  if (state.state === 'connected') {
    return message(
      'storageBaiduNetdiskConnectedDetail',
      'OpenPencil stores documents under /apps/OpenPencil in this Baidu Netdisk account.'
    )
  }
  if (state.state === 'unsupported') {
    return message(
      'storageBaiduNetdiskDesktopOnlyDetail',
      'Use the OpenPencil desktop app to complete Baidu device authorization.'
    )
  }
  if (state.state === 'setup') {
    return message(
      'storageBaiduNetdiskBuildConfigurationMissing',
      'This build could not initialize Baidu Netdisk authorization.'
    )
  }
  if (state.state === 'locked') {
    return message(
      'storageBaiduNetdiskCredentialLockedDetail',
      'Unlock encrypted credential storage, then try again.'
    )
  }
  if (state.state === 'unavailable') {
    return message(
      'storageBaiduNetdiskCredentialUnavailableDetail',
      'Encrypted credential storage could not be opened on this device.'
    )
  }
  if (state.state === 'invalid') {
    return message(
      'storageBaiduNetdiskConnectionNeedsRepairDetail',
      'The saved account metadata and encrypted grant no longer match. Reconnect this profile.'
    )
  }
  return message(
    'storageBaiduNetdiskConnectDescription',
    'Authorize Baidu Netdisk in your system browser without exposing the publisher SecretKey.'
  )
})

const permissionDisclosure = computed(() =>
  message(
    'storageBaiduNetdiskPermissionDisclosure',
    'OpenPencil requests only basic,netdisk and keeps documents under /apps/OpenPencil.'
  )
)

const modeDescription = computed(() => {
  const state = connectionState.value
  if (state.state !== 'connected') return null
  return state.clientMode === 'publisher-broker'
    ? message('storageBaiduNetdiskManagedConnection', 'OpenPencil managed connection')
    : message('storageBaiduNetdiskSelfHostedConnection', 'Self-hosted Baidu application')
})

function services(profileId = activeStorageProfileID.value) {
  return getBaiduNetdiskRuntimeServices({
    preferences: {},
    profileId,
    credentialManager: appCredentialServices.manager,
    credentialResolver: appCredentialServices.resolver,
    resolveCredential(field) {
      return appCredentialServices.resolver.resolve(
        credentialRef(BAIDU_NETDISK_STORAGE_PROVIDER_ID, field, profileId)
      )
    }
  })
}

function current(requestGeneration: number, profileId: string): boolean {
  return mounted && requestGeneration === generation && profileId === activeStorageProfileID.value
}

function setReady(ready: boolean): void {
  if (mounted) emit('ready', BAIDU_NETDISK_STORAGE_PROVIDER_ID, ready)
}

function profileHasOpenTabs(profileId: string): boolean {
  return storageProfileHasOpenTabs(
    { providerId: BAIDU_NETDISK_STORAGE_PROVIDER_ID, profileId },
    getTabsSnapshot().map((tab) => tab.store)
  )
}

function authorizationAccount(
  inspections: readonly StorageAuthorizationWorkInspection[]
): string | undefined {
  return baiduNetdiskSingleAccountId(inspections.map((inspection) => inspection.scope.authority))
}

function authorizationScope(profileId: string, authority: StorageDocumentAuthority) {
  return { providerId: BAIDU_NETDISK_STORAGE_PROVIDER_ID, profileId, authority }
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
  if (signal.aborted) {
    return message('storageBaiduNetdiskCancelled', 'Baidu Netdisk operation cancelled')
  }
  if (error instanceof StorageProfileOpenDocumentsError) {
    return message(
      'storageBaiduNetdiskAuthorizationBlockedByOpenDocuments',
      'Close documents from this Baidu Netdisk profile before changing its authorization.'
    )
  }
  if (error instanceof BaiduNetdiskUnfinishedAuthorizationWorkError) {
    return message(
      'storageBaiduNetdiskUnfinishedWork',
      'Finish or repair pending Baidu Netdisk sync work before removing this account from the device.'
    )
  }
  if (error instanceof StorageDurabilityUnavailableError) {
    return message(
      'storageDurabilityUnavailable',
      'Durable local storage is unavailable, so the Baidu Netdisk authorization was left unchanged.'
    )
  }
  if (error instanceof BaiduNetdiskOAuthError) {
    const byCode: Partial<Record<BaiduNetdiskOAuthError['code'], string>> = {
      unsupported: message(
        'storageBaiduNetdiskDesktopOnly',
        'Baidu Netdisk is available in the desktop app'
      ),
      'setup-required': message(
        'storageBaiduNetdiskBuildConfigurationMissing',
        'This build does not include the publisher Baidu AppKey and Broker configuration.'
      ),
      'self-hosted-credentials-required': message(
        'storageBaiduNetdiskCredentialsInvalid',
        'Select a valid Baidu appKey/secretKey JSON file.'
      ),
      cancelled: message('storageBaiduNetdiskCancelled', 'Baidu Netdisk operation cancelled'),
      'credential-locked': message(
        'storageBaiduNetdiskCredentialLocked',
        'Credential storage is locked'
      ),
      'credential-unavailable': message(
        'storageBaiduNetdiskCredentialUnavailable',
        'Credential storage is unavailable'
      ),
      'inconsistent-state': message(
        'storageBaiduNetdiskMultipleAccounts',
        'This profile contains inconsistent durable account work and must be repaired before reconnecting.'
      ),
      'profile-account-mismatch': message(
        'storageBaiduNetdiskDifferentAccount',
        'Use a new storage profile for a different Baidu account.'
      ),
      'authorization-denied': message(
        'storageBaiduNetdiskAuthorizationDenied',
        'Baidu authorization was denied.'
      ),
      'authorization-timeout': message(
        'storageBaiduNetdiskAuthorizationTimedOut',
        'Baidu device authorization timed out.'
      ),
      'oauth-client-invalid': message(
        'storageBaiduNetdiskCredentialsInvalid',
        'The selected Baidu OAuth application credentials are invalid.'
      ),
      'authorization-grant-invalid': message(
        'storageProviderNotConnected',
        'Baidu Netdisk must be reconnected.',
        { provider: 'Baidu Netdisk' }
      ),
      'device-code-expired': message(
        'storageBaiduNetdiskAuthorizationTimedOut',
        'The Baidu device code expired. Start the connection again.'
      ),
      'token-request-invalid': message(
        'storageBaiduNetdiskTokenRequestInvalid',
        'Baidu rejected the token request. Start the connection again.'
      ),
      'browser-open-failed': message(
        'storageBaiduNetdiskBrowserOpenFailed',
        'The system browser could not be opened.'
      ),
      'scope-mismatch': message(
        'storageBaiduNetdiskScopeMismatch',
        'Baidu did not grant the exact basic and netdisk scopes.'
      ),
      'network-failed': message(
        'storageBaiduNetdiskNetworkFailed',
        'Baidu Netdisk could not be reached.'
      ),
      'oauth-broker-unavailable': message(
        'storageTemporaryNetworkError',
        'The OpenPencil Baidu connection service is temporarily unavailable.'
      ),
      'token-exchange-failed': message(
        'storageBaiduNetdiskTokenRequestInvalid',
        'Baidu could not complete the device-token exchange.'
      ),
      'token-response-invalid': message(
        'storageBaiduNetdiskConnectionNeedsRepair',
        'Baidu returned an invalid token response. Reconnect this profile.'
      ),
      'userinfo-failed': message(
        'storageBaiduNetdiskVerificationFailed',
        'OpenPencil could not verify the authorized Baidu account.'
      ),
      'uk-mismatch': message(
        'storageBaiduNetdiskDifferentAccount',
        'The authorization belongs to a different Baidu account.'
      ),
      'rate-limited': message(
        'storageTemporaryNetworkError',
        'Baidu temporarily rate limited requests.'
      )
    }
    const translated = byCode[error.code]
    if (translated) return translated
  }
  return message('storageBaiduNetdiskOperationFailed', 'Baidu Netdisk operation failed')
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
          'storageBaiduNetdiskAuthorizationWorkRepairFailed',
          'OpenPencil could not inspect pending Baidu Netdisk work. Try again.'
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

function chooseSelfHostedCredentials(): void {
  if (busy.value || connectionState.value.state === 'unsupported') return
  if (!credentialsInput.value) return
  credentialsInput.value.value = ''
  credentialsInput.value.click()
}

async function onCredentialsInputChange(event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || busy.value) return
  if (file.size > MAX_BAIDU_NETDISK_SELF_HOSTED_CREDENTIALS_BYTES) {
    feedback.value = {
      tone: 'error',
      message: message(
        'storageBaiduNetdiskCredentialsInvalid',
        'The selected Baidu credentials file is invalid or too large.'
      )
    }
    return
  }
  try {
    const credentialsJSON = await file.text()
    parseBaiduNetdiskSelfHostedCredentialsJSON(credentialsJSON)
    await connect('self-hosted', credentialsJSON)
  } catch (error) {
    if (error instanceof BaiduNetdiskOAuthError) return
    feedback.value = {
      tone: 'error',
      message: message(
        'storageBaiduNetdiskCredentialsInvalid',
        'The selected file must contain exactly appKey and secretKey.'
      )
    }
  }
}

async function connect(mode: ConnectionMode, credentialsJSON?: string): Promise<void> {
  if (busy.value || (mode === 'publisher-broker' && !publisherConfig)) return
  const active = beginOperation('connecting')
  try {
    const result = await withDurableStorageProfileMutationDrain(
      { providerId: BAIDU_NETDISK_STORAGE_PROVIDER_ID, profileId: active.profileId },
      async () => {
        if (profileHasOpenTabs(active.profileId)) {
          throw new StorageProfileOpenDocumentsError()
        }
        const before = await listStorageProfileAuthorizationWork({
          providerId: BAIDU_NETDISK_STORAGE_PROVIDER_ID,
          profileId: active.profileId
        })
        const expectedUk = authorizationAccount(before)
        const common = {
          signal: active.controller.signal,
          ...(expectedUk ? { expectedUk } : {}),
          onCommitStart() {
            if (current(active.requestGeneration, active.profileId)) {
              operation.value = 'committing'
            }
          }
        }
        const connectOptions =
          mode === 'self-hosted'
            ? { ...common, mode, credentialsJSON: credentialsJSON ?? '' }
            : { ...common, mode }
        const connectedAccount = await services(active.profileId).oauth.connect(connectOptions)

        // Re-enumerate after the durable grant commit so crash-gap rows that were not represented
        // by the old public metadata are adopted too. The profile drain prevents new writers from
        // racing this authority migration.
        const after = await listStorageProfileAuthorizationWork({
          providerId: BAIDU_NETDISK_STORAGE_PROVIDER_ID,
          profileId: active.profileId
        })
        const durableAccount = authorizationAccount(after)
        if (durableAccount && durableAccount !== connectedAccount.authority.accountId) {
          throw new BaiduNetdiskOAuthError(
            'inconsistent-state',
            'Baidu Netdisk durable work belongs to a different Baidu account'
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
            providerId: BAIDU_NETDISK_STORAGE_PROVIDER_ID,
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
        ? message('storageBaiduNetdiskConnectionHealthy', 'Baidu Netdisk connection is healthy')
        : message(
            'storageBaiduNetdiskVerificationFailed',
            'The account connected, but OpenPencil could not verify Baidu Netdisk access.'
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
        ? message('storageBaiduNetdiskConnectionHealthy', 'Baidu Netdisk connection is healthy')
        : message(
            'storageBaiduNetdiskVerificationFailed',
            'OpenPencil could not verify Baidu Netdisk access. Check the account permission and network.'
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
      { providerId: BAIDU_NETDISK_STORAGE_PROVIDER_ID, profileId: active.profileId },
      async () => {
        if (profileHasOpenTabs(active.profileId)) {
          throw new StorageProfileOpenDocumentsError()
        }
        const inspections = await listStorageProfileAuthorizationWork({
          providerId: BAIDU_NETDISK_STORAGE_PROVIDER_ID,
          profileId: active.profileId
        })
        authorizationAccount(inspections)
        if (inspections.some((inspection) => inspection.requiresConfirmation)) {
          throw new BaiduNetdiskUnfinishedAuthorizationWorkError()
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
      message: message(
        'storageBaiduNetdiskRemovedLocally',
        'Baidu Netdisk was removed from this device'
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

async function repairStaleWork(): Promise<void> {
  if (busy.value || staleAuthorizationWork.value.length === 0) return
  const active = beginOperation('repairing')
  try {
    const verification = await withDurableStorageProfileMutationDrain(
      { providerId: BAIDU_NETDISK_STORAGE_PROVIDER_ID, profileId: active.profileId },
      async () => {
        const runtime = services(active.profileId)
        const status = await runtime.oauth.status()
        if (!current(active.requestGeneration, active.profileId)) return null
        if (status.state !== 'connected') {
          throw new BaiduNetdiskOAuthError(
            'authorization-grant-invalid',
            'Baidu Netdisk authorization is missing'
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
          throw new BaiduNetdiskOAuthError(
            'inconsistent-state',
            'Baidu Netdisk durable work belongs to a different Baidu account'
          )
        }
        for (const inspection of stale) {
          await adoptStorageAuthorizationWork({
            providerId: BAIDU_NETDISK_STORAGE_PROVIDER_ID,
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
          throw new Error('Baidu Netdisk authorization work changed during repair')
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
            'storageBaiduNetdiskAuthorizationWorkRecovered',
            'Pending Baidu Netdisk work was safely reconnected.'
          )
        : message(
            'storageBaiduNetdiskVerificationFailed',
            'Pending work was repaired, but OpenPencil could not verify Baidu Netdisk access.'
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
    message: message('storageBaiduNetdiskCancelled', 'Baidu Netdisk operation cancelled')
  }
}

async function removeProfile(profileId: string): Promise<void> {
  controller?.abort(new DOMException('Storage profile is being removed', 'AbortError'))
  generation++
  controller = null
  operation.value = 'idle'
  disposeBaiduNetdiskRuntimeProfile(appCredentialServices.manager, profileId)
  await Promise.all([
    appCredentialServices.manager.clear(baiduNetdiskRefreshTokenCredentialRef(profileId)),
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
  <div class="flex flex-col gap-3" data-test-id="settings-storage-baidu-netdisk">
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
          <p v-if="modeDescription" class="mt-1 text-[9px] leading-4 text-muted">
            {{ modeDescription }}
          </p>
        </div>
      </div>

      <div class="mt-3 flex flex-wrap gap-2">
        <template v-if="connected">
          <button
            type="button"
            class="rounded bg-hover px-3 py-1.5 text-[10px] font-medium text-surface hover:bg-active disabled:opacity-50"
            :disabled="busy"
            data-test-id="settings-storage-baidu-netdisk-check"
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
            data-test-id="settings-storage-baidu-netdisk-reconnect"
            @click="
              connectedMode === 'self-hosted'
                ? chooseSelfHostedCredentials()
                : connect('publisher-broker')
            "
          >
            {{ message('storageBaiduNetdiskReconnect', 'Reconnect') }}
          </button>
          <button
            type="button"
            class="rounded px-3 py-1.5 text-[10px] text-danger hover:bg-danger/10 disabled:opacity-50"
            :disabled="busy"
            data-test-id="settings-storage-baidu-netdisk-disconnect"
            @click="disconnect"
          >
            {{ message('storageBaiduNetdiskRemoveFromDevice', 'Remove from this device') }}
          </button>
        </template>
        <template v-else-if="connectionState.state !== 'unsupported'">
          <button
            v-if="publisherConfig"
            type="button"
            class="rounded bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            :disabled="busy"
            data-test-id="settings-storage-baidu-netdisk-connect"
            @click="connect('publisher-broker')"
          >
            {{
              operation === 'connecting'
                ? message('storageBaiduNetdiskWaitingForBrowser', 'Waiting for browser…')
                : message('storageBaiduNetdiskConnect', 'Connect Baidu Netdisk')
            }}
          </button>
          <button
            type="button"
            class="rounded bg-hover px-3 py-1.5 text-[10px] font-medium text-surface hover:bg-active disabled:opacity-50"
            :disabled="busy"
            data-test-id="settings-storage-baidu-netdisk-import-credentials"
            @click="chooseSelfHostedCredentials"
          >
            {{ message('storageBaiduNetdiskImportCredentials', 'Import credentials JSON') }}
          </button>
        </template>
        <button
          v-if="connectionState.state === 'invalid'"
          type="button"
          class="rounded px-3 py-1.5 text-[10px] text-danger hover:bg-danger/10 disabled:opacity-50"
          :disabled="busy"
          data-test-id="settings-storage-baidu-netdisk-remove-invalid"
          @click="disconnect"
        >
          {{ message('storageBaiduNetdiskRemoveFromDevice', 'Remove from this device') }}
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
          <p class="text-[10px] font-medium text-surface">basic,netdisk · /apps/OpenPencil</p>
          <p class="mt-1 text-[9px] leading-4 text-muted">{{ permissionDisclosure }}</p>
        </div>
      </div>
      <p class="mt-2 text-[9px] leading-4 text-muted">
        {{
          message(
            'storageBaiduNetdiskCredentialStorage',
            'The AppKey, SecretKey, and rotating refresh token for self-hosted mode are kept together in encrypted app-local storage. Access tokens remain only in memory.'
          )
        }}
      </p>
      <p v-if="!publisherConfig" class="mt-2 text-[9px] leading-4 text-warning">
        {{
          message(
            'storageBaiduNetdiskBuildConfigurationMissing',
            'The managed connection is unavailable in this build; self-hosted credentials remain available.'
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
            'storageBaiduNetdiskStaleWorkDescription',
            `OpenPencil found ${staleWorkCount} local Baidu Netdisk item(s) from an interrupted reconnect. Repair them before opening this workspace.`,
            { count: staleWorkCount }
          )
        }}
      </p>
      <button
        type="button"
        class="mt-2 rounded bg-hover px-2.5 py-1 text-[10px] font-medium text-surface hover:bg-active disabled:opacity-50"
        :disabled="busy"
        data-test-id="settings-storage-baidu-netdisk-repair-authorization"
        @click="repairStaleWork"
      >
        {{
          message(
            'storageBaiduNetdiskRepairAuthorizationWork',
            `Repair ${staleWorkCount} item(s)`,
            {
              count: staleWorkCount
            }
          )
        }}
      </button>
    </div>

    <input
      ref="credentialsInput"
      class="hidden"
      type="file"
      accept=".json,application/json"
      data-test-id="settings-storage-baidu-netdisk-credentials-input"
      @change="onCredentialsInputChange"
    />

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
