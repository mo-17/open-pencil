import { createDataGridModuleInstance } from '@open-pencil/core/plugins'

/** The same generated grid stays mounted while its host changes only toolbar visibility. */
export function addDataGridToolbarHarness(
  files: Map<string, string | Uint8Array>,
  target: 'react' | 'vue'
): void {
  const config = createDataGridModuleInstance({
    pageSize: 10,
    selectionMode: 'multiple',
    showCsvTools: false
  }).config
  if (target === 'vue') {
    files.set(
      'src/App.vue',
      `<script setup lang="ts">
import { computed, ref } from 'vue'
import DataGrid from './__openpencil_data_grid.vue'
const showCsvTools = ref(false)
const source = ${JSON.stringify(config)} as const
const config = computed(() => ({ ...source, showCsvTools: showCsvTools.value }))
</script>
<template>
  <label><input type="checkbox" v-model="showCsvTools" />Show CSV tools</label>
  <DataGrid :config="config" style="height:780px;width:620px" />
</template>
`
    )
    return
  }
  files.set(
    'src/App.tsx',
    `import { useState } from 'react'
import DataGrid from './__openpencil_data_grid'
const source = ${JSON.stringify(config)} as const
export default function App() {
  const [showCsvTools, setShowCsvTools] = useState(false)
  return <>
    <label><input type="checkbox" checked={showCsvTools} onChange={event => setShowCsvTools(event.currentTarget.checked)} />Show CSV tools</label>
    <DataGrid config={{ ...source, showCsvTools }} style={{ height: 780, width: 620 }} />
  </>
}
`
  )
}
