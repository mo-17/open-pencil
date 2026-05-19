<script setup lang="ts">
import { computed } from 'vue'

import type { BindingExpr } from '@open-pencil/core/scene-graph'
import { useI18n, useSceneComputed, useSelectionState } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'

import { useEditorStore } from '@/app/editor/active-store'

const editor = useEditorStore()
const sectionCls = useSectionUI()
const { panels } = useI18n()
const { selectedNode } = useSelectionState()

const pageStates = useSceneComputed(() => {
  const page = editor.graph.getNode(editor.state.currentPageId)
  return page?.state ?? []
})

const binding = useSceneComputed<BindingExpr | undefined>(() => selectedNode.value?.bindings?.text)

// Empty string === literal mode; non-empty string === bound to that stateId.
const selectedValue = computed(() => {
  if (!binding.value || binding.value.kind === 'literal') return ''
  return binding.value.stateId ?? ''
})

function onChange(event: Event): void {
  const node = selectedNode.value
  if (!node) return
  const value = (event.target as HTMLSelectElement).value
  const bindingsCopy = { ...node.bindings }
  if (value === '') {
    delete bindingsCopy.text
  } else {
    bindingsCopy.text = { kind: 'ref', stateId: value }
  }
  editor.updateNodeWithUndo(node.id, { bindings: bindingsCopy }, 'Update binding')
}
</script>

<template>
  <div data-test-id="lowcode-text-binding" :class="sectionCls.wrapper">
    <label class="mb-1.5 block text-[11px] text-muted">{{ panels.lowcodeTextSource }}</label>
    <select
      :value="selectedValue"
      data-test-id="lowcode-text-binding-select"
      class="w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
      @change="onChange"
    >
      <option value="">{{ panels.lowcodeTextSourceLiteral }}</option>
      <option v-for="s in pageStates" :key="s.id" :value="s.id">
        {{ panels.lowcodeTextSourceBound }} {{ s.name }}
      </option>
    </select>
  </div>
</template>
