import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createDataGridModuleFrameOverrides,
  createDataGridModuleInstance,
  createTableModuleFrameOverrides
} from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

import { addDataGridCompactHarness } from './compact'
import { addDataGridToolbarHarness } from './toolbar'

export interface DataModulesFixtureOptions {
  showCsvTools?: boolean
  toolbarLifecycle?: boolean
  compactLayout?: boolean
}

export function dataModulesFixture(
  target: 'react' | 'vue' = 'vue',
  lang = 'en',
  lifecycle = false,
  configuredFilters = false,
  options: DataModulesFixtureOptions = {}
) {
  const graph = makeSceneGraph('Data modules')
  const pageId = firstPageId(graph)
  const data = {
    columns: [
      {
        id: 'name',
        label: 'Name',
        type: 'text',
        align: 'start',
        width: 200,
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
        filterable: configuredFilters
      }
    ],
    rows: Array.from({ length: 12 }, (_, index) => ({
      id: 'row-' + index,
      cells: ['Item ' + index, 12 - index]
    }))
  }
  graph.createNode('FRAME', pageId, {
    ...createTableModuleFrameOverrides({
      table: {
        columns: ['Text', 'Value'],
        rows: [
          ['<img src=x onerror=alert(1)>', '中文内容'],
          ['Safe', '2']
        ]
      }
    }),
    x: 20,
    y: 20,
    width: 620,
    height: 120
  })
  for (const [index, selectionMode] of ['multiple', 'single', 'single'].entries()) {
    graph.createNode('FRAME', pageId, {
      ...createDataGridModuleFrameOverrides({
        data,
        filters: configuredFilters
          ? [{ columnId: 'score', operator: 'greater-than', value: 2 }]
          : [],
        pageSize: 10,
        showCsvTools: options.showCsvTools ?? false,
        selectionMode,
        showHeader: index !== 1
      }),
      x: 20 + index * 660,
      y: 170,
      width: 620,
      height: 620
    })
  }
  const output = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, sourceLocale: lang, router: 'none', devMode: false })
  })
  if (lifecycle) {
    if (target !== 'vue') throw new Error('Lifecycle harness requires the Vue target')
    const config = createDataGridModuleInstance({
      data,
      pageSize: 10,
      showCsvTools: options.showCsvTools ?? false,
      selectionMode: 'multiple'
    }).config
    output.files.set(
      'src/App.vue',
      `<script setup lang="ts">
import { computed, ref } from 'vue'
import DataGrid from './__openpencil_data_grid.vue'
const revision = ref(0)
const changed = ref(false)
const mounted = ref(true)
const config = computed(() => {
  // A fresh, equal config object must not erase runtime input after a host render.
  void revision.value
  const value = ${JSON.stringify(config)} as const
  return changed.value ? { ...value, data: { ...value.data, rows: [{ id: 'replacement', cells: ['Replacement', 5] }] } } : value
})
</script>
<template>
  <button type="button" @click="revision++">Rerender host</button>
  <button type="button" @click="changed = true">Replace source data</button>
  <button type="button" @click="mounted = !mounted">Toggle grid</button>
  <output aria-label="Host revision">{{ revision }}</output>
  <DataGrid v-if="mounted" :config="config" style="height:780px;width:620px" />
</template>`
    )
  }
  if (options.toolbarLifecycle) addDataGridToolbarHarness(output.files, target)
  if (options.compactLayout) addDataGridCompactHarness(output.files, target)
  return output
}
