<script setup lang="ts">
import type { DocumentStateDef, StateValueType } from '@open-pencil/core/scene-graph'
import { useI18n, useSceneComputed } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'

import { useEditorStore } from '@/app/editor/active-store'
import { usePresenceTarget } from '@/app/editor/presence/use-presence-target'
import {
  STATE_VALUE_TYPES,
  defaultAsString,
  useStateRowEditor
} from './state-row-editor'

const editor = useEditorStore()
const sectionCls = useSectionUI()
const { panels } = useI18n()
const presence = usePresenceTarget('docState')

// Phase 2 §2 #c — document-level "Document State" lives on the root node
// (`graph.rootId`) only, distinct from page-scoped `state`. Shown in the
// no-node-selected branch between StatePanel and VariablesSection.
const states = useSceneComputed<DocumentStateDef[]>(() => {
  const root = editor.graph.getNode(editor.graph.rootId)
  return root?.lowcodeDocumentState ?? []
})

// Row editing is shared with StatePanel via the composable; only the commit
// target (root node's `lowcodeDocumentState`) differs.
const {
  valueErrors,
  nameErrors,
  addState,
  removeState,
  renameState,
  changeType,
  changeDefault
} = useStateRowEditor({
  states,
  commit: (next) =>
    editor.updateNodeWithUndo(
      editor.graph.rootId,
      { lowcodeDocumentState: next },
      'Update document state'
    ),
  defaultName: 'value'
})
</script>

<template>
  <div
    data-test-id="lowcode-document-state-section"
    :class="sectionCls.wrapper"
    @focusin="presence.onFocusIn"
    @focusout="presence.onFocusOut"
  >
    <div class="mb-1.5 flex items-center justify-between">
      <label class="text-[11px] text-muted">{{ panels.lowcodeDocumentState }}</label>
      <button
        type="button"
        data-test-id="lowcode-document-state-add"
        class="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
        @click="addState"
      >
        + {{ panels.lowcodeDocumentStateAdd }}
      </button>
    </div>

    <p v-if="states.length === 0" class="text-[11px] text-muted">
      {{ panels.lowcodeDocumentStateEmpty }}
    </p>

    <ul v-else class="flex flex-col gap-1.5">
      <li
        v-for="state in states"
        :key="state.id"
        data-test-id="lowcode-document-state-row"
        class="flex flex-col gap-0.5"
      >
        <div class="flex items-center gap-1">
        <input
          :value="state.name"
          :aria-label="panels.lowcodeStateName"
          :aria-invalid="nameErrors.has(state.id) ? 'true' : undefined"
          data-test-id="lowcode-document-state-name"
          :class="[
            'min-w-0 flex-1 rounded border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent',
            nameErrors.has(state.id) ? 'border-red-500' : 'border-border'
          ]"
          @change="renameState(state.id, ($event.target as HTMLInputElement).value)"
        />
        <select
          :value="state.type"
          :aria-label="panels.lowcodeStateType"
          data-test-id="lowcode-document-state-type"
          class="rounded border border-border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent"
          @change="changeType(state.id, ($event.target as HTMLSelectElement).value as StateValueType)"
        >
          <option v-for="t in STATE_VALUE_TYPES" :key="t" :value="t">{{ t }}</option>
        </select>
        <select
          v-if="state.type === 'boolean'"
          :value="defaultAsString(state.defaultValue)"
          :aria-label="panels.lowcodeStateDefault"
          data-test-id="lowcode-document-state-default"
          class="w-16 rounded border border-border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent"
          @change="changeDefault(state.id, ($event.target as HTMLSelectElement).value, 'boolean')"
        >
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
        <input
          v-else
          :value="defaultAsString(state.defaultValue)"
          :type="state.type === 'number' ? 'number' : 'text'"
          :aria-label="panels.lowcodeStateDefault"
          :aria-invalid="valueErrors.has(state.id) ? 'true' : undefined"
          data-test-id="lowcode-document-state-default"
          spellcheck="false"
          :placeholder="
            state.type === 'array'
              ? '[{&quot;name&quot;:&quot;Alice&quot;}]'
              : state.type === 'object'
                ? '{&quot;a&quot;:1}'
                : undefined
          "
          :class="[
            'rounded border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent',
            state.type === 'array' || state.type === 'object'
              ? 'min-w-0 flex-1 font-mono'
              : 'w-20',
            valueErrors.has(state.id) ? 'border-red-500' : 'border-border'
          ]"
          @change="changeDefault(state.id, ($event.target as HTMLInputElement).value, state.type)"
        />
        <button
          type="button"
          :aria-label="panels.lowcodeDocumentStateAdd"
          data-test-id="lowcode-document-state-remove"
          class="rounded p-1 text-muted hover:bg-hover hover:text-surface"
          @click="removeState(state.id)"
        >
          <icon-lucide-x class="size-3" />
        </button>
        </div>
        <p
          v-if="nameErrors.has(state.id)"
          data-test-id="lowcode-document-state-name-error"
          class="pl-1 text-[10px] text-red-500"
        >
          {{ nameErrors.get(state.id) }}
        </p>
        <p
          v-if="valueErrors.has(state.id)"
          data-test-id="lowcode-document-state-default-error"
          class="pl-1 text-[10px] text-red-500"
        >
          {{ valueErrors.get(state.id) }}
        </p>
      </li>
    </ul>
  </div>
</template>
