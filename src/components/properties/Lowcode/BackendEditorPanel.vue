<script setup lang="ts">
import { ref } from 'vue'

import { useI18n } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'

import BackendDataModelEditor from '@/app/lowcode/backend/components/BackendDataModelEditor.vue'
import BackendMigrationDiff from '@/app/lowcode/backend/components/BackendMigrationDiff.vue'
import BackendRelationsEditor from '@/app/lowcode/backend/components/BackendRelationsEditor.vue'
import BackendSecurityEditor from '@/app/lowcode/backend/components/BackendSecurityEditor.vue'
import BackendStorageEditor from '@/app/lowcode/backend/components/BackendStorageEditor.vue'
import BackendWorkflowEditor from '@/app/lowcode/backend/components/BackendWorkflowEditor.vue'
import {
  backendProviderDescriptorKey,
  backendProviderDescriptorLabel,
  useBackendEditor
} from '@/app/lowcode/backend/use-backend-editor'

type BackendTab = 'model' | 'relations' | 'security' | 'workflows' | 'storage' | 'migration'

const sectionCls = useSectionUI()
const { panels } = useI18n()
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

function tabLabel(tab: BackendTab): string {
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

    <fieldset
      :disabled="busy"
      :aria-busy="busy"
      class="m-0 min-w-0 border-0 p-0 disabled:pointer-events-none disabled:opacity-70"
    >
      <div class="flex flex-col gap-1.5">
        <label class="text-[10px] text-muted">{{ panels.lowcodeBackendProvider }}</label>
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
        <label class="text-[10px] text-muted">{{ panels.lowcodeBackendApplicationId }}</label>
        <input
          v-model="draft.applicationId"
          maxlength="64"
          data-test-id="lowcode-backend-application-id"
          spellcheck="false"
          class="min-w-0 rounded border border-border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent"
        />
        <div
          v-if="selectedDescriptor"
          data-test-id="lowcode-backend-provider-authority"
          class="rounded border border-border bg-input/40 px-2 py-1 text-[9px] leading-relaxed text-muted"
        >
          <div class="truncate font-mono">
            adapter {{ selectedDescriptor.adapterId }}@{{ selectedDescriptor.adapterVersion }}
          </div>
          <div class="truncate font-mono">
            package {{ selectedDescriptor.packageAuthority.packageDigest }}
          </div>
          <div class="truncate">capabilities {{ selectedDescriptor.capabilities.join(', ') }}</div>
        </div>
      </div>

      <div class="scrollbar-thin mt-2 flex gap-1 overflow-x-auto pb-1">
        <button
          v-for="tab in tabs"
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

      <BackendDataModelEditor v-if="activeTab === 'model'" :application="draft" />
      <BackendRelationsEditor v-else-if="activeTab === 'relations'" :application="draft" />
      <BackendSecurityEditor v-else-if="activeTab === 'security'" :application="draft" />
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
