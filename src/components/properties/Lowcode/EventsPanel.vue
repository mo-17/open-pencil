<script setup lang="ts">
import { computed } from 'vue'

import { validateExpression, validateUrlTemplate } from '@open-pencil/compiler'
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

const ACTION_KINDS: ActionKind[] = ['setState', 'navigate', 'setVariable', 'apiCall']

const API_METHODS = ['GET', 'POST'] as const

// `setVariable` / `apiCall` kind literals are locked (§7.4 + old .fig
// compat); only their editor-facing labels differ.
function actionKindLabel(kind: ActionKind): string {
  if (kind === 'setVariable') return panels.value.lowcodeActionSetDocument
  if (kind === 'apiCall') return panels.value.lowcodeActionCallApi
  return kind
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
  if (kind === 'setVariable') {
    return {
      id,
      kind: 'setVariable',
      targetName: docTarget?.name ?? '',
      valueExpr: docTarget ? '$prev + 1' : ''
    }
  }
  return {
    id,
    kind: 'apiCall',
    method: 'GET',
    url: '',
    targetName: docTarget?.name ?? ''
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
  url?: string
  body?: string
}

const validStateIds = computed(() => new Set(pageStates.value.map((s) => s.id)))
const validDocStateNames = computed(() => new Set(docStates.value.map((d) => d.name)))

// One validator per kind so `actionErrors` stays a thin dispatch — each
// mirrors the matching `resolveActions` branch in `collect/bindings.ts`.
function setStateErrors(action: Extract<ActionDef, { kind: 'setState' }>): ActionErrors {
  const e: ActionErrors = {}
  if (!action.targetStateId) e.target = 'target required'
  else if (!validStateIds.value.has(action.targetStateId))
    e.target = 'state no longer exists'
  const result = validateExpression(action.valueExpr ?? '')
  if (!result.ok) e.expr = result.reason
  return e
}

function setVariableErrors(action: Extract<ActionDef, { kind: 'setVariable' }>): ActionErrors {
  // §2.5 #i — `targetName` must resolve to a declared Document State.
  // `valueExpr` accepts the §7.3 sub-language; `$prev` is a legal token.
  const e: ActionErrors = {}
  if (!action.targetName || action.targetName.trim() === '') e.target = 'target required'
  else if (!validDocStateNames.value.has(action.targetName))
    e.target = 'document state no longer exists'
  const result = validateExpression(action.valueExpr ?? '')
  if (!result.ok) e.expr = result.reason
  return e
}

function apiCallErrors(action: Extract<ActionDef, { kind: 'apiCall' }>): ActionErrors {
  // §3.2 #1/#3 + §4 — mirror `resolveApiCall`: the URL is a non-empty `${}`
  // template that parses, the target resolves to a docState, and (POST only)
  // the body parses as JSON.
  const e: ActionErrors = {}
  const urlResult = validateUrlTemplate(action.url)
  if (!urlResult.ok) e.url = urlResult.reason
  if (action.targetName.trim() === '') e.target = 'target required'
  else if (!validDocStateNames.value.has(action.targetName))
    e.target = 'document state no longer exists'
  if (action.method === 'POST') {
    const raw = (action.bodyJson ?? '').trim()
    if (raw !== '') {
      try {
        JSON.parse(raw)
      } catch (err) {
        e.body = err instanceof Error ? err.message : String(err)
      }
    }
  }
  return e
}

function errorsFor(action: ActionDef): ActionErrors {
  if (action.kind === 'setState') return setStateErrors(action)
  if (action.kind === 'navigate') {
    return !action.to || action.to.trim() === '' ? { to: 'path required' } : {}
  }
  if (action.kind === 'setVariable') return setVariableErrors(action)
  return apiCallErrors(action)
}

const actionErrors = computed(() => {
  const errors = new Map<string, ActionErrors>()
  for (const action of actions.value) {
    const e = errorsFor(action)
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

          <template v-else-if="action.kind === 'apiCall'">
            <select
              :value="action.method"
              :aria-label="panels.lowcodeActionApiMethod"
              data-test-id="lowcode-action-api-method"
              class="rounded border border-border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent"
              @change="updateAction(action.id, { method: ($event.target as HTMLSelectElement).value as 'GET' | 'POST' })"
            >
              <option v-for="m in API_METHODS" :key="m" :value="m">{{ m }}</option>
            </select>
            <input
              :value="action.url"
              :aria-label="panels.lowcodeActionApiUrl"
              :aria-invalid="actionErrors.get(action.id)?.url ? 'true' : undefined"
              data-test-id="lowcode-action-api-url"
              spellcheck="false"
              placeholder="https://api.example.com/users"
              :class="[
                'min-w-0 flex-1 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
                actionErrors.get(action.id)?.url ? 'border-red-500' : 'border-border'
              ]"
              @change="updateAction(action.id, { url: ($event.target as HTMLInputElement).value })"
            />
            <span class="text-[11px] text-muted">→</span>
            <select
              :value="action.targetName"
              :aria-label="panels.lowcodeActionApiTarget"
              :aria-invalid="actionErrors.get(action.id)?.target ? 'true' : undefined"
              data-test-id="lowcode-action-api-target"
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
        <input
          v-if="action.kind === 'apiCall' && action.method === 'POST'"
          :value="action.bodyJson ?? ''"
          :aria-label="panels.lowcodeActionApiBody"
          :aria-invalid="actionErrors.get(action.id)?.body ? 'true' : undefined"
          data-test-id="lowcode-action-api-body"
          spellcheck="false"
          :placeholder="panels.lowcodeActionApiBody"
          :class="[
            'min-w-0 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
            actionErrors.get(action.id)?.body ? 'border-red-500' : 'border-border'
          ]"
          @change="updateAction(action.id, { bodyJson: ($event.target as HTMLInputElement).value })"
        />
        <p
          v-if="actionErrors.get(action.id)?.target"
          data-test-id="lowcode-action-target-error"
          class="pl-1 text-[10px] text-red-500"
        >
          target: {{ actionErrors.get(action.id)?.target }}
        </p>
        <p
          v-if="actionErrors.get(action.id)?.url"
          data-test-id="lowcode-action-url-error"
          class="pl-1 text-[10px] text-red-500"
        >
          url: {{ actionErrors.get(action.id)?.url }}
        </p>
        <p
          v-if="action.kind === 'apiCall' && !actionErrors.get(action.id)?.url"
          data-test-id="lowcode-action-api-url-hint"
          class="pl-1 text-[10px] text-muted"
        >
          {{ panels.lowcodeActionApiUrlHint }}
        </p>
        <p
          v-if="actionErrors.get(action.id)?.body"
          data-test-id="lowcode-action-body-error"
          class="pl-1 text-[10px] text-red-500"
        >
          body: {{ actionErrors.get(action.id)?.body }}
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
