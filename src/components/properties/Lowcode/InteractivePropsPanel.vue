<script setup lang="ts">
import { isEqual } from 'es-toolkit'
import { computed } from 'vue'

import { colorToHex, parseColor } from '@open-pencil/core/color'
import { validateDateTimeInputProps } from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'
import type { Color, JSONObject } from '@open-pencil/scene-graph/primitives'
import { MIXED, usePanelMessages, useSceneComputed, useSelectionState } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { usePresenceTarget } from '@/app/editor/presence/use-presence-target'
import { changeInputType } from '@/app/lowcode/controls/input-properties'
import ColorInput from '@/components/ColorPicker/ColorInput.vue'
import NumberField from '@/components/inputs/NumberField.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import { useSectionUI } from '@/components/ui/section'
import AppSelect from '@/components/ui/select/AppSelect.vue'
import AppCheckbox from '@/components/ui/toggle/AppCheckbox.vue'

import InputColorValueField from './InputColorValueField.vue'
import InputSuggestionsField from './InputSuggestionsField.vue'
import {
  INTERACTIVE_PROP_FIELDS,
  INTERACTIVE_PROP_VALIDATORS,
  INTERACTIVE_WARNING_KEYS,
  type InteractiveField
} from './interactive-fields'
import InteractiveTextField from './InteractiveTextField.vue'
import RadioOptionsField from './RadioOptionsField.vue'
import SelectOptionsField from './SelectOptionsField.vue'

// Phase 3 §3.v6 — generic interactiveProps editor. Renders the fields declared
// for the selected node type in `interactive-fields.ts`, one editor per
// `field.kind`. Replaces the bespoke InteractiveOptionsPanel; the field set is
// the systemic fix for the recurring "interactiveProps has no UI" gap class.

type Props = Record<string, unknown>

const editor = useEditorStore()
const sectionCls = useSectionUI()
const panels = usePanelMessages()
const { selectedNode } = useSelectionState()
const presence = usePresenceTarget('interactiveProps', () => selectedNode.value?.id)

const ip = useSceneComputed<Props>(() => (selectedNode.value?.interactiveProps ?? {}) as Props)
// Selection-state nodes are defensive copies. Retain the actual graph node as the write owner.
const selectedOwner = useSceneComputed(() => {
  const id = selectedNode.value?.id
  return id ? editor.graph.getNode(id) : undefined
})

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

function replaceProps(next: Props): void {
  const node = selectedNode.value
  if (!node) return
  editor.updateNodeWithUndo(node.id, { interactiveProps: next as JSONObject }, 'Update properties')
}

function commit(patch: Props): void {
  replaceProps({ ...ip.value, ...patch })
}

function stringValue(key: string): string {
  const raw = ip.value[key]
  return typeof raw === 'string' ? raw : ''
}

function boolValue(key: string): boolean {
  return ip.value[key] === true
}

function numberValue(key: string): number | symbol {
  const value = ip.value[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : MIXED
}

function commitNumber(key: string, value: number): void {
  if (!Number.isFinite(value) || (key === 'step' && value <= 0)) return
  if (
    key === 'step' &&
    ['time', 'datetime-local'].includes(String(ip.value.inputType)) &&
    !Number.isInteger(value)
  )
    return
  commit({ [key]: value })
}

function clearProperty(key: string): void {
  const next = { ...ip.value }
  Reflect.deleteProperty(next, key)
  replaceProps(next)
}

function choices(field: InteractiveField): { value: string; label: string }[] {
  return [
    { value: '__openpencil_default__', label: panels.value.lowcodeInteractiveDefaultSelectedNone },
    ...(field.choices ?? arrayValue(field.optionsFrom ?? '')).map((value) => ({
      value,
      label: field.choiceLabelKeys?.[value] ? t(field.choiceLabelKeys[value]) : value
    }))
  ]
}

const stepperChoices = computed(() => [
  { value: '__openpencil_default__', label: panels.value.lowcodeInputStepperDefault },
  { value: 'true', label: panels.value.lowcodeInputStepperCustom },
  { value: 'false', label: panels.value.lowcodeInputStepperHidden }
])

function commitOptionalBoolean(key: string, value: string): void {
  if (value === '__openpencil_default__') clearProperty(key)
  else if (value === 'true' || value === 'false') commit({ [key]: value === 'true' })
}

function dateTimeDraftError(key: string, value: string): string | undefined {
  const issue = validateDateTimeInputProps({ ...ip.value, [key]: value }).find(
    (item) =>
      item.severity === 'error' &&
      (item.key === key || item.code === 'date-time-input-range-inverted')
  )
  return issue ? warningText(issue.code) : undefined
}

function isCurrentOwner(owner: SceneNode | undefined): boolean {
  return (
    !!owner &&
    editor.graph.getNode(owner.id) === owner &&
    editor.state.selectedIds.size === 1 &&
    editor.state.selectedIds.has(owner.id)
  )
}

function commitText(key: string, value: string, owner: SceneNode | undefined): void {
  if (isCurrentOwner(owner)) onTextInput(key, value)
}

function commitSuggestions(values: string[], owner: SceneNode | undefined, previous: Props): void {
  if (isCurrentOwner(owner) && isEqual(owner?.interactiveProps, previous))
    replaceProps({ ...ip.value, suggestions: values })
}

function commitRadioOptions(next: Props, owner: SceneNode | undefined): void {
  if (isCurrentOwner(owner) && owner?.type === 'RADIO') replaceProps(next)
}

function commitSelectOptions(next: Props, owner: SceneNode | undefined, previous: Props): void {
  if (
    isCurrentOwner(owner) &&
    owner?.type === 'SELECT' &&
    isEqual(owner.interactiveProps, previous)
  )
    replaceProps(next)
}

function colorValue(field: InteractiveField): Color {
  return parseColor(stringValue(field.key) || field.defaultValue || '#000000')
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
  replaceProps(next)
}

function onBoolInput(key: string, checked: boolean): void {
  const next: Props = { ...ip.value }
  if (checked) next[key] = true
  else Reflect.deleteProperty(next, key)
  if (key === 'allowClear' && checked && !stringValue('placeholder')) {
    next.placeholder = panels.value.lowcodeSelectPlaceholderExample
  }
  replaceProps(next)
}

function onColorInput(key: string, color: Color): void {
  onTextInput(key, colorToHex(color))
}

function onEnumInput(key: string, value: string): void {
  if (key === 'inputType') {
    replaceProps(changeInputType(ip.value, value === '__openpencil_default__' ? '' : value))
    return
  }
  onTextInput(key, value === '__openpencil_default__' ? '' : value)
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

    <div
      v-for="field in visibleFields"
      :key="`${selectedNode?.id}:${field.key}`"
      class="mb-1.5 flex flex-col gap-0.5"
    >
      <label class="text-[10px] text-muted">{{ t(field.labelKey) }}</label>

      <InputColorValueField
        v-if="field.kind === 'color-value'"
        :owner="selectedOwner"
        :model-value="stringValue(field.key)"
        :label="t(field.labelKey)"
        @commit="(value, owner) => commitText(field.key, value, owner)"
      />
      <InteractiveTextField
        v-else-if="field.kind === 'text' || field.kind === 'time' || field.kind === 'datetime'"
        :owner="selectedOwner"
        :model-value="stringValue(field.key)"
        :label="t(field.labelKey)"
        :placeholder="
          field.kind === 'datetime'
            ? '2026-09-28T09:30'
            : field.kind === 'time'
              ? 'HH:mm[:ss]'
              : t(field.placeholderKey)
        "
        :time-value="field.kind === 'time'"
        :date-time-value="field.kind === 'datetime'"
        :password-value="field.key === 'value' && ip.inputType === 'password'"
        :reset-key="ip.inputType"
        :validate-value="
          field.kind === 'datetime' ? (value) => dateTimeDraftError(field.key, value) : undefined
        "
        :data-test-id="`lowcode-interactive-${field.key}`"
        @commit="(value, owner) => commitText(field.key, value, owner)"
      />

      <!-- Native date input keeps the browser's date picker. -->
      <input
        v-else-if="field.kind === 'date'"
        type="date"
        :value="stringValue(field.key)"
        :aria-label="t(field.labelKey)"
        data-slot="interactive-property"
        :data-property="field.key"
        spellcheck="false"
        :placeholder="t(field.placeholderKey)"
        class="w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
        @change="onTextInput(field.key, ($event.target as HTMLInputElement).value)"
      />

      <!-- color -->
      <ColorInput
        v-else-if="field.kind === 'color'"
        :color="colorValue(field)"
        editable
        :aria-label="t(field.labelKey)"
        data-slot="interactive-property"
        :data-property="field.key"
        class="w-full rounded border border-border bg-input px-2 py-1"
        @update="onColorInput(field.key, $event)"
      />

      <!-- boolean -->
      <AppCheckbox
        v-else-if="field.kind === 'boolean'"
        :model-value="boolValue(field.key)"
        :ariaLabel="t(field.labelKey)"
        :data-test-id="`lowcode-interactive-${field.key}`"
        @update:model-value="onBoolInput(field.key, $event)"
      />

      <!-- enum (select from a sibling string[] field) -->
      <AppSelect
        v-else-if="field.kind === 'optional-boolean'"
        :model-value="
          typeof ip[field.key] === 'boolean' ? String(ip[field.key]) : '__openpencil_default__'
        "
        :label="t(field.labelKey)"
        :options="stepperChoices"
        :data-test-id="`lowcode-interactive-${field.key}`"
        @update:model-value="commitOptionalBoolean(field.key, $event)"
      />

      <AppSelect
        v-else-if="field.kind === 'enum'"
        :model-value="stringValue(field.key) || '__openpencil_default__'"
        :label="t(field.labelKey)"
        :options="choices(field)"
        :data-test-id="`lowcode-interactive-${field.key}`"
        @update:model-value="onEnumInput(field.key, $event)"
      />

      <template v-else-if="field.kind === 'number'">
        <NumberField
          :model-value="numberValue(field.key)"
          :label="t(field.labelKey)"
          :placeholder="panels.lowcodeInteractiveDefaultSelectedNone"
          :min="field.min"
          :step="field.step"
          :disabled="field.key === 'step' && ip.step === 'any'"
          :inherit-binding="false"
          :data-property="`lowcode-control-${field.key}`"
          @commit="commitNumber(field.key, $event)"
        />
        <label
          v-if="field.key === 'step' && !['time', 'datetime-local'].includes(String(ip.inputType))"
          class="flex items-center gap-1 text-[10px] text-muted"
        >
          <AppCheckbox
            :model-value="ip.step === 'any'"
            :ariaLabel="panels.lowcodeControlAnyStep"
            @update:model-value="$event ? commit({ step: 'any' }) : clearProperty('step')"
          />
          {{ panels.lowcodeControlAnyStep }}
        </label>
        <AppButton
          v-if="field.key in ip"
          variant="ghost"
          size="xs"
          @click="clearProperty(field.key)"
        >
          {{ panels.lowcodeControlClearConstraint }}
        </AppButton>
      </template>

      <InputSuggestionsField
        v-else-if="field.kind === 'suggestions'"
        :owner="selectedOwner"
        :properties="ip"
        @commit="commitSuggestions"
      />

      <SelectOptionsField
        v-else-if="field.kind === 'select-options'"
        :owner="selectedOwner"
        :properties="ip"
        :value-bound="!!selectedNode?.bindings?.value"
        @commit="commitSelectOptions"
      />

      <RadioOptionsField
        v-else-if="field.kind === 'radio-options'"
        :owner="selectedOwner"
        :properties="ip"
        :value-bound="!!selectedNode?.bindings?.value"
        @commit="commitRadioOptions"
      />

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
      </div>
      <p v-if="field.hintKey" class="pl-0.5 text-[10px] text-muted">{{ t(field.hintKey) }}</p>
    </div>

    <p
      v-if="selectedNode?.type === 'SELECT' && ip.allowClear === true"
      class="text-[10px] text-muted"
    >
      {{ panels.lowcodeSelectClearHint }}
    </p>
    <AppAlert
      v-for="issue in warnings"
      :key="issue.code"
      tone="warning"
      :heading="warningText(issue.code)"
      data-test-id="lowcode-interactive-warning"
    />
  </div>
</template>
