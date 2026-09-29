<script setup lang="ts">
import { isPlainObject } from 'es-toolkit/predicate'
import { computed, onScopeDispose, ref, watch } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'
import { usePanelMessages, useRetainedActivity } from '@open-pencil/vue'

import AppCheckbox from '@/components/ui/toggle/AppCheckbox.vue'

import InteractiveTextField from './InteractiveTextField.vue'

const { modelValue, owner, resetKey, valueType } = defineProps<{
  modelValue: JSONObject
  owner?: SceneNode
  resetKey?: unknown
  valueType?: 'number' | 'string' | 'array'
}>()
const emit = defineEmits<{ commit: [value: JSONObject, owner: SceneNode | undefined] }>()
const panels = usePanelMessages()
const active = useRetainedActivity()
const generation = ref(0)
let disposed = false
watch(
  () => [modelValue, owner, resetKey, active?.value],
  () => {
    generation.value++
  },
  { flush: 'sync' }
)
onScopeDispose(() => {
  disposed = true
})
const views = computed(() => [
  {
    generation: generation.value,
    owner,
    required: modelValue.required === true
  }
])
const fields = computed(() =>
  [
    ...(valueType === 'number'
      ? []
      : [
          { key: 'minLength', label: panels.value.lowcodeControlMinLength, numeric: true },
          { key: 'maxLength', label: panels.value.lowcodeControlMaxLength, numeric: true }
        ]),
    ...(valueType === 'string' || valueType === 'array'
      ? []
      : [
          { key: 'min', label: panels.value.lowcodeControlNumberMin, numeric: true },
          { key: 'max', label: panels.value.lowcodeControlNumberMax, numeric: true }
        ]),
    ...(valueType === 'number' || valueType === 'array'
      ? []
      : [{ key: 'pattern', label: panels.value.lowcodeValidationPattern, numeric: false }]),
    { key: 'customExpr', label: panels.value.lowcodeValidationCustom, numeric: false }
  ].map((field) => ({
    ...field,
    generation: generation.value,
    value: String(modelValue[field.key] ?? '')
  }))
)
const messages = computed(() => {
  const raw = modelValue.messages
  const current: JSONObject = isPlainObject(raw) ? raw : {}
  return [
    { key: 'required', label: panels.value.lowcodeValidationRequiredMessage },
    { key: 'pattern', label: panels.value.lowcodeValidationPatternMessage },
    { key: 'custom', label: panels.value.lowcodeValidationCustomMessage }
  ]
    .filter((field) => field.key !== 'pattern' || valueType === undefined || valueType === 'string')
    .map((field) => ({
      ...field,
      generation: generation.value,
      value: String(current[field.key] ?? '')
    }))
})
function commit(key: string, value: string | boolean, version: number, message = false) {
  if (disposed || active?.value === false || generation.value !== version) return
  const next = structuredClone(modelValue)
  const raw = next.messages
  const messageValues: JSONObject = isPlainObject(raw) ? raw : {}
  const target: JSONObject = message ? messageValues : next
  if (value === '' || value === false) Reflect.deleteProperty(target, key)
  else if (['minLength', 'maxLength', 'min', 'max'].includes(key)) {
    const number = Number(value)
    if (
      !Number.isFinite(number) ||
      ((key === 'minLength' || key === 'maxLength') && (number < 0 || !Number.isInteger(number)))
    )
      return
    target[key] = number
  } else target[key] = value
  if (message) {
    if (Object.keys(target).length) next.messages = target
    else Reflect.deleteProperty(next, 'messages')
  }
  emit('commit', next, owner)
}
</script>

<template>
  <div :key="generation" class="space-y-2" data-test-id="validation-field-editor">
    <label
      v-for="view in views"
      :key="view.generation"
      class="flex items-center gap-2 text-[11px] text-surface"
    >
      <AppCheckbox
        :model-value="view.required"
        :ariaLabel="panels.lowcodeValidationRequired"
        data-test-id="lowcode-validation-required"
        @update:model-value="commit('required', $event, view.generation)"
      />
      {{ panels.lowcodeValidationRequired }}
    </label>
    <div v-for="field in fields" :key="field.key" class="space-y-1">
      <span class="block text-[10px] text-muted">{{ field.label }}</span>
      <InteractiveTextField
        :owner="owner"
        :model-value="field.value"
        :label="field.label"
        :reset-key="generation"
        :inputmode="field.numeric ? 'decimal' : undefined"
        :data-validation-rule="field.key"
        :data-test-id="
          'lowcode-validation-' +
          field.key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase())
        "
        @commit="commit(field.key, $event, field.generation)"
      />
    </div>
    <div v-for="field in messages" :key="field.key" class="space-y-1">
      <span class="block text-[10px] text-muted">{{ field.label }}</span>
      <InteractiveTextField
        :owner="owner"
        :model-value="field.value"
        :label="field.label"
        :reset-key="generation"
        :data-test-id="'lowcode-validation-message-' + field.key"
        @commit="commit(field.key, $event, field.generation, true)"
      />
    </div>
  </div>
</template>
