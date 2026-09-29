import { TABLE_MODULE_TYPE, TABLE_PLUGIN_ID } from '@open-pencil/core/plugins'

import type { VueModuleAdapter } from './types'

export function buildOpenPencilVueTable(): string {
  return `<script setup lang="ts">
import { computed, normalizeClass, normalizeStyle, useAttrs, type CSSProperties } from 'vue'
defineOptions({ inheritAttrs: false })
const props = defineProps<{ config: {
  table: { columns: readonly string[]; rows: readonly (readonly string[])[] }
  showHeader: boolean; striped: boolean; borderColor: string
  headerBackground: string; textColor: string; fontSize: number
} ; lang?: string }>()
const attrs = useAttrs()
const scrollLabel = computed(() => (props.lang ?? (typeof document === 'undefined' ? 'en' : document.documentElement.lang)).toLowerCase().startsWith('zh') ? '表格滚动区域' : 'Table scroll area')
const hostStyle = computed(() => {
  const normalized = normalizeStyle([attrs.style])
  const style = typeof normalized === 'object' ? normalized : undefined
  const positioned = normalizeClass(attrs.class).split(' ').some(token => ['absolute', 'fixed', 'relative', 'sticky'].includes(token))
  return positioned || (style?.position && style.position !== 'static') ? style : { ...style, position: 'relative' as const }
})
const cellStyle = computed<CSSProperties>(() => ({
  border: '1px solid ' + props.config.borderColor, height: 'max(22px, 1.4em)',
  lineHeight: 1.4, padding: '0 0.7em', textAlign: 'start', verticalAlign: 'top'
}))
</script>
<template>
  <div v-bind="$attrs" data-openpencil-table="" :style="hostStyle">
    <div :aria-label="scrollLabel" data-openpencil-table-scroll="" role="region" tabindex="0" style="height:100%;inset:0;overflow:auto;position:absolute;width:100%">
      <table :style="{ borderCollapse: 'collapse', color: config.textColor, fontSize: config.fontSize + 'px', minWidth: '100%', width: 'max-content' }">
        <thead v-if="config.showHeader" :style="{ background: config.headerBackground, position: 'sticky', top: 0, zIndex: 1 }">
          <tr><th v-for="(column, index) in config.table.columns" :key="index" scope="col" :style="cellStyle">{{ column }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in config.table.rows" :key="rowIndex" :style="{ background: config.striped && rowIndex % 2 === 1 ? '#F9FAFB' : undefined }">
            <td v-for="(_, columnIndex) in config.table.columns" :key="columnIndex" :style="cellStyle">{{ row[columnIndex] ?? '' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <slot />
  </div>
</template>
`
}

export const TABLE_VUE_MODULE_ADAPTER: VueModuleAdapter = Object.freeze({
  pluginId: TABLE_PLUGIN_ID,
  moduleType: TABLE_MODULE_TYPE,
  componentName: 'OpenPencilTable',
  runtimePath: 'src/__openpencil_table.vue',
  importPath: '../__openpencil_table.vue',
  buildRuntime: buildOpenPencilVueTable
})
