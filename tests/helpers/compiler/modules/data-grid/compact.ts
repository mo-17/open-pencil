import { createDataGridModuleInstance } from '@open-pencil/core/plugins'

export function addDataGridCompactHarness(
  files: Map<string, string | Uint8Array>,
  target: 'react' | 'vue'
): void {
  const config = createDataGridModuleInstance({
    data: {
      columns: [
        {
          id: 'name',
          label: 'Name',
          type: 'text',
          align: 'start',
          width: 180,
          sortable: true,
          filterable: true
        },
        {
          id: 'score',
          label: 'Score',
          type: 'number',
          align: 'end',
          width: 100,
          sortable: true,
          filterable: false
        }
      ],
      rows: Array.from({ length: 12 }, (_, index) => ({
        id: 'row-' + index,
        cells: ['Item ' + index, index]
      }))
    },
    pageSize: 10,
    selectionMode: 'multiple',
    density: 'compact',
    stickyHeader: true,
    showCsvTools: false
  }).config
  if (target === 'vue') {
    files.set(
      'src/App.vue',
      `<script setup lang="ts">
import { ref } from 'vue'
import DataGrid from './__openpencil_data_grid.vue'
const compact = ref(true)
const config = ${JSON.stringify(config)} as const
</script>
<template>
  <label><input type="checkbox" v-model="compact" />Compact grid</label>
  <DataGrid :config="config" :style="compact ? { height: '240px', width: '284px' } : { height: '420px', width: '620px' }" />
</template>`
    )
    return
  }
  files.set(
    'src/App.tsx',
    `import { useState } from 'react'
import DataGrid from './__openpencil_data_grid'
const config = ${JSON.stringify(config)} as const
export default function App() {
  const [compact, setCompact] = useState(true)
  return <>
    <label><input type="checkbox" checked={compact} onChange={event => setCompact(event.currentTarget.checked)} />Compact grid</label>
    <DataGrid config={config} style={compact ? { height: 240, width: 284 } : { height: 420, width: 620 }} />
  </>
}`
  )
}
