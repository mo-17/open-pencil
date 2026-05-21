<script setup lang="ts">
import { computed } from 'vue'

import { validateStateName } from '@open-pencil/compiler'
import type { StateDef } from '@open-pencil/core/scene-graph'
import { useI18n, useSceneComputed, useSelectionState } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'

import { useEditorStore } from '@/app/editor/active-store'

const editor = useEditorStore()
const sectionCls = useSectionUI()
const { panels } = useI18n()
const { selectedNode } = useSelectionState()

interface DataSourceRef {
  kind: 'stateRef'
  stateId: string
}

interface ListInteractiveProps {
  dataSourceRef?: DataSourceRef | null
  itemName?: string
  indexName?: string
}

const arrayStates = useSceneComputed<StateDef[]>(() => {
  const page = editor.graph.getNode(editor.state.currentPageId)
  return (page?.state ?? []).filter((s) => s.type === 'array')
})

const ip = useSceneComputed<ListInteractiveProps>(
  () => (selectedNode.value?.interactiveProps ?? {}) as ListInteractiveProps
)

const selectedStateId = computed(() =>
  ip.value.dataSourceRef?.kind === 'stateRef' ? ip.value.dataSourceRef.stateId : ''
)
const itemName = computed(() => ip.value.itemName ?? 'item')
const indexName = computed(() => ip.value.indexName ?? 'index')

const itemNameError = computed(() => {
  const result = validateStateName(itemName.value)
  return result.ok ? undefined : (result.reason ?? 'invalid')
})

const indexNameError = computed(() => {
  if (indexName.value === itemName.value) return 'must differ from item name'
  const result = validateStateName(indexName.value)
  return result.ok ? undefined : (result.reason ?? 'invalid')
})

function commit(patch: Partial<ListInteractiveProps>): void {
  const node = selectedNode.value
  if (!node) return
  const merged: ListInteractiveProps = { ...ip.value, ...patch }
  editor.updateNodeWithUndo(
    node.id,
    { interactiveProps: merged as Record<string, unknown> },
    'Update list directive'
  )
}

function onSourceChange(event: Event): void {
  const id = (event.target as HTMLSelectElement).value
  commit({ dataSourceRef: id === '' ? null : { kind: 'stateRef', stateId: id } })
}

function onItemNameChange(event: Event): void {
  commit({ itemName: (event.target as HTMLInputElement).value })
}

function onIndexNameChange(event: Event): void {
  commit({ indexName: (event.target as HTMLInputElement).value })
}
</script>

<template>
  <div data-test-id="lowcode-list-section" :class="sectionCls.wrapper">
    <label class="mb-1.5 block text-[11px] text-muted">{{ panels.lowcodeList }}</label>

    <div class="flex flex-col gap-1.5">
      <div class="flex flex-col gap-0.5">
        <label class="text-[10px] text-muted">{{ panels.lowcodeListDataSource }}</label>
        <select
          :value="selectedStateId"
          :aria-label="panels.lowcodeListDataSource"
          data-test-id="lowcode-list-datasource"
          class="w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
          @change="onSourceChange"
        >
          <option value="">{{ panels.lowcodeListDataSourcePlaceholder }}</option>
          <option v-for="s in arrayStates" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <p
          v-if="arrayStates.length === 0"
          data-test-id="lowcode-list-no-arrays"
          class="pl-1 text-[10px] text-amber-500"
        >
          {{ panels.lowcodeListNoArrayStates }}
        </p>
      </div>

      <div class="flex gap-1.5">
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <label class="text-[10px] text-muted">{{ panels.lowcodeListItemName }}</label>
          <input
            :value="itemName"
            :aria-label="panels.lowcodeListItemName"
            :aria-invalid="itemNameError ? 'true' : undefined"
            data-test-id="lowcode-list-item-name"
            spellcheck="false"
            :class="[
              'w-full rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
              itemNameError ? 'border-red-500' : 'border-border'
            ]"
            @change="onItemNameChange"
          />
          <p
            v-if="itemNameError"
            data-test-id="lowcode-list-item-name-error"
            class="pl-1 text-[10px] text-red-500"
          >
            {{ itemNameError }}
          </p>
        </div>

        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <label class="text-[10px] text-muted">{{ panels.lowcodeListIndexName }}</label>
          <input
            :value="indexName"
            :aria-label="panels.lowcodeListIndexName"
            :aria-invalid="indexNameError ? 'true' : undefined"
            data-test-id="lowcode-list-index-name"
            spellcheck="false"
            :class="[
              'w-full rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
              indexNameError ? 'border-red-500' : 'border-border'
            ]"
            @change="onIndexNameChange"
          />
          <p
            v-if="indexNameError"
            data-test-id="lowcode-list-index-name-error"
            class="pl-1 text-[10px] text-red-500"
          >
            {{ indexNameError }}
          </p>
        </div>
      </div>

      <p class="pl-1 text-[10px] text-muted">{{ panels.lowcodeListTemplateHint }}</p>
    </div>
  </div>
</template>
