<script setup lang="ts">
import { computed } from 'vue'

import type { JsonObject } from '@open-pencil/scene-graph/primitives'
import { useI18n, useSceneComputed, useSelectionState } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'

import { useEditorStore } from '@/app/editor/active-store'
import { usePresenceTarget } from '@/app/editor/presence/use-presence-target'

import {
  INTERACTIVE_PROP_FIELDS,
  INTERACTIVE_PROP_VALIDATORS,
  INTERACTIVE_WARNING_KEYS,
  type InteractiveField
} from './interactive-fields'

// Phase 3 §3.v6 — generic interactiveProps editor. Renders the fields declared
// for the selected node type in `interactive-fields.ts`, one editor per
// `field.kind`. Replaces the bespoke InteractiveOptionsPanel; the field set is
// the systemic fix for the recurring "interactiveProps has no UI" gap class.

type Props = Record<string, unknown>

const editor = useEditorStore()
const sectionCls = useSectionUI()
const { panels } = useI18n()
const { selectedNode } = useSelectionState()
const presence = usePresenceTarget('interactiveProps', () => selectedNode.value?.id)

const ip = useSceneComputed<Props>(() => (selectedNode.value?.interactiveProps ?? {}) as Props)

const fields = computed<InteractiveField[]>(() => {
  const type = selectedNode.value?.type
  return type ? (INTERACTIVE_PROP_FIELDS[type] ?? []) : []
})

const visibleFields = computed(() =>
  fields.value.filter((f) => (f.visibleWhen ? f.visibleWhen(ip.value) : true))
)

// Phase 3 §3.v7 — per-NodeType validation surfaced as a warning bar. Format
// errors are also dropped from emit / rejected at the tool boundary; range
// issues are warn-and-keep (decision §3.v7.2 h).
const warnings = computed(() => {
  const type = selectedNode.value?.type
  const validate = type ? INTERACTIVE_PROP_VALIDATORS[type] : undefined
  return validate ? validate(ip.value) : []
})

function warningText(code: string): string {
  return t(INTERACTIVE_WARNING_KEYS[code] ?? code)
}

function t(key: string | undefined): string {
  if (!key) return ''
  const value = panels.value[key as keyof typeof panels.value]
  return typeof value === 'string' ? value : key
}

function commit(patch: Props): void {
  const node = selectedNode.value
  if (!node) return
  const merged: Props = { ...ip.value, ...patch }
  editor.updateNodeWithUndo(
    node.id,
    { interactiveProps: merged as JsonObject },
    'Update properties'
  )
}

function stringValue(key: string): string {
  const raw = ip.value[key]
  return typeof raw === 'string' ? raw : ''
}

function boolValue(key: string): boolean {
  return ip.value[key] === true
}

function arrayValue(key: string): string[] {
  const raw = ip.value[key]
  return Array.isArray(raw) ? raw.filter((o): o is string => typeof o === 'string') : []
}

// Empty text / date clears the field so emit falls back to its default
// (mirrors §3.v3 button-text). Boolean stores `true` only, deletes on false
// to match the compiler's `ip.checked === true` read.
function onTextInput(key: string, value: string): void {
  const next: Props = { ...ip.value }
  if (value === '') Reflect.deleteProperty(next, key)
  else next[key] = value
  commit(next)
}

function onBoolInput(key: string, checked: boolean): void {
  const next: Props = { ...ip.value }
  if (checked) next[key] = true
  else Reflect.deleteProperty(next, key)
  commit(next)
}

function onEnumInput(key: string, value: string): void {
  onTextInput(key, value)
}

function addOption(key: string): void {
  commit({ [key]: [...arrayValue(key), ''] })
}

function removeOption(key: string, index: number): void {
  commit({ [key]: arrayValue(key).filter((_, i) => i !== index) })
}

function updateOption(key: string, index: number, value: string): void {
  commit({ [key]: arrayValue(key).map((o, i) => (i === index ? value : o)) })
}
</script>

<template>
  <div
    v-if="visibleFields.length > 0"
    data-test-id="lowcode-interactive-props"
    :class="sectionCls.wrapper"
    @focusin="presence.onFocusIn"
    @focusout="presence.onFocusOut"
  >
    <label class="mb-1.5 block text-[11px] text-muted">{{ t('lowcodeInteractiveProps') }}</label>

    <div v-for="field in visibleFields" :key="field.key" class="mb-1.5 flex flex-col gap-0.5">
      <label class="text-[10px] text-muted">{{ t(field.labelKey) }}</label>

      <!-- text / date -->
      <input
        v-if="field.kind === 'text' || field.kind === 'date'"
        :type="field.kind === 'date' ? 'date' : 'text'"
        :value="stringValue(field.key)"
        :aria-label="t(field.labelKey)"
        :data-test-id="`lowcode-interactive-${field.key}`"
        spellcheck="false"
        :placeholder="t(field.placeholderKey)"
        class="w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
        @change="onTextInput(field.key, ($event.target as HTMLInputElement).value)"
      />

      <!-- boolean -->
      <input
        v-else-if="field.kind === 'boolean'"
        type="checkbox"
        :checked="boolValue(field.key)"
        :aria-label="t(field.labelKey)"
        :data-test-id="`lowcode-interactive-${field.key}`"
        class="size-3.5 self-start accent-accent"
        @change="onBoolInput(field.key, ($event.target as HTMLInputElement).checked)"
      />

      <!-- enum (select from a sibling string[] field) -->
      <select
        v-else-if="field.kind === 'enum'"
        :value="stringValue(field.key)"
        :aria-label="t(field.labelKey)"
        :data-test-id="`lowcode-interactive-${field.key}`"
        class="w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
        @change="onEnumInput(field.key, ($event.target as HTMLSelectElement).value)"
      >
        <option value="">{{ t('lowcodeInteractiveDefaultSelectedNone') }}</option>
        <option v-for="opt in arrayValue(field.optionsFrom ?? '')" :key="opt" :value="opt">
          {{ opt }}
        </option>
      </select>

      <!-- string-array (options list) -->
      <div v-else-if="field.kind === 'string-array'" class="flex flex-col gap-1">
        <div
          v-for="(opt, i) in arrayValue(field.key)"
          :key="i"
          data-test-id="lowcode-interactive-option"
          class="flex items-center gap-1"
        >
          <input
            :value="opt"
            :aria-label="panels.lowcodeInteractiveOptionValue"
            data-test-id="lowcode-interactive-option-input"
            spellcheck="false"
            :placeholder="panels.lowcodeInteractiveOptionPlaceholder"
            class="min-w-0 flex-1 rounded border border-border bg-input px-1.5 py-0.5 text-[11px] text-surface outline-none focus:border-accent"
            @change="updateOption(field.key, i, ($event.target as HTMLInputElement).value)"
          />
          <button
            type="button"
            :aria-label="panels.lowcodeInteractiveOptionRemove"
            data-test-id="lowcode-interactive-option-remove"
            class="rounded p-0.5 text-muted hover:bg-hover hover:text-surface"
            @click="removeOption(field.key, i)"
          >
            <icon-lucide-x class="size-3" />
          </button>
        </div>
        <button
          type="button"
          data-test-id="lowcode-interactive-option-add"
          class="self-start rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
          @click="addOption(field.key)"
        >
          + {{ panels.lowcodeInteractiveOptionAdd }}
        </button>
        <p v-if="field.hintKey" class="pl-0.5 text-[10px] text-muted">{{ t(field.hintKey) }}</p>
      </div>
    </div>

    <div v-if="warnings.length > 0" data-test-id="lowcode-interactive-warning" class="mt-1">
      <p v-for="issue in warnings" :key="issue.code" class="text-[10px] text-orange-500">
        {{ warningText(issue.code) }}
      </p>
    </div>
  </div>
</template>
