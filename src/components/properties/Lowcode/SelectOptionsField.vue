<script setup lang="ts">
import { computed } from 'vue'

import { lowcodeSelectOptions } from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'
import { usePanelMessages } from '@open-pencil/vue'

import {
  editSelectOptions,
  selectDefaultOption,
  selectMultipleMode,
  toggleSelectDefault,
  selectOptionIssues
} from '@/app/lowcode/controls/select-options'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'
import AppCheckbox from '@/components/ui/toggle/AppCheckbox.vue'

import InteractiveTextField from './InteractiveTextField.vue'

const { owner, properties, valueBound } = defineProps<{
  owner?: SceneNode
  properties: Record<string, unknown>
  valueBound: boolean
}>()
const emit = defineEmits<{
  commit: [
    properties: Record<string, unknown>,
    owner: SceneNode | undefined,
    previous: Record<string, unknown>
  ]
}>()
const panels = usePanelMessages()
const options = computed(() => lowcodeSelectOptions(properties.options))
const dynamic = computed(() => properties.optionsSource != null)
const multiple = computed(() => properties.multiple === true)
const values = computed(() =>
  Array.isArray(properties.value)
    ? properties.value.filter((item): item is string => typeof item === 'string')
    : []
)
const selected = computed(() => {
  if (typeof properties.value !== 'string') return -1
  const index = options.value.findIndex((option) => option.value === properties.value)
  return index === -1 ? -2 : index
})
const choices = computed(() => [
  { value: -1, label: panels.value.lowcodeSelectAutomaticDefault },
  ...(selected.value === -2
    ? [{ value: -2, label: String(properties.value) || panels.value.lowcodeSelectEmptyValue }]
    : []),
  ...options.value.map((option, index) => ({
    value: index,
    label: `${option.label || panels.value.lowcodeSelectEmptyValue} (${option.value || panels.value.lowcodeSelectEmptyValue})`,
    disabled: option.disabled
  }))
])
const warnings = computed(() => {
  if (dynamic.value) return []
  const labels = {
    duplicate: panels.value.lowcodeSelectDuplicateValues,
    label: panels.value.lowcodeSelectEmptyLabels,
    missing: panels.value.lowcodeSelectMissingValue
  }
  return selectOptionIssues(properties).map((issue) => labels[issue])
})

function edit(change: Parameters<typeof editSelectOptions>[1], editOwner = owner): void {
  emit('commit', editSelectOptions(properties, change), editOwner, properties)
}

function changeMode(enabled: boolean): void {
  if (!valueBound) emit('commit', selectMultipleMode(properties, enabled), owner, properties)
}
function toggleDefault(value: string): void {
  if (!valueBound) emit('commit', toggleSelectDefault(properties, value), owner, properties)
}
function changeValues(value: string[], editOwner = owner): void {
  if (!valueBound) emit('commit', { ...properties, value }, editOwner, properties)
}
function chooseDefault(index: number): void {
  if (!valueBound) emit('commit', selectDefaultOption(properties, index), owner, properties)
}

function changeDynamicDefault(value: string, editOwner: SceneNode | undefined): void {
  if (!valueBound) emit('commit', { ...properties, value }, editOwner, properties)
}
</script>

<template>
  <div class="flex flex-col gap-2" data-property="lowcode-select-options">
    <label class="flex items-center gap-2 text-[10px] text-muted">
      <AppCheckbox
        :model-value="multiple"
        :disabled="valueBound"
        :ariaLabel="panels.lowcodeSelectMultiple"
        @update:model-value="changeMode"
      />
      {{ panels.lowcodeSelectMultiple }}
    </label>
    <p v-if="valueBound" class="text-[10px] text-muted">{{ panels.lowcodeSelectModeBoundHint }}</p>
    <label class="text-[10px] text-muted">{{ panels.lowcodeInteractiveDefaultSelected }}</label>
    <template v-if="multiple && !dynamic">
      <label
        v-for="option in options"
        :key="option.value"
        class="flex items-center gap-2 text-[10px] text-muted"
      >
        <AppCheckbox
          :model-value="values.includes(option.value)"
          :disabled="valueBound || option.disabled"
          :ariaLabel="option.label || panels.lowcodeSelectEmptyValue"
          @update:model-value="toggleDefault(option.value)"
        />
        {{ option.label || panels.lowcodeSelectEmptyValue }}
      </label>
    </template>
    <template v-else-if="multiple">
      <div v-for="(value, index) in values" :key="index" class="flex items-center gap-1">
        <InteractiveTextField
          :owner="owner"
          :reset-key="properties"
          :model-value="value"
          :disabled="valueBound"
          :label="`${panels.lowcodeInteractiveDefaultSelected} ${index + 1}`"
          @commit="
            (text, editOwner) =>
              changeValues(
                values.map((item, itemIndex) => (itemIndex === index ? text : item)),
                editOwner
              )
          "
        />
        <AppButton
          variant="ghost"
          size="xs"
          :disabled="valueBound"
          :aria-label="`${panels.lowcodeInteractiveOptionRemove} ${index + 1}`"
          @click="changeValues(values.filter((_, itemIndex) => itemIndex !== index))"
          ><icon-lucide-x class="size-3"
        /></AppButton>
      </div>
      <AppButton
        variant="ghost"
        size="xs"
        :disabled="valueBound"
        @click="changeValues([...values, ''])"
        >{{ panels.lowcodeInteractiveOptionAdd }}</AppButton
      >
    </template>
    <InteractiveTextField
      v-else-if="dynamic"
      :owner="owner"
      :reset-key="properties"
      :model-value="typeof properties.value === 'string' ? properties.value : ''"
      :label="panels.lowcodeInteractiveDefaultSelected"
      :disabled="valueBound"
      @commit="changeDynamicDefault"
    />
    <AppSelect
      v-else
      :model-value="selected"
      :label="panels.lowcodeInteractiveDefaultSelected"
      :options="choices"
      :disabled="valueBound"
      @update:model-value="chooseDefault"
    />
    <p v-if="valueBound" class="text-[10px] text-muted">
      {{ panels.lowcodeInteractiveRadioBoundHint }}
    </p>
    <AppAlert v-if="dynamic" tone="info" :heading="panels.lowcodeSelectDynamicHint" />
    <template v-else>
      <div
        v-for="(option, index) in options"
        :key="index"
        class="flex flex-col gap-1 rounded border border-border p-2"
        data-property="lowcode-select-option"
      >
        <div class="flex items-center gap-1">
          <span class="min-w-0 flex-1 text-[10px] text-muted">{{ index + 1 }}</span>
          <AppButton
            variant="ghost"
            size="xs"
            :disabled="index === 0"
            :aria-label="`${panels.lowcodeSelectMoveUp} ${index + 1}`"
            @click="edit({ kind: 'move', index, offset: -1 })"
            ><icon-lucide-arrow-up class="size-3"
          /></AppButton>
          <AppButton
            variant="ghost"
            size="xs"
            :disabled="index === options.length - 1"
            :aria-label="`${panels.lowcodeSelectMoveDown} ${index + 1}`"
            @click="edit({ kind: 'move', index, offset: 1 })"
            ><icon-lucide-arrow-down class="size-3"
          /></AppButton>
          <AppButton
            variant="ghost"
            size="xs"
            :aria-label="`${panels.lowcodeInteractiveOptionRemove} ${index + 1}`"
            @click="edit({ kind: 'remove', index })"
            ><icon-lucide-x class="size-3"
          /></AppButton>
        </div>
        <label class="text-[10px] text-muted">{{ panels.lowcodeControlOptionLabel }}</label>
        <InteractiveTextField
          :owner="owner"
          :reset-key="properties"
          :model-value="option.label"
          :label="`${panels.lowcodeControlOptionLabel} ${index + 1}`"
          @commit="
            (label, editOwner) => edit({ kind: 'update', index, patch: { label } }, editOwner)
          "
        />
        <label class="text-[10px] text-muted">{{ panels.lowcodeSelectSubmitValue }}</label>
        <InteractiveTextField
          :owner="owner"
          :reset-key="properties"
          :model-value="option.value"
          :label="`${panels.lowcodeSelectSubmitValue} ${index + 1}`"
          @commit="
            (value, editOwner) => edit({ kind: 'update', index, patch: { value } }, editOwner)
          "
        />
        <label class="flex items-center gap-1 text-[10px] text-muted">
          <AppCheckbox
            :model-value="option.disabled === true"
            :ariaLabel="`${panels.lowcodeControlDisabled} ${index + 1}`"
            @update:model-value="edit({ kind: 'update', index, patch: { disabled: $event } })"
          />
          {{ panels.lowcodeControlDisabled }}
        </label>
      </div>
      <AppButton
        variant="ghost"
        size="xs"
        @click="
          edit({
            kind: 'add',
            label: `${panels.lowcodeInteractiveOptionValue} ${options.length + 1}`
          })
        "
        >{{ panels.lowcodeInteractiveOptionAdd }}</AppButton
      >
    </template>
    <AppAlert v-for="warning in warnings" :key="warning" tone="warning" :heading="warning" />
  </div>
</template>
