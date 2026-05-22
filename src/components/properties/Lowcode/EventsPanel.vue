<script setup lang="ts">
import { computed } from 'vue'

import { validateExpression } from '@open-pencil/compiler'
import type {
  ActionDef,
  ActionKind,
  EventName,
  SceneNode
} from '@open-pencil/core/scene-graph'
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

// Phase 2 §2 — `setVariable` writes a document-level Document State, declared
// on the root node. The dropdown lists these by name; empty → "no document
// state". The `setVariable` action *kind* literal stays (§7.4 lock); only the
// editor label reads "Set Document State".
const docStates = useSceneComputed(() => {
  const root = editor.graph.getNode(editor.graph.rootId)
  return root?.lowcodeDocumentState ?? []
})

const actions = useSceneComputed<ActionDef[]>(() => {
  const node = selectedNode.value
  const name = eventName.value
  if (!node || !name) return []
  return node.events?.[name] ?? []
})

const ACTION_KINDS: ActionKind[] = ['setState', 'navigate', 'setVariable']

// The `setVariable` kind literal is locked (§7.4 + old .fig compat); only its
// editor-facing label differs.
function actionKindLabel(kind: ActionKind): string {
  return kind === 'setVariable' ? panels.value.lowcodeActionSetDocument : kind
}

function commitActions(node: SceneNode, name: EventName, next: ActionDef[]): void {
  const eventsCopy = { ...node.events }
  if (next.length === 0) {
    delete eventsCopy[name]
  } else {
    eventsCopy[name] = next
  }
  editor.updateNodeWithUndo(node.id, { events: eventsCopy }, 'Update events')
}

// Phase 1 §7.4: factory per kind. Switching kinds discards the previous
// kind's fields so the discriminated union invariant holds.
function makeAction(kind: ActionKind, id: string): ActionDef {
  if (kind === 'setState') {
    const target = pageStates.value[0]
    return {
      id,
      kind: 'setState',
      targetStateId: target?.id,
      valueExpr: target ? `${target.name} + 1` : ''
    }
  }
  if (kind === 'navigate') {
    return { id, kind: 'navigate', to: '/' }
  }
  const docTarget = docStates.value[0]
  return {
    id,
    kind: 'setVariable',
    targetName: docTarget?.name ?? '',
    valueExpr: docTarget ? '$prev + 1' : ''
  }
}

function addAction(): void {
  const node = selectedNode.value
  const name = eventName.value
  if (!node || !name) return
  commitActions(node, name, [...actions.value, makeAction('setState', crypto.randomUUID())])
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

function updateAction(id: string, patch: Partial<ActionDef>): void {
  const node = selectedNode.value
  const name = eventName.value
  if (!node || !name) return
  commitActions(
    node,
    name,
    actions.value.map((a) => {
      if (a.id !== id) return a
      return { ...a, ...patch } as ActionDef
    })
  )
}

function changeKind(id: string, kind: ActionKind): void {
  const node = selectedNode.value
  const name = eventName.value
  if (!node || !name) return
  commitActions(
    node,
    name,
    actions.value.map((a) => (a.id === id ? makeAction(kind, a.id) : a))
  )
}

// Phase 1 §7.3 + §7.4 — mirror what the IR collect pass rejects
// (`collect/bindings.ts` → `resolveActions`). Each kind has its own slots;
// every slot is independent so we can show two reds on the same row.
interface ActionErrors {
  target?: string
  expr?: string
  to?: string
}

const validStateIds = computed(() => new Set(pageStates.value.map((s) => s.id)))
const validDocStateNames = computed(() => new Set(docStates.value.map((d) => d.name)))

const actionErrors = computed(() => {
  const errors = new Map<string, ActionErrors>()
  for (const action of actions.value) {
    const e: ActionErrors = {}
    if (action.kind === 'setState') {
      if (!action.targetStateId) e.target = 'target required'
      else if (!validStateIds.value.has(action.targetStateId))
        e.target = 'state no longer exists'
      const exprResult = validateExpression(action.valueExpr ?? '')
      if (!exprResult.ok) e.expr = exprResult.reason
    } else if (action.kind === 'navigate') {
      if (!action.to || action.to.trim() === '') e.to = 'path required'
    } else if (action.kind === 'setVariable') {
      // §2.5 #i — `targetName` must resolve to a declared Document State.
      // `valueExpr` accepts the §7.3 sub-language; `$prev` is a legal token
      // (parses as a `$`-prefixed identifier post step 1).
      if (!action.targetName || action.targetName.trim() === '') e.target = 'target required'
      else if (!validDocStateNames.value.has(action.targetName))
        e.target = 'document state no longer exists'
      const exprResult = validateExpression(action.valueExpr ?? '')
      if (!exprResult.ok) e.expr = exprResult.reason
    }
    if (Object.keys(e).length > 0) errors.set(action.id, e)
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
      v-if="pageStates.length === 0 && actions.length === 0"
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
          <select
            :value="action.kind"
            aria-label="Action kind"
            data-test-id="lowcode-action-kind"
            class="rounded border border-border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent"
            @change="changeKind(action.id, ($event.target as HTMLSelectElement).value as ActionKind)"
          >
            <option v-for="k in ACTION_KINDS" :key="k" :value="k">{{ actionKindLabel(k) }}</option>
          </select>

          <template v-if="action.kind === 'setState'">
            <select
              :value="action.targetStateId ?? ''"
              :aria-label="panels.lowcodeActionSet"
              :aria-invalid="actionErrors.get(action.id)?.target ? 'true' : undefined"
              data-test-id="lowcode-action-target"
              :class="[
                'rounded border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent',
                actionErrors.get(action.id)?.target ? 'border-red-500' : 'border-border'
              ]"
              @change="updateAction(action.id, { targetStateId: ($event.target as HTMLSelectElement).value })"
            >
              <option v-if="pageStates.length === 0" value="" disabled>no state</option>
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
              @change="updateAction(action.id, { valueExpr: ($event.target as HTMLInputElement).value })"
            />
          </template>

          <template v-else-if="action.kind === 'navigate'">
            <span class="text-[11px] text-muted">to</span>
            <input
              :value="action.to ?? ''"
              aria-label="Route path"
              :aria-invalid="actionErrors.get(action.id)?.to ? 'true' : undefined"
              data-test-id="lowcode-action-to"
              spellcheck="false"
              placeholder="/about"
              :class="[
                'min-w-0 flex-1 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
                actionErrors.get(action.id)?.to ? 'border-red-500' : 'border-border'
              ]"
              @change="updateAction(action.id, { to: ($event.target as HTMLInputElement).value })"
            />
          </template>

          <template v-else-if="action.kind === 'setVariable'">
            <select
              :value="action.targetName ?? ''"
              :aria-label="panels.lowcodeActionSet"
              :aria-invalid="actionErrors.get(action.id)?.target ? 'true' : undefined"
              data-test-id="lowcode-action-variable-name"
              :class="[
                'rounded border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent',
                actionErrors.get(action.id)?.target ? 'border-red-500' : 'border-border'
              ]"
              @change="updateAction(action.id, { targetName: ($event.target as HTMLSelectElement).value })"
            >
              <option v-if="docStates.length === 0" value="" disabled>
                {{ panels.lowcodeActionNoDocumentState }}
              </option>
              <option v-for="d in docStates" :key="d.id" :value="d.name">{{ d.name }}</option>
            </select>
            <span class="text-[11px] text-muted">=</span>
            <input
              :value="action.valueExpr ?? ''"
              :aria-label="panels.lowcodeActionValue"
              :aria-invalid="actionErrors.get(action.id)?.expr ? 'true' : undefined"
              data-test-id="lowcode-action-variable-expr"
              spellcheck="false"
              :class="[
                'min-w-0 flex-1 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
                actionErrors.get(action.id)?.expr ? 'border-red-500' : 'border-border'
              ]"
              @change="updateAction(action.id, { valueExpr: ($event.target as HTMLInputElement).value })"
            />
          </template>

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
        <p
          v-if="actionErrors.get(action.id)?.to"
          data-test-id="lowcode-action-to-error"
          class="pl-1 text-[10px] text-red-500"
        >
          to: {{ actionErrors.get(action.id)?.to }}
        </p>
      </li>
    </ul>
  </div>
</template>
