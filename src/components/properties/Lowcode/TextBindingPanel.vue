<script setup lang="ts">
import { computed } from 'vue'

import { validateExpression } from '@open-pencil/compiler'
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

// Source select value: '' = literal, '__expr__' = expression, otherwise = stateId
// of the bound state. Phase 2 §9 adds the expression option for LIST templates
// (item.name etc.); identifier-vs-scope validation still lives on the IR side.
const EXPR_SENTINEL = '__expr__'

const selectedValue = computed(() => {
  if (!binding.value || binding.value.kind === 'literal') return ''
  if (binding.value.kind === 'expr') return EXPR_SENTINEL
  return binding.value.stateId ?? ''
})

const exprValue = computed(() =>
  binding.value?.kind === 'expr' ? (binding.value.expr ?? '') : ''
)

const exprError = computed(() => {
  if (binding.value?.kind !== 'expr') return undefined
  const src = binding.value.expr ?? ''
  if (src === '') return undefined
  const result = validateExpression(src)
  return result.ok ? undefined : result.reason
})

function commitBinding(next: BindingExpr | undefined): void {
  const node = selectedNode.value
  if (!node) return
  const bindingsCopy = { ...node.bindings }
  if (next === undefined) delete bindingsCopy.text
  else bindingsCopy.text = next
  editor.updateNodeWithUndo(node.id, { bindings: bindingsCopy }, 'Update binding')
}

function onSourceChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (value === '') {
    commitBinding(undefined)
  } else if (value === EXPR_SENTINEL) {
    commitBinding({ kind: 'expr', expr: '' })
  } else {
    commitBinding({ kind: 'ref', stateId: value })
  }
}

function onExprChange(event: Event): void {
  const expr = (event.target as HTMLInputElement).value
  commitBinding({ kind: 'expr', expr })
}
</script>

<template>
  <div data-test-id="lowcode-text-binding" :class="sectionCls.wrapper">
    <label class="mb-1.5 block text-[11px] text-muted">{{ panels.lowcodeTextSource }}</label>
    <select
      :value="selectedValue"
      data-test-id="lowcode-text-binding-select"
      class="w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
      @change="onSourceChange"
    >
      <option value="">{{ panels.lowcodeTextSourceLiteral }}</option>
      <option v-for="s in pageStates" :key="s.id" :value="s.id">
        {{ panels.lowcodeTextSourceBound }} {{ s.name }}
      </option>
      <option :value="EXPR_SENTINEL">{{ panels.lowcodeTextSourceExpression }}</option>
    </select>

    <div v-if="binding?.kind === 'expr'" class="mt-1.5 flex flex-col gap-0.5">
      <label class="text-[10px] text-muted">{{ panels.lowcodeTextSourceExprLabel }}</label>
      <input
        :value="exprValue"
        :aria-label="panels.lowcodeTextSourceExprLabel"
        :aria-invalid="exprError ? 'true' : undefined"
        data-test-id="lowcode-text-binding-expr"
        spellcheck="false"
        :placeholder="panels.lowcodeTextSourceExprPlaceholder"
        :class="[
          'w-full rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
          exprError ? 'border-red-500' : 'border-border'
        ]"
        @change="onExprChange"
      />
      <p
        v-if="exprError"
        data-test-id="lowcode-text-binding-expr-error"
        class="pl-1 text-[10px] text-red-500"
      >
        {{ exprError }}
      </p>
    </div>
  </div>
</template>
