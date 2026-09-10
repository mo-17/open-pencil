<script setup lang="ts">
import { computed } from 'vue'

import type { SupabaseConfig } from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import type { AppBackendProviderDocumentGraph } from '@/app/plugins/host/backend-provider'
import type { DesktopSupabaseBackendReviewResult } from '@/app/plugins/host/deployment/desktop/supabase/backend/review'
import type { DesktopSupabaseSourceMigrationExportResult } from '@/app/plugins/host/deployment/desktop/supabase/source-migration/export'

import {
  SUPABASE_SOURCE_MIGRATION_NAME_MAX_LENGTH,
  useSupabaseSourceMigrationExportController
} from './supabase-source-migration-export-controller'

const { config, graph, reviewed, externalBusy } = defineProps<{
  config?: SupabaseConfig
  graph: AppBackendProviderDocumentGraph
  reviewed: DesktopSupabaseBackendReviewResult
  externalBusy?: boolean
}>()

const emit = defineEmits<{
  busy: [value: boolean]
  exported: [result: DesktopSupabaseSourceMigrationExportResult]
}>()
const { panels } = useI18n()
const {
  busy,
  canExport,
  exportMigration,
  inspectedLedgerName,
  localBusy,
  localError,
  migrationName,
  promotionLedgerName,
  result,
  selectInspectedLedger,
  selectPromotionLedger,
  setInspectedLedgerInput,
  setPromotionLedgerInput,
  updateMigrationName
} = useSupabaseSourceMigrationExportController({
  getConfig: () => config,
  getGraph: () => graph,
  getReviewed: () => reviewed,
  getExternalBusy: () => externalBusy === true,
  onBusy: (value) => emit('busy', value),
  onExported: (value) => emit('exported', value)
})

const errorMessage = computed(() => {
  const code = localError.value
  if (!code) return ''
  if (code === 'invalid-ledger-file') {
    return panels.value.lowcodeSupabaseSourceMigrationErrorInvalidFile
  }
  if (code === 'ledger-file-too-large' || code === 'invalid-ledger') {
    return panels.value.lowcodeSupabaseSourceMigrationErrorInvalidLedger
  }
  if (code === 'invalid-name') return panels.value.lowcodeSupabaseSourceMigrationErrorInvalidName
  if (code === 'review-not-ready') {
    return panels.value.lowcodeSupabaseSourceMigrationErrorReviewNotReady
  }
  if (code === 'review-stale' || code === 'invalid-config') {
    return panels.value.lowcodeSupabaseSourceMigrationErrorReviewStale
  }
  if (code === 'backend-provider-missing' || code === 'backend-provider-unavailable') {
    return panels.value.lowcodeSupabaseSourceMigrationErrorProvider
  }
  if (code === 'desktop-required') {
    return panels.value.lowcodeSupabaseSourceMigrationErrorDesktopOnly
  }
  if (code === 'outcome-unknown') {
    return panels.value.lowcodeSupabaseSourceMigrationErrorOutcomeUnknown
  }
  if (code === 'aborted') return panels.value.lowcodeSupabaseSourceMigrationErrorCancelled
  if (code === 'already-running') {
    return panels.value.lowcodeSupabaseSourceMigrationErrorAlreadyRunning
  }
  if (code === 'bundle-invalid') {
    return panels.value.lowcodeSupabaseSourceMigrationErrorBundleInvalid
  }
  return panels.value.lowcodeSupabaseSourceMigrationErrorFailed
})
</script>

<template>
  <section
    data-test-id="lowcode-supabase-source-migration-export"
    class="mt-1 flex flex-col gap-1.5 rounded border border-border bg-input p-2"
  >
    <div class="flex items-center justify-between gap-2">
      <label class="text-[11px] text-muted">{{ panels.lowcodeSupabaseSourceMigrationTitle }}</label>
      <span class="rounded bg-accent/10 px-1.5 py-0.5 text-[9px] uppercase text-accent">
        {{ panels.lowcodeSupabaseSourceMigrationSourceOnly }}
      </span>
    </div>
    <p class="text-[10px] text-muted">
      {{ panels.lowcodeSupabaseSourceMigrationDescription }}
    </p>

    <label class="flex flex-col gap-1 text-[10px] text-muted">
      {{ panels.lowcodeSupabaseSourceMigrationNameLabel }}
      <input
        type="text"
        autocomplete="off"
        spellcheck="false"
        pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
        :maxlength="SUPABASE_SOURCE_MIGRATION_NAME_MAX_LENGTH"
        :value="migrationName"
        data-test-id="lowcode-supabase-source-migration-name"
        :placeholder="panels.lowcodeSupabaseSourceMigrationNamePlaceholder"
        :disabled="busy"
        class="w-full rounded border border-border bg-panel px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent disabled:opacity-50"
        @input="updateMigrationName"
      />
    </label>

    <div class="grid grid-cols-2 gap-1">
      <label
        class="cursor-pointer rounded border border-border px-2 py-1 text-center text-[10px] text-muted hover:bg-hover hover:text-surface"
        :class="busy ? 'pointer-events-none opacity-50' : ''"
      >
        {{ panels.lowcodeSupabaseSourceMigrationInspectedLedger }}
        <input
          :ref="setInspectedLedgerInput"
          type="file"
          accept=".json,application/json"
          class="hidden"
          data-test-id="lowcode-supabase-source-inspected-ledger-file"
          :disabled="busy"
          @change="selectInspectedLedger"
        />
      </label>
      <label
        class="cursor-pointer rounded border border-border px-2 py-1 text-center text-[10px] text-muted hover:bg-hover hover:text-surface"
        :class="busy ? 'pointer-events-none opacity-50' : ''"
      >
        {{ panels.lowcodeSupabaseSourceMigrationPromotionLedger }}
        <input
          :ref="setPromotionLedgerInput"
          type="file"
          accept=".json,application/json"
          class="hidden"
          data-test-id="lowcode-supabase-source-promotion-ledger-file"
          :disabled="busy"
          @change="selectPromotionLedger"
        />
      </label>
    </div>
    <p
      v-if="inspectedLedgerName || promotionLedgerName"
      data-test-id="lowcode-supabase-source-ledger-files"
      class="break-all text-[9px] text-muted"
    >
      <span v-if="inspectedLedgerName">
        {{ panels.lowcodeSupabaseSourceMigrationInspectedFileLabel }}:
        {{ inspectedLedgerName }}
      </span>
      <span v-if="inspectedLedgerName && promotionLedgerName"> · </span>
      <span v-if="promotionLedgerName">
        {{ panels.lowcodeSupabaseSourceMigrationPromotionFileLabel }}:
        {{ promotionLedgerName }}
      </span>
    </p>

    <button
      type="button"
      data-test-id="lowcode-supabase-source-migration-export-button"
      :disabled="!canExport"
      class="rounded border border-accent/50 px-2 py-1 text-[11px] text-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
      @click="exportMigration"
    >
      {{
        localBusy
          ? panels.lowcodeSupabaseSourceMigrationExporting
          : panels.lowcodeSupabaseSourceMigrationExport
      }}
    </button>

    <p
      v-if="errorMessage"
      data-test-id="lowcode-supabase-source-migration-error"
      class="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-500"
      role="alert"
    >
      {{ errorMessage }}
    </p>

    <article
      v-if="result"
      data-test-id="lowcode-supabase-source-migration-result"
      class="flex flex-col gap-1 rounded border border-green-500/40 bg-green-500/5 p-2"
    >
      <p class="text-[10px] text-green-500">
        {{ panels.lowcodeSupabaseSourceMigrationSaved }}
      </p>
      <dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[9px] text-muted">
        <dt>{{ panels.lowcodeSupabaseSourceMigrationResultFile }}</dt>
        <dd class="min-w-0 break-all font-mono text-surface">{{ result.fileName }}</dd>
        <dt>{{ panels.lowcodeSupabaseSourceMigrationResultPath }}</dt>
        <dd class="min-w-0 break-all font-mono text-surface">{{ result.migrationPath }}</dd>
        <dt>{{ panels.lowcodeSupabaseSourceMigrationResultDigest }}</dt>
        <dd class="min-w-0 break-all font-mono text-surface">
          {{ result.bundleManifestDigest }}
        </dd>
        <dt>{{ panels.lowcodeSupabaseSourceMigrationResultPromotion }}</dt>
        <dd class="font-mono text-surface">
          {{
            result.promotionLedgerIncluded
              ? panels.lowcodeSupabaseSourceMigrationPromotionIncluded
              : panels.lowcodeSupabaseSourceMigrationPromotionNotGenerated
          }}
        </dd>
      </dl>
      <p class="text-[9px] text-amber-500">
        {{ panels.lowcodeSupabaseSourceMigrationPostSaveHint }}
      </p>
    </article>
  </section>
</template>
