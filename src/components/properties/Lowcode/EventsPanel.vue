<script setup lang="ts">
import { computed } from 'vue'

import { validateExpression } from '@open-pencil/compiler'
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

// Phase 1 §7.3 — mirror what the IR collect pass rejects
// (`collect/bindings.ts` → `resolveActions`). Two failure modes can ride on
// the same action row, so each entry holds both slots independently.
interface ActionErrors {
  target?: string
  expr?: string
}

const validStateIds = computed(() => new Set(pageStates.value.map((s) => s.id)))

const actionErrors = computed(() => {
  const errors = new Map<string, ActionErrors>()
  for (const action of actions.value) {
    const e: ActionErrors = {}
    if (!action.targetStateId) {
      e.target = 'target required'
    } else if (!validStateIds.value.has(action.targetStateId)) {
      e.target = 'state no longer exists'
    }
    const exprResult = validateExpression(action.valueExpr ?? '')
    if (!exprResult.ok) e.expr = exprResult.reason
    if (e.target !== undefined || e.expr !== undefined) errors.set(action.id, e)
  }
  return errors
})
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
        class="flex flex-col gap-0.5"
      >
        <div class="flex items-center gap-1">
        <span class="text-[11px] text-muted">{{ panels.lowcodeActionSet }}</span>
        <select
          :value="action.targetStateId ?? ''"
          :aria-label="panels.lowcodeActionSet"
          :aria-invalid="actionErrors.get(action.id)?.target ? 'true' : undefined"
          data-test-id="lowcode-action-target"
          :class="[
            'rounded border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent',
            actionErrors.get(action.id)?.target ? 'border-red-500' : 'border-border'
          ]"
          @change="setTarget(action.id, ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="s in pageStates" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <span class="text-[11px] text-muted">=</span>
        <input
          :value="action.valueExpr ?? ''"
          :aria-label="panels.lowcodeActionValue"
          :aria-invalid="actionErrors.get(action.id)?.expr ? 'true' : undefined"
          data-test-id="lowcode-action-expr"
          spellcheck="false"
          :class="[
            'min-w-0 flex-1 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
            actionErrors.get(action.id)?.expr ? 'border-red-500' : 'border-border'
          ]"
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
        </div>
        <p
          v-if="actionErrors.get(action.id)?.target"
          data-test-id="lowcode-action-target-error"
          class="pl-1 text-[10px] text-red-500"
        >
          target: {{ actionErrors.get(action.id)?.target }}
        </p>
        <p
          v-if="actionErrors.get(action.id)?.expr"
          data-test-id="lowcode-action-expr-error"
          class="pl-1 text-[10px] text-red-500"
        >
          expression: {{ actionErrors.get(action.id)?.expr }}
        </p>
      </li>
    </ul>
  </div>
</template>
