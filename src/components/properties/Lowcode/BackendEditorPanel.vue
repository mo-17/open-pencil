<script setup lang="ts">
import { unrefElement } from '@vueuse/core'
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'

import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'
import { useI18n } from '@open-pencil/vue'

import { commerceCopy } from '@/app/lowcode/backend/commerce/copy'
import BackendCommandsEditor from '@/app/lowcode/backend/components/BackendCommandsEditor.vue'
import BackendDataModelEditor from '@/app/lowcode/backend/components/BackendDataModelEditor.vue'
import BackendHttpAPIEditor from '@/app/lowcode/backend/components/BackendHttpAPIEditor.vue'
import BackendMigrationDiff from '@/app/lowcode/backend/components/BackendMigrationDiff.vue'
import BackendRelationsEditor from '@/app/lowcode/backend/components/BackendRelationsEditor.vue'
import BackendSecurityEditor from '@/app/lowcode/backend/components/BackendSecurityEditor.vue'
import BackendStorageEditor from '@/app/lowcode/backend/components/BackendStorageEditor.vue'
import BackendWorkflowEditor from '@/app/lowcode/backend/components/BackendWorkflowEditor.vue'
import { nestJSUICopy } from '@/app/lowcode/backend/components/nestjs-ui-copy'
import BackendLibraryDialog from '@/app/lowcode/backend/library/BackendLibraryDialog.vue'
import { createBackendLibraryCatalog } from '@/app/lowcode/backend/library/catalog'
import { backendLibraryViewCopy } from '@/app/lowcode/backend/library/view-copy'
import {
  backendProviderDescriptorKey,
  backendProviderDescriptorLabel,
  useBackendEditor
} from '@/app/lowcode/backend/use-backend-editor'
import { openSettingsDialog } from '@/app/settings/dialog'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppBadge from '@/components/ui/feedback/AppBadge.vue'
import { useSectionUI } from '@/components/ui/section'

type BackendTab =
  | 'commands'
  | 'http'
  | 'model'
  | 'relations'
  | 'security'
  | 'workflows'
  | 'storage'
  | 'migration'

const sectionCls = useSectionUI()
const { panels, locale } = useI18n()
const commerceText = computed(() => commerceCopy(locale.value))
const nestJSText = computed(() => nestJSUICopy(locale.value))
const libraryText = computed(() => backendLibraryViewCopy(locale.value))
const libraryOpen = ref(false)
const libraryTrigger = useTemplateRef('libraryTrigger')
const activeTab = ref<BackendTab>('model')
const tabs = Object.freeze([
  'model',
  'relations',
  'security',
  'workflows',
  'storage',
  'migration'
] as const satisfies readonly BackendTab[])
const {
  libraryBlockReason,
  createLibraryTemplate,
  canInitializeNestJS,
  initializeNestJS,
  canCreateNotesPages,
  createNotesPages,
  busy,
  canSave,
  clearArmed,
  clearDeclaration,
  committedProviderUnavailable,
  committedRequest,
  diagnostics,
  draft,
  draftValidation,
  hasBackendDeclaration,
  operationError,
  outcome,
  providerDescriptors,
  providersLoading,
  readError,
  saveDraft,
  selectedDescriptor,
  selectedProviderKey
} = useBackendEditor()

const isNestJS = computed(() => selectedDescriptor.value?.providerId === 'nestjs')
const libraryItems = computed(() =>
  createBackendLibraryCatalog(
    providerDescriptors.value.map((descriptor) => ({
      descriptor,
      descriptorKey: backendProviderDescriptorKey(descriptor)
    })),
    locale.value
  )
)
const templateProviderKey = computed(() => {
  const descriptor =
    selectedDescriptor.value?.providerId === 'nestjs'
      ? selectedDescriptor.value
      : providerDescriptors.value.find((entry) => entry.providerId === 'nestjs')
  return descriptor ? backendProviderDescriptorKey(descriptor) : ''
})
const visibleTabs = computed(() =>
  isNestJS.value
    ? (['model', 'http', 'commands', 'relations', 'security', 'migration'] as const)
    : tabs
)

function selectLibraryProvider(key: string): void {
  if (
    busy.value ||
    providersLoading.value ||
    !providerDescriptors.value.some(
      (descriptor) => backendProviderDescriptorKey(descriptor) === key
    )
  )
    return
  selectedProviderKey.value = key
  activeTab.value = 'model'
  libraryOpen.value = false
}
async function useLibraryTemplate(
  id: 'personal-notes' | 'single-sku-shop',
  authentication: BackendHttpAPIOIDCAuthenticationIRV1,
  providerKey: string
): Promise<void> {
  if (await createLibraryTemplate(id, authentication, providerKey)) {
    libraryOpen.value = false
    activeTab.value = 'http'
  }
}
async function managePlugins(): Promise<void> {
  libraryOpen.value = false
  await nextTick()
  openSettingsDialog('plugins')
}
watch(libraryOpen, async (value) => {
  if (!value) {
    await nextTick()
    unrefElement(libraryTrigger)?.focus()
  }
})
watch(isNestJS, () => {
  activeTab.value = 'model'
})

function tabLabel(tab: BackendTab): string {
  if (tab === 'commands') return commerceText.value.commands
  if (tab === 'http') return panels.value.lowcodeBackendTabHttp
  if (tab === 'model') return panels.value.lowcodeBackendTabModel
  if (tab === 'relations') return panels.value.lowcodeBackendTabRelations
  if (tab === 'security') return panels.value.lowcodeBackendTabSecurity
  if (tab === 'workflows') return panels.value.lowcodeBackendTabWorkflows
  if (tab === 'storage') return panels.value.lowcodeBackendTabStorage
  return panels.value.lowcodeBackendTabMigration
}
</script>

<template>
  <div data-test-id="lowcode-backend-editor" :class="sectionCls.wrapper">
    <div class="mb-1.5 flex items-center justify-between gap-2">
      <label class="text-[11px] font-medium text-surface">{{ panels.lowcodeBackendTitle }}</label>
      <span
        :class="[
          'rounded border px-1.5 py-0.5 text-[9px]',
          draftValidation.ok && selectedDescriptor
            ? 'border-green-500/40 text-green-500'
            : 'border-red-500/40 text-red-500'
        ]"
      >
        {{
          draftValidation.ok && selectedDescriptor
            ? panels.lowcodeBackendValid
            : panels.lowcodeBackendInvalid
        }}
      </span>
    </div>
    <p class="mb-2 text-[10px] leading-relaxed text-muted">
      {{ panels.lowcodeBackendDescription }}
    </p>

    <div class="mb-3 rounded-lg border border-border bg-panel-field p-3">
      <div class="mb-2 flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <icon-lucide-database class="size-4 shrink-0 text-accent" />
          <span class="truncate text-xs font-medium text-surface">{{
            selectedDescriptor?.providerId || libraryText.title
          }}</span>
        </div>
        <AppBadge tone="neutral">{{ libraryText.current }}</AppBadge>
      </div>
      <p class="mb-3 text-[10px] leading-relaxed text-muted">{{ libraryText.description }}</p>
      <AppButton
        ref="libraryTrigger"
        color="primary"
        variant="solid"
        class="w-full"
        :disabled="busy"
        @click="libraryOpen = true"
      >
        <template #leading><icon-lucide-layout-grid /></template>
        {{ libraryText.browse }}
      </AppButton>
    </div>
    <BackendLibraryDialog
      v-model:open="libraryOpen"
      :items="libraryItems"
      :current-provider-key="selectedProviderKey"
      :template-provider-key="templateProviderKey"
      :block-reason="libraryBlockReason"
      :busy="busy"
      :loading="providersLoading"
      :error="operationError || readError"
      @select-provider="selectLibraryProvider"
      @use-template="useLibraryTemplate"
      @manage-plugins="managePlugins"
    />

    <fieldset
      :disabled="busy"
      :aria-busy="busy"
      class="m-0 min-w-0 border-0 p-0 disabled:pointer-events-none disabled:opacity-70"
    >
      <div class="flex flex-col gap-1.5">
        <details class="rounded border border-border p-2">
          <summary class="cursor-pointer text-[10px] text-muted">
            {{ libraryText.advanced }}
          </summary>
          <label class="mt-2 block text-[10px] text-muted">{{
            panels.lowcodeBackendProvider
          }}</label>
          <select
            v-model="selectedProviderKey"
            data-test-id="lowcode-backend-provider"
            :disabled="busy || providersLoading || providerDescriptors.length === 0"
            class="min-w-0 rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent disabled:opacity-50"
          >
            <option
              v-if="committedProviderUnavailable && committedRequest"
              :value="backendProviderDescriptorKey(committedRequest.selection)"
              disabled
            >
              {{ committedRequest.selection.providerId }} ·
              {{ panels.lowcodeBackendProviderUnavailable }}
            </option>
            <option
              v-for="descriptor in providerDescriptors"
              :key="backendProviderDescriptorKey(descriptor)"
              :value="backendProviderDescriptorKey(descriptor)"
            >
              {{ backendProviderDescriptorLabel(descriptor) }}
            </option>
          </select>
          <p v-if="providersLoading" class="text-[10px] text-muted">
            {{ panels.lowcodeBackendProviderLoading }}
          </p>
          <p v-else-if="providerDescriptors.length === 0" class="text-[10px] text-red-500">
            {{ panels.lowcodeBackendProviderMissing }}
          </p>
          <p v-else-if="committedProviderUnavailable" class="text-[10px] text-red-500">
            {{ panels.lowcodeBackendProviderUnavailable }}
          </p>
          <p
            v-if="
              committedProviderUnavailable && committedRequest?.selection.providerId === 'nestjs'
            "
            class="text-[10px] leading-relaxed text-muted"
          >
            {{ nestJSText.providerRecovery }}
          </p>
          <details v-if="selectedDescriptor" class="mt-2 text-[10px] text-muted">
            <summary class="cursor-pointer">{{ libraryText.authority }}</summary>
            <div
              data-test-id="lowcode-backend-provider-authority"
              class="mt-1 space-y-1 break-all font-mono text-[9px]"
            >
              <div>
                adapter {{ selectedDescriptor.adapterId }}@{{ selectedDescriptor.adapterVersion }}
              </div>
              <div>package {{ selectedDescriptor.packageAuthority.packageDigest }}</div>
              <div>capabilities {{ selectedDescriptor.capabilities.join(', ') }}</div>
            </div>
          </details>
          <div v-if="canInitializeNestJS" class="mt-3 space-y-1.5">
            <AppButton variant="outline" size="sm" @click="initializeNestJS">
              {{ panels.lowcodeBackendInitializeNotes }}
            </AppButton>
            <p class="text-[10px] text-muted">{{ libraryText.modelDraftHint }}</p>
          </div>
        </details>
        <label class="text-[10px] text-muted">{{ panels.lowcodeBackendApplicationId }}</label>
        <input
          v-model="draft.applicationId"
          maxlength="64"
          data-test-id="lowcode-backend-application-id"
          spellcheck="false"
          class="min-w-0 rounded border border-border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent"
        />
      </div>

      <div class="scrollbar-thin mt-2 flex gap-1 overflow-x-auto pb-1">
        <button
          v-for="tab in visibleTabs"
          :key="tab"
          type="button"
          :class="[
            'shrink-0 rounded px-1.5 py-1 text-[10px]',
            activeTab === tab ? 'bg-accent text-white' : 'bg-hover text-muted hover:text-surface'
          ]"
          @click="activeTab = tab"
        >
          {{ tabLabel(tab) }}
        </button>
      </div>

      <div v-if="isNestJS" class="mt-2 flex flex-col gap-2">
        <p class="text-[10px] text-muted">{{ panels.lowcodeBackendNestJSHint }}</p>
        <button
          v-if="canCreateNotesPages"
          type="button"
          :disabled="!canCreateNotesPages"
          class="rounded border border-border px-2 py-1 text-xs text-surface disabled:opacity-50"
          @click="createNotesPages"
        >
          {{ panels.lowcodeBackendCreatePages }}
        </button>
      </div>
      <BackendCommandsEditor v-if="activeTab === 'commands'" :application="draft" />
      <BackendHttpAPIEditor v-else-if="activeTab === 'http'" :application="draft" />
      <BackendDataModelEditor
        v-else-if="activeTab === 'model'"
        :application="draft"
        :nestjs="isNestJS"
      />
      <BackendRelationsEditor
        v-else-if="activeTab === 'relations'"
        :application="draft"
        :nestjs="isNestJS"
      />
      <BackendSecurityEditor
        v-else-if="activeTab === 'security'"
        :application="draft"
        :nestjs="isNestJS"
      />
      <BackendWorkflowEditor v-else-if="activeTab === 'workflows'" :application="draft" />
      <BackendStorageEditor v-else-if="activeTab === 'storage'" :application="draft" />
      <BackendMigrationDiff
        v-else
        :application="draftValidation.application"
        :baseline="committedRequest?.application.dataModel"
      />
    </fieldset>

    <div
      v-if="readError || operationError"
      data-test-id="lowcode-backend-operation-error"
      class="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-500"
    >
      {{ readError || operationError }}
    </div>
    <div v-if="diagnostics.length" data-test-id="lowcode-backend-diagnostics" class="mt-2">
      <p class="mb-1 text-[10px] text-muted">{{ panels.lowcodeBackendDiagnostics }}</p>
      <ul class="max-h-32 space-y-1 overflow-y-auto">
        <li
          v-for="(diagnostic, index) in diagnostics.slice(0, 12)"
          :key="`${diagnostic.path}:${diagnostic.code}:${index}`"
          class="rounded border border-red-500/30 bg-red-500/5 px-2 py-1 text-[9px] text-red-500"
        >
          <span class="font-mono">{{ diagnostic.path }}</span> · {{ diagnostic.message }}
        </li>
      </ul>
    </div>
    <p v-if="outcome" class="mt-2 text-[10px] text-green-500">{{ outcome }}</p>

    <div class="mt-2 flex gap-1 border-t border-border pt-2">
      <button
        type="button"
        data-test-id="lowcode-backend-save"
        :disabled="!canSave"
        class="min-w-0 flex-1 rounded bg-accent px-2 py-1 text-[10px] text-white disabled:cursor-not-allowed disabled:opacity-50"
        @click="saveDraft"
      >
        {{ busy ? panels.lowcodeBackendSaving : panels.lowcodeBackendSave }}
      </button>
      <button
        type="button"
        data-test-id="lowcode-backend-clear"
        :disabled="busy || !hasBackendDeclaration"
        :class="[
          'rounded border px-2 py-1 text-[10px] disabled:opacity-50',
          clearArmed ? 'border-red-500 text-red-500' : 'border-border text-muted hover:bg-hover'
        ]"
        @click="clearDeclaration"
      >
        {{ clearArmed ? panels.lowcodeBackendClearConfirm : panels.lowcodeBackendClear }}
      </button>
    </div>
  </div>
</template>
