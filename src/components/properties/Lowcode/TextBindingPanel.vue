<script setup lang="ts">
import { computed } from 'vue'

import { validateExpression } from '@open-pencil/core/lowcode-validation'
import type { BindingExpr } from '@open-pencil/core/scene-graph'
import type { JsonObject } from '@open-pencil/core/types'
import { useI18n, useSceneComputed, useSelectionState } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'

import { useEditorStore } from '@/app/editor/active-store'
import { usePresenceTarget } from '@/app/editor/presence/use-presence-target'

const editor = useEditorStore()
const sectionCls = useSectionUI()
const { panels } = useI18n()
const { selectedNode } = useSelectionState()
const presence = usePresenceTarget('textBinding', () => selectedNode.value?.id)

const pageStates = useSceneComputed(() => {
  const page = editor.graph.getNode(editor.state.currentPageId)
  return page?.state ?? []
})

// Phase 2 §2 — document-level Document State, declared on the root node.
// Read here via `BindingExpr.kind:'docState'` (a separate track from page
// state `kind:'ref'`).
const docStates = useSceneComputed(() => {
  const root = editor.graph.getNode(editor.graph.rootId)
  return root?.lowcodeDocumentState ?? []
})

const binding = useSceneComputed<BindingExpr | undefined>(() => selectedNode.value?.bindings?.text)

// Source select value: '' = literal, '__expr__' = expression,
// '__docState__' = Document State, otherwise = stateId of the bound page
// state. Phase 2 §9 added the expression option for LIST templates;
// Phase 2 §2 adds Document State. Identifier-vs-scope validation still
// lives on the IR side.
const EXPR_SENTINEL = '__expr__'
const DOCSTATE_SENTINEL = '__docState__'

const selectedValue = computed(() => {
  if (!binding.value || binding.value.kind === 'literal') return ''
  if (binding.value.kind === 'expr') return EXPR_SENTINEL
  if (binding.value.kind === 'docState') return DOCSTATE_SENTINEL
  return binding.value.stateId ?? ''
})

const exprValue = computed(() => (binding.value?.kind === 'expr' ? (binding.value.expr ?? '') : ''))

const exprError = computed(() => {
  if (binding.value?.kind !== 'expr') return undefined
  const src = binding.value.expr ?? ''
  if (src === '') return undefined
  const result = validateExpression(src)
  return result.ok ? undefined : result.reason
})

const docStateName = computed(() =>
  binding.value?.kind === 'docState' ? (binding.value.docStateName ?? '') : ''
)

// Phase 3 §3.v3 — BUTTON `interactiveProps.text` literal editor.
//
// `applyButtonProps` in the compiler tree walker reads `interactiveProps.text`
// only when no `bindings.text` is set; otherwise the binding wins. So this
// input is the manual fallback for users who don't want to wire a state at
// all — currently the ONLY way to change a BUTTON's static label without
// going through AI / CLI (§3.v2 ACK #1 user feedback).
//
// TEXT nodes intentionally don't get this input: their text lives on
// `node.characters` and is edited via canvas double-click, not Properties.
const isButton = computed(() => selectedNode.value?.type === 'BUTTON')
const inLiteralMode = computed(() => !binding.value || binding.value.kind === 'literal')
const buttonLiteralText = computed(() => {
  const ip = selectedNode.value?.interactiveProps
  return typeof ip?.text === 'string' ? (ip.text as string) : ''
})

function commitBinding(next: BindingExpr | undefined): void {
  const node = selectedNode.value
  if (!node) return
  const bindingsCopy = { ...node.bindings }
  if (next === undefined) delete bindingsCopy.text
  else bindingsCopy.text = next
  editor.updateNodeWithUndo(node.id, { bindings: bindingsCopy }, 'Update binding')
}

function onButtonTextChange(event: Event): void {
  const node = selectedNode.value
  if (!node) return
  const next = (event.target as HTMLInputElement).value
  const ipPrev = (node.interactiveProps ?? {}) as JsonObject
  // Empty input clears the field → emit falls back to default 'Button' literal.
  // Aligns with §3.2 "set null/undefined to clear" semantics.
  const ipNext: Record<string, unknown> = { ...ipPrev }
  if (next === '') delete ipNext.text
  else ipNext.text = next
  editor.updateNodeWithUndo(node.id, { interactiveProps: ipNext }, 'Update button text')
}

function onSourceChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (value === '') {
    commitBinding(undefined)
  } else if (value === EXPR_SENTINEL) {
    commitBinding({ kind: 'expr', expr: '' })
  } else if (value === DOCSTATE_SENTINEL) {
    commitBinding({ kind: 'docState', docStateName: docStates.value[0]?.name ?? '' })
  } else {
    commitBinding({ kind: 'ref', stateId: value })
  }
}

function onExprChange(event: Event): void {
  const expr = (event.target as HTMLInputElement).value
  commitBinding({ kind: 'expr', expr })
}

function onDocStateChange(event: Event): void {
  const name = (event.target as HTMLSelectElement).value
  commitBinding({ kind: 'docState', docStateName: name })
}
</script>

<template>
  <div
    data-test-id="lowcode-text-binding"
    :class="sectionCls.wrapper"
    @focusin="presence.onFocusIn"
    @focusout="presence.onFocusOut"
  >
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
      <option :value="DOCSTATE_SENTINEL">{{ panels.lowcodeTextSourceDocState }}</option>
      <option :value="EXPR_SENTINEL">{{ panels.lowcodeTextSourceExpression }}</option>
    </select>

    <div v-if="isButton && inLiteralMode" class="mt-1.5 flex flex-col gap-0.5">
      <label class="text-[10px] text-muted">{{ panels.lowcodeButtonText }}</label>
      <input
        :value="buttonLiteralText"
        :aria-label="panels.lowcodeButtonText"
        data-test-id="lowcode-button-interactive-text"
        spellcheck="false"
        :placeholder="panels.lowcodeButtonTextPlaceholder"
        class="w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
        @change="onButtonTextChange"
      />
    </div>

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

    <div v-else-if="binding?.kind === 'docState'" class="mt-1.5 flex flex-col gap-0.5">
      <label class="text-[10px] text-muted">{{ panels.lowcodeTextSourceDocState }}</label>
      <select
        :value="docStateName"
        :aria-label="panels.lowcodeTextSourceDocState"
        data-test-id="lowcode-text-binding-docstate"
        class="w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
        @change="onDocStateChange"
      >
        <option v-if="docStates.length === 0" value="" disabled>
          {{ panels.lowcodeActionNoDocumentState }}
        </option>
        <option v-for="d in docStates" :key="d.id" :value="d.name">{{ d.name }}</option>
      </select>
    </div>
  </div>
</template>
