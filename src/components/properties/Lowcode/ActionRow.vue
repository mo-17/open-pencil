<script setup lang="ts">
import { computed } from 'vue'

import type {
  ActionDef,
  ActionKind,
  DocumentStateDef,
  StateDef,
  SupabaseFilter,
  SupabasePayloadEntry,
  WorkflowDef
} from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import { ANALYTICS_TRACK_EVENT_CONFIG_HINT } from '@/app/lowcode/analytics-help'
import Tip from '@/components/ui/Tip.vue'
import {
  authNeedsEmail,
  authNeedsPassword,
  computeActionErrors,
  type ActionErrors
} from '@/app/lowcode/action-errors'
import { ACTION_KINDS, makeAction } from './action-factory'
// ActionRow ↔ ActionList are mutually recursive components (a row renders nested
// branch lists, a list renders rows) — the import cycle is intentional and
// resolved lazily at render time, the canonical Vue recursive-component pattern.
// eslint-disable-next-line import/no-cycle
import ActionList from './ActionList.vue'

/**
 * Phase 3 §10 v10 — one row of the recursive workflow editor. Renders a single
 * `ActionDef`'s kind selector + per-kind field editors + inline errors, and —
 * for the branch-bearing kinds — nested `ActionList`s (which recurse back into
 * `ActionRow`). This makes the whole workflow logic visible + fine-tunable in
 * the GUI; MCP stays the backstop for deep/bulk authoring.
 *
 * Controlled: takes the action via `action`, emits the edited replacement via
 * `update:action` (or `remove`). The parent list owns array identity.
 */
const { action, pageStates, docStates, workflows, analyticsConfigured, actionPath } = defineProps<{
  action: ActionDef
  pageStates: readonly StateDef[]
  docStates: readonly DocumentStateDef[]
  /** §10 v11 — named workflows a `callWorkflow` row can target / pass args to. */
  workflows: readonly WorkflowDef[]
  analyticsConfigured?: boolean
  actionPath: string
}>()

const emit = defineEmits<{
  'update:action': [ActionDef]
  remove: []
}>()

const { panels } = useI18n()

const API_METHODS = ['GET', 'POST'] as const
const TOAST_VARIANTS = ['info', 'success', 'error'] as const
const SUPABASE_OPS = ['insert', 'update', 'delete', 'upsert'] as const
const SUPABASE_AUTH_OPS = [
  'signIn',
  'signUp',
  'signOut',
  'resetPassword',
  'updatePassword'
] as const
const SUPABASE_FILTER_OPS: SupabaseFilter['op'][] = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'like',
  'in'
]

const validStateIds = computed(() => new Set(pageStates.map((s) => s.id)))
const validDocStateNames = computed(() => new Set(docStates.map((d) => d.name)))

const errors = computed<ActionErrors>(() =>
  computeActionErrors(action, {
    validStateIds: validStateIds.value,
    validDocStateNames: validDocStateNames.value,
    workflows
  })
)

// `setVariable` / `apiCall` / `supabase*` kind literals are locked; only their
// editor-facing labels differ. condition / confirm use hardcoded labels
// (avoids messages.ts + 7-locale churn, per panel convention).
function actionKindLabel(kind: ActionKind): string {
  if (kind === 'setVariable') return panels.value.lowcodeActionSetDocument
  if (kind === 'apiCall') return panels.value.lowcodeActionCallApi
  if (kind === 'supabaseQuery') return panels.value.lowcodeActionSupabaseQuery
  if (kind === 'supabaseMutation') return panels.value.lowcodeActionSupabaseMutation
  if (kind === 'supabaseAuth') return panels.value.lowcodeActionSupabaseAuth
  if (kind === 'condition') return 'If (condition)'
  if (kind === 'confirm') return 'Confirm'
  if (kind === 'callWorkflow') return 'Call workflow'
  if (kind === 'trackEvent') return 'Track event'
  if (kind === 'stripeCheckout') return 'Stripe checkout'
  if (kind === 'stripeCustomerPortal') return 'Stripe customer portal'
  return kind
}

function patch(p: Partial<ActionDef>): void {
  emit('update:action', { ...action, ...p } as ActionDef)
}

function changeKind(kind: ActionKind): void {
  emit('update:action', makeAction(kind, action.id, { pageStates, docStates }))
}

function updateFilters(next: (current: SupabaseFilter[]) => SupabaseFilter[]): void {
  const a = action
  if (a.kind !== 'supabaseQuery' && a.kind !== 'supabaseMutation') return
  patch({ filters: next(a.filters ?? []) })
}
function addFilter(): void {
  updateFilters((cur) => [...cur, { column: '', op: 'eq', valueExpr: '' }])
}
function removeFilter(index: number): void {
  updateFilters((cur) => cur.filter((_, i) => i !== index))
}
function updateFilter(index: number, p: Partial<SupabaseFilter>): void {
  updateFilters((cur) => cur.map((f, i) => (i === index ? { ...f, ...p } : f)))
}

function updateEntries(next: (current: SupabasePayloadEntry[]) => SupabasePayloadEntry[]): void {
  const a = action
  if (a.kind !== 'supabaseMutation') return
  patch({ payloadEntries: next(a.payloadEntries ?? []) })
}
function addEntry(): void {
  updateEntries((cur) => [...cur, { key: '', valueExpr: '' }])
}
function removeEntry(index: number): void {
  updateEntries((cur) => cur.filter((_, i) => i !== index))
}
function updateEntry(index: number, p: Partial<SupabasePayloadEntry>): void {
  updateEntries((cur) => cur.map((e, i) => (i === index ? { ...e, ...p } : e)))
}

type TrackProperty = SupabasePayloadEntry

const trackProperties = computed<TrackProperty[]>(() => {
  if (action.kind !== 'trackEvent') return []
  return Object.entries(action.properties ?? {}).map(([key, valueExpr]) => ({ key, valueExpr }))
})

function updateTrackProperties(next: (current: TrackProperty[]) => TrackProperty[]): void {
  if (action.kind !== 'trackEvent') return
  const entries = next(trackProperties.value)
  const properties: Record<string, string> = {}
  for (const entry of entries) properties[entry.key] = entry.valueExpr
  patch({
    properties: Object.keys(properties).length > 0 ? properties : undefined
  } as Partial<ActionDef>)
}
function uniqueTrackPropertyKey(base: string, index?: number): string {
  const stem = base.trim() || 'prop'
  const existing = new Set(
    trackProperties.value
      .filter((_, i) => i !== index)
      .map((entry) => entry.key)
      .filter(Boolean)
  )
  if (!existing.has(stem)) return stem
  let suffix = 2
  while (existing.has(`${stem}_${suffix}`)) suffix += 1
  return `${stem}_${suffix}`
}
function addTrackProperty(): void {
  updateTrackProperties((cur) => [
    ...cur,
    { key: uniqueTrackPropertyKey(`prop${cur.length + 1}`), valueExpr: '' }
  ])
}
function removeTrackProperty(index: number): void {
  updateTrackProperties((cur) => cur.filter((_, i) => i !== index))
}
function updateTrackProperty(index: number, p: Partial<TrackProperty>): void {
  updateTrackProperties((cur) =>
    cur.map((entry, i) =>
      i === index
        ? {
            ...entry,
            ...p,
            ...(p.key !== undefined ? { key: uniqueTrackPropertyKey(p.key, index) } : {})
          }
        : entry
    )
  )
}

function updateStripePayloadEntries(
  next: (current: SupabasePayloadEntry[]) => SupabasePayloadEntry[]
): void {
  if (action.kind !== 'stripeCheckout' && action.kind !== 'stripeCustomerPortal') return
  const entries = next(action.payloadEntries ?? [])
  patch({ payloadEntries: entries.length > 0 ? entries : undefined } as Partial<ActionDef>)
}
function addStripePayloadEntry(): void {
  updateStripePayloadEntries((cur) => [...cur, { key: `item${cur.length + 1}`, valueExpr: '' }])
}
function removeStripePayloadEntry(index: number): void {
  updateStripePayloadEntries((cur) => cur.filter((_, i) => i !== index))
}
function updateStripePayloadEntry(index: number, p: Partial<SupabasePayloadEntry>): void {
  updateStripePayloadEntries((cur) => cur.map((e, i) => (i === index ? { ...e, ...p } : e)))
}

// §10 v9/v10 nested branches. consequent is required (always an array); the
// optional branches (alternate / onSuccess / onError) collapse to undefined
// when emptied so emit / round-trip stay byte-identical to a branch-less action.
type BranchKey = 'consequent' | 'alternate' | 'onSuccess' | 'onError'
function updateBranch(key: BranchKey, next: ActionDef[]): void {
  if (key === 'consequent') {
    patch({ consequent: next })
    return
  }
  patch({ [key]: next.length > 0 ? next : undefined } as Partial<ActionDef>)
}

// §10 v11 — callWorkflow: the args editor renders one expression input per
// formal parameter of the selected workflow, marking those that may be omitted
// (a paramDefaults entry or optionalParams membership) as optional.
interface CallWorkflowArg {
  name: string
  value: string
  optional: boolean
}
const callWorkflowArgs = computed<CallWorkflowArg[]>(() => {
  if (action.kind !== 'callWorkflow') return []
  const wf = workflows.find((w) => w.id === action.workflowId)
  if (!wf) return []
  const defaults = wf.paramDefaults ?? {}
  const optional = new Set(wf.optionalParams)
  const args = action.args ?? {}
  return (wf.params ?? []).map((name) => ({
    name,
    value: Object.hasOwn(args, name) ? args[name] : '',
    optional: Object.hasOwn(defaults, name) || optional.has(name)
  }))
})

function changeWorkflow(id: string): void {
  // Switching workflows discards args — the previous workflow's parameter names
  // no longer apply.
  patch({ workflowId: id || undefined, args: undefined } as Partial<ActionDef>)
}

function setArg(param: string, value: string): void {
  if (action.kind !== 'callWorkflow') return
  const next: Record<string, string> = { ...action.args }
  if (value.trim() === '') Reflect.deleteProperty(next, param)
  else next[param] = value
  patch({ args: Object.keys(next).length > 0 ? next : undefined } as Partial<ActionDef>)
}
</script>

<template>
  <li
    data-test-id="lowcode-action-row"
    :data-lowcode-action-id="action.id"
    :data-lowcode-action-path="actionPath"
    tabindex="-1"
    class="flex flex-col gap-0.5 rounded outline-none transition-colors focus-visible:ring-1 focus-visible:ring-accent"
  >
    <div class="flex items-center gap-1">
      <select
        :value="action.kind"
        aria-label="Action kind"
        data-test-id="lowcode-action-kind"
        class="rounded border border-border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent"
        @change="changeKind(($event.target as HTMLSelectElement).value as ActionKind)"
      >
        <option v-for="k in ACTION_KINDS" :key="k" :value="k">{{ actionKindLabel(k) }}</option>
      </select>

      <template v-if="action.kind === 'setState'">
        <select
          :value="action.targetStateId ?? ''"
          :aria-label="panels.lowcodeActionSet"
          :aria-invalid="errors.target ? 'true' : undefined"
          data-test-id="lowcode-action-target"
          :class="[
            'rounded border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent',
            errors.target ? 'border-red-500' : 'border-border'
          ]"
          @change="patch({ targetStateId: ($event.target as HTMLSelectElement).value })"
        >
          <option v-if="pageStates.length === 0" value="" disabled>no state</option>
          <option v-for="s in pageStates" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <span class="text-[11px] text-muted">=</span>
        <input
          :value="action.valueExpr ?? ''"
          :aria-label="panels.lowcodeActionValue"
          :aria-invalid="errors.expr ? 'true' : undefined"
          data-test-id="lowcode-action-expr"
          spellcheck="false"
          :class="[
            'min-w-0 flex-1 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
            errors.expr ? 'border-red-500' : 'border-border'
          ]"
          @change="patch({ valueExpr: ($event.target as HTMLInputElement).value })"
        />
      </template>

      <template v-else-if="action.kind === 'navigate'">
        <span class="text-[11px] text-muted">to</span>
        <input
          :value="action.to ?? ''"
          aria-label="Route path"
          :aria-invalid="errors.to ? 'true' : undefined"
          data-test-id="lowcode-action-to"
          spellcheck="false"
          placeholder="/about"
          :class="[
            'min-w-0 flex-1 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
            errors.to ? 'border-red-500' : 'border-border'
          ]"
          @change="patch({ to: ($event.target as HTMLInputElement).value })"
        />
      </template>

      <template v-else-if="action.kind === 'setVariable'">
        <select
          :value="action.targetName ?? ''"
          :aria-label="panels.lowcodeActionSet"
          :aria-invalid="errors.target ? 'true' : undefined"
          data-test-id="lowcode-action-variable-name"
          :class="[
            'rounded border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent',
            errors.target ? 'border-red-500' : 'border-border'
          ]"
          @change="patch({ targetName: ($event.target as HTMLSelectElement).value })"
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
          :aria-invalid="errors.expr ? 'true' : undefined"
          data-test-id="lowcode-action-variable-expr"
          spellcheck="false"
          :class="[
            'min-w-0 flex-1 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
            errors.expr ? 'border-red-500' : 'border-border'
          ]"
          @change="patch({ valueExpr: ($event.target as HTMLInputElement).value })"
        />
      </template>

      <template v-else-if="action.kind === 'apiCall'">
        <select
          :value="action.method"
          :aria-label="panels.lowcodeActionApiMethod"
          data-test-id="lowcode-action-api-method"
          class="rounded border border-border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent"
          @change="patch({ method: ($event.target as HTMLSelectElement).value as 'GET' | 'POST' })"
        >
          <option v-for="m in API_METHODS" :key="m" :value="m">{{ m }}</option>
        </select>
        <input
          :value="action.url"
          :aria-label="panels.lowcodeActionApiUrl"
          :aria-invalid="errors.url ? 'true' : undefined"
          data-test-id="lowcode-action-api-url"
          spellcheck="false"
          placeholder="https://api.example.com/users"
          :class="[
            'min-w-0 flex-1 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
            errors.url ? 'border-red-500' : 'border-border'
          ]"
          @change="patch({ url: ($event.target as HTMLInputElement).value })"
        />
        <span class="text-[11px] text-muted">→</span>
        <select
          :value="action.targetName"
          :aria-label="panels.lowcodeActionApiTarget"
          :aria-invalid="errors.target ? 'true' : undefined"
          data-test-id="lowcode-action-api-target"
          :class="[
            'rounded border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent',
            errors.target ? 'border-red-500' : 'border-border'
          ]"
          @change="patch({ targetName: ($event.target as HTMLSelectElement).value })"
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
          :aria-invalid="errors.table ? 'true' : undefined"
          data-test-id="lowcode-action-supabase-table"
          spellcheck="false"
          :placeholder="panels.lowcodeActionSupabaseTablePlaceholder"
          :class="[
            'min-w-0 flex-1 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
            errors.table ? 'border-red-500' : 'border-border'
          ]"
          @change="patch({ table: ($event.target as HTMLInputElement).value })"
        />
        <span class="text-[11px] text-muted">→</span>
        <select
          :value="action.resultTarget"
          :aria-label="panels.lowcodeActionApiTarget"
          :aria-invalid="errors.target ? 'true' : undefined"
          data-test-id="lowcode-action-supabase-result-target"
          :class="[
            'rounded border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent',
            errors.target ? 'border-red-500' : 'border-border'
          ]"
          @change="patch({ resultTarget: ($event.target as HTMLSelectElement).value })"
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
          @change="
            patch({
              operation: ($event.target as HTMLSelectElement).value as
                | 'insert'
                | 'update'
                | 'delete'
                | 'upsert'
            })
          "
        >
          <option v-for="op in SUPABASE_OPS" :key="op" :value="op">{{ op }}</option>
        </select>
        <input
          :value="action.table"
          :aria-label="panels.lowcodeActionSupabaseTable"
          :aria-invalid="errors.table ? 'true' : undefined"
          data-test-id="lowcode-action-supabase-table"
          spellcheck="false"
          :placeholder="panels.lowcodeActionSupabaseTablePlaceholder"
          :class="[
            'min-w-0 flex-1 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
            errors.table ? 'border-red-500' : 'border-border'
          ]"
          @change="patch({ table: ($event.target as HTMLInputElement).value })"
        />
      </template>

      <template v-else-if="action.kind === 'supabaseAuth'">
        <select
          :value="action.operation"
          :aria-label="panels.lowcodeActionSupabaseOperation"
          data-test-id="lowcode-action-auth-operation"
          class="rounded border border-border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent"
          @change="
            patch({
              operation: ($event.target as HTMLSelectElement).value as
                | 'signIn'
                | 'signOut'
                | 'signUp'
                | 'resetPassword'
                | 'updatePassword'
            })
          "
        >
          <option v-for="op in SUPABASE_AUTH_OPS" :key="op" :value="op">{{ op }}</option>
        </select>
      </template>

      <template v-else-if="action.kind === 'toast'">
        <input
          :value="action.messageExpr ?? ''"
          aria-label="Toast message"
          :aria-invalid="errors.message ? 'true' : undefined"
          data-test-id="lowcode-action-toast-message"
          spellcheck="false"
          placeholder='"Saved!"'
          :class="[
            'min-w-0 flex-1 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
            errors.message ? 'border-red-500' : 'border-border'
          ]"
          @change="patch({ messageExpr: ($event.target as HTMLInputElement).value })"
        />
        <select
          :value="action.variant ?? 'info'"
          aria-label="Toast variant"
          data-test-id="lowcode-action-toast-variant"
          class="rounded border border-border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent"
          @change="
            patch({
              variant: ($event.target as HTMLSelectElement).value as 'info' | 'success' | 'error'
            })
          "
        >
          <option v-for="v in TOAST_VARIANTS" :key="v" :value="v">{{ v }}</option>
        </select>
      </template>

      <template v-else-if="action.kind === 'clipboard'">
        <span class="text-[11px] text-muted">copy</span>
        <input
          :value="action.valueExpr ?? ''"
          aria-label="Clipboard value"
          :aria-invalid="errors.expr ? 'true' : undefined"
          data-test-id="lowcode-action-clipboard-value"
          spellcheck="false"
          placeholder="email"
          :class="[
            'min-w-0 flex-1 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
            errors.expr ? 'border-red-500' : 'border-border'
          ]"
          @change="patch({ valueExpr: ($event.target as HTMLInputElement).value })"
        />
      </template>

      <template v-else-if="action.kind === 'trackEvent'">
        <span class="text-[11px] text-muted">track</span>
        <input
          :value="action.eventNameExpr ?? ''"
          aria-label="Analytics event name"
          :aria-invalid="errors.expr ? 'true' : undefined"
          data-test-id="lowcode-action-track-event-name"
          spellcheck="false"
          placeholder='"signup_click"'
          :class="[
            'min-w-0 flex-1 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
            errors.expr ? 'border-red-500' : 'border-border'
          ]"
          @change="patch({ eventNameExpr: ($event.target as HTMLInputElement).value })"
        />
      </template>

      <template
        v-else-if="action.kind === 'stripeCheckout' || action.kind === 'stripeCustomerPortal'"
      >
        <span class="text-[11px] text-muted">
          {{ action.kind === 'stripeCheckout' ? 'checkout' : 'portal' }}
        </span>
        <input
          :value="action.endpoint ?? ''"
          :aria-label="
            action.kind === 'stripeCheckout'
              ? 'Stripe checkout endpoint'
              : 'Stripe customer portal endpoint'
          "
          :aria-invalid="errors.endpoint ? 'true' : undefined"
          data-test-id="lowcode-action-stripe-endpoint"
          spellcheck="false"
          :placeholder="action.kind === 'stripeCheckout' ? '/api/checkout' : '/api/customer-portal'"
          :class="[
            'min-w-0 flex-1 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
            errors.endpoint ? 'border-red-500' : 'border-border'
          ]"
          @change="patch({ endpoint: ($event.target as HTMLInputElement).value })"
        />
      </template>

      <template v-else-if="action.kind === 'delay'">
        <span class="text-[11px] text-muted">wait</span>
        <input
          :value="action.ms ?? 0"
          type="number"
          min="0"
          aria-label="Delay milliseconds"
          :aria-invalid="errors.ms ? 'true' : undefined"
          data-test-id="lowcode-action-delay-ms"
          :class="[
            'w-24 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
            errors.ms ? 'border-red-500' : 'border-border'
          ]"
          @change="patch({ ms: Number(($event.target as HTMLInputElement).value) })"
        />
        <span class="text-[11px] text-muted">ms</span>
      </template>

      <template v-else-if="action.kind === 'condition'">
        <span class="text-[11px] text-muted">if</span>
        <input
          :value="action.condExpr ?? ''"
          aria-label="Condition expression"
          :aria-invalid="errors.condExpr ? 'true' : undefined"
          data-test-id="lowcode-action-condition-expr"
          spellcheck="false"
          placeholder="count > 0"
          :class="[
            'min-w-0 flex-1 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
            errors.condExpr ? 'border-red-500' : 'border-border'
          ]"
          @change="patch({ condExpr: ($event.target as HTMLInputElement).value })"
        />
      </template>

      <template v-else-if="action.kind === 'confirm'">
        <input
          :value="action.messageExpr ?? ''"
          aria-label="Confirm message"
          :aria-invalid="errors.message ? 'true' : undefined"
          data-test-id="lowcode-action-confirm-message"
          spellcheck="false"
          placeholder='"Delete this?"'
          :class="[
            'min-w-0 flex-1 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
            errors.message ? 'border-red-500' : 'border-border'
          ]"
          @change="patch({ messageExpr: ($event.target as HTMLInputElement).value })"
        />
      </template>

      <template v-else-if="action.kind === 'stop'">
        <span class="text-[11px] text-muted">stop the chain</span>
      </template>

      <template v-else-if="action.kind === 'callWorkflow'">
        <select
          :value="action.workflowId ?? ''"
          aria-label="Workflow"
          :aria-invalid="errors.workflow ? 'true' : undefined"
          data-test-id="lowcode-action-workflow"
          :class="[
            'min-w-0 flex-1 rounded border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent',
            errors.workflow ? 'border-red-500' : 'border-border'
          ]"
          @change="changeWorkflow(($event.target as HTMLSelectElement).value)"
        >
          <option value="">
            {{ workflows.length === 0 ? 'No workflows yet' : 'Select a workflow…' }}
          </option>
          <option v-for="wf in workflows" :key="wf.id" :value="wf.id">{{ wf.name }}</option>
        </select>
      </template>

      <button
        type="button"
        data-test-id="lowcode-action-remove"
        class="rounded p-1 text-muted hover:bg-hover hover:text-surface"
        @click="emit('remove')"
      >
        <icon-lucide-x class="size-3" />
      </button>
    </div>

    <input
      v-if="action.kind === 'apiCall' && action.method === 'POST'"
      :value="action.bodyJson ?? ''"
      :aria-label="panels.lowcodeActionApiBody"
      :aria-invalid="errors.body ? 'true' : undefined"
      data-test-id="lowcode-action-api-body"
      spellcheck="false"
      :placeholder="panels.lowcodeActionApiBody"
      :class="[
        'min-w-0 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
        errors.body ? 'border-red-500' : 'border-border'
      ]"
      @change="patch({ bodyJson: ($event.target as HTMLInputElement).value })"
    />

    <input
      v-if="action.kind === 'supabaseAuth' && authNeedsEmail(action.operation)"
      :value="action.emailExpr ?? ''"
      :aria-label="panels.lowcodeActionAuthEmail"
      :aria-invalid="errors.email ? 'true' : undefined"
      data-test-id="lowcode-action-auth-email"
      spellcheck="false"
      :placeholder="panels.lowcodeActionAuthEmailPlaceholder"
      :class="[
        'min-w-0 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
        errors.email ? 'border-red-500' : 'border-border'
      ]"
      @change="patch({ emailExpr: ($event.target as HTMLInputElement).value })"
    />
    <input
      v-if="action.kind === 'supabaseAuth' && authNeedsPassword(action.operation)"
      :value="action.passwordExpr ?? ''"
      :aria-label="panels.lowcodeActionAuthPassword"
      :aria-invalid="errors.password ? 'true' : undefined"
      data-test-id="lowcode-action-auth-password"
      spellcheck="false"
      :placeholder="panels.lowcodeActionAuthPasswordPlaceholder"
      :class="[
        'min-w-0 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
        errors.password ? 'border-red-500' : 'border-border'
      ]"
      @change="patch({ passwordExpr: ($event.target as HTMLInputElement).value })"
    />

    <div
      v-if="action.kind === 'trackEvent'"
      data-test-id="lowcode-action-track-event-properties"
      class="flex flex-col gap-1 pl-1"
    >
      <Tip
        v-if="!analyticsConfigured"
        label="Open the empty-selection Services & Workflows panel to add a GA4, Plausible, or PostHog provider id."
      >
        <p
          data-test-id="lowcode-action-track-event-config-hint"
          class="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-500"
        >
          {{ ANALYTICS_TRACK_EVENT_CONFIG_HINT }}
        </p>
      </Tip>
      <label v-if="trackProperties.length > 0" class="text-[10px] text-muted">properties</label>
      <div
        v-for="(entry, i) in trackProperties"
        :key="i"
        data-test-id="lowcode-action-track-event-property"
        class="flex items-center gap-1"
      >
        <input
          :value="entry.key"
          aria-label="Analytics property key"
          :aria-invalid="errors.properties?.get(i)?.keyError ? 'true' : undefined"
          data-test-id="lowcode-action-track-event-property-key"
          spellcheck="false"
          placeholder="plan"
          :class="[
            'w-20 rounded border bg-input px-1.5 py-0.5 font-mono text-[11px] text-surface outline-none focus:border-accent',
            errors.properties?.get(i)?.keyError ? 'border-red-500' : 'border-border'
          ]"
          @change="updateTrackProperty(i, { key: ($event.target as HTMLInputElement).value })"
        />
        <input
          :value="entry.valueExpr"
          aria-label="Analytics property value"
          :aria-invalid="errors.properties?.get(i)?.valueError ? 'true' : undefined"
          data-test-id="lowcode-action-track-event-property-value"
          spellcheck="false"
          placeholder="selectedPlan"
          :class="[
            'min-w-0 flex-1 rounded border bg-input px-1.5 py-0.5 font-mono text-[11px] text-surface outline-none focus:border-accent',
            errors.properties?.get(i)?.valueError ? 'border-red-500' : 'border-border'
          ]"
          @change="
            updateTrackProperty(i, {
              valueExpr: ($event.target as HTMLInputElement).value
            })
          "
        />
        <button
          type="button"
          aria-label="Remove analytics property"
          data-test-id="lowcode-action-track-event-property-remove"
          class="rounded p-0.5 text-muted hover:bg-hover hover:text-surface"
          @click="removeTrackProperty(i)"
        >
          <icon-lucide-x class="size-3" />
        </button>
      </div>
      <button
        type="button"
        data-test-id="lowcode-action-track-event-property-add"
        class="self-start rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
        @click="addTrackProperty"
      >
        + property
      </button>
    </div>

    <div
      v-if="action.kind === 'stripeCheckout' || action.kind === 'stripeCustomerPortal'"
      data-test-id="lowcode-action-stripe-payload"
      class="flex flex-col gap-1 pl-1"
    >
      <p class="rounded border border-border bg-panel px-2 py-1 text-[10px] text-muted">
        Calls your server endpoint. Put Stripe secret keys only on that server, never in this
        document.
      </p>
      <label class="flex items-center gap-1 text-[11px] text-muted">
        <input
          type="checkbox"
          :checked="action.includeAuthToken ?? false"
          data-test-id="lowcode-action-stripe-auth-token"
          @change="
            patch({
              includeAuthToken: ($event.target as HTMLInputElement).checked || undefined
            })
          "
        />
        Send Supabase bearer token
      </label>
      <label v-if="(action.payloadEntries?.length ?? 0) > 0" class="text-[10px] text-muted">
        payload
      </label>
      <div
        v-for="(entry, i) in action.payloadEntries ?? []"
        :key="i"
        data-test-id="lowcode-action-stripe-payload-entry"
        class="flex items-center gap-1"
      >
        <input
          :value="entry.key"
          aria-label="Stripe payload key"
          :aria-invalid="errors.entries?.get(i)?.keyError ? 'true' : undefined"
          data-test-id="lowcode-action-stripe-payload-key"
          spellcheck="false"
          placeholder="priceId"
          :class="[
            'w-24 rounded border bg-input px-1.5 py-0.5 font-mono text-[11px] text-surface outline-none focus:border-accent',
            errors.entries?.get(i)?.keyError ? 'border-red-500' : 'border-border'
          ]"
          @change="updateStripePayloadEntry(i, { key: ($event.target as HTMLInputElement).value })"
        />
        <input
          :value="entry.valueExpr"
          aria-label="Stripe payload value"
          :aria-invalid="errors.entries?.get(i)?.valueError ? 'true' : undefined"
          data-test-id="lowcode-action-stripe-payload-value"
          spellcheck="false"
          placeholder="selectedPriceId"
          :class="[
            'min-w-0 flex-1 rounded border bg-input px-1.5 py-0.5 font-mono text-[11px] text-surface outline-none focus:border-accent',
            errors.entries?.get(i)?.valueError ? 'border-red-500' : 'border-border'
          ]"
          @change="
            updateStripePayloadEntry(i, {
              valueExpr: ($event.target as HTMLInputElement).value
            })
          "
        />
        <button
          type="button"
          aria-label="Remove Stripe payload entry"
          data-test-id="lowcode-action-stripe-payload-remove"
          class="rounded p-0.5 text-muted hover:bg-hover hover:text-surface"
          @click="removeStripePayloadEntry(i)"
        >
          <icon-lucide-x class="size-3" />
        </button>
      </div>
      <button
        type="button"
        data-test-id="lowcode-action-stripe-payload-add"
        class="self-start rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
        @click="addStripePayloadEntry"
      >
        + payload
      </button>
      <select
        :value="action.errorTarget ?? ''"
        :aria-label="
          action.kind === 'stripeCheckout'
            ? 'Stripe checkout error target'
            : 'Stripe customer portal error target'
        "
        data-test-id="lowcode-action-stripe-error-target"
        class="self-start rounded border border-border bg-input px-1.5 py-0.5 text-[11px] text-surface outline-none focus:border-accent"
        @change="patch({ errorTarget: ($event.target as HTMLSelectElement).value || undefined })"
      >
        <option value="">No error target</option>
        <option v-for="d in docStates" :key="d.id" :value="d.name">{{ d.name }}</option>
      </select>
    </div>

    <template v-if="action.kind === 'supabaseQuery'">
      <input
        :value="action.columns ?? ''"
        :aria-label="panels.lowcodeActionSupabaseColumns"
        data-test-id="lowcode-action-supabase-columns"
        spellcheck="false"
        :placeholder="panels.lowcodeActionSupabaseColumnsPlaceholder"
        class="min-w-0 rounded border border-border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent"
        @change="patch({ columns: ($event.target as HTMLInputElement).value })"
      />
      <label class="flex items-center gap-1 pl-1 text-[11px] text-muted">
        <input
          type="checkbox"
          :checked="action.single ?? false"
          data-test-id="lowcode-action-supabase-single"
          @change="patch({ single: ($event.target as HTMLInputElement).checked })"
        />
        {{ panels.lowcodeActionSupabaseSingle }}
      </label>
    </template>

    <template v-if="action.kind === 'supabaseMutation' && action.operation !== 'delete'">
      <p
        v-if="errors.payloadSourceConflict"
        data-test-id="lowcode-action-supabase-payload-source-conflict"
        class="pl-1 text-[10px] text-orange-500"
      >
        {{ panels.lowcodeActionSupabasePayloadSourceConflict }}
      </p>
      <input
        :value="action.payloadJson ?? ''"
        :aria-label="panels.lowcodeActionSupabasePayload"
        :aria-invalid="errors.payload ? 'true' : undefined"
        data-test-id="lowcode-action-supabase-payload"
        spellcheck="false"
        :placeholder="panels.lowcodeActionSupabasePayload"
        :class="[
          'min-w-0 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
          errors.payload ? 'border-red-500' : 'border-border'
        ]"
        @change="patch({ payloadJson: ($event.target as HTMLInputElement).value })"
      />
      <div class="flex flex-col gap-1 pl-1">
        <label v-if="(action.payloadEntries?.length ?? 0) > 0" class="text-[10px] text-muted">
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
            :aria-invalid="errors.entries?.get(i)?.keyError ? 'true' : undefined"
            data-test-id="lowcode-action-supabase-payload-entry-key"
            spellcheck="false"
            :placeholder="panels.lowcodeActionSupabasePayloadEntryKey"
            :class="[
              'w-20 rounded border bg-input px-1.5 py-0.5 font-mono text-[11px] text-surface outline-none focus:border-accent',
              errors.entries?.get(i)?.keyError ? 'border-red-500' : 'border-border'
            ]"
            @change="updateEntry(i, { key: ($event.target as HTMLInputElement).value })"
          />
          <input
            :value="entry.valueExpr"
            :aria-label="panels.lowcodeActionSupabasePayloadEntryValue"
            :aria-invalid="errors.entries?.get(i)?.valueError ? 'true' : undefined"
            data-test-id="lowcode-action-supabase-payload-entry-value"
            spellcheck="false"
            :placeholder="panels.lowcodeActionSupabasePayloadEntryValuePlaceholder"
            :class="[
              'min-w-0 flex-1 rounded border bg-input px-1.5 py-0.5 font-mono text-[11px] text-surface outline-none focus:border-accent',
              errors.entries?.get(i)?.valueError ? 'border-red-500' : 'border-border'
            ]"
            @change="updateEntry(i, { valueExpr: ($event.target as HTMLInputElement).value })"
          />
          <button
            type="button"
            :aria-label="panels.lowcodeActionSupabasePayloadEntryRemove"
            data-test-id="lowcode-action-supabase-payload-entry-remove"
            class="rounded p-0.5 text-muted hover:bg-hover hover:text-surface"
            @click="removeEntry(i)"
          >
            <icon-lucide-x class="size-3" />
          </button>
        </div>
        <button
          type="button"
          data-test-id="lowcode-action-supabase-payload-add-entry"
          class="self-start rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
          @click="addEntry"
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
            @change="updateFilter(i, { column: ($event.target as HTMLInputElement).value })"
          />
          <select
            :value="filter.op"
            aria-label="Filter operator"
            data-test-id="lowcode-action-supabase-filter-op"
            class="rounded border border-border bg-input px-1 py-0.5 text-[11px] text-surface outline-none focus:border-accent"
            @change="
              updateFilter(i, {
                op: ($event.target as HTMLSelectElement).value as SupabaseFilter['op']
              })
            "
          >
            <option v-for="op in SUPABASE_FILTER_OPS" :key="op" :value="op">{{ op }}</option>
          </select>
          <input
            :value="filter.valueExpr"
            :aria-label="panels.lowcodeActionValue"
            :aria-invalid="errors.filters?.has(i) ? 'true' : undefined"
            data-test-id="lowcode-action-supabase-filter-value"
            spellcheck="false"
            :placeholder="panels.lowcodeActionSupabaseFilterValuePlaceholder"
            :class="[
              'min-w-0 flex-1 rounded border bg-input px-1.5 py-0.5 font-mono text-[11px] text-surface outline-none focus:border-accent',
              errors.filters?.has(i) ? 'border-red-500' : 'border-border'
            ]"
            @change="updateFilter(i, { valueExpr: ($event.target as HTMLInputElement).value })"
          />
          <button
            type="button"
            :aria-label="panels.lowcodeActionSupabaseFilterRemove"
            data-test-id="lowcode-action-supabase-filter-remove"
            class="rounded p-0.5 text-muted hover:bg-hover hover:text-surface"
            @click="removeFilter(i)"
          >
            <icon-lucide-x class="size-3" />
          </button>
        </div>
        <button
          type="button"
          data-test-id="lowcode-action-supabase-filter-add"
          class="self-start rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
          @click="addFilter"
        >
          + {{ panels.lowcodeActionSupabaseFilterAdd }}
        </button>
      </div>
      <select
        :value="action.errorTarget ?? ''"
        :aria-label="panels.lowcodeActionSupabaseErrorTarget"
        data-test-id="lowcode-action-supabase-error-target"
        class="rounded border border-border bg-input px-1.5 py-0.5 text-[11px] text-surface outline-none focus:border-accent"
        @change="patch({ errorTarget: ($event.target as HTMLSelectElement).value || undefined })"
      >
        <option value="">{{ panels.lowcodeActionSupabaseErrorTargetNone }}</option>
        <option v-for="d in docStates" :key="d.id" :value="d.name">{{ d.name }}</option>
      </select>
    </template>

    <select
      v-if="action.kind === 'supabaseAuth'"
      :value="action.errorTarget ?? ''"
      :aria-label="panels.lowcodeActionSupabaseErrorTarget"
      data-test-id="lowcode-action-supabase-error-target"
      class="self-start rounded border border-border bg-input px-1.5 py-0.5 text-[11px] text-surface outline-none focus:border-accent"
      @change="patch({ errorTarget: ($event.target as HTMLSelectElement).value || undefined })"
    >
      <option value="">{{ panels.lowcodeActionSupabaseErrorTargetNone }}</option>
      <option v-for="d in docStates" :key="d.id" :value="d.name">{{ d.name }}</option>
    </select>

    <!-- §10 v9 result branches: apiCall / supabaseQuery / supabaseMutation -->
    <div
      v-if="
        action.kind === 'apiCall' ||
        action.kind === 'supabaseQuery' ||
        action.kind === 'supabaseMutation'
      "
      class="flex flex-col gap-1 border-l border-border pl-2"
    >
      <label class="text-[10px] text-muted">on success</label>
      <ActionList
        :actions="action.onSuccess ?? []"
        :page-states="pageStates"
        :doc-states="docStates"
        :workflows="workflows"
        :analytics-configured="analyticsConfigured"
        :action-path-prefix="`${actionPath}/onSuccess`"
        data-test-id="lowcode-action-on-success-add"
        @update:actions="updateBranch('onSuccess', $event)"
      />
      <label class="text-[10px] text-muted">on error</label>
      <ActionList
        :actions="action.onError ?? []"
        :page-states="pageStates"
        :doc-states="docStates"
        :workflows="workflows"
        :analytics-configured="analyticsConfigured"
        :action-path-prefix="`${actionPath}/onError`"
        data-test-id="lowcode-action-on-error-add"
        @update:actions="updateBranch('onError', $event)"
      />
    </div>

    <!-- §10 v10 control-flow branches: condition / confirm -->
    <div
      v-if="action.kind === 'condition' || action.kind === 'confirm'"
      class="flex flex-col gap-1 border-l border-border pl-2"
    >
      <label class="text-[10px] text-muted">{{
        action.kind === 'confirm' ? 'on confirm' : 'then'
      }}</label>
      <ActionList
        :actions="action.consequent"
        :page-states="pageStates"
        :doc-states="docStates"
        :workflows="workflows"
        :analytics-configured="analyticsConfigured"
        :action-path-prefix="`${actionPath}/consequent`"
        data-test-id="lowcode-action-consequent-add"
        @update:actions="updateBranch('consequent', $event)"
      />
      <label class="text-[10px] text-muted">{{
        action.kind === 'confirm' ? 'on cancel' : 'else'
      }}</label>
      <ActionList
        :actions="action.alternate ?? []"
        :page-states="pageStates"
        :doc-states="docStates"
        :workflows="workflows"
        :analytics-configured="analyticsConfigured"
        :action-path-prefix="`${actionPath}/alternate`"
        data-test-id="lowcode-action-alternate-add"
        @update:actions="updateBranch('alternate', $event)"
      />
    </div>

    <!-- §10 v11 callWorkflow args: one expression input per formal parameter of
         the selected workflow (caller-scope expressions). -->
    <div
      v-if="action.kind === 'callWorkflow' && callWorkflowArgs.length > 0"
      data-test-id="lowcode-action-workflow-args"
      class="flex flex-col gap-1 border-l border-border pl-2"
    >
      <label class="text-[10px] text-muted">arguments</label>
      <div v-for="arg in callWorkflowArgs" :key="arg.name" class="flex flex-col gap-0.5">
        <div class="flex items-center gap-1">
          <Tip :label="arg.name">
            <label class="w-20 shrink-0 truncate text-[11px] text-muted">{{ arg.name }}</label>
          </Tip>
          <input
            :value="arg.value"
            :aria-label="`Argument ${arg.name}`"
            :aria-invalid="errors.argErrors?.has(arg.name) ? 'true' : undefined"
            data-test-id="lowcode-action-workflow-arg"
            spellcheck="false"
            :placeholder="arg.optional ? 'optional' : 'expression'"
            :class="[
              'min-w-0 flex-1 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
              errors.argErrors?.has(arg.name) ? 'border-red-500' : 'border-border'
            ]"
            @change="setArg(arg.name, ($event.target as HTMLInputElement).value)"
          />
        </div>
        <p
          v-if="errors.argErrors?.has(arg.name)"
          data-test-id="lowcode-action-workflow-arg-error"
          class="pl-1 text-[10px] text-red-500"
        >
          {{ arg.name }}: {{ errors.argErrors?.get(arg.name) }}
        </p>
      </div>
    </div>

    <p
      v-if="errors.workflow"
      data-test-id="lowcode-action-workflow-error"
      class="pl-1 text-[10px] text-red-500"
    >
      workflow: {{ errors.workflow }}
    </p>

    <p
      v-if="errors.email"
      data-test-id="lowcode-action-auth-email-error"
      class="pl-1 text-[10px] text-red-500"
    >
      email: {{ errors.email }}
    </p>
    <p
      v-if="errors.password"
      data-test-id="lowcode-action-auth-password-error"
      class="pl-1 text-[10px] text-red-500"
    >
      password: {{ errors.password }}
    </p>
    <p
      v-if="action.kind === 'supabaseAuth'"
      data-test-id="lowcode-action-auth-current-user-hint"
      class="pl-1 text-[10px] text-muted"
    >
      {{ panels.lowcodeActionAuthCurrentUserHint }}
    </p>
    <p
      v-if="action.kind === 'supabaseAuth' && action.operation === 'signUp'"
      data-test-id="lowcode-action-auth-signup-note"
      class="pl-1 text-[10px] text-muted"
    >
      {{ panels.lowcodeActionAuthSignUpNote }}
    </p>
    <p
      v-if="action.kind === 'supabaseAuth' && action.operation === 'resetPassword'"
      data-test-id="lowcode-action-auth-reset-note"
      class="pl-1 text-[10px] text-muted"
    >
      {{ panels.lowcodeActionAuthResetNote }}
    </p>
    <p
      v-if="action.kind === 'supabaseAuth' && action.operation === 'updatePassword'"
      data-test-id="lowcode-action-auth-update-note"
      class="pl-1 text-[10px] text-muted"
    >
      {{ panels.lowcodeActionAuthUpdateNote }}
    </p>
    <p
      v-if="errors.target"
      data-test-id="lowcode-action-target-error"
      class="pl-1 text-[10px] text-red-500"
    >
      target: {{ errors.target }}
    </p>
    <p
      v-if="errors.table"
      data-test-id="lowcode-action-table-error"
      class="pl-1 text-[10px] text-red-500"
    >
      table: {{ errors.table }}
    </p>
    <p
      v-if="errors.payload"
      data-test-id="lowcode-action-payload-error"
      class="pl-1 text-[10px] text-red-500"
    >
      payload: {{ errors.payload }}
    </p>
    <p
      v-if="errors.url"
      data-test-id="lowcode-action-url-error"
      class="pl-1 text-[10px] text-red-500"
    >
      url: {{ errors.url }}
    </p>
    <p
      v-if="action.kind === 'apiCall' && !errors.url"
      data-test-id="lowcode-action-api-url-hint"
      class="pl-1 text-[10px] text-muted"
    >
      {{ panels.lowcodeActionApiUrlHint }}
    </p>
    <p
      v-if="errors.body"
      data-test-id="lowcode-action-body-error"
      class="pl-1 text-[10px] text-red-500"
    >
      body: {{ errors.body }}
    </p>
    <p
      v-if="errors.expr"
      data-test-id="lowcode-action-expr-error"
      class="pl-1 text-[10px] text-red-500"
    >
      expression: {{ errors.expr }}
    </p>
    <p
      v-if="errors.condExpr"
      data-test-id="lowcode-action-cond-error"
      class="pl-1 text-[10px] text-red-500"
    >
      condition: {{ errors.condExpr }}
    </p>
    <p
      v-if="errors.message"
      data-test-id="lowcode-action-message-error"
      class="pl-1 text-[10px] text-red-500"
    >
      message: {{ errors.message }}
    </p>
    <p
      v-if="errors.ms"
      data-test-id="lowcode-action-ms-error"
      class="pl-1 text-[10px] text-red-500"
    >
      delay: {{ errors.ms }}
    </p>
    <p
      v-if="errors.to"
      data-test-id="lowcode-action-to-error"
      class="pl-1 text-[10px] text-red-500"
    >
      to: {{ errors.to }}
    </p>
  </li>
</template>
