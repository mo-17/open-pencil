<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

import type { ActionDef, DocumentStateDef, StateDef, WorkflowDef } from '@open-pencil/scene-graph'

import { flashLowcodeFocusHighlight } from '@/app/lowcode/focus-highlight'
import ActionList from './ActionList.vue'

/**
 * Phase 3 §10 v11 — one row of the `WorkflowsPanel`: edits a single named
 * `WorkflowDef`. Surfaces the workflow's label, its formal parameters (each with
 * an optional default expression / omitted-argument toggle → `params` +
 * `paramDefaults` + `optionalParams`), and its action chain via the same
 * recursive `ActionList` editor used for node events — so a workflow body can
 * itself contain control-flow / result branches and even nested `callWorkflow`s.
 * Emits the whole new workflow on every edit; the panel owns persistence / undo.
 */
const { workflow, workflows, pages, pageStates, docStates, analyticsConfigured } = defineProps<{
  workflow: WorkflowDef
  /** The full workflow list, so a nested `callWorkflow` can target peers. */
  workflows: readonly WorkflowDef[]
  pages: readonly { id: string; name: string }[]
  pageStates: readonly StateDef[]
  docStates: readonly DocumentStateDef[]
  analyticsConfigured?: boolean
}>()

const emit = defineEmits<{
  'update:workflow': [WorkflowDef]
  remove: []
}>()
const rowEl = ref<HTMLElement | null>(null)

function selectorValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&')
}

defineExpose({
  focusRow(): void {
    rowEl.value?.scrollIntoView({ block: 'nearest' })
    rowEl.value?.focus({ preventScroll: true })
    flashLowcodeFocusHighlight(rowEl.value)
  },
  async focusAction(actionPath: string): Promise<boolean> {
    await nextTick()
    const actionRow = rowEl.value?.querySelector<HTMLElement>(
      `[data-lowcode-action-path="${selectorValue(actionPath)}"]`
    )
    if (!actionRow) return false
    actionRow.scrollIntoView({ block: 'nearest' })
    actionRow.focus({ preventScroll: true })
    flashLowcodeFocusHighlight(actionRow)
    return true
  }
})

// Mirrors `validateWorkflowParams` in tools/modify/lowcode.ts: a plain
// identifier, deliberately excluding `$` so a param never shadows $prev / $event
// / $currentUser.
const PARAM_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

interface ParamRow {
  name: string
  default: string
  optional: boolean
}

const paramRows = computed<ParamRow[]>(() => {
  const defaults = workflow.paramDefaults ?? {}
  const optional = new Set(workflow.optionalParams)
  return (workflow.params ?? []).map((name) => ({
    name,
    default: Object.hasOwn(defaults, name) ? defaults[name] : '',
    optional: optional.has(name)
  }))
})

const paramErrors = computed<Map<number, string>>(() => {
  const out = new Map<number, string>()
  const seen = new Set<string>()
  paramRows.value.forEach((r, i) => {
    if (r.name.trim() === '') out.set(i, 'name required')
    else if (!PARAM_RE.test(r.name)) out.set(i, 'invalid identifier')
    else if (seen.has(r.name)) out.set(i, 'duplicate')
    else seen.add(r.name)
  })
  return out
})

function setName(name: string): void {
  emit('update:workflow', { ...workflow, name })
}

function setPageId(pageId: string): void {
  emit('update:workflow', { ...workflow, pageId: pageId || undefined })
}

function updateActions(next: ActionDef[]): void {
  emit('update:workflow', { ...workflow, actions: next })
}

// Rebuild params + paramDefaults + optionalParams from the edited rows. Empty
// lists collapse to undefined so a parameterless workflow round-trips
// byte-identically. Rename/remove naturally rewrites optionalParams to the
// surviving rows, avoiding stale MCP-authored parameter names.
function commitParams(rows: ParamRow[]): void {
  const params = rows.map((r) => r.name)
  const paramDefaults: Record<string, string> = {}
  const optionalParams: string[] = []
  for (const r of rows) {
    if (r.default.trim() !== '') paramDefaults[r.name] = r.default
    if (r.optional) optionalParams.push(r.name)
  }
  emit('update:workflow', {
    ...workflow,
    params: params.length > 0 ? params : undefined,
    paramDefaults: Object.keys(paramDefaults).length > 0 ? paramDefaults : undefined,
    optionalParams: optionalParams.length > 0 ? optionalParams : undefined
  })
}

function uniqueParamName(): string {
  const used = new Set(paramRows.value.map((r) => r.name))
  if (!used.has('param')) return 'param'
  let n = 2
  while (used.has(`param${n}`)) n += 1
  return `param${n}`
}

function addParam(): void {
  commitParams([...paramRows.value, { name: uniqueParamName(), default: '', optional: false }])
}
function removeParam(index: number): void {
  commitParams(paramRows.value.filter((_, i) => i !== index))
}
function setParamName(index: number, name: string): void {
  commitParams(paramRows.value.map((r, i) => (i === index ? { ...r, name } : r)))
}
function setParamDefault(index: number, def: string): void {
  commitParams(paramRows.value.map((r, i) => (i === index ? { ...r, default: def } : r)))
}
function setParamOptional(index: number, optional: boolean): void {
  commitParams(paramRows.value.map((r, i) => (i === index ? { ...r, optional } : r)))
}
</script>

<template>
  <li
    ref="rowEl"
    data-test-id="lowcode-workflow-row"
    :data-workflow-id="workflow.id"
    tabindex="-1"
    class="flex flex-col gap-1.5 rounded border border-border p-2 transition-colors"
  >
    <div class="flex items-center gap-1">
      <input
        :value="workflow.name"
        aria-label="Workflow name"
        data-test-id="lowcode-workflow-name"
        spellcheck="false"
        class="min-w-0 flex-1 rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
        @change="setName(($event.target as HTMLInputElement).value)"
      />
      <select
        :value="workflow.pageId ?? ''"
        aria-label="Workflow page scope"
        data-test-id="lowcode-workflow-page"
        class="max-w-28 rounded border border-border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent"
        @change="setPageId(($event.target as HTMLSelectElement).value)"
      >
        <option value="">current page</option>
        <option v-for="page in pages" :key="page.id" :value="page.id">{{ page.name }}</option>
      </select>
      <button
        type="button"
        aria-label="Remove workflow"
        data-test-id="lowcode-workflow-remove"
        class="rounded p-1 text-muted hover:bg-hover hover:text-surface"
        @click="emit('remove')"
      >
        <icon-lucide-x class="size-3" />
      </button>
    </div>

    <div class="flex flex-col gap-1 border-l border-border pl-2">
      <div class="flex items-center justify-between">
        <label class="text-[10px] text-muted">parameters</label>
        <button
          type="button"
          data-test-id="lowcode-workflow-param-add"
          class="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
          @click="addParam"
        >
          + param
        </button>
      </div>
      <div
        v-for="(p, i) in paramRows"
        :key="i"
        data-test-id="lowcode-workflow-param-row"
        class="flex flex-col gap-0.5"
      >
        <div class="flex items-center gap-1">
          <input
            :value="p.name"
            aria-label="Parameter name"
            :aria-invalid="paramErrors.has(i) ? 'true' : undefined"
            data-test-id="lowcode-workflow-param-name"
            spellcheck="false"
            :class="[
              'w-24 min-w-0 rounded border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent',
              paramErrors.has(i) ? 'border-red-500' : 'border-border'
            ]"
            @change="setParamName(i, ($event.target as HTMLInputElement).value)"
          />
          <input
            :value="p.default"
            aria-label="Parameter default expression"
            data-test-id="lowcode-workflow-param-default"
            spellcheck="false"
            placeholder="default (optional)"
            class="min-w-0 flex-1 rounded border border-border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent"
            @change="setParamDefault(i, ($event.target as HTMLInputElement).value)"
          />
          <label class="flex shrink-0 items-center gap-1 text-[10px] text-muted">
            <input
              type="checkbox"
              :checked="p.optional"
              aria-label="Optional parameter"
              data-test-id="lowcode-workflow-param-optional"
              class="size-3 accent-accent"
              @change="setParamOptional(i, ($event.target as HTMLInputElement).checked)"
            />
            optional
          </label>
          <button
            type="button"
            aria-label="Remove parameter"
            data-test-id="lowcode-workflow-param-remove"
            class="rounded p-1 text-muted hover:bg-hover hover:text-surface"
            @click="removeParam(i)"
          >
            <icon-lucide-x class="size-3" />
          </button>
        </div>
        <p
          v-if="paramErrors.has(i)"
          data-test-id="lowcode-workflow-param-error"
          class="pl-1 text-[10px] text-red-500"
        >
          {{ paramErrors.get(i) }}
        </p>
      </div>
    </div>

    <div class="flex flex-col gap-1 border-l border-border pl-2">
      <label class="text-[10px] text-muted">actions</label>
      <ActionList
        :actions="workflow.actions"
        :page-states="pageStates"
        :doc-states="docStates"
        :workflows="workflows"
        :analytics-configured="analyticsConfigured"
        data-test-id="lowcode-workflow-action-add"
        @update:actions="updateActions"
      />
    </div>
  </li>
</template>
