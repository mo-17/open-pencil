<script setup lang="ts">
import { computed } from 'vue'

import type { BindingExpr, NodeType } from '@open-pencil/core/scene-graph'
import { useI18n, useSceneComputed, useSelectionState } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'

import { useEditorStore } from '@/app/editor/active-store'
import { usePresenceTarget } from '@/app/editor/presence/use-presence-target'

// Phase 3 §3.x + §3.v4 — controlled form-control value binding. IR collect
// only accepts `kind: 'ref'` (page-state) or `kind: 'docState'`, and per
// node type a specific target state-type set:
//   INPUT                                  → string | number
//   TEXTAREA / SELECT / RADIO / DATEPICKER → string
//   CHECKBOX / SWITCH                      → boolean
// Anything else falls back to uncontrolled emit with a warning. This panel
// mirrors those rules at the UI level so users never commit a binding the
// compiler would reject. The candidate dropdown filters page-state and
// docState by allowed type per node; numbers route through Number(...)
// on write + emit `<input type="number">` (INPUT only).

type CtrlType = 'string' | 'number' | 'boolean' | 'array'

const editor = useEditorStore()
const sectionCls = useSectionUI()
const { panels } = useI18n()
const { selectedNode } = useSelectionState()
const presence = usePresenceTarget('valueBinding', () => selectedNode.value?.id)

function checkboxHasOptions(): boolean {
  const raw = selectedNode.value?.interactiveProps?.options
  return Array.isArray(raw) && raw.length > 0
}

const allowedTypes = computed<readonly CtrlType[]>(() => {
  const t = selectedNode.value?.type as NodeType | undefined
  if (t === 'INPUT') return ['string', 'number']
  if (t === 'SWITCH') return ['boolean']
  // Phase 3 §3.v4 step 8 — CHECKBOX with options[] becomes a multi-select
  // group bound to array<string>; without options it's a single boolean.
  if (t === 'CHECKBOX') return [checkboxHasOptions() ? 'array' : 'boolean']
  return ['string']
})

const controlMode = computed<'boolean' | 'array' | 'text'>(() => {
  const t = selectedNode.value?.type
  if (t === 'SWITCH') return 'boolean'
  if (t === 'CHECKBOX') return checkboxHasOptions() ? 'array' : 'boolean'
  return 'text'
})

const candidatePageStates = useSceneComputed(() => {
  const page = editor.graph.getNode(editor.state.currentPageId)
  const allow = allowedTypes.value
  return (page?.state ?? []).filter((s) => allow.includes(s.type as CtrlType))
})

const candidateDocStates = useSceneComputed(() => {
  const root = editor.graph.getNode(editor.graph.rootId)
  const allow = allowedTypes.value
  return (root?.lowcodeDocumentState ?? []).filter((d) =>
    allow.includes(d.type as CtrlType)
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
  }
}
</script>

<template>
  <div
    data-test-id="lowcode-value-binding"
    :class="sectionCls.wrapper"
    @focusin="presence.onFocusIn"
    @focusout="presence.onFocusOut"
  >
    <label class="mb-1.5 block text-[11px] text-muted">{{ panels.lowcodeValueBinding }}</label>
    <select
      :value="selectedValue"
      :disabled="!hasAnyCandidate"
      data-test-id="lowcode-value-binding-select"
      class="w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-50"
      @change="onSourceChange"
    >
      <option value="">{{ panels.lowcodeValueBindingUncontrolled }}</option>
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
      data-test-id="lowcode-value-binding-empty"
      class="mt-1 text-[10px] text-muted"
    >
      {{ panels.lowcodeValueBindingNoStates }}
    </p>
    <p v-else class="mt-1 text-[10px] text-muted">
      {{
        controlMode === 'array'
          ? panels.lowcodeValueBindingArrayHint
          : controlMode === 'boolean'
            ? panels.lowcodeValueBindingBooleanHint
            : panels.lowcodeValueBindingHint
      }}
    </p>
  </div>
</template>
