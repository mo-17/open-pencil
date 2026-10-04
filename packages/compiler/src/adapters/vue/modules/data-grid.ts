import { DATA_GRID_CSV_RUNTIME } from '#compiler/adapters/data-grid/csv'
import { DATA_GRID_FEEDBACK_RUNTIME } from '#compiler/adapters/data-grid/feedback'
import { DATA_GRID_ROWS_RUNTIME } from '#compiler/adapters/data-grid/rows'
import {
  DATA_GRID_TYPES,
  DATA_GRID_CELL_RUNTIME,
  DATA_GRID_LAYOUT_RUNTIME
} from '#compiler/adapters/data-grid/source'

import { DATA_GRID_MODULE_TYPE, DATA_GRID_PLUGIN_ID } from '@open-pencil/core/plugins'

import type { VueModuleAdapter } from './types'

export function buildOpenPencilVueDataGrid(): string {
  return `<script lang="ts">
${DATA_GRID_TYPES}
${DATA_GRID_CSV_RUNTIME}
${DATA_GRID_CELL_RUNTIME}
${DATA_GRID_ROWS_RUNTIME}
${DATA_GRID_FEEDBACK_RUNTIME}
${DATA_GRID_LAYOUT_RUNTIME}
</script>
<script setup lang="ts">
import { computed, normalizeClass, normalizeStyle, ref, useAttrs, useId, watch, type CSSProperties } from 'vue'
defineOptions({ inheritAttrs: false })
const props = defineProps<{ config: OpenPencilDataGridConfig; lang?: string; rowsBound?: boolean; rows?: unknown }>()
const attrs = useAttrs()
const chinese = computed(() => (props.lang ?? (typeof document === 'undefined' ? 'en' : document.documentElement.lang)).toLowerCase().startsWith('zh'))
const copy = computed(() => dataGridCopy(chinese.value))
const localRows = ref<readonly OpenPencilDataGridRow[]>(props.config.data.rows)
const boundRows = computed(() => props.rowsBound ? resolveBoundDataGridRows(props.rows, props.config.data.columns) : { ok: true, rows: [] })
const rows = computed(() => props.rowsBound ? boundRows.value.rows : localRows.value)
const rowsUnavailable = computed(() => props.rowsBound === true && !boundRows.value.ok)
const sort = ref<OpenPencilDataGridSort | null>(props.config.initialSort)
const queries = ref<Record<string, string>>({})
const page = ref(0)
const selectedIds = ref(new Set<string>())
const csvOpen = ref(false)
const csvSource = ref('')
const csvOutput = ref('')
const csvStatus = ref<'imported' | 'prepared' | ''>('')
const csvError = ref('')
const sanitizedCount = ref(0)
const importedCount = ref(0)
const selectionName = 'openpencil-data-grid-selection-' + useId()
const scrollArea = ref<HTMLDivElement | null>(null)
const tableHeader = ref<HTMLTableSectionElement | null>(null)
const stickyHeaderFits = ref(false)
watch([scrollArea, tableHeader, () => props.config.showHeader, () => props.config.stickyHeader], ([viewport, header, showHeader, stickyHeader], _, onCleanup) => {
  stickyHeaderFits.value = false
  if (viewport && header && showHeader && stickyHeader) {
    onCleanup(observeDataGridStickyHeader(viewport, header, fits => { stickyHeaderFits.value = fits }))
  }
}, { flush: 'post' })
// Value equality keeps local edits on unrelated host rerenders; changed data resets the session.
watch(() => JSON.stringify({ data: { columns: props.config.data.columns, rows: props.rowsBound ? boundRows.value.rows : props.config.data.rows }, rowsBound: props.rowsBound === true, rowsUnavailable: rowsUnavailable.value, filters: props.config.filters, initialSort: props.config.initialSort, pageSize: props.config.pageSize, selectionMode: props.config.selectionMode }), () => {
  localRows.value = props.config.data.rows
  sort.value = props.config.initialSort
  queries.value = {}
  page.value = 0
  selectedIds.value = new Set()
  csvSource.value = ''
  csvOutput.value = ''
  csvStatus.value = ''
  csvError.value = ''
  sanitizedCount.value = 0
})
const columnIndexes = computed(() => new Map(props.config.data.columns.map((column, index) => [column.id, index])))
const filteredRows = computed(() => rows.value.filter(row => {
  for (const filter of props.config.filters) {
    const index = columnIndexes.value.get(filter.columnId)
    if (index === undefined || !matchesFilter(row.cells[index] ?? null, filter)) return false
  }
  for (const column of props.config.data.columns) {
    const query = queries.value[column.id]?.trim().toLocaleLowerCase()
    if (!query) continue
    const index = columnIndexes.value.get(column.id)
    if (index === undefined || !cellText(row.cells[index] ?? null).toLocaleLowerCase().includes(query)) return false
  }
  return true
}))
const sortedRows = computed(() => {
  const current = sort.value
  if (!current) return filteredRows.value
  const index = columnIndexes.value.get(current.columnId)
  if (index === undefined) return filteredRows.value
  const direction = current.direction === 'ascending' ? 1 : -1
  return filteredRows.value.map((row, sourceIndex) => ({ row, sourceIndex }))
    .sort((left, right) => compareCells(left.row.cells[index] ?? null, right.row.cells[index] ?? null) * direction || left.sourceIndex - right.sourceIndex)
    .map(({ row }) => row)
})
const pageCount = computed(() => Math.max(1, Math.ceil(sortedRows.value.length / props.config.pageSize)))
watch(pageCount, count => { page.value = Math.min(page.value, count - 1) })
const pageRows = computed(() => sortedRows.value.slice(page.value * props.config.pageSize, (page.value + 1) * props.config.pageSize))
const allPageRowsSelected = computed(() => pageRows.value.length > 0 && pageRows.value.every(row => selectedIds.value.has(row.id)))
const pageSelectionIsMixed = computed(() => !allPageRowsSelected.value && pageRows.value.some(row => selectedIds.value.has(row.id)))
const selectionSummaryId = selectionName + '-summary'
const selectionText = computed(() => copy.value.selected(selectedIds.value.size, selectedIds.value.size - pageRows.value.filter(row => selectedIds.value.has(row.id)).length))
const hasQueries = computed(() => Object.values(queries.value).some(value => value.length > 0))
const hasSelection = computed(() => props.config.selectionMode !== 'none' && selectedIds.value.size > 0)
const showFeedback = computed(() => hasSelection.value || hasQueries.value || props.config.filters.length > 0)
const paginationText = computed(() => copy.value.page(page.value + 1, pageCount.value, filteredRows.value.length))
const statusText = computed(() => csvStatus.value === 'prepared' ? copy.value.prepared : csvStatus.value === 'imported' ? copy.value.imported(importedCount.value) : '')
const sanitizedText = computed(() => copy.value.sanitized(sanitizedCount.value))
function clearQueries() {
  ;(scrollArea.value?.querySelector<HTMLInputElement>('input[type="search"]') ?? scrollArea.value)?.focus()
  queries.value = {}
  page.value = 0
}
function clearSelection() {
  ;(scrollArea.value?.querySelector<HTMLInputElement>('input[type="checkbox"]:not(:disabled), input[type="radio"]:not(:disabled)') ?? scrollArea.value)?.focus()
  selectedIds.value = new Set()
}
function toggleSort(column: OpenPencilDataGridColumn) {
  if (!column.sortable) return
  page.value = 0
  sort.value = sort.value?.columnId !== column.id ? { columnId: column.id, direction: 'ascending' }
    : sort.value.direction === 'ascending' ? { columnId: column.id, direction: 'descending' } : null
}
function filterColumn(columnId: string, event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return
  page.value = 0
  queries.value = { ...queries.value, [columnId]: event.target.value }
}
function toggleRow(id: string) {
  if (props.config.selectionMode === 'none') return
  const selected = selectedIds.value.has(id)
  if (props.config.selectionMode === 'single') selectedIds.value = selected ? new Set() : new Set([id])
  else if (selected) selectedIds.value.delete(id)
  else selectedIds.value.add(id)
}
function togglePageRows() {
  if (props.config.selectionMode !== 'multiple') return
  const selected = allPageRowsSelected.value
  for (const row of pageRows.value) {
    if (selected) selectedIds.value.delete(row.id)
    else selectedIds.value.add(row.id)
  }
}
function importPastedCsv() {
  if (props.rowsBound) return
  try {
    const imported = importCsvRows(csvSource.value, props.config.data.columns)
    localRows.value = imported
    sort.value = props.config.initialSort
    queries.value = {}
    page.value = 0
    selectedIds.value = new Set()
    csvOutput.value = ''
    sanitizedCount.value = 0
    csvError.value = ''
    importedCount.value = imported.length
    csvStatus.value = 'imported'
  } catch (cause) {
    csvStatus.value = ''
    csvError.value = cause instanceof Error ? cause.message : String(cause)
  }
}
function prepareCsvText() {
  try {
    const prepared = exportCsvRows(props.config.data.columns, props.rowsBound ? sortedRows.value : rows.value)
    csvOutput.value = prepared.text
    sanitizedCount.value = prepared.sanitizedCount
    csvError.value = ''
    csvStatus.value = 'prepared'
  } catch (cause) {
    csvOutput.value = ''
    sanitizedCount.value = 0
    csvStatus.value = ''
    csvError.value = cause instanceof Error ? cause.message : String(cause)
  }
}
const hostStyle = computed<CSSProperties>(() => {
  const normalized = normalizeStyle([attrs.style])
  const style = typeof normalized === 'object' ? normalized : undefined
  const positioned = normalizeClass(attrs.class).split(' ').some(token => ['absolute', 'fixed', 'relative', 'sticky'].includes(token))
  return { ...(positioned || (style?.position && style.position !== 'static') ? style : { ...style, position: 'relative' as const }), color: props.config.textColor, display: 'flex', flexDirection: 'column', fontSize: props.config.fontSize + 'px', overflow: 'hidden' }
})
const cellStyle = (column: OpenPencilDataGridColumn): CSSProperties => ({
  border: '1px solid ' + props.config.borderColor, boxSizing: 'border-box', height: props.config.density === 'compact' ? '30px' : '42px',
  padding: props.config.density === 'compact' ? '4px 8px' : '8px 12px', textAlign: column.align, verticalAlign: 'middle', width: column.width + 'px'
})
const buttonStyle = computed<CSSProperties>(() => ({ minHeight: '44px', padding: '6px 10px', border: '1px solid ' + props.config.borderColor, borderRadius: '4px', background: props.config.headerBackground, color: props.config.textColor, cursor: 'pointer' }))
const inputStyle = computed<CSSProperties>(() => ({ boxSizing: 'border-box', display: 'block', width: '100%', minHeight: '36px', padding: '6px', border: '1px solid ' + props.config.borderColor, borderRadius: '4px', background: '#FFFFFF', color: props.config.textColor }))
const selectionColumn = computed(() => props.config.selectionMode === 'none' ? 0 : 44)
const tableWidth = computed(() => props.config.data.columns.reduce((total, column) => total + column.width, selectionColumn.value))
const visuallyHiddenStyle: CSSProperties = { border: 0, clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', height: '1px', margin: '-1px', overflow: 'hidden', padding: 0, position: 'absolute', whiteSpace: 'nowrap', width: '1px' }
const headerStyle = computed<CSSProperties>(() => props.config.showHeader ? {
  background: props.config.headerBackground, position: props.config.stickyHeader && stickyHeaderFits.value ? 'sticky' : undefined,
  top: props.config.stickyHeader && stickyHeaderFits.value ? 0 : undefined, zIndex: props.config.stickyHeader && stickyHeaderFits.value ? 1 : undefined
} : visuallyHiddenStyle)
</script>
<template>
  <div v-bind="$attrs" :lang="lang" data-openpencil-data-grid="" :data-openpencil-data-grid-unavailable="rowsUnavailable || undefined" :style="hostStyle">
    <div v-if="config.showCsvTools === true" :aria-label="copy.tools" data-openpencil-data-grid-csv-tools="" role="region" :style="{ borderBottom: '1px solid ' + config.borderColor, padding: '8px', flexShrink: 0 }">
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        <button type="button" :disabled="rowsBound" :style="buttonStyle" @click="csvOpen = !csvOpen">{{ csvOpen ? copy.close : copy.paste }}</button>
        <button type="button" :disabled="rowsUnavailable" :style="buttonStyle" @click="prepareCsvText">{{ copy.prepare }}</button>
      </div>
      <p v-if="rowsBound">{{ copy.boundReadOnly }}</p>
      <div v-if="csvOpen && !rowsBound" style="margin-top:6px">
        <label>{{ copy.source }}<textarea v-model="csvSource" :maxlength="CSV_MAX_BYTES" rows="5" :spellcheck="false" :style="inputStyle" /></label>
        <button type="button" :disabled="rowsBound" :style="buttonStyle" @click="importPastedCsv">{{ copy.import }}</button><p>{{ copy.local }}</p>
      </div>
      <div v-if="csvOutput" style="margin-top:6px">
        <label>{{ copy.output }}<textarea :value="csvOutput" readonly rows="5" :spellcheck="false" :style="inputStyle" /></label>
        <p>{{ copy.manual }} <span v-if="sanitizedCount > 0">{{ sanitizedText }}</span></p>
      </div>
      <p v-if="statusText" aria-live="polite">{{ statusText }}</p>
      <p v-if="csvError" aria-live="assertive" role="alert">{{ copy.failure }} {{ csvError }}</p>
    </div>
    <div v-if="config.selectionMode !== 'none' || showFeedback" data-openpencil-data-grid-feedback="" :data-openpencil-data-grid-feedback-hidden="showFeedback ? undefined : ''" :style="showFeedback ? { borderBottom: '1px solid ' + config.borderColor, padding: '8px', flexShrink: 0 } : visuallyHiddenStyle">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
        <span v-if="config.selectionMode !== 'none'" :id="selectionSummaryId" role="status" aria-live="polite" aria-atomic="true">{{ selectionText }}</span>
        <button v-if="hasSelection" type="button" :style="buttonStyle" @click="clearSelection">{{ copy.clearSelection }}</button>
        <button v-if="hasQueries" type="button" :style="buttonStyle" @click="clearQueries">{{ copy.clearFilters }}</button>
      </div>
      <p v-if="config.filters.length" style="margin:4px 0 0">{{ copy.configuredFilters }}</p>
    </div>
    <div ref="scrollArea" :aria-label="copy.scroll" data-openpencil-data-grid-scroll="" role="region" tabindex="0" style="flex:1;min-height:0;overflow:auto">
      <table :aria-colcount="config.data.columns.length + (selectionColumn ? 1 : 0)" :aria-rowcount="filteredRows.length" :style="{ borderCollapse: 'collapse', minWidth: '100%', tableLayout: 'fixed', width: tableWidth + 'px' }">
        <thead ref="tableHeader" :data-visually-hidden="config.showHeader ? undefined : ''" :style="headerStyle">
          <tr>
            <th v-if="config.selectionMode !== 'none'" scope="col" :style="{ border: '1px solid ' + config.borderColor, width: '44px' }">
              <template v-if="!config.showHeader">{{ copy.selection }}</template>
              <input v-else-if="config.selectionMode === 'multiple'" type="checkbox" :aria-label="copy.all" :aria-describedby="selectionSummaryId" :disabled="pageRows.length === 0" :aria-checked="pageSelectionIsMixed ? 'mixed' : allPageRowsSelected" :checked="allPageRowsSelected" :indeterminate.prop="pageSelectionIsMixed" @change="togglePageRows" />
              <span v-else aria-hidden="true">•</span>
            </th>
            <th v-for="column in config.data.columns" :key="column.id" scope="col" :aria-sort="sort?.columnId === column.id ? sort.direction : 'none'" :style="cellStyle(column)">
              <button v-if="config.showHeader && column.sortable" type="button" :style="buttonStyle" @click="toggleSort(column)">{{ column.label }}</button><template v-else>{{ column.label }}</template>
            </th>
          </tr>
          <tr v-if="config.showHeader && config.data.columns.some(column => column.filterable)" data-openpencil-data-grid-filters="">
            <th v-if="config.selectionMode !== 'none'" aria-hidden="true" />
            <th v-for="column in config.data.columns" :key="column.id" scope="col" :style="cellStyle(column)">
              <input v-if="column.filterable" type="search" :style="inputStyle" :aria-label="copy.filter + column.label" :value="queries[column.id] ?? ''" @input="filterColumn(column.id, $event)" />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in pageRows" :key="row.id" :aria-selected="config.selectionMode === 'none' ? undefined : selectedIds.has(row.id)" :data-selected="selectedIds.has(row.id) || undefined" :style="{ background: selectedIds.has(row.id) ? config.accentColor + '20' : config.striped && rowIndex % 2 === 1 ? '#F9FAFB' : undefined }">
            <td v-if="config.selectionMode !== 'none'" :style="{ border: '1px solid ' + config.borderColor, textAlign: 'center' }">
              <input :type="config.selectionMode === 'single' ? 'radio' : 'checkbox'" :aria-label="copy.select + row.id" :aria-describedby="selectionSummaryId" :checked="selectedIds.has(row.id)" :name="config.selectionMode === 'single' ? selectionName : undefined" @change="toggleRow(row.id)" />
            </td>
            <td v-for="(column, index) in config.data.columns" :key="column.id" :style="cellStyle(column)">{{ cellText(row.cells[index] ?? null) }}</td>
          </tr>
          <tr v-if="pageRows.length === 0"><td :colspan="config.data.columns.length + (selectionColumn ? 1 : 0)" style="padding:16px;text-align:center"><span v-if="rowsUnavailable" role="alert">{{ copy.boundUnavailable }}</span><template v-else>{{ copy.empty }}</template></td></tr>
        </tbody>
      </table>
    </div>
    <div :aria-label="copy.pagination" data-openpencil-data-grid-pagination="" role="navigation" :style="{ flexShrink: 0, display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', padding: '8px', borderTop: '1px solid ' + config.borderColor }">
      <button type="button" :style="{ ...buttonStyle, opacity: page === 0 ? 0.5 : 1 }" :disabled="page === 0" @click="page--">{{ copy.previous }}</button>
      <span aria-live="polite">{{ paginationText }}</span>
      <button type="button" :style="{ ...buttonStyle, opacity: page >= pageCount - 1 ? 0.5 : 1 }" :disabled="page >= pageCount - 1" @click="page++">{{ copy.next }}</button>
    </div>
    <slot />
  </div>
</template>
`
}

export const DATA_GRID_VUE_MODULE_ADAPTER: VueModuleAdapter = Object.freeze({
  pluginId: DATA_GRID_PLUGIN_ID,
  moduleType: DATA_GRID_MODULE_TYPE,
  componentName: 'OpenPencilDataGrid',
  runtimePath: 'src/__openpencil_data_grid.vue',
  importPath: '../__openpencil_data_grid.vue',
  buildRuntime: buildOpenPencilVueDataGrid
})
