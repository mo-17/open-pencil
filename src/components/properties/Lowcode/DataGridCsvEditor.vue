<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import {
  DATA_GRID_CSV_LIMITS,
  exportDataGridCsv,
  parseDataGridCsv,
  type DataGridDataV1
} from '@open-pencil/core/plugins'

const { modelValue, label } = defineProps<{
  modelValue: DataGridDataV1
  label: string
}>()

const emit = defineEmits<{
  commit: [value: DataGridDataV1]
}>()

const importOpen = ref(false)
const importSource = ref('')
const preparedCsv = ref('')
const localError = ref('')
const status = ref('')
const sanitizedFormulaFieldCount = ref(0)
const errorMessage = computed(() => localError.value)

watch(
  () => modelValue,
  () => {
    preparedCsv.value = ''
    sanitizedFormulaFieldCount.value = 0
    status.value = ''
    localError.value = ''
  },
  { deep: true }
)

function inputValue(event: Event): string {
  return (event.target as HTMLTextAreaElement).value
}

function importCsv(): void {
  try {
    const result = parseDataGridCsv(importSource.value, modelValue.columns)
    emit('commit', result.data)
    localError.value = ''
    preparedCsv.value = ''
    sanitizedFormulaFieldCount.value = 0
    void nextTick(() => {
      status.value = `Imported ${result.rowCount} rows. This change is stored in the design and can be undone.`
    })
  } catch (cause) {
    status.value = ''
    localError.value = cause instanceof Error ? cause.message : String(cause)
  }
}

function prepareCsv(): void {
  try {
    const result = exportDataGridCsv(modelValue)
    preparedCsv.value = result.text
    sanitizedFormulaFieldCount.value = result.sanitizedFormulaFieldCount
    localError.value = ''
    status.value = 'CSV text prepared. Copy it manually from the read-only field below.'
  } catch (cause) {
    preparedCsv.value = ''
    sanitizedFormulaFieldCount.value = 0
    status.value = ''
    localError.value = cause instanceof Error ? cause.message : String(cause)
  }
}
</script>

<template>
  <div
    data-test-id="data-grid-csv-editor"
    role="group"
    :aria-label="label"
    class="flex flex-col gap-1.5"
  >
    <div class="flex flex-wrap items-center gap-1">
      <button
        type="button"
        data-test-id="data-grid-csv-toggle-import"
        class="rounded border border-border px-1.5 py-1 text-[10px] text-surface hover:bg-hover"
        @click="importOpen = !importOpen"
      >
        {{ importOpen ? 'Close CSV import' : 'Paste CSV' }}
      </button>
      <button
        type="button"
        data-test-id="data-grid-csv-prepare"
        class="rounded border border-border px-1.5 py-1 text-[10px] text-surface hover:bg-hover"
        @click="prepareCsv"
      >
        Prepare CSV text
      </button>
      <span class="ml-auto text-[9px] text-muted">
        {{ modelValue.rows.length }} rows · {{ modelValue.columns.length }} columns
      </span>
    </div>

    <div v-if="importOpen" class="flex flex-col gap-1">
      <textarea
        :value="importSource"
        :aria-label="`${label} CSV import text`"
        :maxlength="DATA_GRID_CSV_LIMITS.bytes"
        data-test-id="data-grid-csv-import-source"
        rows="7"
        wrap="off"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        class="w-full resize-y rounded border border-border bg-input px-2 py-1.5 font-mono text-[10px] leading-relaxed text-surface outline-none focus:border-accent"
        @input="importSource = inputValue($event)"
      />
      <div class="flex items-center justify-between gap-2">
        <span class="text-[9px] leading-relaxed text-muted">
          UTF-8 CSV, comma-delimited. Import persists in the design and participates in undo.
        </span>
        <button
          type="button"
          data-test-id="data-grid-csv-import"
          class="shrink-0 rounded bg-accent px-2 py-1 text-[10px] text-white hover:opacity-90"
          @click="importCsv"
        >
          Import
        </button>
      </div>
    </div>

    <div v-if="preparedCsv" class="flex flex-col gap-1">
      <textarea
        :value="preparedCsv"
        :aria-label="`${label} prepared CSV text`"
        data-test-id="data-grid-csv-output"
        rows="7"
        readonly
        wrap="off"
        spellcheck="false"
        class="w-full resize-y rounded border border-border bg-input px-2 py-1.5 font-mono text-[10px] leading-relaxed text-surface outline-none focus:border-accent"
      />
      <p class="text-[9px] leading-relaxed text-muted">
        No file or clipboard permission is requested. Copy this text manually.
        <span v-if="sanitizedFormulaFieldCount > 0">
          {{ sanitizedFormulaFieldCount }} formula-like text fields were neutralized for spreadsheet
          safety.
        </span>
      </p>
    </div>

    <p v-if="status" data-test-id="data-grid-csv-status" class="text-[10px] text-emerald-400">
      {{ status }}
    </p>
    <p v-if="errorMessage" data-test-id="data-grid-csv-error" class="text-[10px] text-red-400">
      {{ errorMessage }}
    </p>
  </div>
</template>
