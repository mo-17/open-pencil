<script setup lang="ts">
import { computed } from 'vue'

import type { ActionDef, EventName, SceneNode } from '@open-pencil/core/scene-graph'
import { useI18n, useSceneComputed, useSelectionState } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'

import { useEditorStore } from '@/app/editor/active-store'

const editor = useEditorStore()
const sectionCls = useSectionUI()
const { panels } = useI18n()
const { selectedNode } = useSelectionState()

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

const actions = useSceneComputed<ActionDef[]>(() => {
  const node = selectedNode.value
  const name = eventName.value
  if (!node || !name) return []
  return node.events?.[name] ?? []
})

function commitActions(node: SceneNode, name: EventName, next: ActionDef[]): void {
  const eventsCopy = { ...node.events }
  if (next.length === 0) {
    delete eventsCopy[name]
  } else {
    eventsCopy[name] = next
  }
  editor.updateNodeWithUndo(node.id, { events: eventsCopy }, 'Update events')
}

function addAction(): void {
  const node = selectedNode.value
  const name = eventName.value
  if (!node || !name) return
  const target = pageStates.value[0]
  const def: ActionDef = {
    id: crypto.randomUUID(),
    kind: 'setState',
    targetStateId: target?.id,
    valueExpr: target ? `${target.name} + 1` : ''
  }
  commitActions(node, name, [...actions.value, def])
}

function removeAction(id: string): void {
  const node = selectedNode.value
  const name = eventName.value
  if (!node || !name) return
  commitActions(
    node,
    name,
    actions.value.filter((a) => a.id !== id)
  )
}

function setTarget(id: string, targetStateId: string): void {
  const node = selectedNode.value
  const name = eventName.value
  if (!node || !name) return
  commitActions(
    node,
    name,
    actions.value.map((a) => (a.id === id ? { ...a, targetStateId } : a))
  )
}

function setExpr(id: string, valueExpr: string): void {
  const node = selectedNode.value
  const name = eventName.value
  if (!node || !name) return
  commitActions(
    node,
    name,
    actions.value.map((a) => (a.id === id ? { ...a, valueExpr } : a))
  )
}
</script>

<template>
  <div
    v-if="eventName"
    data-test-id="lowcode-events-section"
    :class="sectionCls.wrapper"
  >
    <div class="mb-1.5 flex items-center justify-between">
      <label class="text-[11px] text-muted">{{ eventLabel }}</label>
      <button
        type="button"
        data-test-id="lowcode-action-add"
        class="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
        @click="addAction"
      >
        + {{ panels.lowcodeActionAdd }}
      </button>
    </div>

    <p
      v-if="pageStates.length === 0"
      class="text-[11px] text-muted"
    >
      {{ panels.lowcodeActionNoStates }}
    </p>

    <ul v-else-if="actions.length > 0" class="flex flex-col gap-1.5">
      <li
        v-for="action in actions"
        :key="action.id"
        data-test-id="lowcode-action-row"
        class="flex items-center gap-1"
      >
        <span class="text-[11px] text-muted">{{ panels.lowcodeActionSet }}</span>
        <select
          :value="action.targetStateId ?? ''"
          :aria-label="panels.lowcodeActionSet"
          data-test-id="lowcode-action-target"
          class="rounded border border-border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent"
          @change="setTarget(action.id, ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="s in pageStates" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <span class="text-[11px] text-muted">=</span>
        <input
          :value="action.valueExpr ?? ''"
          :aria-label="panels.lowcodeActionValue"
          data-test-id="lowcode-action-expr"
          spellcheck="false"
          class="min-w-0 flex-1 rounded border border-border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent"
          @change="setExpr(action.id, ($event.target as HTMLInputElement).value)"
        />
        <button
          type="button"
          data-test-id="lowcode-action-remove"
          class="rounded p-1 text-muted hover:bg-hover hover:text-surface"
          @click="removeAction(action.id)"
        >
          <icon-lucide-x class="size-3" />
        </button>
      </li>
    </ul>
  </div>
</template>
