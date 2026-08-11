<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from '@open-pencil/vue'

import {
  activeStorageProfileID,
  readStoragePreferences,
  storageDocumentAuthoritiesEqual,
  type StorageDocumentAuthority,
  writeStoragePreference
} from '@/app/integrations/storage'
import {
  GOOGLE_DRIVE_CLIENT_ID_FIELD,
  GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
  resolveGoogleDriveClientId
} from '@/app/integrations/storage/google-drive/config'
import {
  GoogleDriveOAuthError,
  googleDriveRefreshTokenCredentialRef,
  type GoogleDriveOAuthStatus
} from '@/app/integrations/storage/google-drive/oauth/session'
import { LocalGoogleDriveOAuthMetadataStore } from '@/app/integrations/storage/google-drive/oauth/metadata'
import {
  disposeGoogleDriveRuntimeProfile,
  getGoogleDriveRuntimeServices
} from '@/app/integrations/storage/google-drive/runtime'
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
  inspectStorageAuthorizationWork,
  listStaleStorageAuthorizationWork,
  resumeStorageSync,
  type StorageAuthorizationWorkInspection
} from '@/app/storage/sync'
import { getTabsSnapshot } from '@/app/tabs'
import AppInput from '@/components/ui/AppInput.vue'

type ConnectionState = GoogleDriveOAuthStatus | { state: 'setup'; profileId: string }
type Operation = 'idle' | 'inspecting' | 'connecting' | 'checking' | 'disconnecting' | 'repairing'
type ActiveOperation = {
  controller: AbortController
  generation: number
  profileId: string
}
type PendingReconnect = {
  documentCount: number
  unfinishedDocumentCount: number
  jobCount: number
  authorities: readonly StorageDocumentAuthority[]
  snapshotFingerprint: string
}

type AuthorizationPreflight = {
  authorities: readonly StorageDocumentAuthority[]
  inspections: readonly StorageAuthorizationWorkInspection[]
  snapshotFingerprint: string
  pending: PendingReconnect | null
}

const emit = defineEmits<{
  ready: [providerId: typeof GOOGLE_DRIVE_STORAGE_PROVIDER_ID, ready: boolean]
}>()
const { dialogs } = useI18n()
const buildClientId = resolveGoogleDriveClientId({})
const connectionState = ref<ConnectionState>({
  state: 'setup',
  profileId: activeStorageProfileID.value
})
const operation = ref<Operation>('idle')
const feedback = ref<{ tone: 'success' | 'error' | 'neutral'; message: string } | null>(null)
const localOnlyAvailable = ref(false)
const pendingReconnect = ref<PendingReconnect | null>(null)
const staleAuthorizationWork = ref<StorageAuthorizationWorkInspection[]>([])
const reconnectConfirmButton = ref<HTMLButtonElement | null>(null)
const reconnectButton = ref<HTMLButtonElement | null>(null)
const metadataStore = new LocalGoogleDriveOAuthMetadataStore()
let controller: AbortController | null = null
let asyncGeneration = 0
let mounted = false

const connected = computed(() => connectionState.value.state === 'connected')
const busy = computed(() => operation.value !== 'idle')
const canConnect = computed(() => Boolean(buildClientId) && !busy.value && !pendingReconnect.value)
const maskedBuildClientId = computed(() =>
  buildClientId ? maskClientId(buildClientId) : dialogs.value.storageGoogleDriveClientIDUnavailable
)
const showLocalOnly = computed(
  () => localOnlyAvailable.value || connectionState.value.state === 'invalid'
)
const reconnectWorkCount = computed(() => {
  const pending = pendingReconnect.value
  return pending ? Math.max(pending.unfinishedDocumentCount, pending.jobCount) : 0
})
const staleWorkCount = computed(() =>
  staleAuthorizationWork.value.reduce(
    (count, inspection) => count + Math.max(inspection.documentCount, inspection.jobCount),
    0
  )
)

const statusTitle = computed(() => {
  const state = connectionState.value
  if (state.state === 'connected') {
    return dialogs.value.storageGoogleDriveConnectedAs({ account: state.accountLabel })
  }
  if (state.state === 'unsupported') return dialogs.value.storageGoogleDriveDesktopOnly
  if (state.state === 'locked') return dialogs.value.storageGoogleDriveCredentialLocked
  if (state.state === 'unavailable') return dialogs.value.storageGoogleDriveCredentialUnavailable
  if (state.state === 'invalid') return dialogs.value.storageGoogleDriveConnectionNeedsRepair
  if (state.state === 'missing') return dialogs.value.storageGoogleDriveNotConnected
  return dialogs.value.storageGoogleDriveSetupRequired
})

const statusDetail = computed(() => {
  const state = connectionState.value
  if (state.state === 'connected') return dialogs.value.storageGoogleDriveConnectedDetail
  if (state.state === 'unsupported') return dialogs.value.storageGoogleDriveDesktopOnlyDetail
  if (state.state === 'locked') return dialogs.value.storageGoogleDriveCredentialLockedDetail
  if (state.state === 'unavailable')
    return dialogs.value.storageGoogleDriveCredentialUnavailableDetail
  if (state.state === 'invalid') return dialogs.value.storageGoogleDriveConnectionNeedsRepairDetail
  if (state.state === 'setup') return dialogs.value.storageGoogleDriveBuildConfigurationMissing
  return dialogs.value.storageGoogleDriveConnectDescription
})

function maskClientId(clientId: string): string {
  const suffix = '.apps.googleusercontent.com'
  const identifier = clientId.endsWith(suffix) ? clientId.slice(0, -suffix.length) : clientId
  if (identifier.length <= 8) return `${identifier.slice(0, 2)}…${identifier.slice(-2)}${suffix}`
  return `${identifier.slice(0, 6)}…${identifier.slice(-4)}${suffix}`
}

function authorityFromConnection(state: GoogleDriveOAuthStatus): StorageDocumentAuthority | null {
  return state.state === 'connected'
    ? { accountId: state.subject, authorizationVersion: state.authorizationVersion }
    : null
}

function authorityKey(authority: StorageDocumentAuthority): string {
  return JSON.stringify([authority.accountId, authority.authorizationVersion])
}

function authorizationCandidates(state: GoogleDriveOAuthStatus): StorageDocumentAuthority[] {
  if (state.state === 'connected') {
    return [{ accountId: state.subject, authorizationVersion: state.authorizationVersion }]
  }
  if (state.state !== 'invalid') return []
  return state.repairAuthorities.map((authority) => ({
    accountId: authority.subject,
    authorizationVersion: authority.authorizationVersion
  }))
}

function authorizationScope(profileId: string, authority: StorageDocumentAuthority) {
  return { providerId: GOOGLE_DRIVE_STORAGE_PROVIDER_ID, profileId, authority }
}

function profileHasOpenTabs(profileId: string, accountId?: string): boolean {
  return storageProfileHasOpenTabs(
    {
      providerId: GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
      profileId,
      ...(accountId ? { accountId } : {})
    },
    getTabsSnapshot().map((tab) => tab.store)
  )
}

function authorizationSnapshotFingerprint(
  inspections: readonly StorageAuthorizationWorkInspection[]
): string {
  return JSON.stringify(
    inspections
      .map((inspection) => [
        authorityKey(inspection.scope.authority),
        inspection.documentCount,
        inspection.unfinishedDocumentCount,
        inspection.jobCount
      ])
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
  )
}

async function inspectAuthorizationPreflight(profileId: string): Promise<AuthorizationPreflight> {
  const status = await services(profileId).oauth.status()
  const seeds = authorizationCandidates(status)
  const inspections = new Map<string, StorageAuthorizationWorkInspection>()
  for (const authority of seeds) {
    const [current, stale] = await Promise.all([
      inspectStorageAuthorizationWork(authorizationScope(profileId, authority)),
      listStaleStorageAuthorizationWork(authorizationScope(profileId, authority))
    ])
    for (const inspection of [current, ...stale]) {
      inspections.set(authorityKey(inspection.scope.authority), inspection)
    }
  }
  const values = [...inspections.values()]
  const authorities = values.map((inspection) => inspection.scope.authority)
  const snapshotFingerprint = authorizationSnapshotFingerprint(values)
  const pending = values.filter((inspection) => inspection.requiresConfirmation)
  return {
    authorities,
    inspections: values,
    snapshotFingerprint,
    pending:
      pending.length === 0
        ? null
        : {
            documentCount: pending.reduce(
              (count, inspection) => count + inspection.documentCount,
              0
            ),
            unfinishedDocumentCount: pending.reduce(
              (count, inspection) => count + inspection.unfinishedDocumentCount,
              0
            ),
            jobCount: pending.reduce((count, inspection) => count + inspection.jobCount, 0),
            authorities,
            snapshotFingerprint
          }
  }
}

function clearLegacyClientIdOverride(profileId = activeStorageProfileID.value): void {
  writeStoragePreference(
    GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
    GOOGLE_DRIVE_CLIENT_ID_FIELD,
    '',
    profileId
  )
}

function services(profileId = activeStorageProfileID.value) {
  const preferences = readStoragePreferences(GOOGLE_DRIVE_STORAGE_PROVIDER_ID, profileId)
  return getGoogleDriveRuntimeServices({
    preferences,
    profileId,
    credentialManager: appCredentialServices.manager,
    credentialResolver: appCredentialServices.resolver,
    resolveCredential(field) {
      return appCredentialServices.resolver.resolve(
        credentialRef(GOOGLE_DRIVE_STORAGE_PROVIDER_ID, field, profileId)
      )
    }
  })
}

function operationError(error: unknown, signal: AbortSignal): string {
  if (signal.aborted) return dialogs.value.storageGoogleDriveCancelled
  if (error instanceof StorageDurabilityUnavailableError) {
    return dialogs.value.storageDurabilityUnavailable
  }
  if (error instanceof StorageProfileOpenDocumentsError) {
    return dialogs.value.storageGoogleDriveAuthorizationBlockedByOpenDocuments
  }
  if (error instanceof GoogleDriveOAuthError) {
    const messageByCode: Partial<Record<GoogleDriveOAuthError['code'], string>> = {
      'profile-account-mismatch': dialogs.value.storageGoogleDriveDifferentAccount,
      'authorization-denied': dialogs.value.storageGoogleDriveAuthorizationDenied,
      'authorization-timeout': dialogs.value.storageGoogleDriveAuthorizationTimedOut,
      'browser-open-failed': dialogs.value.storageGoogleDriveBrowserOpenFailed,
      'scope-mismatch': dialogs.value.storageGoogleDriveScopeMismatch,
      'network-failed': dialogs.value.storageGoogleDriveNetworkFailed,
      'invalid-client-id': dialogs.value.storageGoogleDriveDesktopClientRequired,
      'oauth-client-invalid': dialogs.value.storageGoogleDriveDesktopClientRequired,
      'redirect-uri-mismatch': dialogs.value.storageGoogleDriveRedirectUriMismatch,
      'token-request-invalid': dialogs.value.storageGoogleDriveTokenRequestInvalid,
      'authorization-grant-invalid': dialogs.value.storageGoogleDriveAuthorizationCodeRejected,
      'token-exchange-failed': dialogs.value.storageGoogleDriveTokenExchangeFailed,
      'token-response-invalid': dialogs.value.storageGoogleDriveTokenExchangeFailed,
      'userinfo-failed': dialogs.value.storageGoogleDriveAccountVerificationFailed,
      'subject-mismatch': dialogs.value.storageGoogleDriveAccountVerificationFailed,
      'credential-locked': dialogs.value.storageGoogleDriveCredentialLocked,
      'credential-unavailable': dialogs.value.storageGoogleDriveCredentialUnavailable
    }
    const message = messageByCode[error.code]
    if (message) return message
    if (/cancelled/i.test(error.message)) return dialogs.value.storageGoogleDriveCancelled
  }
  return dialogs.value.storageGoogleDriveOperationFailed
}

function repairOperationError(error: unknown): string {
  if (error instanceof StorageDurabilityUnavailableError) {
    return dialogs.value.storageDurabilityUnavailable
  }
  if (error instanceof StorageProfileOpenDocumentsError) {
    return dialogs.value.storageGoogleDriveAuthorizationBlockedByOpenDocuments
  }
  return dialogs.value.storageGoogleDriveAuthorizationWorkRepairFailed
}

function currentGeneration(generation: number, profileId: string): boolean {
  return mounted && generation === asyncGeneration && profileId === activeStorageProfileID.value
}

function emitReadiness(ready: boolean): void {
  if (!mounted) return
  emit('ready', GOOGLE_DRIVE_STORAGE_PROVIDER_ID, ready)
}

async function refreshStaleAuthorizationWork(
  profileId: string,
  authority: StorageDocumentAuthority,
  generation: number
): Promise<void> {
  const stale = await listStaleStorageAuthorizationWork(authorizationScope(profileId, authority))
  if (!currentGeneration(generation, profileId)) return
  staleAuthorizationWork.value = stale
}

async function refreshStatus(): Promise<void> {
  const generation = ++asyncGeneration
  const profileId = activeStorageProfileID.value
  if (!buildClientId) {
    if (!currentGeneration(generation, profileId)) return
    connectionState.value = { state: 'setup', profileId }
    emitReadiness(false)
    return
  }
  try {
    const status = await services(profileId).oauth.status()
    if (!currentGeneration(generation, profileId)) return
    connectionState.value = status
    emitReadiness(status.state === 'connected')
    const authority = authorityFromConnection(status)
    if (!authority) {
      staleAuthorizationWork.value = []
      return
    }
    try {
      await refreshStaleAuthorizationWork(profileId, authority, generation)
    } catch {
      if (!currentGeneration(generation, profileId)) return
      staleAuthorizationWork.value = []
      feedback.value = {
        tone: 'error',
        message: dialogs.value.storageGoogleDriveAuthorizationWorkRepairFailed
      }
    }
  } catch {
    if (!currentGeneration(generation, profileId)) return
    connectionState.value = { state: 'setup', profileId }
    emitReadiness(false)
  }
}

function beginOperation(next: Exclude<Operation, 'idle'>): ActiveOperation {
  controller?.abort()
  controller = new AbortController()
  const generation = ++asyncGeneration
  operation.value = next
  feedback.value = null
  return { controller, generation, profileId: activeStorageProfileID.value }
}

function finishOperation(operationController: AbortController): void {
  if (!mounted || controller !== operationController) return
  controller = null
  operation.value = 'idle'
}

async function performConnect(
  activeOperation: ActiveOperation,
  approvedPreviousAuthorities: readonly StorageDocumentAuthority[]
): Promise<void> {
  const signal = activeOperation.controller.signal
  const runtime = services(activeOperation.profileId)
  const account = await runtime.oauth.connect(signal)
  if (!currentGeneration(activeOperation.generation, activeOperation.profileId)) return
  const nextAuthority: StorageDocumentAuthority = {
    accountId: account.subject,
    authorizationVersion: account.authorizationVersion
  }
  const previousAuthorities = new Map<string, StorageDocumentAuthority>()
  for (const authority of approvedPreviousAuthorities) {
    if (!storageDocumentAuthoritiesEqual(authority, nextAuthority)) {
      previousAuthorities.set(authorityKey(authority), authority)
    }
  }
  for (const replacement of account.replacedAuthorities) {
    const candidate = {
      accountId: replacement.subject,
      authorizationVersion: replacement.authorizationVersion
    }
    if (!previousAuthorities.has(authorityKey(candidate))) continue
    if (!storageDocumentAuthoritiesEqual(candidate, nextAuthority)) {
      previousAuthorities.set(authorityKey(candidate), candidate)
    }
  }
  for (const candidate of previousAuthorities.values()) {
    await adoptStorageAuthorizationWork({
      providerId: GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
      profileId: activeOperation.profileId,
      previousAuthority: candidate,
      nextAuthority
    })
    if (!currentGeneration(activeOperation.generation, activeOperation.profileId)) return
  }
  const { replacedAuthorities: _replacedAuthorities, ...connectedAccount } = account
  connectionState.value = { state: 'connected', ...connectedAccount }
  emitReadiness(true)
  localOnlyAvailable.value = false
  feedback.value = {
    tone: 'success',
    message:
      approvedPreviousAuthorities.length > 0
        ? dialogs.value.storageGoogleDriveAuthorizationWorkRecovered
        : dialogs.value.storageGoogleDriveConnectedSuccess
  }
  const result = await runtime.adapter.testConnection({ signal })
  if (!currentGeneration(activeOperation.generation, activeOperation.profileId)) return
  if (!result.ok) {
    feedback.value = {
      tone: 'error',
      message: dialogs.value.storageGoogleDriveVerificationFailed
    }
  }
  await refreshStaleAuthorizationWork(
    activeOperation.profileId,
    nextAuthority,
    activeOperation.generation
  )
  if (!currentGeneration(activeOperation.generation, activeOperation.profileId)) return
  await resumeStorageSync()
}

async function connect(): Promise<void> {
  if (!canConnect.value) return
  const activeOperation = beginOperation('inspecting')
  const signal = activeOperation.controller.signal
  try {
    const pending = await withDurableStorageProfileMutationDrain(
      {
        providerId: GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
        profileId: activeOperation.profileId
      },
      async () => {
        const preflight = await inspectAuthorizationPreflight(activeOperation.profileId)
        if (!currentGeneration(activeOperation.generation, activeOperation.profileId)) return null
        const accountIds = new Set(preflight.authorities.map((authority) => authority.accountId))
        if (accountIds.size === 0) {
          if (profileHasOpenTabs(activeOperation.profileId)) {
            throw new StorageProfileOpenDocumentsError()
          }
        } else if (
          [...accountIds].some((accountId) =>
            profileHasOpenTabs(activeOperation.profileId, accountId)
          )
        ) {
          throw new StorageProfileOpenDocumentsError()
        }
        if (preflight.pending) return preflight.pending
        operation.value = 'connecting'
        await performConnect(activeOperation, preflight.authorities)
        return null
      },
      signal
    )
    if (!currentGeneration(activeOperation.generation, activeOperation.profileId)) return
    if (pending) {
      pendingReconnect.value = pending
      await nextTick()
      reconnectConfirmButton.value?.focus()
    }
  } catch (error) {
    if (!currentGeneration(activeOperation.generation, activeOperation.profileId)) return
    feedback.value = { tone: 'error', message: operationError(error, signal) }
    await refreshStatus()
  } finally {
    finishOperation(activeOperation.controller)
  }
}

async function confirmReconnect(): Promise<void> {
  const pending = pendingReconnect.value
  if (!pending || busy.value) return
  pendingReconnect.value = null
  const activeOperation = beginOperation('connecting')
  const signal = activeOperation.controller.signal
  try {
    await withDurableStorageProfileMutationDrain(
      {
        providerId: GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
        profileId: activeOperation.profileId
      },
      async () => {
        const preflight = await inspectAuthorizationPreflight(activeOperation.profileId)
        if (!currentGeneration(activeOperation.generation, activeOperation.profileId)) return
        if (preflight.snapshotFingerprint !== pending.snapshotFingerprint) {
          throw new Error('Google Drive authorization changed before reconnect confirmation')
        }
        if (
          preflight.authorities.some((authority) =>
            profileHasOpenTabs(activeOperation.profileId, authority.accountId)
          )
        ) {
          throw new StorageProfileOpenDocumentsError()
        }
        await performConnect(activeOperation, preflight.authorities)
      },
      signal
    )
  } catch (error) {
    if (!currentGeneration(activeOperation.generation, activeOperation.profileId)) return
    feedback.value = { tone: 'error', message: operationError(error, signal) }
    await refreshStatus()
  } finally {
    finishOperation(activeOperation.controller)
  }
}

async function cancelReconnect(): Promise<void> {
  pendingReconnect.value = null
  await nextTick()
  reconnectButton.value?.focus()
}

async function checkConnection(): Promise<void> {
  if (!connected.value || busy.value) return
  const activeOperation = beginOperation('checking')
  const signal = activeOperation.controller.signal
  try {
    const result = await services(activeOperation.profileId).adapter.testConnection({ signal })
    if (!currentGeneration(activeOperation.generation, activeOperation.profileId)) return
    feedback.value = {
      tone: result.ok ? 'success' : 'error',
      message: result.ok
        ? dialogs.value.storageGoogleDriveConnectionHealthy
        : dialogs.value.storageGoogleDriveVerificationFailed
    }
  } catch (error) {
    if (!currentGeneration(activeOperation.generation, activeOperation.profileId)) return
    feedback.value = { tone: 'error', message: operationError(error, signal) }
  } finally {
    finishOperation(activeOperation.controller)
  }
}

async function disconnect(localOnly = false): Promise<void> {
  if (busy.value) return
  const activeOperation = beginOperation('disconnecting')
  const signal = activeOperation.controller.signal
  try {
    const result = await withDurableStorageProfileMutationDrain(
      {
        providerId: GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
        profileId: activeOperation.profileId
      },
      async () => {
        const preflight = await inspectAuthorizationPreflight(activeOperation.profileId)
        if (!currentGeneration(activeOperation.generation, activeOperation.profileId)) return null
        if (
          preflight.authorities.length === 0
            ? profileHasOpenTabs(activeOperation.profileId)
            : preflight.authorities.some((authority) =>
                profileHasOpenTabs(activeOperation.profileId, authority.accountId)
              )
        ) {
          throw new StorageProfileOpenDocumentsError()
        }
        if (preflight.pending) return null
        return services(activeOperation.profileId).oauth.disconnect(
          { mode: localOnly ? 'local-only' : 'revoke' },
          signal
        )
      },
      signal
    )
    if (!currentGeneration(activeOperation.generation, activeOperation.profileId)) return
    if (!result) {
      feedback.value = {
        tone: 'error',
        message: dialogs.value.storageGoogleDriveDisconnectBlockedByUnsyncedWork
      }
      return
    }
    if (result.outcome === 'revoke-failed') {
      localOnlyAvailable.value = true
      feedback.value = {
        tone: 'error',
        message: dialogs.value.storageGoogleDriveRevokeFailed
      }
      return
    }
    localOnlyAvailable.value = false
    feedback.value = {
      tone: 'neutral',
      message: localOnly
        ? dialogs.value.storageGoogleDriveRemovedLocally
        : dialogs.value.storageGoogleDriveDisconnected
    }
    await refreshStatus()
  } catch (error) {
    if (!currentGeneration(activeOperation.generation, activeOperation.profileId)) return
    feedback.value = { tone: 'error', message: operationError(error, signal) }
  } finally {
    finishOperation(activeOperation.controller)
  }
}

async function repairStaleWork(): Promise<void> {
  if (busy.value || staleAuthorizationWork.value.length === 0) return
  const activeOperation = beginOperation('repairing')
  try {
    await withDurableStorageProfileMutationDrain(
      {
        providerId: GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
        profileId: activeOperation.profileId
      },
      async () => {
        const status = await services(activeOperation.profileId).oauth.status()
        const nextAuthority = authorityFromConnection(status)
        if (!currentGeneration(activeOperation.generation, activeOperation.profileId)) return
        if (!nextAuthority) throw new Error('Google Drive authorization is missing')
        if (profileHasOpenTabs(activeOperation.profileId, nextAuthority.accountId)) {
          throw new StorageProfileOpenDocumentsError()
        }
        const stale = await listStaleStorageAuthorizationWork(
          authorizationScope(activeOperation.profileId, nextAuthority)
        )
        if (!currentGeneration(activeOperation.generation, activeOperation.profileId)) return
        for (const inspection of stale) {
          await adoptStorageAuthorizationWork({
            providerId: GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
            profileId: activeOperation.profileId,
            previousAuthority: inspection.scope.authority,
            nextAuthority
          })
          if (!currentGeneration(activeOperation.generation, activeOperation.profileId)) return
        }
        await refreshStaleAuthorizationWork(
          activeOperation.profileId,
          nextAuthority,
          activeOperation.generation
        )
        if (!currentGeneration(activeOperation.generation, activeOperation.profileId)) return
        await resumeStorageSync()
      },
      activeOperation.controller.signal
    )
    if (!currentGeneration(activeOperation.generation, activeOperation.profileId)) return
    feedback.value = {
      tone: 'success',
      message: dialogs.value.storageGoogleDriveAuthorizationWorkRecovered
    }
  } catch (error) {
    if (!currentGeneration(activeOperation.generation, activeOperation.profileId)) return
    feedback.value = {
      tone: 'error',
      message: repairOperationError(error)
    }
  } finally {
    finishOperation(activeOperation.controller)
  }
}

function cancelOperation(): void {
  const activeController = controller
  controller = null
  asyncGeneration++
  operation.value = 'idle'
  activeController?.abort(new DOMException('Cancelled by the user', 'AbortError'))
  feedback.value = {
    tone: 'neutral',
    message: dialogs.value.storageGoogleDriveCancelled
  }
}

async function removeProfile(profileId: string): Promise<void> {
  controller?.abort(new DOMException('Storage profile is being removed', 'AbortError'))
  asyncGeneration++
  controller = null
  operation.value = 'idle'
  disposeGoogleDriveRuntimeProfile(appCredentialServices.manager, profileId)
  await Promise.all([
    appCredentialServices.manager.clear(googleDriveRefreshTokenCredentialRef(profileId)),
    metadataStore.remove(profileId)
  ])
}

defineExpose({ removeProfile })

watch(activeStorageProfileID, (profileId) => {
  asyncGeneration++
  controller?.abort()
  controller = null
  operation.value = 'idle'
  feedback.value = null
  localOnlyAvailable.value = false
  pendingReconnect.value = null
  staleAuthorizationWork.value = []
  clearLegacyClientIdOverride(profileId)
  void refreshStatus()
})

onMounted(() => {
  mounted = true
  clearLegacyClientIdOverride(activeStorageProfileID.value)
  void refreshStatus()
})
onBeforeUnmount(() => {
  mounted = false
  asyncGeneration++
  controller?.abort()
  controller = null
  pendingReconnect.value = null
  staleAuthorizationWork.value = []
})
</script>

<template>
  <div class="flex flex-col gap-3" data-test-id="settings-storage-google-drive">
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
              {{ dialogs.storageConnected }}
            </span>
          </div>
          <p class="mt-1 text-[10px] leading-4 text-muted">{{ statusDetail }}</p>
        </div>
      </div>

      <div v-if="!pendingReconnect" class="mt-3 flex flex-wrap gap-2">
        <template v-if="connected">
          <button
            type="button"
            class="rounded bg-hover px-3 py-1.5 text-[10px] font-medium text-surface hover:bg-active disabled:opacity-50"
            :disabled="busy"
            @click="checkConnection"
          >
            {{
              operation === 'checking'
                ? dialogs.storageCheckingConnection
                : dialogs.storageCheckConnection
            }}
          </button>
          <button
            ref="reconnectButton"
            type="button"
            class="rounded px-3 py-1.5 text-[10px] text-muted hover:bg-hover hover:text-surface disabled:opacity-50"
            :disabled="busy"
            @click="connect"
          >
            {{ dialogs.storageGoogleDriveReconnect }}
          </button>
          <button
            type="button"
            class="rounded px-3 py-1.5 text-[10px] text-danger hover:bg-danger/10 disabled:opacity-50"
            :disabled="busy"
            @click="disconnect(false)"
          >
            {{ dialogs.storageGoogleDriveDisconnect }}
          </button>
        </template>
        <button
          v-else-if="connectionState.state !== 'unsupported'"
          ref="reconnectButton"
          type="button"
          class="rounded bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          :disabled="!canConnect"
          data-test-id="settings-storage-google-connect"
          @click="connect"
        >
          {{
            operation === 'connecting'
              ? dialogs.storageGoogleDriveWaitingForBrowser
              : operation === 'inspecting'
                ? dialogs.storageCheckingConnection
                : dialogs.storageGoogleDriveConnect
          }}
        </button>
        <button
          v-if="busy && operation !== 'repairing'"
          type="button"
          class="rounded px-3 py-1.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
          @click="cancelOperation"
        >
          {{ dialogs.cancel }}
        </button>
      </div>

      <div
        v-else
        class="mt-3 rounded border border-warning/30 bg-warning/10 p-2.5"
        role="alertdialog"
        aria-labelledby="storage-google-reconnect-title"
        aria-describedby="storage-google-reconnect-description"
      >
        <p id="storage-google-reconnect-title" class="text-[10px] font-medium text-surface">
          {{ dialogs.storageGoogleDriveReconnectWorkTitle }}
        </p>
        <p id="storage-google-reconnect-description" class="mt-1 text-[9px] leading-4 text-muted">
          {{
            dialogs.storageGoogleDriveReconnectWorkDescription({
              documents: pendingReconnect.unfinishedDocumentCount,
              jobs: pendingReconnect.jobCount
            })
          }}
        </p>
        <div class="mt-2 flex flex-wrap gap-2">
          <button
            ref="reconnectConfirmButton"
            type="button"
            class="rounded bg-warning px-2.5 py-1 text-[10px] font-medium text-white hover:bg-warning/90"
            data-test-id="settings-storage-google-reconnect-confirm"
            @click="confirmReconnect"
          >
            {{ dialogs.storageGoogleDriveReconnectWorkConfirm({ count: reconnectWorkCount }) }}
          </button>
          <button
            type="button"
            class="rounded px-2.5 py-1 text-[10px] text-muted hover:bg-hover hover:text-surface"
            @click="cancelReconnect"
          >
            {{ dialogs.cancel }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="showLocalOnly"
      class="rounded border border-warning/30 bg-warning/10 p-2.5 text-[10px] leading-4 text-muted"
    >
      <p>{{ dialogs.storageGoogleDriveLocalOnlyWarning }}</p>
      <button
        type="button"
        class="mt-2 rounded bg-hover px-2.5 py-1 text-[10px] font-medium text-surface hover:bg-active disabled:opacity-50"
        :disabled="busy"
        @click="disconnect(true)"
      >
        {{ dialogs.storageGoogleDriveRemoveFromDevice }}
      </button>
    </div>

    <div
      v-if="staleAuthorizationWork.length > 0"
      class="rounded border border-warning/30 bg-warning/10 p-2.5 text-[10px] leading-4 text-muted"
      role="status"
      aria-live="polite"
    >
      <p>{{ dialogs.storageGoogleDriveStaleWorkDescription({ count: staleWorkCount }) }}</p>
      <button
        type="button"
        class="mt-2 rounded bg-hover px-2.5 py-1 text-[10px] font-medium text-surface hover:bg-active disabled:opacity-50"
        :disabled="busy"
        data-test-id="settings-storage-google-repair-authorization"
        @click="repairStaleWork"
      >
        {{ dialogs.storageGoogleDriveRepairAuthorizationWork({ count: staleWorkCount }) }}
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

    <details class="rounded border border-border/70 bg-panel/20 p-2.5">
      <summary class="cursor-pointer select-none text-[10px] font-medium text-muted">
        {{ dialogs.storageGoogleDriveAdvanced }}
      </summary>
      <div class="mt-3 flex flex-col gap-2">
        <label class="flex flex-col gap-1 text-[10px] text-muted">
          {{ dialogs.storageGoogleDriveClientID }}
          <AppInput
            :model-value="maskedBuildClientId"
            :aria-label="dialogs.storageGoogleDriveClientID"
            readonly
            size="sm"
            tone="panel"
          />
        </label>
        <p class="text-[9px] leading-4 text-muted">
          {{ dialogs.storageGoogleDriveClientIDHint }}
        </p>
        <p
          class="text-[9px] leading-4 text-muted"
          data-test-id="settings-storage-google-credential-storage"
        >
          {{ dialogs.storageGoogleDriveCredentialStorage }}
        </p>
        <p class="text-[9px] text-muted">
          {{ dialogs.storageProfileID({ profile: activeStorageProfileID }) }}
        </p>
      </div>
    </details>
  </div>
</template>
