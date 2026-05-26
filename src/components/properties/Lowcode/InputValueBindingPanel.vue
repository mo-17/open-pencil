<script setup lang="ts">
import { computed } from 'vue'

import type { BindingExpr } from '@open-pencil/core/scene-graph'
import { useI18n, useSceneComputed, useSelectionState } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'

import { useEditorStore } from '@/app/editor/active-store'

// Phase 3 §3.x — controlled INPUT value binding. The IR collect step accepts
// only `kind: 'ref'` (page-state) or `kind: 'docState'`, and only when the
// target state is `type: 'string'` or `'number'` — anything else falls back
// to the uncontrolled emit path with a warning. This panel mirrors those
// rules at the UI level so users never commit a binding the compiler would
// reject. Numbers route through `Number(e.target.value)` on write + emit
// `<input type="number">`; strings pass through.

const editor = useEditorStore()
const sectionCls = useSectionUI()
const { panels } = useI18n()
const { selectedNode } = useSelectionState()

const candidatePageStates = useSceneComputed(() => {
  const page = editor.graph.getNode(editor.state.currentPageId)
  return (page?.state ?? []).filter((s) => s.type === 'string' || s.type === 'number')
})

const candidateDocStates = useSceneComputed(() => {
  const root = editor.graph.getNode(editor.graph.rootId)
  return (root?.lowcodeDocumentState ?? []).filter(
    (d) => d.type === 'string' || d.type === 'number'
  )
})

const binding = useSceneComputed<BindingExpr | undefined>(
  () => selectedNode.value?.bindings?.value
)

const DOCSTATE_PREFIX = 'doc:'
const STATE_PREFIX = 'state:'

const selectedValue = computed(() => {
  if (!binding.value) return ''
  if (binding.value.kind === 'docState' && binding.value.docStateName) {
    return `${DOCSTATE_PREFIX}${binding.value.docStateName}`
  }
  if (binding.value.kind === 'ref' && binding.value.stateId) {
    return `${STATE_PREFIX}${binding.value.stateId}`
  }
  return ''
})

const hasAnyCandidate = computed(
  () => candidatePageStates.value.length > 0 || candidateDocStates.value.length > 0
)

function commitBinding(next: BindingExpr | undefined): void {
  const node = selectedNode.value
  if (!node) return
  const bindingsCopy = { ...node.bindings }
  if (next === undefined) delete bindingsCopy.value
  else bindingsCopy.value = next
  editor.updateNodeWithUndo(node.id, { bindings: bindingsCopy }, 'Update value binding')
}

function onSourceChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (value === '') {
    commitBinding(undefined)
    return
  }
  if (value.startsWith(DOCSTATE_PREFIX)) {
    commitBinding({ kind: 'docState', docStateName: value.slice(DOCSTATE_PREFIX.length) })
    return
  }
  if (value.startsWith(STATE_PREFIX)) {
    commitBinding({ kind: 'ref', stateId: value.slice(STATE_PREFIX.length) })
    return
  }
}
</script>

<template>
  <div data-test-id="lowcode-input-value-binding" :class="sectionCls.wrapper">
    <label class="mb-1.5 block text-[11px] text-muted">{{ panels.lowcodeInputValue }}</label>
    <select
      :value="selectedValue"
      :disabled="!hasAnyCandidate"
      data-test-id="lowcode-input-value-binding-select"
      class="w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-50"
      @change="onSourceChange"
    >
      <option value="">{{ panels.lowcodeInputValueUncontrolled }}</option>
      <option
        v-for="s in candidatePageStates"
        :key="s.id"
        :value="`${STATE_PREFIX}${s.id}`"
      >
        {{ panels.lowcodeTextSourceBound }} {{ s.name }} ({{ s.type }})
      </option>
      <option
        v-for="d in candidateDocStates"
        :key="d.id"
        :value="`${DOCSTATE_PREFIX}${d.name}`"
      >
        {{ panels.lowcodeTextSourceDocState }}: {{ d.name }} ({{ d.type }})
      </option>
    </select>
    <p
      v-if="!hasAnyCandidate"
      data-test-id="lowcode-input-value-binding-empty"
      class="mt-1 text-[10px] text-muted"
    >
      {{ panels.lowcodeInputValueNoStringStates }}
    </p>
    <p v-else class="mt-1 text-[10px] text-muted">
      {{ panels.lowcodeInputValueHint }}
    </p>
  </div>
</template>
