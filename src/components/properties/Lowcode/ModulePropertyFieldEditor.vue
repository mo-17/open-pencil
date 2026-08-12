<script setup lang="ts">
import { computed } from 'vue'

import {
  UPLOAD_BUTTON_MODULE_TYPE,
  UPLOAD_BUTTON_PLUGIN_ID,
  type AccordionItemV1,
  type ModuleDefinition,
  type ModulePropertyField,
  type TabsItemV1
} from '@open-pencil/core/plugins'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'
import { useI18n } from '@open-pencil/vue'

import type { AppPluginModuleEditorText } from '@/app/plugins/localization'
import NumberField from '@/components/inputs/NumberField.vue'

import ModuleSpecializedFieldEditor from './ModuleSpecializedFieldEditor.vue'
import { valueAtPath } from './module-props-panel-controller'
import { specializedModuleFieldKind } from './module-property-field'

const { field, definition, config, label, error, moduleEditorText, optionLabel } = defineProps<{
  field: ModulePropertyField
  definition?: ModuleDefinition
  config: JSONObject
  label: string
  error?: string
  moduleEditorText: AppPluginModuleEditorText
  optionLabel: (field: ModulePropertyField, option: string) => string
}>()

const emit = defineEmits<{
  commit: [value: unknown]
  commitBoolean: [event: Event]
  commitJson: [source: string]
  commitTabs: [value: TabsItemV1[]]
  commitAccordion: [value: AccordionItemV1[]]
}>()

const specializedKind = computed(() => specializedModuleFieldKind(definition, field))
const { panels } = useI18n()

const isUploadModule = computed(
  () =>
    definition?.pluginId === UPLOAD_BUTTON_PLUGIN_ID &&
    definition.moduleType === UPLOAD_BUTTON_MODULE_TYPE
)
const isUploadMaxFiles = computed(
  () => isUploadModule.value && field.path.length === 1 && field.path[0] === 'maxFiles'
)
const isUploadBooleanField = computed(() => isUploadModule.value && field.kind === 'boolean')
const isUploadNumberField = computed(() => isUploadModule.value && field.kind === 'number')
const uploadSingleFileMode = computed(() => isUploadMaxFiles.value && config.multiple !== true)
const numberMin = computed(() =>
  isUploadMaxFiles.value && config.multiple === true ? Math.max(2, field.min ?? 2) : field.min
)
const uploadNumberFieldUI = { root: 'h-11 min-h-11' }

function currentValue(): unknown {
  return valueAtPath(config, field.path)
}

function numberValue(): number {
  const value = currentValue()
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function booleanValue(): boolean {
  return currentValue() === true
}

function textValue(): string {
  const value = currentValue()
  return typeof value === 'string' ? value : ''
}

function jsonValue(): string {
  return JSON.stringify(currentValue() ?? null, null, 2)
}
</script>

<template>
  <div
    data-test-id="module-property-field"
    :data-module-path="field.path.map(String).join('.')"
    class="mb-2 flex flex-col gap-1"
  >
    <label v-if="!isUploadBooleanField" class="text-[10px] text-muted">{{ label }}</label>

    <template v-if="field.kind === 'number'">
      <NumberField
        :model-value="numberValue()"
        :min="numberMin"
        :max="field.max"
        :step="field.step"
        :label="label"
        :disabled="uploadSingleFileMode"
        :ui="isUploadNumberField ? uploadNumberFieldUI : undefined"
        data-test-id="module-property-input"
        :data-module-path="field.path.map(String).join('.')"
        @commit="emit('commit', $event)"
      />
      <p
        v-if="uploadSingleFileMode"
        data-test-id="upload-single-file-max-hint"
        class="text-[10px] leading-relaxed text-muted"
      >
        {{ panels.lowcodeUploadSingleFileMaxHint }}
      </p>
    </template>

    <label
      v-else-if="isUploadBooleanField"
      data-test-id="upload-boolean-control"
      :data-module-path="field.path.map(String).join('.')"
      class="flex min-h-11 cursor-pointer items-center gap-2 rounded border border-border bg-input px-3 py-2 text-xs text-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/40"
    >
      <input
        type="checkbox"
        :checked="booleanValue()"
        :aria-label="label"
        data-test-id="module-property-input"
        :data-module-path="field.path.map(String).join('.')"
        class="size-4 shrink-0 accent-accent outline-none"
        @change="emit('commitBoolean', $event)"
      />
      <span>{{ label }}</span>
    </label>

    <input
      v-else-if="field.kind === 'boolean'"
      type="checkbox"
      :checked="booleanValue()"
      :aria-label="label"
      data-test-id="module-property-input"
      :data-module-path="field.path.map(String).join('.')"
      class="size-3.5 accent-accent"
      @change="emit('commitBoolean', $event)"
    />

    <select
      v-else-if="field.kind === 'select'"
      :value="textValue()"
      :aria-label="label"
      data-test-id="module-property-input"
      :data-module-path="field.path.map(String).join('.')"
      class="w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
      @change="emit('commit', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="option in field.options" :key="option" :value="option">
        {{ optionLabel(field, option) }}
      </option>
    </select>

    <ModuleSpecializedFieldEditor
      v-else-if="specializedKind"
      :field="field"
      :config="config"
      :kind="specializedKind"
      :label="label"
      :error="error"
      :module-editor-text="moduleEditorText"
      @commit="emit('commit', $event)"
      @commit-tabs="emit('commitTabs', $event)"
      @commit-accordion="emit('commitAccordion', $event)"
    />

    <textarea
      v-else-if="field.kind === 'json'"
      :value="jsonValue()"
      :aria-label="label"
      data-test-id="module-property-input"
      :data-module-path="field.path.map(String).join('.')"
      rows="4"
      spellcheck="false"
      class="w-full resize-y rounded border border-border bg-input px-2 py-1 font-mono text-[10px] leading-relaxed text-surface outline-none focus:border-accent"
      @change="emit('commitJson', ($event.target as HTMLTextAreaElement).value)"
    />

    <input
      v-else-if="field.kind === 'color'"
      type="color"
      :value="textValue()"
      :aria-label="label"
      data-test-id="module-property-input"
      :data-module-path="field.path.map(String).join('.')"
      class="h-7 w-full cursor-pointer rounded border border-border bg-input p-1"
      @change="emit('commit', ($event.target as HTMLInputElement).value)"
    />

    <input
      v-else
      type="text"
      :value="textValue()"
      :aria-label="label"
      data-test-id="module-property-input"
      :data-module-path="field.path.map(String).join('.')"
      spellcheck="false"
      class="w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
      @change="emit('commit', ($event.target as HTMLInputElement).value)"
    />

    <p v-if="error" class="text-[10px] text-red-400">{{ error }}</p>
  </div>
</template>
