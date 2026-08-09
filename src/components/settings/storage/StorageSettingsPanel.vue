<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '@open-pencil/vue'

import {
  activeStorageProfileID,
  activeStorageProviderID,
  copyStorageProfilePreferences,
  createStorageProfile,
  DEFAULT_STORAGE_PROFILE_ID,
  deleteStorageProfile,
  ensureS3StorageAuthority,
  listStorageProfiles,
  MAX_STORAGE_PROFILE_NAME_LENGTH,
  MAX_STORAGE_PROFILES_PER_PROVIDER,
  renameStorageProfile,
  readStoragePreferences,
  S3_COMPATIBLE_STORAGE_PROVIDER_ID,
  storageProviderPluginState,
  storageProviderRegistry,
  type StorageProfile,
  type StorageProviderID
} from '@/app/integrations/storage'
import { settingsDialogOpen } from '@/app/settings/dialog'
import {
  StorageDurabilityUnavailableError,
  withDurableStorageProfileMutationDrain
} from '@/app/storage/durability'
import {
  StorageProfileRemovalBlockedError,
  storageProfileRemovalBlocked
} from '@/app/storage/profile-removal'
import { storageProfileHasOpenTabs } from '@/app/storage/mutation-drain'
import { prepareS3LegacyMigration } from '@/app/storage/sync'
import { getTabsSnapshot } from '@/app/tabs'
import GoogleDriveStorageConnection from '@/components/settings/storage/GoogleDriveStorageConnection.vue'
import S3CompatibleStorageSettings from '@/components/settings/storage/S3CompatibleStorageSettings.vue'
import AppInput from '@/components/ui/AppInput.vue'

type ProfileEditorMode = 'idle' | 'add' | 'rename' | 'delete'
type ProfileSettingsHandle = { removeProfile(profileId: string): Promise<void> }

const { dialogs } = useI18n()
const router = useRouter()
const readiness = ref<Record<string, boolean>>({})
const profileEditorMode = ref<ProfileEditorMode>('idle')
const profileNameDraft = ref('')
const profileActionBusy = ref(false)
const profileError = ref<string | null>(null)
const profileComponentGeneration = ref(0)
const googleSettings = ref<ProfileSettingsHandle | null>(null)
const s3Settings = ref<ProfileSettingsHandle | null>(null)
const provider = computed(() => storageProviderRegistry.get(activeStorageProviderID.value))
const activePluginState = computed(() => storageProviderPluginState(activeStorageProviderID.value))
const providers = computed(() =>
  storageProviderRegistry
    .list()
    .filter((item) => storageProviderPluginState(item.id) !== 'disabled')
)
const profiles = computed(() => listStorageProfiles(activeStorageProviderID.value))
const activeProfile = computed(
  () =>
    profiles.value.find((profile) => profile.id === activeStorageProfileID.value) ??
    profiles.value[0]
)
const readinessKey = (providerId: StorageProviderID, profileId: string) =>
  JSON.stringify([providerId, profileId])
const profileComponentKey = computed(() =>
  JSON.stringify([
    activeStorageProviderID.value,
    activeStorageProfileID.value,
    profileComponentGeneration.value
  ])
)
const configured = computed(() => {
  const key = readinessKey(activeStorageProviderID.value, activeStorageProfileID.value)
  return activePluginState.value === 'enabled' && readiness.value[key] === true
})

function providerDescription(providerId: StorageProviderID): string {
  return providerId === 'google-drive'
    ? dialogs.value.storageGoogleDriveProviderDescription
    : dialogs.value.storageS3ProviderDescription
}

function providerLabel(providerId: StorageProviderID): string {
  return providerId === 'google-drive' ? 'Google Drive' : dialogs.value.storageS3ProviderName
}

function selectProvider(providerId: StorageProviderID): void {
  activeStorageProviderID.value = providerId
}

function moveProviderSelection(event: KeyboardEvent, providerId: StorageProviderID): void {
  const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
  const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown'
  if (!horizontal && !vertical && event.key !== 'Home' && event.key !== 'End') return
  const items = providers.value
  if (items.length === 0) return
  event.preventDefault()
  const currentIndex = Math.max(
    0,
    items.findIndex((item) => item.id === providerId)
  )
  let nextIndex: number
  if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = items.length - 1
  else {
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
    nextIndex = (currentIndex + direction + items.length) % items.length
  }
  const next = items[nextIndex]
  if (!next) return
  selectProvider(next.id)
  const group = (event.currentTarget as HTMLElement | null)?.parentElement
  requestAnimationFrame(() => {
    group?.querySelector<HTMLButtonElement>(`[data-provider-id="${CSS.escape(next.id)}"]`)?.focus()
  })
}

function updateReadiness(providerId: StorageProviderID, ready: boolean): void {
  const key = readinessKey(providerId, activeStorageProfileID.value)
  readiness.value = { ...readiness.value, [key]: ready }
}

function updateS3Readiness(ready: boolean): void {
  updateReadiness('s3-compatible', ready)
}

async function openWorkspace(): Promise<void> {
  if (!configured.value) return
  settingsDialogOpen.value = false
  await router.push('/storage')
}

function profileLabel(profile: StorageProfile): string {
  return profile.id === DEFAULT_STORAGE_PROFILE_ID && profile.name === 'Default'
    ? dialogs.value.storageDefaultProfile
    : profile.name
}

function selectProfile(event: Event): void {
  const profileId = (event.currentTarget as HTMLSelectElement).value
  if (!profiles.value.some((profile) => profile.id === profileId)) return
  activeStorageProfileID.value = profileId
}

function beginAddProfile(): void {
  profileError.value = null
  profileNameDraft.value = dialogs.value.storageNewProfileDefaultName({
    count: profiles.value.length + 1
  })
  profileEditorMode.value = 'add'
}

function beginRenameProfile(): void {
  if (!activeProfile.value) return
  profileError.value = null
  profileNameDraft.value = profileLabel(activeProfile.value)
  profileEditorMode.value = 'rename'
}

function cancelProfileAction(): void {
  if (profileActionBusy.value) return
  profileEditorMode.value = 'idle'
  profileNameDraft.value = ''
  profileError.value = null
}

function saveProfile(): void {
  try {
    if (profileEditorMode.value === 'add') {
      const providerId = activeStorageProviderID.value
      const sourceProfileId = activeStorageProfileID.value
      const created = createStorageProfile(providerId, profileNameDraft.value)
      copyStorageProfilePreferences(providerId, sourceProfileId, created.id)
    } else if (profileEditorMode.value === 'rename') {
      renameStorageProfile(
        activeStorageProviderID.value,
        activeStorageProfileID.value,
        profileNameDraft.value
      )
    } else {
      return
    }
    profileEditorMode.value = 'idle'
    profileNameDraft.value = ''
    profileError.value = null
  } catch {
    profileError.value =
      profiles.value.length >= MAX_STORAGE_PROFILES_PER_PROVIDER
        ? dialogs.value.storageProfileLimitReached({
            count: MAX_STORAGE_PROFILES_PER_PROVIDER
          })
        : dialogs.value.storageProfileActionFailed
  }
}

async function confirmDeleteProfile(): Promise<void> {
  if (profileActionBusy.value) return
  const providerId = activeStorageProviderID.value
  const profileId = activeStorageProfileID.value
  const handle = providerId === 'google-drive' ? googleSettings.value : s3Settings.value
  if (!handle) {
    profileError.value = dialogs.value.storageProfileActionFailed
    return
  }
  profileActionBusy.value = true
  profileError.value = null
  try {
    await withDurableStorageProfileMutationDrain({ providerId, profileId }, async () => {
      if (
        storageProfileHasOpenTabs(
          { providerId, profileId },
          getTabsSnapshot().map((tab) => tab.store)
        )
      ) {
        profileError.value = dialogs.value.storageProfileDeleteBlockedByOpenDocuments
        return
      }
      if (providerId === S3_COMPATIBLE_STORAGE_PROVIDER_ID) {
        const legacy = await prepareS3LegacyMigration({
          profileId,
          authority: ensureS3StorageAuthority(profileId),
          preferences: readStoragePreferences(providerId, profileId)
        })
        if (legacy.requiresConfirmation) {
          profileError.value = dialogs.value.storageS3LegacyMigrationRequired
          return
        }
      }
      if (await storageProfileRemovalBlocked(providerId, profileId)) {
        profileError.value = dialogs.value.storageProfileDeleteBlockedByUnsyncedWork
        return
      }
      await handle.removeProfile(profileId)
      deleteStorageProfile(providerId, profileId)
      profileComponentGeneration.value++
      const key = readinessKey(providerId, profileId)
      readiness.value = Object.fromEntries(
        Object.entries(readiness.value).filter(([candidate]) => candidate !== key)
      )
      profileEditorMode.value = 'idle'
    })
  } catch (error) {
    if (error instanceof StorageDurabilityUnavailableError) {
      profileError.value = dialogs.value.storageDurabilityUnavailable
    } else if (error instanceof StorageProfileRemovalBlockedError) {
      profileError.value = dialogs.value.storageProfileDeleteBlockedByUnsyncedWork
    } else {
      profileError.value = dialogs.value.storageProfileActionFailed
    }
  } finally {
    profileActionBusy.value = false
  }
}

watch([activeStorageProviderID, activeStorageProfileID], () => {
  const key = readinessKey(activeStorageProviderID.value, activeStorageProfileID.value)
  readiness.value = { ...readiness.value, [key]: false }
  profileEditorMode.value = 'idle'
  profileNameDraft.value = ''
  profileError.value = null
})

watch(
  providers,
  (items) => {
    if (!items.some((item) => item.id === activeStorageProviderID.value)) {
      activeStorageProviderID.value = items[0]?.id ?? 's3-compatible'
    }
  },
  { immediate: true }
)
</script>

<template>
  <section class="flex flex-col gap-4" data-test-id="settings-storage-panel">
    <div>
      <h3 class="text-xs font-semibold text-surface">{{ dialogs.settingsStorage }}</h3>
      <p class="mt-1 text-[10px] leading-4 text-muted">
        {{ dialogs.storageProviderChoiceDescription }}
      </p>
    </div>

    <div class="grid grid-cols-2 gap-2" role="radiogroup" :aria-label="dialogs.storageProvider">
      <button
        v-for="item in providers"
        :key="item.id"
        type="button"
        role="radio"
        class="relative rounded-lg border border-border bg-panel/30 p-3 text-left transition-colors hover:bg-hover data-[state=active]:border-accent/60 data-[state=active]:bg-accent/5"
        :aria-checked="item.id === activeStorageProviderID"
        :tabindex="item.id === activeStorageProviderID ? 0 : -1"
        :data-provider-id="item.id"
        :data-state="item.id === activeStorageProviderID ? 'active' : 'inactive'"
        :data-test-id="`settings-storage-provider-${item.id}`"
        @click="selectProvider(item.id)"
        @keydown="moveProviderSelection($event, item.id)"
      >
        <div class="flex items-center gap-2">
          <span
            class="flex size-6 items-center justify-center rounded bg-hover text-muted data-[state=active]:bg-accent/15 data-[state=active]:text-accent"
            :data-state="item.id === activeStorageProviderID ? 'active' : 'inactive'"
          >
            <icon-lucide-cloud v-if="item.id === 'google-drive'" class="size-3.5" />
            <icon-lucide-server v-else class="size-3.5" />
          </span>
          <span class="text-[11px] font-medium text-surface">{{ providerLabel(item.id) }}</span>
          <span
            v-if="item.id === 'google-drive'"
            class="ml-auto rounded-full bg-accent/10 px-1.5 py-0.5 text-[8px] font-medium text-accent"
          >
            {{ dialogs.storageRecommended }}
          </span>
        </div>
        <p class="mt-2 text-[9px] leading-4 text-muted">
          {{ providerDescription(item.id) }}
        </p>
      </button>
    </div>

    <div class="rounded-lg border border-border bg-panel/30 p-3" data-test-id="storage-profiles">
      <div class="flex items-center justify-between gap-2">
        <label for="storage-profile-selector" class="text-[10px] font-medium text-surface">
          {{ dialogs.storageProfiles }}
        </label>
        <span class="text-[9px] text-muted">
          {{ profiles.length }}/{{ MAX_STORAGE_PROFILES_PER_PROVIDER }}
        </span>
      </div>
      <div class="mt-2 flex gap-2">
        <select
          id="storage-profile-selector"
          class="min-w-0 flex-1 rounded border border-border bg-panel-field px-2 py-1.5 text-[10px] text-surface outline-none focus:border-panel-focus"
          :value="activeStorageProfileID"
          :aria-label="dialogs.storageProfileSelector"
          :disabled="profileActionBusy"
          @change="selectProfile"
        >
          <option v-for="profile in profiles" :key="profile.id" :value="profile.id">
            {{ profileLabel(profile) }}
          </option>
        </select>
        <button
          type="button"
          class="rounded bg-hover px-2 text-[10px] text-surface hover:bg-active disabled:opacity-50"
          :disabled="profileActionBusy || profiles.length >= MAX_STORAGE_PROFILES_PER_PROVIDER"
          @click="beginAddProfile"
        >
          {{ dialogs.storageAddProfile }}
        </button>
        <button
          type="button"
          class="rounded px-2 text-[10px] text-muted hover:bg-hover hover:text-surface disabled:opacity-50"
          :disabled="profileActionBusy"
          @click="beginRenameProfile"
        >
          {{ dialogs.storageRenameProfile }}
        </button>
        <button
          type="button"
          class="rounded px-2 text-[10px] text-danger hover:bg-danger/10 disabled:opacity-50"
          :disabled="profileActionBusy || activePluginState !== 'enabled'"
          @click="profileEditorMode = 'delete'"
        >
          {{ dialogs.storageDeleteProfile }}
        </button>
      </div>

      <div
        v-if="profileEditorMode === 'add' || profileEditorMode === 'rename'"
        class="mt-3 flex items-end gap-2"
      >
        <label class="min-w-0 flex-1 text-[9px] text-muted">
          {{ dialogs.storageProfileName }}
          <AppInput
            v-model="profileNameDraft"
            class="mt-1"
            size="sm"
            tone="panel"
            autofocus
            :maxlength="MAX_STORAGE_PROFILE_NAME_LENGTH"
            @enter="saveProfile"
          />
        </label>
        <button
          type="button"
          class="rounded bg-accent px-2.5 py-1.5 text-[10px] font-medium text-white hover:bg-accent/90"
          @click="saveProfile"
        >
          {{
            profileEditorMode === 'add'
              ? dialogs.storageCreateProfile
              : dialogs.storageSaveProfileName
          }}
        </button>
        <button
          type="button"
          class="rounded px-2.5 py-1.5 text-[10px] text-muted hover:bg-hover"
          @click="cancelProfileAction"
        >
          {{ dialogs.cancel }}
        </button>
      </div>

      <div
        v-else-if="profileEditorMode === 'delete'"
        class="mt-3 rounded border border-warning/30 bg-warning/10 p-2.5"
        role="alert"
      >
        <p class="text-[10px] font-medium text-surface">
          {{
            dialogs.storageDeleteProfileConfirm({
              name: activeProfile ? profileLabel(activeProfile) : activeStorageProfileID
            })
          }}
        </p>
        <p class="mt-1 text-[9px] leading-4 text-muted">
          {{ dialogs.storageDeleteProfileWarning }}
        </p>
        <div class="mt-2 flex gap-2">
          <button
            type="button"
            class="rounded bg-danger px-2.5 py-1 text-[10px] font-medium text-white disabled:opacity-50"
            :disabled="profileActionBusy"
            @click="confirmDeleteProfile"
          >
            {{ profileActionBusy ? dialogs.storageDeletingProfile : dialogs.storageDeleteProfile }}
          </button>
          <button
            type="button"
            class="rounded px-2.5 py-1 text-[10px] text-muted hover:bg-hover"
            :disabled="profileActionBusy"
            @click="cancelProfileAction"
          >
            {{ dialogs.cancel }}
          </button>
        </div>
      </div>
      <p v-if="profileError" class="mt-2 text-[9px] text-danger" role="alert">
        {{ profileError }}
      </p>
    </div>

    <div class="h-px bg-border/70" />

    <div
      v-if="activePluginState === 'loading'"
      class="flex items-center gap-2 rounded border border-border bg-panel/40 px-3 py-2 text-[10px] text-muted"
      role="status"
      aria-live="polite"
    >
      <icon-lucide-loader-circle class="size-3 animate-spin" />
      {{ dialogs.storageCheckingConnection }}
    </div>
    <GoogleDriveStorageConnection
      v-else-if="provider.id === 'google-drive'"
      :key="profileComponentKey"
      ref="googleSettings"
      @ready="updateReadiness"
    />
    <S3CompatibleStorageSettings
      v-else
      :key="profileComponentKey"
      ref="s3Settings"
      @ready="updateS3Readiness"
    />

    <button
      type="button"
      class="rounded border border-border px-3 py-2 text-[11px] font-medium text-surface hover:bg-hover disabled:text-muted disabled:opacity-50"
      :disabled="!configured"
      data-test-id="settings-storage-open-workspace"
      @click="openWorkspace"
    >
      {{ dialogs.openStorageWorkspace }}
    </button>
  </section>
</template>
