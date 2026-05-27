<script setup lang="ts">
import { computed } from 'vue'

import {
  PAYLOAD_ENTRY_KEY_RE,
  validateExpression,
  validateUrlTemplate
} from '@open-pencil/core/lowcode-validation'
import type {
  ActionDef,
  ActionKind,
  EventName,
  SceneNode,
  SupabaseFilter,
  SupabasePayloadEntry
} from '@open-pencil/core/scene-graph'
import { useI18n, useSceneComputed, useSelectionState } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'

import { useEditorStore } from '@/app/editor/active-store'

import AuthControls from './AuthControls.vue'

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

const ACTION_KINDS: ActionKind[] = [
  'setState',
  'navigate',
  'setVariable',
  'apiCall',
  'supabaseQuery',
  'supabaseMutation'
]

const API_METHODS = ['GET', 'POST'] as const
const SUPABASE_OPS = ['insert', 'update', 'delete', 'upsert'] as const
const SUPABASE_FILTER_OPS: SupabaseFilter['op'][] = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'in'
]

// `setVariable` / `apiCall` / `supabaseQuery` / `supabaseMutation` kind
// literals are locked (§7.4 + §2.2 #c + old .fig compat); only their
// editor-facing labels differ.
function actionKindLabel(kind: ActionKind): string {
  if (kind === 'setVariable') return panels.value.lowcodeActionSetDocument
  if (kind === 'apiCall') return panels.value.lowcodeActionCallApi
  if (kind === 'supabaseQuery') return panels.value.lowcodeActionSupabaseQuery
  if (kind === 'supabaseMutation') return panels.value.lowcodeActionSupabaseMutation
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
  if (kind === 'apiCall') {
    return {
      id,
      kind: 'apiCall',
      method: 'GET',
      url: '',
      targetName: docTarget?.name ?? ''
    }
  }
  if (kind === 'supabaseQuery') {
    return {
      id,
      kind: 'supabaseQuery',
      table: '',
      resultTarget: docTarget?.name ?? ''
    }
  }
  return {
    id,
    kind: 'supabaseMutation',
    operation: 'insert',
    table: ''
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

// Phase 3 §2 — filter list mutators for supabaseQuery / supabaseMutation.
// `updateAction({ filters: next })` would discard list identity on every
// keystroke; we surface scoped helpers instead so the row component just
// dispatches by index.
function patchFilters(
  id: string,
  next: (current: SupabaseFilter[]) => SupabaseFilter[]
): void {
  const action = actions.value.find((a) => a.id === id)
  if (!action) return
  if (action.kind !== 'supabaseQuery' && action.kind !== 'supabaseMutation') return
  const current = action.filters ?? []
  updateAction(id, { filters: next(current) })
}

function addFilter(id: string): void {
  patchFilters(id, (current) => [...current, { column: '', op: 'eq', valueExpr: '' }])
}

function removeFilter(id: string, index: number): void {
  patchFilters(id, (current) => current.filter((_, i) => i !== index))
}

function updateFilter(id: string, index: number, patch: Partial<SupabaseFilter>): void {
  patchFilters(id, (current) =>
    current.map((f, i) => (i === index ? { ...f, ...patch } : f))
  )
}

// Phase 3 §3.v3 — payloadEntries list mutators (mirror of filter mutators).
// Only valid on `supabaseMutation`; the `delete` operation hides the editor
// in the template but the raw data is preserved (so toggling op back to
// insert/update brings the entries back — §3.v3.2 #e no-swallow).
function patchEntries(
  id: string,
  next: (current: SupabasePayloadEntry[]) => SupabasePayloadEntry[]
): void {
  const action = actions.value.find((a) => a.id === id)
  if (!action || action.kind !== 'supabaseMutation') return
  const current = action.payloadEntries ?? []
  updateAction(id, { payloadEntries: next(current) })
}

function addEntry(id: string): void {
  patchEntries(id, (current) => [...current, { key: '', valueExpr: '' }])
}

function removeEntry(id: string, index: number): void {
  patchEntries(id, (current) => current.filter((_, i) => i !== index))
}

function updateEntry(id: string, index: number, patch: Partial<SupabasePayloadEntry>): void {
  patchEntries(id, (current) =>
    current.map((e, i) => (i === index ? { ...e, ...patch } : e))
  )
}

// Phase 1 §7.3 + §7.4 — mirror what the IR collect pass rejects
// (`collect/bindings.ts` → `resolveActions`). Each kind has its own slots;
// every slot is independent so we can show two reds on the same row.
// Phase 3 §2 widens this with Supabase-specific slots: `table`, `payload`,
// per-filter `valueExpr` keyed by filter index.
interface PayloadEntryError {
  keyError?: string
  valueError?: string
}

interface ActionErrors {
  target?: string
  expr?: string
  to?: string
  url?: string
  body?: string
  table?: string
  payload?: string
  filters?: Map<number, string>
  // Phase 3 §3.v3 — per-row payloadEntries errors keyed by index.
  entries?: Map<number, PayloadEntryError>
  // Phase 3 §3.v3 — mirrors IR `action-supabase-mutation-payload-source-conflict`.
  payloadSourceConflict?: boolean
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

// Phase 3 §2 — `resolveSupabaseFilters` mirror: each filter row's `valueExpr`
// is validated independently; errors are keyed by index so the UI can red
// only the offending row.
function filterErrors(filters: SupabaseFilter[] | undefined): Map<number, string> | undefined {
  if (!filters || filters.length === 0) return undefined
  const out = new Map<number, string>()
  filters.forEach((f, i) => {
    const result = validateExpression(f.valueExpr ?? '')
    if (!result.ok) out.set(i, result.reason ?? 'invalid expression')
  })
  return out.size > 0 ? out : undefined
}

function supabaseQueryErrors(
  action: Extract<ActionDef, { kind: 'supabaseQuery' }>
): ActionErrors {
  // §2.2 #i + §2.4 `resolveSupabaseQuery`: table is non-empty, resultTarget
  // resolves to a docState, filter exprs all parse. errorTarget when set
  // must also resolve.
  const e: ActionErrors = {}
  if (action.table.trim() === '') e.table = 'table required'
  if (action.resultTarget.trim() === '') e.target = 'target required'
  else if (!validDocStateNames.value.has(action.resultTarget))
    e.target = 'document state no longer exists'
  if (action.errorTarget && !validDocStateNames.value.has(action.errorTarget))
    e.target = 'error target no longer exists'
  const fe = filterErrors(action.filters)
  if (fe) e.filters = fe
  return e
}

// Phase 3 §3.v3 — per-entry validator. Key must be a JS identifier (column
// safety); dup keys flagged on the second occurrence; valueExpr parses.
// Mirrors `validateSupabasePayloadEntries` in lowcode-validation but emits
// per-row error maps instead of bailing at first failure so the UI can red
// every offending row at once.
function payloadEntryErrors(
  entries: SupabasePayloadEntry[] | undefined
): Map<number, PayloadEntryError> | undefined {
  if (!entries || entries.length === 0) return undefined
  const out = new Map<number, PayloadEntryError>()
  const seen = new Map<string, number>()
  entries.forEach((entry, i) => {
    const slot: PayloadEntryError = {}
    if (entry.key === '') slot.keyError = 'column required'
    else if (!PAYLOAD_ENTRY_KEY_RE.test(entry.key)) slot.keyError = 'invalid identifier'
    else if (seen.has(entry.key)) slot.keyError = `duplicates "${entry.key}"`
    else seen.set(entry.key, i)
    const v = validateExpression(entry.valueExpr ?? '')
    if (!v.ok) slot.valueError = v.reason ?? 'invalid expression'
    if (slot.keyError || slot.valueError) out.set(i, slot)
  })
  return out.size > 0 ? out : undefined
}

function supabaseMutationErrors(
  action: Extract<ActionDef, { kind: 'supabaseMutation' }>
): ActionErrors {
  // §2.4 `resolveSupabaseMutation`: table is non-empty; payloadJson (when
  // present) parses; filters required for update/delete (collect drops the
  // action otherwise — the editor surfaces it as a red banner upfront).
  // §3.v2.2 #e — both payloadJson and payloadEntries set → conflict warning.
  const e: ActionErrors = {}
  if (action.table.trim() === '') e.table = 'table required'
  const raw = (action.payloadJson ?? '').trim()
  if (raw !== '') {
    try {
      JSON.parse(raw)
    } catch (err) {
      e.payload = err instanceof Error ? err.message : String(err)
    }
  }
  const fe = filterErrors(action.filters)
  if (fe) e.filters = fe
  const ee = payloadEntryErrors(action.payloadEntries)
  if (ee) e.entries = ee
  // Conflict only relevant when both channels actually carry content (after
  // the `'{}'` normalize hides "AI residue"; mirrors IR `payload-source
  // -conflict` warn — surfacing here so the user sees it before runtime).
  if (raw !== '' && (action.payloadEntries?.length ?? 0) > 0) {
    e.payloadSourceConflict = true
  }
  return e
}

function errorsFor(action: ActionDef): ActionErrors {
  if (action.kind === 'setState') return setStateErrors(action)
  if (action.kind === 'navigate') {
    return !action.to || action.to.trim() === '' ? { to: 'path required' } : {}
  }
  if (action.kind === 'setVariable') return setVariableErrors(action)
  if (action.kind === 'apiCall') return apiCallErrors(action)
  if (action.kind === 'supabaseQuery') return supabaseQueryErrors(action)
  return supabaseMutationErrors(action)
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

    <AuthControls />

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

          <template v-else-if="action.kind === 'supabaseQuery'">
            <input
              :value="action.table"
              :aria-label="panels.lowcodeActionSupabaseTable"
              :aria-invalid="actionErrors.get(action.id)?.table ? 'true' : undefined"
              data-test-id="lowcode-action-supabase-table"
              spellcheck="false"
              :placeholder="panels.lowcodeActionSupabaseTablePlaceholder"
              :class="[
                'min-w-0 flex-1 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
                actionErrors.get(action.id)?.table ? 'border-red-500' : 'border-border'
              ]"
              @change="updateAction(action.id, { table: ($event.target as HTMLInputElement).value })"
            />
            <span class="text-[11px] text-muted">→</span>
            <select
              :value="action.resultTarget"
              :aria-label="panels.lowcodeActionApiTarget"
              :aria-invalid="actionErrors.get(action.id)?.target ? 'true' : undefined"
              data-test-id="lowcode-action-supabase-result-target"
              :class="[
                'rounded border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent',
                actionErrors.get(action.id)?.target ? 'border-red-500' : 'border-border'
              ]"
              @change="updateAction(action.id, { resultTarget: ($event.target as HTMLSelectElement).value })"
            >
              <option v-if="docStates.length === 0" value="" disabled>
                {{ panels.lowcodeActionNoDocumentState }}
              </option>
              <option v-for="d in docStates" :key="d.id" :value="d.name">{{ d.name }}</option>
            </select>
          </template>

          <template v-else-if="action.kind === 'supabaseMutation'">
            <select
              :value="action.operation"
              :aria-label="panels.lowcodeActionSupabaseOperation"
              data-test-id="lowcode-action-supabase-operation"
              class="rounded border border-border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent"
              @change="updateAction(action.id, { operation: ($event.target as HTMLSelectElement).value as 'insert' | 'update' | 'delete' | 'upsert' })"
            >
              <option v-for="op in SUPABASE_OPS" :key="op" :value="op">{{ op }}</option>
            </select>
            <input
              :value="action.table"
              :aria-label="panels.lowcodeActionSupabaseTable"
              :aria-invalid="actionErrors.get(action.id)?.table ? 'true' : undefined"
              data-test-id="lowcode-action-supabase-table"
              spellcheck="false"
              :placeholder="panels.lowcodeActionSupabaseTablePlaceholder"
              :class="[
                'min-w-0 flex-1 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
                actionErrors.get(action.id)?.table ? 'border-red-500' : 'border-border'
              ]"
              @change="updateAction(action.id, { table: ($event.target as HTMLInputElement).value })"
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

        <template v-if="action.kind === 'supabaseQuery'">
          <input
            :value="action.columns ?? ''"
            :aria-label="panels.lowcodeActionSupabaseColumns"
            data-test-id="lowcode-action-supabase-columns"
            spellcheck="false"
            :placeholder="panels.lowcodeActionSupabaseColumnsPlaceholder"
            class="min-w-0 rounded border border-border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent"
            @change="updateAction(action.id, { columns: ($event.target as HTMLInputElement).value })"
          />
          <label class="flex items-center gap-1 pl-1 text-[11px] text-muted">
            <input
              type="checkbox"
              :checked="action.single ?? false"
              data-test-id="lowcode-action-supabase-single"
              @change="updateAction(action.id, { single: ($event.target as HTMLInputElement).checked })"
            />
            {{ panels.lowcodeActionSupabaseSingle }}
          </label>
        </template>

        <template
          v-if="action.kind === 'supabaseMutation' && action.operation !== 'delete'"
        >
          <p
            v-if="actionErrors.get(action.id)?.payloadSourceConflict"
            data-test-id="lowcode-action-supabase-payload-source-conflict"
            class="pl-1 text-[10px] text-orange-500"
          >
            {{ panels.lowcodeActionSupabasePayloadSourceConflict }}
          </p>
          <input
            :value="action.payloadJson ?? ''"
            :aria-label="panels.lowcodeActionSupabasePayload"
            :aria-invalid="actionErrors.get(action.id)?.payload ? 'true' : undefined"
            data-test-id="lowcode-action-supabase-payload"
            spellcheck="false"
            :placeholder="panels.lowcodeActionSupabasePayload"
            :class="[
              'min-w-0 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
              actionErrors.get(action.id)?.payload ? 'border-red-500' : 'border-border'
            ]"
            @change="updateAction(action.id, { payloadJson: ($event.target as HTMLInputElement).value })"
          />
          <div class="flex flex-col gap-1 pl-1">
            <label
              v-if="(action.payloadEntries?.length ?? 0) > 0"
              class="text-[10px] text-muted"
            >
              {{ panels.lowcodeActionSupabasePayloadEntries }}
            </label>
            <div
              v-for="(entry, i) in action.payloadEntries ?? []"
              :key="i"
              data-test-id="lowcode-action-supabase-payload-entry"
              class="flex items-center gap-1"
            >
              <input
                :value="entry.key"
                :aria-label="panels.lowcodeActionSupabasePayloadEntryKey"
                :aria-invalid="actionErrors.get(action.id)?.entries?.get(i)?.keyError ? 'true' : undefined"
                data-test-id="lowcode-action-supabase-payload-entry-key"
                spellcheck="false"
                :placeholder="panels.lowcodeActionSupabasePayloadEntryKey"
                :class="[
                  'w-20 rounded border bg-input px-1.5 py-0.5 font-mono text-[11px] text-surface outline-none focus:border-accent',
                  actionErrors.get(action.id)?.entries?.get(i)?.keyError ? 'border-red-500' : 'border-border'
                ]"
                @change="updateEntry(action.id, i, { key: ($event.target as HTMLInputElement).value })"
              />
              <input
                :value="entry.valueExpr"
                :aria-label="panels.lowcodeActionSupabasePayloadEntryValue"
                :aria-invalid="actionErrors.get(action.id)?.entries?.get(i)?.valueError ? 'true' : undefined"
                data-test-id="lowcode-action-supabase-payload-entry-value"
                spellcheck="false"
                :placeholder="panels.lowcodeActionSupabasePayloadEntryValuePlaceholder"
                :class="[
                  'min-w-0 flex-1 rounded border bg-input px-1.5 py-0.5 font-mono text-[11px] text-surface outline-none focus:border-accent',
                  actionErrors.get(action.id)?.entries?.get(i)?.valueError ? 'border-red-500' : 'border-border'
                ]"
                @change="updateEntry(action.id, i, { valueExpr: ($event.target as HTMLInputElement).value })"
              />
              <button
                type="button"
                :aria-label="panels.lowcodeActionSupabasePayloadEntryRemove"
                data-test-id="lowcode-action-supabase-payload-entry-remove"
                class="rounded p-0.5 text-muted hover:bg-hover hover:text-surface"
                @click="removeEntry(action.id, i)"
              >
                <icon-lucide-x class="size-3" />
              </button>
            </div>
            <button
              type="button"
              data-test-id="lowcode-action-supabase-payload-add-entry"
              class="self-start rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
              @click="addEntry(action.id)"
            >
              + {{ panels.lowcodeActionSupabasePayloadAddEntry }}
            </button>
          </div>
        </template>

        <template v-if="action.kind === 'supabaseQuery' || action.kind === 'supabaseMutation'">
          <div class="flex flex-col gap-1 pl-1">
            <div
              v-for="(filter, i) in action.filters ?? []"
              :key="i"
              data-test-id="lowcode-action-supabase-filter"
              class="flex items-center gap-1"
            >
              <input
                :value="filter.column"
                :aria-label="panels.lowcodeActionSupabaseFilterColumn"
                data-test-id="lowcode-action-supabase-filter-column"
                spellcheck="false"
                :placeholder="panels.lowcodeActionSupabaseFilterColumn"
                class="w-20 rounded border border-border bg-input px-1.5 py-0.5 font-mono text-[11px] text-surface outline-none focus:border-accent"
                @change="updateFilter(action.id, i, { column: ($event.target as HTMLInputElement).value })"
              />
              <select
                :value="filter.op"
                aria-label="Filter operator"
                data-test-id="lowcode-action-supabase-filter-op"
                class="rounded border border-border bg-input px-1 py-0.5 text-[11px] text-surface outline-none focus:border-accent"
                @change="updateFilter(action.id, i, { op: ($event.target as HTMLSelectElement).value as SupabaseFilter['op'] })"
              >
                <option v-for="op in SUPABASE_FILTER_OPS" :key="op" :value="op">{{ op }}</option>
              </select>
              <input
                :value="filter.valueExpr"
                :aria-label="panels.lowcodeActionValue"
                :aria-invalid="actionErrors.get(action.id)?.filters?.has(i) ? 'true' : undefined"
                data-test-id="lowcode-action-supabase-filter-value"
                spellcheck="false"
                :placeholder="panels.lowcodeActionSupabaseFilterValuePlaceholder"
                :class="[
                  'min-w-0 flex-1 rounded border bg-input px-1.5 py-0.5 font-mono text-[11px] text-surface outline-none focus:border-accent',
                  actionErrors.get(action.id)?.filters?.has(i) ? 'border-red-500' : 'border-border'
                ]"
                @change="updateFilter(action.id, i, { valueExpr: ($event.target as HTMLInputElement).value })"
              />
              <button
                type="button"
                :aria-label="panels.lowcodeActionSupabaseFilterRemove"
                data-test-id="lowcode-action-supabase-filter-remove"
                class="rounded p-0.5 text-muted hover:bg-hover hover:text-surface"
                @click="removeFilter(action.id, i)"
              >
                <icon-lucide-x class="size-3" />
              </button>
            </div>
            <button
              type="button"
              data-test-id="lowcode-action-supabase-filter-add"
              class="self-start rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
              @click="addFilter(action.id)"
            >
              + {{ panels.lowcodeActionSupabaseFilterAdd }}
            </button>
          </div>
          <select
            :value="action.errorTarget ?? ''"
            :aria-label="panels.lowcodeActionSupabaseErrorTarget"
            data-test-id="lowcode-action-supabase-error-target"
            class="rounded border border-border bg-input px-1.5 py-0.5 text-[11px] text-surface outline-none focus:border-accent"
            @change="updateAction(action.id, { errorTarget: ($event.target as HTMLSelectElement).value || undefined })"
          >
            <option value="">{{ panels.lowcodeActionSupabaseErrorTargetNone }}</option>
            <option v-for="d in docStates" :key="d.id" :value="d.name">{{ d.name }}</option>
          </select>
        </template>

        <p
          v-if="actionErrors.get(action.id)?.target"
          data-test-id="lowcode-action-target-error"
          class="pl-1 text-[10px] text-red-500"
        >
          target: {{ actionErrors.get(action.id)?.target }}
        </p>
        <p
          v-if="actionErrors.get(action.id)?.table"
          data-test-id="lowcode-action-table-error"
          class="pl-1 text-[10px] text-red-500"
        >
          table: {{ actionErrors.get(action.id)?.table }}
        </p>
        <p
          v-if="actionErrors.get(action.id)?.payload"
          data-test-id="lowcode-action-payload-error"
          class="pl-1 text-[10px] text-red-500"
        >
          payload: {{ actionErrors.get(action.id)?.payload }}
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
