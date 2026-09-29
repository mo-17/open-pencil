<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import type { WorkflowDef } from '@open-pencil/scene-graph'
import { usePanelMessages, useSceneComputed, useSelectionState } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { usePresenceTarget } from '@/app/editor/presence/use-presence-target'
import { clearLowcodeActionFocus, peekLowcodeActionFocus } from '@/app/lowcode/action/focus'
import { collectServerWorkflowOptions } from '@/app/lowcode/action/server-workflow-options'
import { useLowcodeEventEditor } from '@/app/lowcode/events/use'
import { flashLowcodeFocusHighlight } from '@/app/lowcode/focus-highlight'
import { collectMotionActionOptions } from '@/app/lowcode/motion-action-options'
import { useSectionUI } from '@/components/ui/section'
import AppSelect from '@/components/ui/select/AppSelect.vue'

import ActionList from './ActionList.vue'

/**
 * Phase 3 §10 v10 — the events panel is now a thin host around the recursive
 * `ActionList` / `ActionRow` editor: it selects a supported event slot,
 * the page/document state lists the rows need, and persists the whole action
 * array through undo. All per-kind editing + the nested control-flow / result
 * branches live in `ActionRow`, so the full workflow logic is visible and
 * fine-tunable at any depth (MCP remains the backstop for bulk authoring).
 */
const editor = useEditorStore()
const sectionCls = useSectionUI()
const panels = usePanelMessages()
const { selectedNode } = useSelectionState()
const presence = usePresenceTarget('events', () => selectedNode.value?.id)
const rootEl = ref<HTMLElement | null>(null)

const { availableEvents, eventName, target } = useLowcodeEventEditor(editor, selectedNode)
const eventOptions = computed(() => {
  const labels = {
    onClick: panels.value.lowcodeEventOnClick,
    onSubmit: panels.value.lowcodeEventOnSubmit,
    onChange: panels.value.lowcodeEventOnChange,
    onFocus: panels.value.lowcodeEventOnFocus,
    onBlur: panels.value.lowcodeEventOnBlur
  }
  return availableEvents.value.map((value) => ({ value, label: labels[value] }))
})
const eventLabel = computed(
  () => eventOptions.value.find((option) => option.value === eventName.value)?.label
)

const pageStates = useSceneComputed(() => {
  const page = editor.graph.getNode(editor.state.currentPageId)
  return page?.state ?? []
})

// Phase 2 §2 — `setVariable` writes a document-level Document State, declared
// on the root node.
const docStates = useSceneComputed(() => {
  const root = editor.graph.getNode(editor.graph.rootId)
  return root?.lowcodeDocumentState ?? []
})

// Phase 3 §10 v11 — named workflows live document-level on the root node; a
// `callWorkflow` action row targets one by id and passes args to its params.
const docWorkflows = useSceneComputed<WorkflowDef[]>(() => {
  const root = editor.graph.getNode(editor.graph.rootId)
  return root?.lowcodeWorkflows ?? []
})

const serverWorkflows = useSceneComputed(() => collectServerWorkflowOptions(editor.graph))

const analyticsConfigured = useSceneComputed<boolean>(() => {
  const config = editor.graph.getNode(editor.graph.rootId)?.lowcodeAnalyticsConfig
  return config?.enabled !== false && !!config?.id?.trim()
})

const motionOptions = useSceneComputed(() =>
  collectMotionActionOptions(editor.graph.getAllNodes(), { pageId: editor.state.currentPageId })
)

const actions = useSceneComputed(() => {
  const node = selectedNode.value
  const name = eventName.value
  if (!node || !name) return []
  return node.events?.[name] ?? []
})

function selectorValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&')
}

async function focusPendingActionRow(): Promise<void> {
  const pending = peekLowcodeActionFocus(editor.graph, selectedNode.value?.id)
  if (!pending) return
  const graph = editor.graph
  const event = eventName.value
  const generation = target.value?.key
  await nextTick()
  if (
    editor.graph !== graph ||
    eventName.value !== event ||
    selectedNode.value?.id !== pending.nodeId ||
    target.value?.key !== generation ||
    peekLowcodeActionFocus(editor.graph, selectedNode.value?.id) !== pending ||
    !rootEl.value?.isConnected
  )
    return
  const row = rootEl.value?.querySelector<HTMLElement>(
    `[data-lowcode-action-path="${selectorValue(pending.actionPath)}"]`
  )
  if (!row) return
  row.scrollIntoView({ block: 'nearest' })
  row.focus({ preventScroll: true })
  flashLowcodeFocusHighlight(row)
  clearLowcodeActionFocus(pending)
}

onMounted(() => {
  void focusPendingActionRow()
})

watch(
  () => [
    selectedNode.value?.id,
    eventName.value,
    actions.value.length,
    peekLowcodeActionFocus(editor.graph, selectedNode.value?.id)
  ],
  () => {
    void focusPendingActionRow()
  },
  { flush: 'post' }
)
</script>

<template>
  <div
    v-if="eventName && target"
    ref="rootEl"
    data-test-id="lowcode-events-section"
    :class="sectionCls.wrapper"
    @focusin="presence.onFocusIn"
    @focusout="presence.onFocusOut"
  >
    <AppSelect
      v-if="eventOptions.length > 1"
      v-model="eventName"
      :label="panels.lowcodeEventTrigger"
      :options="eventOptions"
      data-test-id="lowcode-event-trigger"
    />
    <p v-else class="text-[11px] text-muted">{{ eventLabel }}</p>
    <p
      v-if="eventName === 'onChange' || eventName === 'onFocus' || eventName === 'onBlur'"
      class="text-[11px] text-muted"
    >
      {{ panels.lowcodeEventValueHint({ value: '$value' }) }}
    </p>

    <p v-if="pageStates.length === 0 && actions.length === 0" class="text-[11px] text-muted">
      {{ panels.lowcodeActionNoStates }}
    </p>

    <ActionList
      :key="target.key"
      :actions="actions"
      :page-states="pageStates"
      :doc-states="docStates"
      :workflows="docWorkflows"
      :server-workflows="serverWorkflows"
      :motion-options="motionOptions"
      :analytics-configured="analyticsConfigured"
      :action-path-prefix="eventName ?? ''"
      data-test-id="lowcode-action-add"
      @update:actions="target.commit"
    />
  </div>
</template>
