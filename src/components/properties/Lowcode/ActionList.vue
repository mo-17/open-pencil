<script setup lang="ts">
import type {
  ActionDef,
  DocumentStateDef,
  StateDef,
  WorkflowDef
} from '@open-pencil/core/scene-graph'
import { useI18n } from '@open-pencil/vue'

import { makeAction } from './action-factory'
// Mutually recursive with ActionRow (a list renders rows, a row renders nested
// branch lists) — intentional cycle, resolved lazily at render time.
// eslint-disable-next-line import/no-cycle
import ActionRow from './ActionRow.vue'

/**
 * Phase 3 §10 v10 — a controlled, recursive list of workflow actions. Renders
 * one `ActionRow` per action plus an "add" button; `ActionRow` recurses back
 * into `ActionList` for nested branches (condition/confirm, onSuccess/onError),
 * so the full workflow tree is editable at any depth. Emits the whole new array
 * on every edit (the parent owns persistence / undo).
 */
const {
  actions,
  pageStates,
  docStates,
  workflows,
  analyticsConfigured,
  actionPathPrefix,
  addTestId
} = defineProps<{
  actions: readonly ActionDef[]
  pageStates: readonly StateDef[]
  docStates: readonly DocumentStateDef[]
  /** §10 v11 — named workflows a `callWorkflow` row can target / pass args to. */
  workflows: readonly WorkflowDef[]
  analyticsConfigured?: boolean
  actionPathPrefix?: string
  /** Test id for the add button (top-level keeps `lowcode-action-add`; nested
   *  branches pass a branch-specific id). */
  addTestId?: string
}>()

const emit = defineEmits<{
  'update:actions': [ActionDef[]]
}>()

const { panels } = useI18n()

function replaceAt(index: number, next: ActionDef): void {
  emit(
    'update:actions',
    actions.map((a, i) => (i === index ? next : a))
  )
}
function removeAt(index: number): void {
  emit(
    'update:actions',
    actions.filter((_, i) => i !== index)
  )
}
function add(): void {
  emit('update:actions', [
    ...actions,
    makeAction('setState', crypto.randomUUID(), { pageStates, docStates })
  ])
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <ul v-if="actions.length > 0" class="flex flex-col gap-1.5">
      <ActionRow
        v-for="(action, i) in actions"
        :key="action.id"
        :action="action"
        :page-states="pageStates"
        :doc-states="docStates"
        :workflows="workflows"
        :analytics-configured="analyticsConfigured"
        :action-path="actionPathPrefix ? `${actionPathPrefix}[${i}]` : `[${i}]`"
        @update:action="replaceAt(i, $event)"
        @remove="removeAt(i)"
      />
    </ul>
    <button
      type="button"
      :data-test-id="addTestId ?? 'lowcode-action-add'"
      class="self-start rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
      @click="add"
    >
      + {{ panels.lowcodeActionAdd }}
    </button>
  </div>
</template>
