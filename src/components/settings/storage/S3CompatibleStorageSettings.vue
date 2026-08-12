<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useClipboard } from '@vueuse/core'
import { useI18n } from '@open-pencil/vue'

import {
  activeStorageProfileID,
  clearS3StorageCredential,
  createActiveStorageAdapter,
  ensureS3StorageAuthority,
  readStoragePreferences,
  S3_COMPATIBLE_STORAGE_PROVIDER_ID,
  setS3StorageCredential,
  storageCredentialStatuses,
  storagePreferencesComplete,
  type S3StorageAdapter,
  writeStoragePreference
} from '@/app/integrations/storage'
import {
  buildCORSConfigurationJSON,
  collectCloudCORSOrigins
} from '@/app/integrations/storage/s3/cors'
import { appCredentialServices } from '@/app/settings/credentials/app'
import { credentialRef } from '@/app/settings/credentials/reference'
import type { CredentialStatus } from '@/app/settings/credentials/types'
import {
  assertCloudStorageDurability,
  StorageDurabilityUnavailableError,
  withDurableStorageProfileMutationDrain
} from '@/app/storage/durability'
import {
  StorageProfileOpenDocumentsError,
  storageProfileHasOpenTabs
} from '@/app/storage/mutation-drain'
import {
  confirmS3LegacyMigration,
  inspectStorageAuthorizationWork,
  prepareS3LegacyMigration,
  resumeStorageSync,
  type S3LegacyMigrationInspection
} from '@/app/storage/sync'
import { getTabsSnapshot } from '@/app/tabs'
import AppInput from '@/components/ui/AppInput.vue'

const PROVIDER_ID = S3_COMPATIBLE_STORAGE_PROVIDER_ID
type PreferenceField = 'endpoint' | 'bucket' | 'region'
type CredentialField = 'access-key-id' | 'secret-access-key'
const PREFERENCE_FIELDS = ['endpoint', 'bucket', 'region'] as const
const CREDENTIAL_FIELDS = ['access-key-id', 'secret-access-key'] as const
const emit = defineEmits<{ ready: [ready: boolean] }>()
const { dialogs } = useI18n()
const { copy, copied } = useClipboard()
const preferenceDrafts = ref<Record<PreferenceField, string>>({
  endpoint: '',
  bucket: '',
  region: ''
})
const credentialDrafts = ref<Record<CredentialField, string>>({
  'access-key-id': '',
  'secret-access-key': ''
})
const credentialStatuses = ref<Record<string, CredentialStatus>>({})
const busy = ref(false)
const migrationBusy = ref(false)
const migrationInspection = ref<S3LegacyMigrationInspection | null>(null)
const result = ref<{ ok: boolean; message: string } | null>(null)
let controller: AbortController | null = null
let asyncGeneration = 0
let migrationRefreshGeneration = 0
let mounted = false
const configured = computed(
  () =>
    storagePreferencesComplete(PROVIDER_ID, activeStorageProfileID.value) &&
    ['access-key-id', 'secret-access-key'].every(
      (field) => credentialStatuses.value[field] === 'configured'
    )
)
const migrationTarget = computed(() =>
  readStoragePreferences(PROVIDER_ID, activeStorageProfileID.value)
)

function preferenceLabel(field: PreferenceField): string {
  if (field === 'endpoint') return dialogs.value.storageEndpoint
  if (field === 'bucket') return dialogs.value.storageBucket
  return dialogs.value.storageRegion
}

function credentialLabel(field: CredentialField): string {
  return field === 'access-key-id'
    ? dialogs.value.storageAccessKeyID
    : dialogs.value.storageSecretAccessKey
}

function lifecycleMutationError(error: unknown, fallback: string): string {
  if (error instanceof StorageDurabilityUnavailableError) {
    return dialogs.value.storageDurabilityUnavailable
  }
  if (error instanceof StorageProfileOpenDocumentsError) {
    return dialogs.value.storageS3MutationBlockedByOpenDocuments
  }
  return fallback
}

function loadPreferences(profileId: string): void {
  const stored = readStoragePreferences(PROVIDER_ID, profileId)
  preferenceDrafts.value = {
    endpoint: stored.endpoint ?? '',
    bucket: stored.bucket ?? '',
    region: stored.region ?? ''
  }
}

function currentGeneration(generation: number, profileId: string): boolean {
  return mounted && generation === asyncGeneration && profileId === activeStorageProfileID.value
}

async function refreshStatuses(profileId = activeStorageProfileID.value): Promise<void> {
  const generation = ++asyncGeneration
  const statuses = await storageCredentialStatuses(PROVIDER_ID, profileId)
  if (!currentGeneration(generation, profileId)) return
  credentialStatuses.value = statuses
  emit('ready', configured.value)
}

function preferenceChanges(profileId: string): boolean {
  const stored = readStoragePreferences(PROVIDER_ID, profileId)
  return PREFERENCE_FIELDS.some(
    (field) => (stored[field] ?? '') !== preferenceDrafts.value[field].trim()
  )
}

function currentMigrationScope(profileId: string) {
  return {
    profileId,
    authority: ensureS3StorageAuthority(profileId),
    preferences: readStoragePreferences(PROVIDER_ID, profileId)
  }
}

function profileHasOpenTabs(profileId: string): boolean {
  return storageProfileHasOpenTabs(
    { providerId: PROVIDER_ID, profileId },
    getTabsSnapshot().map((tab) => tab.store)
  )
}

async function refreshLegacyMigration(profileId = activeStorageProfileID.value): Promise<void> {
  const refreshGeneration = ++migrationRefreshGeneration
  try {
    await assertCloudStorageDurability()
    const next = await prepareS3LegacyMigration(currentMigrationScope(profileId))
    if (
      !mounted ||
      refreshGeneration !== migrationRefreshGeneration ||
      profileId !== activeStorageProfileID.value
    ) {
      return
    }
    migrationInspection.value = next
  } catch (error) {
    if (
      mounted &&
      refreshGeneration === migrationRefreshGeneration &&
      profileId === activeStorageProfileID.value
    ) {
      result.value = {
        ok: false,
        message:
          error instanceof StorageDurabilityUnavailableError
            ? dialogs.value.storageDurabilityUnavailable
            : dialogs.value.storageS3LegacyMigrationFailed
      }
    }
  }
}

async function mutationAllowed(
  profileId: string,
  generation: number,
  operation: () => Promise<void> | void
): Promise<boolean> {
  try {
    return await withDurableStorageProfileMutationDrain(
      { providerId: PROVIDER_ID, profileId },
      async () => {
        if (profileHasOpenTabs(profileId)) throw new StorageProfileOpenDocumentsError()
        const legacy = await prepareS3LegacyMigration(currentMigrationScope(profileId))
        if (!currentGeneration(generation, profileId)) return false
        migrationInspection.value = legacy
        if (legacy.requiresConfirmation) {
          result.value = {
            ok: false,
            message: dialogs.value.storageS3LegacyMigrationRequired
          }
          return false
        }
        const inspection = await inspectStorageAuthorizationWork({
          providerId: PROVIDER_ID,
          profileId,
          authority: ensureS3StorageAuthority(profileId)
        })
        if (!currentGeneration(generation, profileId)) return false
        if (inspection.requiresConfirmation) {
          result.value = {
            ok: false,
            message: dialogs.value.storageS3MutationBlockedByUnsyncedWork
          }
          return false
        }
        await operation()
        return true
      }
    )
  } catch (error) {
    if (currentGeneration(generation, profileId)) {
      result.value = {
        ok: false,
        message: lifecycleMutationError(error, dialogs.value.storageConnectionFailed)
      }
    }
    return false
  }
}

async function savePreferences(profileId = activeStorageProfileID.value): Promise<boolean> {
  if (!preferenceChanges(profileId)) return true
  const generation = asyncGeneration
  return mutationAllowed(profileId, generation, () => {
    for (const field of PREFERENCE_FIELDS) {
      writeStoragePreference(PROVIDER_ID, field, preferenceDrafts.value[field], profileId)
    }
    emit('ready', configured.value)
  })
}

async function saveCredential(
  field: CredentialField,
  profileId = activeStorageProfileID.value,
  refresh = true
): Promise<boolean> {
  const value = credentialDrafts.value[field]?.trim()
  if (!value) return true
  const generation = asyncGeneration
  const saved = await mutationAllowed(profileId, generation, async () => {
    await setS3StorageCredential(appCredentialServices.manager, profileId, field, value)
  })
  if (!saved) return false
  if (profileId !== activeStorageProfileID.value) return false
  credentialDrafts.value[field] = ''
  if (refresh) await refreshStatuses(profileId)
  return true
}

async function clearCredential(field: CredentialField): Promise<void> {
  const profileId = activeStorageProfileID.value
  const generation = asyncGeneration
  const cleared = await mutationAllowed(profileId, generation, async () => {
    await clearS3StorageCredential(appCredentialServices.manager, profileId, field)
  })
  if (!cleared) return
  if (profileId !== activeStorageProfileID.value) return
  credentialDrafts.value[field] = ''
  await refreshStatuses(profileId)
}

async function confirmLegacyMigration(): Promise<void> {
  const pending = migrationInspection.value
  if (!pending?.requiresConfirmation || migrationBusy.value) return
  const profileId = activeStorageProfileID.value
  const generation = asyncGeneration
  migrationBusy.value = true
  result.value = null
  try {
    const migrated = await withDurableStorageProfileMutationDrain(
      { providerId: PROVIDER_ID, profileId },
      async () => {
        if (profileHasOpenTabs(profileId)) throw new StorageProfileOpenDocumentsError()
        return confirmS3LegacyMigration({
          ...currentMigrationScope(profileId),
          confirmedConfigurationIdentity: pending.configurationIdentity
        })
      }
    )
    if (!currentGeneration(generation, profileId)) return
    migrationInspection.value = migrated
    result.value = { ok: true, message: dialogs.value.storageS3LegacyMigrationComplete }
    await resumeStorageSync()
  } catch (error) {
    if (!currentGeneration(generation, profileId)) return
    result.value = {
      ok: false,
      message: lifecycleMutationError(error, dialogs.value.storageS3LegacyMigrationFailed)
    }
    await refreshLegacyMigration(profileId)
  } finally {
    if (profileId === activeStorageProfileID.value) migrationBusy.value = false
  }
}

async function testConnection(): Promise<void> {
  if (busy.value) return
  const profileId = activeStorageProfileID.value
  controller?.abort()
  const operationController = new AbortController()
  controller = operationController
  const generation = ++asyncGeneration
  busy.value = true
  result.value = null
  try {
    await assertCloudStorageDurability()
    if (!(await savePreferences(profileId))) return
    for (const field of CREDENTIAL_FIELDS) {
      if (!(await saveCredential(field, profileId, false))) return
      operationController.signal.throwIfAborted()
    }
    const legacy = await prepareS3LegacyMigration(currentMigrationScope(profileId))
    if (!currentGeneration(generation, profileId)) return
    migrationInspection.value = legacy
    if (legacy.requiresConfirmation) {
      result.value = { ok: false, message: dialogs.value.storageS3LegacyMigrationRequired }
      return
    }
    const adapter = createActiveStorageAdapter(PROVIDER_ID, profileId) as S3StorageAdapter
    const connection = await adapter.testConnection({ signal: operationController.signal })
    if (!currentGeneration(generation, profileId)) return
    let message: string = dialogs.value.storageConnectionFailed
    if (connection.ok) message = dialogs.value.storageConnectionReady
    else if (connection.isCORSFailure) message = dialogs.value.storageS3CorsFailure
    result.value = {
      ok: connection.ok,
      message
    }
    if (connection.ok) await resumeStorageSync()
  } catch (error) {
    if (!currentGeneration(generation, profileId)) return
    let message: string = dialogs.value.storageConnectionFailed
    if (error instanceof StorageDurabilityUnavailableError) {
      message = dialogs.value.storageDurabilityUnavailable
    } else if (operationController.signal.aborted) {
      message = dialogs.value.storageOperationCancelled
    }
    result.value = {
      ok: false,
      message
    }
  } finally {
    if (controller === operationController) {
      controller = null
      busy.value = false
      emit('ready', configured.value)
    }
  }
}

function cancelOperation(): void {
  controller?.abort(new DOMException('Cancelled by the user', 'AbortError'))
}

async function removeProfile(profileId: string): Promise<void> {
  controller?.abort(new DOMException('Storage profile is being removed', 'AbortError'))
  asyncGeneration++
  controller = null
  busy.value = false
  await Promise.all(
    CREDENTIAL_FIELDS.map((field) =>
      appCredentialServices.manager.clear(credentialRef(PROVIDER_ID, field, profileId))
    )
  )
}

defineExpose({ removeProfile })

function copyCORSConfiguration(): void {
  void copy(buildCORSConfigurationJSON(collectCloudCORSOrigins()))
}

watch(activeStorageProfileID, (profileId) => {
  asyncGeneration++
  migrationRefreshGeneration++
  controller?.abort()
  controller = null
  busy.value = false
  migrationBusy.value = false
  loadPreferences(profileId)
  credentialDrafts.value = { 'access-key-id': '', 'secret-access-key': '' }
  credentialStatuses.value = {}
  migrationInspection.value = null
  result.value = null
  void refreshLegacyMigration(profileId)
  void refreshStatuses(profileId)
})

onMounted(() => {
  mounted = true
  loadPreferences(activeStorageProfileID.value)
  void refreshLegacyMigration()
  void refreshStatuses()
})
onBeforeUnmount(() => {
  mounted = false
  asyncGeneration++
  migrationRefreshGeneration++
  controller?.abort()
  controller = null
})
</script>

<template>
  <div class="flex flex-col gap-3" data-test-id="settings-storage-s3">
    <div class="rounded border border-border bg-panel/40 p-3">
      <p class="text-[11px] font-medium text-surface">{{ dialogs.storageS3AdvancedTitle }}</p>
      <p class="mt-1 text-[10px] leading-4 text-muted">
        {{ dialogs.storageS3AdvancedDescription }}
      </p>
    </div>

    <div
      v-if="migrationInspection?.requiresConfirmation"
      class="rounded border border-warning/50 bg-warning/10 p-3 text-[10px] leading-4 text-muted"
      data-test-id="settings-storage-s3-legacy-migration"
      role="alert"
    >
      <p class="font-medium text-surface">{{ dialogs.storageS3LegacyMigrationTitle }}</p>
      <p class="mt-1">
        {{
          dialogs.storageS3LegacyMigrationDescription({
            documents: migrationInspection.legacyDocumentCount,
            jobs: migrationInspection.jobCount
          })
        }}
      </p>
      <p class="mt-1 break-all">
        {{
          dialogs.storageS3LegacyMigrationTarget({
            endpoint: migrationTarget.endpoint || '—',
            bucket: migrationTarget.bucket || '—'
          })
        }}
      </p>
      <button
        type="button"
        class="mt-2 rounded bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        :disabled="migrationBusy || busy"
        data-test-id="settings-storage-s3-confirm-legacy-migration"
        @click="confirmLegacyMigration"
      >
        {{
          migrationBusy
            ? dialogs.storageS3LegacyMigrationMigrating
            : dialogs.storageS3LegacyMigrationConfirm
        }}
      </button>
    </div>

    <label
      v-for="field in PREFERENCE_FIELDS"
      :key="field"
      class="flex flex-col gap-1 text-[10px] text-muted"
    >
      {{ preferenceLabel(field) }}
      <AppInput
        v-model="preferenceDrafts[field]"
        :placeholder="field === 'endpoint' ? 'https://s3.example.com' : undefined"
        size="sm"
        tone="panel"
        @change="savePreferences"
      />
    </label>

    <div
      v-for="field in CREDENTIAL_FIELDS"
      :key="field"
      class="flex flex-col gap-1"
      :data-credential="field"
    >
      <label :for="`storage-${field}`" class="text-[10px] text-muted">
        {{ credentialLabel(field) }}
      </label>
      <div class="flex gap-2">
        <AppInput
          :id="`storage-${field}`"
          v-model="credentialDrafts[field]"
          type="password"
          :aria-label="credentialLabel(field)"
          :placeholder="
            credentialStatuses[field] === 'configured'
              ? dialogs.keySavedReplace
              : credentialLabel(field)
          "
          size="sm"
          tone="panel"
          class="min-w-0 flex-1"
          @enter="saveCredential(field)"
        />
        <button
          v-if="credentialDrafts[field]?.trim()"
          type="button"
          class="rounded bg-hover px-2 text-[10px] text-surface hover:bg-active"
          @click="saveCredential(field)"
        >
          {{ dialogs.save }}
        </button>
        <button
          v-else-if="credentialStatuses[field] === 'configured'"
          type="button"
          class="rounded px-2 text-[10px] text-muted hover:bg-hover hover:text-surface"
          @click="clearCredential(field)"
        >
          {{ dialogs.clear }}
        </button>
      </div>
    </div>

    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        class="rounded bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        :disabled="busy"
        data-test-id="settings-storage-test"
        @click="testConnection"
      >
        {{ busy ? dialogs.storageCheckingConnection : dialogs.testConnection }}
      </button>
      <button
        v-if="busy"
        type="button"
        class="rounded px-3 py-1.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
        @click="cancelOperation"
      >
        {{ dialogs.cancel }}
      </button>
      <button
        type="button"
        class="rounded px-3 py-1.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
        @click="copyCORSConfiguration"
      >
        {{ copied ? dialogs.copied : dialogs.copyStorageCors }}
      </button>
    </div>

    <p
      v-if="result"
      class="rounded border border-border bg-panel px-2 py-1.5 text-[10px] text-muted data-[state=success]:text-success data-[state=error]:text-danger"
      :data-state="result.ok ? 'success' : 'error'"
      role="status"
    >
      {{ result.message }}
    </p>
  </div>
</template>
