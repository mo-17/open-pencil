<script setup lang="ts">
import { computed } from 'vue'

import type { ActionDef, EventName, SceneNode, WorkflowDef } from '@open-pencil/core/scene-graph'
import { useI18n, useSceneComputed, useSelectionState } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'

import { useEditorStore } from '@/app/editor/active-store'
import { usePresenceTarget } from '@/app/editor/presence/use-presence-target'

import ActionList from './ActionList.vue'

/**
 * Phase 3 §10 v10 — the events panel is now a thin host around the recursive
 * `ActionList` / `ActionRow` editor: it resolves the node's single event slot,
 * the page/document state lists the rows need, and persists the whole action
 * array through undo. All per-kind editing + the nested control-flow / result
 * branches live in `ActionRow`, so the full workflow logic is visible and
 * fine-tunable at any depth (MCP remains the backstop for bulk authoring).
 */
const editor = useEditorStore()
const sectionCls = useSectionUI()
const { panels } = useI18n()
const { selectedNode } = useSelectionState()
const presence = usePresenceTarget('events', () => selectedNode.value?.id)

// Phase 0 surfaces exactly one event slot per supported node type:
//   BUTTON → onClick, FORM → onSubmit. Other interactive types come later.
const eventName = computed<EventName | null>(() => {
  const type = selectedNode.value?.type
  if (type === 'BUTTON') return 'onClick'
  if (type === 'FORM') return 'onSubmit'
  return null
})

const eventLabel = computed(() => {
  if (eventName.value === 'onClick') return panels.value.lowcodeEventOnClick
  if (eventName.value === 'onSubmit') return panels.value.lowcodeEventOnSubmit
  return ''
})

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

const actions = useSceneComputed<ActionDef[]>(() => {
  const node = selectedNode.value
  const name = eventName.value
  if (!node || !name) return []
  return node.events?.[name] ?? []
})

function commitActions(next: ActionDef[]): void {
  const node = selectedNode.value
  const name = eventName.value
  if (!node || !name) return
  const eventsCopy: SceneNode['events'] = { ...node.events }
  if (next.length === 0) {
    Reflect.deleteProperty(eventsCopy, name)
  } else {
    eventsCopy[name] = next
  }
  editor.updateNodeWithUndo(node.id, { events: eventsCopy }, 'Update events')
}
</script>

<template>
  <div
    v-if="eventName"
    data-test-id="lowcode-events-section"
    :class="sectionCls.wrapper"
    @focusin="presence.onFocusIn"
    @focusout="presence.onFocusOut"
  >
    <div class="mb-1.5 flex items-center justify-between">
      <label class="text-[11px] text-muted">{{ eventLabel }}</label>
    </div>

    <p v-if="pageStates.length === 0 && actions.length === 0" class="text-[11px] text-muted">
      {{ panels.lowcodeActionNoStates }}
    </p>

    <ActionList
      :actions="actions"
      :page-states="pageStates"
      :doc-states="docStates"
      :workflows="docWorkflows"
      add-test-id="lowcode-action-add"
      @update:actions="commitActions"
    />
  </div>
</template>
