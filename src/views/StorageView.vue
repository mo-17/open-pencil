<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useEventListener, useIntervalFn } from '@vueuse/core'
import { useI18n } from '@open-pencil/vue'

import {
  activeStorageProfileID,
  activeStorageProviderID,
  createActiveStorageAdapter,
  readGoogleDriveStoredAuthority,
  resolveStorageDocumentBinding,
  storageCredentialStatuses,
  storageDocumentAuthoritiesEqual,
  storageDocumentKey,
  storageDocumentAuthorityMatches,
  storageProviderPluginEnabled,
  storageProviderPluginState,
  storagePreferencesComplete,
  storageProviderRegistry,
  type StorageAdapter,
  type StorageDocument,
  type StorageDocumentAuthority,
  type StorageDocumentBinding
} from '@/app/integrations/storage'
import {
  clearGoogleDriveChangeCursor,
  readGoogleDriveChangeCursor,
  writeGoogleDriveChangeCursor
} from '@/app/integrations/storage/google-drive/change-cursor'
import type { GoogleDriveStorageAdapter } from '@/app/integrations/storage/google-drive/adapter'
import { isOpenPencilFile } from '@/app/integrations/storage/google-drive/client'
import { GoogleDriveError } from '@/app/integrations/storage/google-drive/errors'
import { GoogleDriveOAuthError } from '@/app/integrations/storage/google-drive/oauth/session'
import { openSettingsDialog, settingsDialogOpen } from '@/app/settings/dialog'
import type { CredentialStatus } from '@/app/settings/credentials/types'
import {
  assertCloudStorageDurability,
  StorageDurabilityUnavailableError
} from '@/app/storage/durability'
import { createCanvasId } from '@/app/storage/id'
import {
  getLocalCanvasStore,
  type LocalCanvasMeta,
  type LocalSyncStatus
} from '@/app/storage/local-store'
import { withStorageProfileMutationLease } from '@/app/storage/mutation-drain'
import { reconcileStorageDocuments } from '@/app/storage/reconcile'
import { pendingSyncCount, syncUiState, uploadProgressByCanvas } from '@/app/storage/sync'
import { queueStorageDocumentDeletion } from '@/app/storage/workspace/delete'
import {
  activeTab,
  allTabs,
  createTab,
  getTabsSnapshot,
  openStorageDocumentInNewTab
} from '@/app/tabs'
import StorageDeleteDocumentDialog from '@/components/storage/StorageDeleteDocumentDialog.vue'
import StorageWorkspaceDocumentCard from '@/components/storage/StorageWorkspaceDocumentCard.vue'
import AppPlaceholder from '@/components/ui/AppPlaceholder.vue'

const GOOGLE_DRIVE_PROVIDER_ID = 'google-drive'
const CHANGE_POLL_INTERVAL_MS = 60_000
const { dialogs } = useI18n()
const router = useRouter()
const provider = computed(() => storageProviderRegistry.get(activeStorageProviderID.value))
const providerPluginState = computed(() => storageProviderPluginState(provider.value.id))
const documents = ref<StorageDocument[]>([])
const statusesByKey = ref<ReadonlyMap<string, LocalSyncStatus>>(new Map())
const preservedCopyIds = ref<ReadonlySet<string>>(new Set())
const credentialStatuses = ref<Record<string, CredentialStatus>>({})
const configurationComplete = computed(
  () =>
    providerPluginState.value === 'enabled' &&
    storagePreferencesComplete(provider.value.id, activeStorageProfileID.value) &&
    provider.value.credentialFields.every(
      (field) => !field.required || credentialStatuses.value[field.id] === 'configured'
    )
)
const connectionReady = ref(activeStorageProviderID.value !== GOOGLE_DRIVE_PROVIDER_ID)
const configured = computed(() => configurationComplete.value && connectionReady.value)
const durabilityAvailable = ref<boolean | null>(null)
const loading = ref(false)
const checkingChanges = ref(false)
const creating = ref(false)
const openingDocumentId = ref<string | null>(null)
const deletingDocumentId = ref<string | null>(null)
const error = ref<string | null>(null)
const operationNotice = ref<string | null>(null)
const activeAuthority = ref<StorageDocumentAuthority | null>(null)
let refreshController: AbortController | null = null
let changeController: AbortController | null = null
let openController: AbortController | null = null
let createController: AbortController | null = null

type WorkspaceIdentity = Omit<StorageDocumentBinding, 'documentId'>

type DeleteCandidate = Readonly<{
  document: StorageDocument
  identity: WorkspaceIdentity
  binding: StorageDocumentBinding
}>

const deleteCandidate = ref<DeleteCandidate | null>(null)

type RefreshContext = Readonly<{
  providerId: string
  profileId: string
  controller: AbortController
}>

const conflictCount = computed(
  () => [...statusesByKey.value.values()].filter((status) => status === 'conflict').length
)

const deleteBlockedByOpenTab = computed(() => {
  void allTabs.value.length
  const candidate = deleteCandidate.value
  return candidate ? storageBindingIsOpen(candidate.binding) : false
})

const syncSummary = computed(() => {
  if (syncUiState.value === 'offline') return dialogs.value.storageSyncOffline
  if (syncUiState.value === 'error') return dialogs.value.storageSyncNeedsAttention
  if (syncUiState.value === 'syncing' || pendingSyncCount.value > 0) {
    return dialogs.value.storageSyncingCount({ count: pendingSyncCount.value })
  }
  return null
})

function currentWorkspaceIdentity(): WorkspaceIdentity {
  return {
    providerId: activeStorageProviderID.value,
    profileId: activeStorageProfileID.value,
    ...(activeAuthority.value ? { authority: activeAuthority.value } : {})
  }
}

function bindingFor(identity: WorkspaceIdentity, documentId: string): StorageDocumentBinding {
  return resolveStorageDocumentBinding({
    providerId: identity.providerId,
    profileId: identity.profileId,
    documentId,
    ...(identity.authority ? { authority: identity.authority } : {})
  })
}

function activeBinding(documentId: string): StorageDocumentBinding {
  return bindingFor(currentWorkspaceIdentity(), documentId)
}

function matchesStorageAccount(
  metadata: {
    providerId: string
    profileId: string
    authority: StorageDocumentAuthority | null
  },
  identity: WorkspaceIdentity
): boolean {
  if (metadata.providerId !== identity.providerId || metadata.profileId !== identity.profileId) {
    return false
  }
  if (!identity.authority || !metadata.authority) {
    return identity.authority === undefined && metadata.authority === null
  }
  if (identity.providerId === GOOGLE_DRIVE_PROVIDER_ID) {
    return metadata.authority.accountId === identity.authority.accountId
  }
  return storageDocumentAuthoritiesEqual(metadata.authority, identity.authority)
}

function scopeIsCurrent(scope: Pick<WorkspaceIdentity, 'providerId' | 'profileId'>): boolean {
  return (
    activeStorageProviderID.value === scope.providerId &&
    activeStorageProfileID.value === scope.profileId
  )
}

function identityIsCurrent(identity: WorkspaceIdentity): boolean {
  return (
    scopeIsCurrent(identity) &&
    storageDocumentAuthorityMatches(identity.authority, activeAuthority.value)
  )
}

function refreshIsCurrent(context: RefreshContext): boolean {
  return (
    refreshController === context.controller &&
    !context.controller.signal.aborted &&
    scopeIsCurrent(context) &&
    storageProviderPluginEnabled(context.providerId)
  )
}

function requireCurrent(operationIsCurrent: () => boolean): void {
  if (!operationIsCurrent())
    throw new DOMException('Storage operation was superseded', 'AbortError')
}

function updateActiveAuthority(authority: StorageDocumentAuthority | null): void {
  activeAuthority.value = authority
}

function storageAccountFilter(identity: WorkspaceIdentity) {
  return (metadata: {
    providerId: string
    profileId: string
    authority: StorageDocumentAuthority | null
  }) => matchesStorageAccount(metadata, identity)
}

function updateStatuses(local: readonly LocalCanvasMeta[]): void {
  statusesByKey.value = new Map(local.map((metadata) => [metadata.key, metadata.syncStatus]))
  preservedCopyIds.value = new Set(
    local.filter((metadata) => metadata.conflictOfDocumentId).map((metadata) => metadata.id)
  )
}

async function paintLocalDocuments(
  identity: WorkspaceIdentity,
  operationIsCurrent: () => boolean
): Promise<LocalCanvasMeta[]> {
  const local = (await getLocalCanvasStore().listMetas()).filter(storageAccountFilter(identity))
  requireCurrent(operationIsCurrent)
  documents.value = local.map((metadata) => ({
    id: metadata.id,
    name: metadata.name,
    updatedAt: metadata.updatedAt,
    remoteRevision: metadata.remoteRevision,
    metadataAuthoritative: true
  }))
  updateStatuses(local)
  return local
}

function documentStatus(document: StorageDocument): LocalSyncStatus {
  return statusesByKey.value.get(storageDocumentKey(activeBinding(document.id))) ?? 'synced'
}

function documentProgress(document: StorageDocument): number | null {
  return uploadProgressByCanvas.value.get(storageDocumentKey(activeBinding(document.id))) ?? null
}

function storageBindingsShareRemoteDocument(
  first: StorageDocumentBinding,
  second: StorageDocumentBinding
): boolean {
  if (
    first.providerId !== second.providerId ||
    first.profileId !== second.profileId ||
    first.documentId !== second.documentId
  ) {
    return false
  }
  if (!first.authority || !second.authority) {
    return first.authority === undefined && second.authority === undefined
  }
  return first.authority.accountId === second.authority.accountId
}

function storageBindingIsOpen(binding: StorageDocumentBinding): boolean {
  return getTabsSnapshot().some((tab) => {
    const current = tab.store.getStorageBinding()
    return current ? storageBindingsShareRemoteDocument(current, binding) : false
  })
}

function requestDeleteDocument(document: StorageDocument): void {
  if (deletingDocumentId.value || durabilityAvailable.value !== true) return
  const identity = currentWorkspaceIdentity()
  if (identity.providerId === GOOGLE_DRIVE_PROVIDER_ID && !identity.authority) return
  deleteCandidate.value = {
    document,
    identity,
    binding: bindingFor(identity, document.id)
  }
  operationNotice.value = null
  error.value = null
}

function closeDeleteDialog(open: boolean): void {
  if (!open && !deletingDocumentId.value) deleteCandidate.value = null
}

async function confirmDeleteDocument(): Promise<void> {
  const candidate = deleteCandidate.value
  if (!candidate || deletingDocumentId.value || storageBindingIsOpen(candidate.binding)) return
  deletingDocumentId.value = candidate.document.id
  operationNotice.value = null
  error.value = null
  try {
    await requireCloudStorageDurability()
    if (!identityIsCurrent(candidate.identity) || storageBindingIsOpen(candidate.binding)) return
    const result = await queueStorageDocumentDeletion(candidate.binding)
    if (!identityIsCurrent(candidate.identity)) return
    await paintLocalDocuments(candidate.identity, () => identityIsCurrent(candidate.identity))
    operationNotice.value =
      result.queueState === 'queued'
        ? dialogs.value.storageDeleteDocumentQueued
        : dialogs.value.storageDeleteDocumentRecoveryPending
    if (deleteCandidate.value === candidate) deleteCandidate.value = null
  } catch (reason) {
    const superseded = reason instanceof DOMException && reason.name === 'AbortError'
    if (!superseded && identityIsCurrent(candidate.identity)) {
      error.value =
        reason instanceof StorageDurabilityUnavailableError
          ? friendlyError(reason)
          : dialogs.value.storageDeleteDocumentFailed
    }
  } finally {
    if (deletingDocumentId.value === candidate.document.id) deletingDocumentId.value = null
  }
}

function aborted(reason: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (reason instanceof DOMException && reason.name === 'AbortError')
}

function friendlyError(reason: unknown): string {
  if (reason instanceof StorageDurabilityUnavailableError) {
    return dialogs.value.storageDurabilityUnavailable
  }
  if (reason instanceof GoogleDriveOAuthError) {
    if (
      reason.code === 'credential-missing' ||
      reason.code === 'credential-invalid' ||
      reason.code === 'inconsistent-state'
    ) {
      return dialogs.value.storageGoogleDriveNotConnected
    }
    if (reason.code === 'credential-locked') return dialogs.value.storageGoogleDriveCredentialLocked
    if (reason.code === 'credential-unavailable') {
      return dialogs.value.storageGoogleDriveCredentialUnavailable
    }
  }
  if (reason instanceof GoogleDriveError) {
    if (reason.code === 'auth' || reason.code === 'authorization-changed') {
      return dialogs.value.storageGoogleDriveReconnectRequired
    }
    if (reason.code === 'permission') return dialogs.value.storageGoogleDrivePermissionDenied
    if (reason.code === 'rate-limited') return dialogs.value.storageGoogleDriveRateLimited
    if (reason.code === 'network' || reason.code === 'server') {
      return dialogs.value.storageTemporaryNetworkError
    }
    if (reason.code === 'resource-limit') return dialogs.value.storageDocumentTooLarge
  }
  return dialogs.value.storageWorkspaceLoadFailed
}

async function requireCloudStorageDurability(): Promise<void> {
  try {
    await assertCloudStorageDurability()
    durabilityAvailable.value = true
  } catch (reason) {
    if (reason instanceof StorageDurabilityUnavailableError) {
      durabilityAvailable.value = false
    }
    throw reason
  }
}

function isGoogleDriveAdapter(adapter: StorageAdapter): adapter is GoogleDriveStorageAdapter {
  return 'getStartPageToken' in adapter && 'listChanges' in adapter
}

async function reconcileRemoteDocuments(
  adapter: StorageAdapter,
  identity: WorkspaceIdentity,
  context: RefreshContext
): Promise<void> {
  const { signal } = context.controller
  const operationIsCurrent = () => refreshIsCurrent(context) && identityIsCurrent(identity)
  const nextCursor =
    isGoogleDriveAdapter(adapter) && identity.authority
      ? await adapter.getStartPageToken({ signal })
      : null
  requireCurrent(operationIsCurrent)
  const remote = await adapter.listDocuments({ signal })
  requireCurrent(operationIsCurrent)
  const localStore = getLocalCanvasStore()
  const local = (await localStore.listMetas(true)).filter(storageAccountFilter(identity))
  requireCurrent(operationIsCurrent)
  const reconciliation = reconcileStorageDocuments(local, remote)

  for (const binding of reconciliation.localBindingsToPurge) {
    requireCurrent(operationIsCurrent)
    await localStore.remove(binding)
  }
  for (const document of reconciliation.remoteDocumentsToSeed) {
    requireCurrent(operationIsCurrent)
    await localStore.upsertIndexMeta({
      id: document.id,
      providerId: identity.providerId,
      profileId: identity.profileId,
      authority: identity.authority ?? null,
      name: document.name,
      updatedAt: document.updatedAt,
      syncStatus: 'synced',
      lastSyncedAt: document.updatedAt,
      lastSyncError: null,
      remoteRevision: document.remoteRevision ?? null
    })
  }
  const refreshedLocal = (await localStore.listMetas(true)).filter(storageAccountFilter(identity))
  requireCurrent(operationIsCurrent)
  documents.value = reconciliation.documents
  updateStatuses(refreshedLocal)
  if (nextCursor && identity.authority) {
    writeGoogleDriveChangeCursor(
      { profileId: identity.profileId, authority: identity.authority },
      nextCursor
    )
  }
}

function configurationReadyFor(
  providerId: string,
  profileId: string,
  statuses: Readonly<Record<string, CredentialStatus>>
): boolean {
  const registration = storageProviderRegistry.get(providerId)
  return (
    storageProviderPluginEnabled(providerId) &&
    storagePreferencesComplete(providerId, profileId) &&
    registration.credentialFields.every(
      (field) => !field.required || statuses[field.id] === 'configured'
    )
  )
}

async function refresh(): Promise<boolean> {
  refreshController?.abort()
  changeController?.abort()
  const controller = new AbortController()
  refreshController = controller
  const context: RefreshContext = Object.freeze({
    providerId: activeStorageProviderID.value,
    profileId: activeStorageProfileID.value,
    controller
  })
  loading.value = true
  error.value = null
  try {
    if (providerPluginState.value === 'loading') return false
    if (!storageProviderPluginEnabled(context.providerId)) {
      connectionReady.value = false
      return false
    }

    const statuses = await storageCredentialStatuses(context.providerId, context.profileId)
    requireCurrent(() => refreshIsCurrent(context))
    credentialStatuses.value = statuses
    if (!configurationReadyFor(context.providerId, context.profileId, statuses)) {
      connectionReady.value = false
      durabilityAvailable.value = null
      return false
    }
    await requireCloudStorageDurability()
    requireCurrent(() => refreshIsCurrent(context))

    let identity: WorkspaceIdentity = {
      providerId: context.providerId,
      profileId: context.profileId
    }
    if (context.providerId === GOOGLE_DRIVE_PROVIDER_ID) {
      const storedAuthority = await readGoogleDriveStoredAuthority(context.profileId)
      requireCurrent(() => refreshIsCurrent(context))
      if (storedAuthority) {
        identity = { ...identity, authority: storedAuthority }
        updateActiveAuthority(storedAuthority)
        await paintLocalDocuments(identity, () => refreshIsCurrent(context))
      } else {
        updateActiveAuthority(null)
      }
    } else {
      updateActiveAuthority(null)
      await paintLocalDocuments(identity, () => refreshIsCurrent(context))
    }

    const adapter = createActiveStorageAdapter(context.providerId, context.profileId)
    const remoteAuthority = (await adapter.getAuthority?.({ signal: controller.signal })) ?? null
    requireCurrent(() => refreshIsCurrent(context))
    if (context.providerId === GOOGLE_DRIVE_PROVIDER_ID && remoteAuthority === null) {
      connectionReady.value = false
      error.value = dialogs.value.storageGoogleDriveNotConnected
      return false
    }
    identity = {
      providerId: context.providerId,
      profileId: context.profileId,
      ...(remoteAuthority ? { authority: remoteAuthority } : {})
    }
    updateActiveAuthority(remoteAuthority)
    connectionReady.value = true
    await paintLocalDocuments(identity, () => refreshIsCurrent(context))
    await reconcileRemoteDocuments(adapter, identity, context)
    return true
  } catch (reason) {
    if (aborted(reason, controller.signal)) return false
    if (
      context.providerId === GOOGLE_DRIVE_PROVIDER_ID &&
      reason instanceof GoogleDriveOAuthError
    ) {
      connectionReady.value = false
    }
    if (scopeIsCurrent(context)) error.value = friendlyError(reason)
    return false
  } finally {
    if (refreshController === controller) {
      refreshController = null
      loading.value = false
    }
  }
}

async function checkForRemoteChanges(): Promise<void> {
  if (
    loading.value ||
    checkingChanges.value ||
    !configured.value ||
    durabilityAvailable.value !== true ||
    activeStorageProviderID.value !== GOOGLE_DRIVE_PROVIDER_ID ||
    !activeAuthority.value
  ) {
    return
  }
  const workspaceIdentity = currentWorkspaceIdentity()
  if (!workspaceIdentity.authority) return
  const adapter = createActiveStorageAdapter(
    workspaceIdentity.providerId,
    workspaceIdentity.profileId
  )
  if (!isGoogleDriveAdapter(adapter)) return
  const cursorIdentity = {
    profileId: workspaceIdentity.profileId,
    authority: workspaceIdentity.authority
  }
  const cursor = readGoogleDriveChangeCursor(cursorIdentity)
  if (!cursor) {
    await refresh()
    return
  }
  const controller = new AbortController()
  changeController?.abort()
  changeController = controller
  const operationIsCurrent = () =>
    changeController === controller &&
    !controller.signal.aborted &&
    identityIsCurrent(workspaceIdentity)
  checkingChanges.value = true
  try {
    const result = await adapter.listChanges(cursor, { signal: controller.signal })
    requireCurrent(operationIsCurrent)
    const visibleIds = new Set(documents.value.map((document) => document.id))
    const relevant = result.changes.some(
      (change) => visibleIds.has(change.fileId) || (change.file && isOpenPencilFile(change.file))
    )
    if (relevant) {
      await refresh()
      return
    }
    requireCurrent(operationIsCurrent)
    writeGoogleDriveChangeCursor(cursorIdentity, result.newStartPageToken)
  } catch (reason) {
    if (aborted(reason, controller.signal) || !identityIsCurrent(workspaceIdentity)) return
    if (reason instanceof GoogleDriveError && reason.status === 410) {
      clearGoogleDriveChangeCursor(cursorIdentity)
      await refresh()
      return
    }
    error.value = friendlyError(reason)
  } finally {
    if (changeController === controller) {
      changeController = null
      checkingChanges.value = false
    }
  }
}

async function openDocument(document: StorageDocument): Promise<void> {
  if (
    openingDocumentId.value ||
    deletingDocumentId.value === document.id ||
    durabilityAvailable.value !== true
  ) {
    return
  }
  const identity = currentWorkspaceIdentity()
  if (identity.providerId === GOOGLE_DRIVE_PROVIDER_ID && !identity.authority) return
  const binding = bindingFor(identity, document.id)
  openController?.abort()
  const controller = new AbortController()
  openController = controller
  openingDocumentId.value = document.id
  error.value = null
  try {
    await requireCloudStorageDurability()
    await openStorageDocumentInNewTab(document, binding, { signal: controller.signal })
    requireCurrent(
      () =>
        openController === controller && !controller.signal.aborted && identityIsCurrent(identity)
    )
    await router.push('/')
  } catch (reason) {
    if (!aborted(reason, controller.signal) && identityIsCurrent(identity)) {
      error.value = friendlyError(reason)
    }
  } finally {
    if (openController === controller) {
      openController = null
      openingDocumentId.value = null
    }
  }
}

async function createDocument(): Promise<void> {
  if (!configured.value || creating.value || durabilityAvailable.value !== true) return
  const identity = currentWorkspaceIdentity()
  if (identity.providerId === GOOGLE_DRIVE_PROVIDER_ID && !identity.authority) return
  createController?.abort()
  const controller = new AbortController()
  createController = controller
  creating.value = true
  error.value = null
  try {
    await requireCloudStorageDurability()
    await withStorageProfileMutationLease(identity, async (lease) => {
      const adapter = createActiveStorageAdapter(identity.providerId, identity.profileId)
      const currentAuthority = (await adapter.getAuthority?.({ signal: controller.signal })) ?? null
      requireCurrent(
        () =>
          createController === controller &&
          !controller.signal.aborted &&
          identityIsCurrent(identity)
      )
      if (!storageDocumentAuthorityMatches(identity.authority, currentAuthority)) {
        throw new GoogleDriveError(
          'authorization-changed',
          'Google Drive authorization changed while creating the document'
        )
      }
      const documentId =
        (await adapter.reserveDocumentId?.({ signal: controller.signal })) ?? createCanvasId()
      requireCurrent(
        () =>
          createController === controller &&
          !controller.signal.aborted &&
          identityIsCurrent(identity)
      )
      const current = activeTab.value
      const store =
        current?.store.state.documentName === 'Untitled' && !current.store.undo.canUndo
          ? current.store
          : createTab().store
      store.setStorageDocumentSource(bindingFor(identity, documentId), 'Untitled')
      await store.saveFigFile({ storageMutationLease: lease })
    })
    requireCurrent(
      () =>
        createController === controller && !controller.signal.aborted && identityIsCurrent(identity)
    )
    await router.push('/')
  } catch (reason) {
    if (!aborted(reason, controller.signal) && identityIsCurrent(identity)) {
      error.value = friendlyError(reason)
    }
  } finally {
    if (createController === controller) {
      createController = null
      creating.value = false
    }
  }
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') void checkForRemoteChanges()
}

async function repaintCurrentLocalDocuments(): Promise<void> {
  if (durabilityAvailable.value !== true) return
  const identity = currentWorkspaceIdentity()
  if (identity.providerId === GOOGLE_DRIVE_PROVIDER_ID && !identity.authority) return
  try {
    await paintLocalDocuments(identity, () => identityIsCurrent(identity))
  } catch (reason) {
    const superseded = reason instanceof DOMException && reason.name === 'AbortError'
    if (!superseded && identityIsCurrent(identity)) {
      error.value = friendlyError(reason)
    }
  }
}

useEventListener(window, 'online', () => void checkForRemoteChanges())
useEventListener(document, 'visibilitychange', onVisibilityChange)
useIntervalFn(() => void checkForRemoteChanges(), CHANGE_POLL_INTERVAL_MS)

watch([activeStorageProviderID, activeStorageProfileID], () => {
  refreshController?.abort()
  changeController?.abort()
  openController?.abort()
  createController?.abort()
  updateActiveAuthority(null)
  durabilityAvailable.value = null
  connectionReady.value = activeStorageProviderID.value !== GOOGLE_DRIVE_PROVIDER_ID
  credentialStatuses.value = {}
  documents.value = []
  statusesByKey.value = new Map()
  preservedCopyIds.value = new Set()
  deleteCandidate.value = null
  operationNotice.value = null
  void refresh()
})

watch(providerPluginState, (state, previous) => {
  if (state === 'enabled') {
    if (previous !== 'enabled') void refresh()
    return
  }
  refreshController?.abort()
  changeController?.abort()
  openController?.abort()
  createController?.abort()
  connectionReady.value = false
  durabilityAvailable.value = null
  if (state === 'disabled') {
    updateActiveAuthority(null)
    documents.value = []
    statusesByKey.value = new Map()
    preservedCopyIds.value = new Set()
    deleteCandidate.value = null
    error.value = null
  }
})

watch([syncUiState, pendingSyncCount], ([state, count], [previousState, previousCount]) => {
  const jobSettled = count < previousCount || (previousState === 'syncing' && state !== 'syncing')
  if (jobSettled) void repaintCurrentLocalDocuments()
})

watch(settingsDialogOpen, (open, wasOpen) => {
  if (wasOpen && !open) void refresh()
})

onMounted(() => {
  void refresh()
})

onBeforeUnmount(() => {
  refreshController?.abort()
  changeController?.abort()
  openController?.abort()
  createController?.abort()
})
</script>

<template>
  <main class="flex min-h-screen flex-col bg-app text-surface" data-test-id="storage-workspace">
    <header class="flex h-14 items-center border-b border-border px-6">
      <div>
        <div class="flex items-center gap-2">
          <h1 class="text-sm font-semibold">{{ dialogs.storageWorkspace }}</h1>
          <span
            v-if="syncSummary"
            class="inline-flex items-center gap-1 rounded-full bg-hover px-1.5 py-0.5 text-[9px] text-muted"
            :data-state="syncUiState"
            role="status"
            aria-live="polite"
          >
            <icon-lucide-cloud-off v-if="syncUiState === 'offline'" class="size-2.5" />
            <icon-lucide-triangle-alert v-else-if="syncUiState === 'error'" class="size-2.5" />
            <icon-lucide-loader-circle v-else class="size-2.5 animate-spin" />
            {{ syncSummary }}
          </span>
        </div>
        <p class="mt-0.5 text-[10px] text-muted">
          {{ provider.label }} · {{ activeStorageProfileID }}
        </p>
      </div>
      <div class="ml-auto flex gap-2">
        <button
          type="button"
          class="rounded px-3 py-1.5 text-xs text-muted hover:bg-hover hover:text-surface"
          @click="openSettingsDialog('storage')"
        >
          {{ dialogs.settings }}
        </button>
        <button
          type="button"
          class="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!configured || creating || durabilityAvailable !== true"
          data-test-id="storage-new-document"
          @click="createDocument"
        >
          {{ creating ? dialogs.storageCreatingDocument : dialogs.newStoredDocument }}
        </button>
      </div>
    </header>

    <section class="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col p-6">
      <div class="mb-4 flex shrink-0 items-center justify-between gap-3">
        <div class="min-w-0 flex-1">
          <p v-if="error" class="text-xs text-danger" role="alert">{{ error }}</p>
          <p v-else-if="operationNotice" class="text-xs text-success" role="status">
            {{ operationNotice }}
          </p>
          <p v-else-if="conflictCount" class="text-[10px] text-warning" role="status">
            {{ dialogs.storageConflictCount({ count: conflictCount }) }}
          </p>
          <p v-else-if="durabilityAvailable === false" class="text-[10px] text-danger">
            {{ dialogs.storageDurabilityUnavailable }}
          </p>
          <p v-else class="text-[10px] text-muted">
            {{ dialogs.storageLocalFirstHint }}
          </p>
        </div>
        <button
          v-if="configurationComplete"
          type="button"
          class="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted hover:bg-hover hover:text-surface disabled:opacity-50"
          :disabled="loading"
          @click="refresh"
        >
          <icon-lucide-refresh-cw class="size-3" :class="loading ? 'animate-spin' : ''" />
          {{ dialogs.refresh }}
        </button>
      </div>

      <div
        v-if="documents.length"
        class="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4"
      >
        <StorageWorkspaceDocumentCard
          v-for="document in documents"
          :key="document.id"
          :document="document"
          :sync-status="documentStatus(document)"
          :progress="documentProgress(document)"
          :preserved-copy="preservedCopyIds.has(document.id)"
          :busy="openingDocumentId === document.id || deletingDocumentId === document.id"
          :disabled="durabilityAvailable !== true"
          @open="openDocument(document)"
          @delete="requestDeleteDocument(document)"
        />
      </div>

      <div
        v-else-if="loading"
        class="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4"
        :aria-label="dialogs.loadingDocuments"
        aria-busy="true"
        role="status"
      >
        <div
          v-for="index in 6"
          :key="index"
          class="overflow-hidden rounded-xl border border-border bg-panel"
        >
          <div class="aspect-[4/3] animate-pulse bg-panel-field" />
          <div class="space-y-2 border-t border-border p-3">
            <div class="h-3 w-2/3 animate-pulse rounded bg-hover" />
            <div class="h-2 w-1/2 animate-pulse rounded bg-hover" />
          </div>
        </div>
      </div>

      <AppPlaceholder
        v-else-if="durabilityAvailable === false"
        :label="dialogs.storageDurabilityUnavailable"
        size="page"
      >
        <template #icon>
          <icon-lucide-hard-drive-download class="size-5" />
        </template>
        <template #action>
          <button
            type="button"
            class="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90"
            @click="router.push('/')"
          >
            {{ dialogs.storageContinueLocally }}
          </button>
        </template>
      </AppPlaceholder>

      <AppPlaceholder v-else-if="configured" :label="dialogs.emptyStorageWorkspace" size="page">
        <template #icon>
          <icon-lucide-files class="size-5" />
        </template>
        <template #action>
          <button
            type="button"
            class="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90"
            @click="createDocument"
          >
            {{ dialogs.newStoredDocument }}
          </button>
        </template>
      </AppPlaceholder>

      <AppPlaceholder v-else :label="dialogs.storageNotConfigured" size="page">
        <template #icon>
          <icon-lucide-cloud class="size-5" />
        </template>
        <template #action>
          <button
            type="button"
            class="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90"
            @click="openSettingsDialog('storage')"
          >
            {{ dialogs.settings }}
          </button>
        </template>
      </AppPlaceholder>
    </section>
  </main>

  <StorageDeleteDocumentDialog
    :open="deleteCandidate !== null"
    :document-name="deleteCandidate?.document.name ?? ''"
    :provider-label="provider.label"
    :moves-to-trash="deleteCandidate?.identity.providerId === GOOGLE_DRIVE_PROVIDER_ID"
    :busy="deletingDocumentId !== null"
    :blocked="deleteBlockedByOpenTab"
    @update:open="closeDeleteDialog"
    @confirm="confirmDeleteDocument"
  />
</template>
