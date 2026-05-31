<script setup lang="ts">
import { computed } from 'vue'

import { validateExpression } from '@open-pencil/core/lowcode-validation'
import { useI18n, useSceneComputed, useSelectionState } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'

import { useEditorStore } from '@/app/editor/active-store'
import { usePresenceTarget } from '@/app/editor/presence/use-presence-target'

const editor = useEditorStore()
const sectionCls = useSectionUI()
const { panels } = useI18n()
const { selectedNode } = useSelectionState()
const presence = usePresenceTarget('renderCondition', () => selectedNode.value?.id)

const renderCondition = useSceneComputed<string>(() => selectedNode.value?.renderCondition ?? '')

// Mirror the IR collect-side §9.2 #8 check so the parse failure surfaces
// inline; identifier-vs-state validation stays on the IR side (the panel
// can't see the LIST inScope set the source node lives in).
const exprError = computed(() => {
  if (renderCondition.value === '') return undefined
  const result = validateExpression(renderCondition.value)
  return result.ok ? undefined : result.reason
})

function onChange(event: Event): void {
  const node = selectedNode.value
  if (!node) return
  const value = (event.target as HTMLInputElement).value
  editor.updateNodeWithUndo(
    node.id,
    { renderCondition: value === '' ? undefined : value },
    'Update render condition'
  )
}
</script>

<template>
  <div
    data-test-id="lowcode-render-condition"
    :class="sectionCls.wrapper"
    @focusin="presence.onFocusIn"
    @focusout="presence.onFocusOut"
  >
    <label class="mb-1.5 block text-[11px] text-muted">{{ panels.lowcodeRenderCondition }}</label>
    <input
      :value="renderCondition"
      :aria-label="panels.lowcodeRenderCondition"
      :aria-invalid="exprError ? 'true' : undefined"
      data-test-id="lowcode-render-condition-input"
      spellcheck="false"
      :placeholder="panels.lowcodeRenderConditionPlaceholder"
      :class="[
        'w-full rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
        exprError ? 'border-red-500' : 'border-border'
      ]"
      @change="onChange"
    />
    <p
      v-if="exprError"
      data-test-id="lowcode-render-condition-error"
      class="mt-1 pl-1 text-[10px] text-red-500"
    >
      {{ exprError }}
    </p>
    <p v-else class="mt-1 pl-1 text-[10px] text-muted">{{ panels.lowcodeRenderConditionHint }}</p>
  </div>
</template>
