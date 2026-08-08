<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { TABLE_MODULE_LIMITS, type TableDataV1 } from '@open-pencil/core/plugins'
import { useI18n } from '@open-pencil/vue'

const { modelValue, label, error } = defineProps<{
  modelValue: TableDataV1
  label: string
  error?: string
}>()

const emit = defineEmits<{
  commit: [value: TableDataV1]
}>()

const { panels } = useI18n()
const draft = ref(cloneTable(modelValue))
const textLength = computed(() =>
  [...draft.value.columns, ...draft.value.rows.flat()].reduce(
    (total, value) => total + value.length,
    0
  )
)
const overTextLimit = computed(() => textLength.value > TABLE_MODULE_LIMITS.totalText)
const limitError = computed(() =>
  overTextLimit.value
    ? panels.value.lowcodeTableTooMuchText({ max: TABLE_MODULE_LIMITS.totalText })
    : ''
)
const errorMessage = computed(() => limitError.value || error || '')

watch(
  () => modelValue,
  (value) => {
    draft.value = cloneTable(value)
  },
  { deep: true }
)

function cloneTable(value: TableDataV1): TableDataV1 {
  return {
    columns: [...value.columns],
    rows: value.rows.map((row) => [...row])
  }
}

function sameTable(left: TableDataV1, right: TableDataV1): boolean {
  if (left.columns.length !== right.columns.length || left.rows.length !== right.rows.length) {
    return false
  }
  if (left.columns.some((column, index) => column !== right.columns[index])) return false
  return left.rows.every(
    (row, rowIndex) =>
      row.length === right.rows[rowIndex]?.length &&
      row.every((cell, columnIndex) => cell === right.rows[rowIndex]?.[columnIndex])
  )
}

function commit(): void {
  if (overTextLimit.value || sameTable(draft.value, modelValue)) return
  emit('commit', cloneTable(draft.value))
}

function commitShortcut(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return
  event.preventDefault()
  commit()
}

function eventValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}

function updateColumn(index: number, event: Event): void {
  draft.value.columns[index] = eventValue(event)
}

function updateCell(rowIndex: number, columnIndex: number, event: Event): void {
  const row = draft.value.rows[rowIndex]
  if (row) row[columnIndex] = eventValue(event)
}

function addColumn(): void {
  if (draft.value.columns.length >= TABLE_MODULE_LIMITS.columns) return
  draft.value.columns.push('')
  draft.value.rows.forEach((row) => row.push(''))
  commit()
}

function deleteColumn(index: number): void {
  if (draft.value.columns.length <= 1) return
  draft.value.columns.splice(index, 1)
  draft.value.rows.forEach((row) => row.splice(index, 1))
  commit()
}

function addRow(): void {
  if (draft.value.rows.length >= TABLE_MODULE_LIMITS.rows) return
  draft.value.rows.push(Array.from({ length: draft.value.columns.length }, () => ''))
  commit()
}

function deleteRow(index: number): void {
  draft.value.rows.splice(index, 1)
  commit()
}
</script>

<template>
  <div
    data-test-id="table-content-editor"
    role="group"
    :aria-label="label"
    class="flex flex-col gap-1.5"
  >
    <div class="flex flex-wrap items-center gap-1">
      <button
        type="button"
        data-test-id="table-add-column"
        :disabled="draft.columns.length >= TABLE_MODULE_LIMITS.columns"
        class="rounded border border-border px-1.5 py-1 text-[10px] text-surface disabled:cursor-not-allowed disabled:opacity-40"
        @click="addColumn"
      >
        {{ panels.lowcodeTableAddColumn }}
      </button>
      <button
        type="button"
        data-test-id="table-add-row"
        :disabled="draft.rows.length >= TABLE_MODULE_LIMITS.rows"
        class="rounded border border-border px-1.5 py-1 text-[10px] text-surface disabled:cursor-not-allowed disabled:opacity-40"
        @click="addRow"
      >
        {{ panels.lowcodeTableAddRow }}
      </button>
      <span class="ml-auto text-[9px] text-muted">
        {{
          panels.lowcodeTableSize({
            rows: draft.rows.length,
            maxRows: TABLE_MODULE_LIMITS.rows,
            columns: draft.columns.length,
            maxColumns: TABLE_MODULE_LIMITS.columns
          })
        }}
      </span>
    </div>

    <div class="max-h-80 overflow-auto rounded border border-border">
      <table class="min-w-max border-collapse bg-input text-[10px]">
        <thead>
          <tr>
            <th
              v-for="(_column, columnIndex) in draft.columns"
              :key="`header-${columnIndex}`"
              class="min-w-28 border-b border-r border-border p-1 align-top last:border-r-0"
            >
              <div class="flex items-center gap-1">
                <input
                  :value="draft.columns[columnIndex]"
                  :maxlength="TABLE_MODULE_LIMITS.cellText"
                  :aria-label="panels.lowcodeTableHeaderCell({ column: columnIndex + 1 })"
                  data-test-id="table-header-input"
                  class="min-w-0 flex-1 rounded border border-border bg-surface px-1 py-0.5 text-[10px] font-medium text-surface outline-none focus:border-accent"
                  @input="updateColumn(columnIndex, $event)"
                  @blur="commit"
                  @keydown="commitShortcut"
                />
                <button
                  type="button"
                  data-test-id="table-delete-column"
                  :disabled="draft.columns.length <= 1"
                  :aria-label="panels.lowcodeTableDeleteColumn({ column: columnIndex + 1 })"
                  class="shrink-0 rounded px-1 text-xs text-muted hover:bg-hover disabled:cursor-not-allowed disabled:opacity-30"
                  @click="deleteColumn(columnIndex)"
                >
                  ×
                </button>
              </div>
            </th>
            <th class="w-7 border-b border-border" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in draft.rows" :key="`row-${rowIndex}`">
            <td
              v-for="(_cell, columnIndex) in row"
              :key="`cell-${rowIndex}-${columnIndex}`"
              class="min-w-28 border-b border-r border-border p-1 last:border-r-0"
            >
              <input
                :value="row[columnIndex]"
                :maxlength="TABLE_MODULE_LIMITS.cellText"
                :aria-label="
                  panels.lowcodeTableBodyCell({ row: rowIndex + 1, column: columnIndex + 1 })
                "
                data-test-id="table-cell-input"
                class="w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-[10px] text-surface outline-none hover:border-border focus:border-accent focus:bg-surface"
                @input="updateCell(rowIndex, columnIndex, $event)"
                @blur="commit"
                @keydown="commitShortcut"
              />
            </td>
            <td class="w-7 border-b border-border p-1 text-center">
              <button
                type="button"
                data-test-id="table-delete-row"
                :aria-label="panels.lowcodeTableDeleteRow({ row: rowIndex + 1 })"
                class="rounded px-1 text-xs text-muted hover:bg-hover"
                @click="deleteRow(rowIndex)"
              >
                ×
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="text-right text-[9px] text-muted" data-test-id="table-text-length">
      {{ panels.lowcodeTableTextLength({ count: textLength, max: TABLE_MODULE_LIMITS.totalText }) }}
    </div>
    <p v-if="errorMessage" data-test-id="table-content-error" class="text-[10px] text-red-400">
      {{ errorMessage }}
    </p>
  </div>
</template>
