<script setup lang="ts">
import { onScopeDispose, ref, watch } from 'vue'

import { isHexColorInputValue } from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'
import { usePanelMessages, useRetainedActivity } from '@open-pencil/vue'

import InteractiveTextField from './InteractiveTextField.vue'

const { modelValue, owner, label } = defineProps<{
  modelValue: string
  owner?: SceneNode
  label: string
}>()
const emit = defineEmits<{ commit: [value: string, owner: SceneNode | undefined] }>()
const panels = usePanelMessages(),
  active = useRetainedActivity(),
  generation = ref(0)
let pickerOwner: SceneNode | undefined,
  pickerGeneration = -1,
  disposed = false
watch(
  () => [modelValue, owner, active?.value],
  () => {
    generation.value++
    pickerOwner = undefined
    pickerGeneration = -1
  },
  { flush: 'sync' }
)
onScopeDispose(() => {
  disposed = true
  pickerOwner = undefined
})
function begin(event: Event) {
  const target = event.currentTarget as HTMLInputElement
  pickerGeneration = Number(target.dataset.generation)
  pickerOwner = active?.value !== false && pickerGeneration === generation.value ? owner : undefined
}
function choose(event: Event) {
  const target = event.currentTarget as HTMLInputElement
  const value = target.value
  if (
    !disposed &&
    active?.value !== false &&
    pickerOwner &&
    pickerOwner === owner &&
    pickerGeneration === generation.value &&
    Number(target.dataset.generation) === generation.value &&
    isHexColorInputValue(value)
  )
    emit('commit', value, pickerOwner)
}
</script>

<template>
  <div class="flex min-w-0 items-start gap-2" data-test-id="input-color-value">
    <input
      :key="generation"
      type="color"
      :data-generation="generation"
      :value="isHexColorInputValue(modelValue) ? modelValue : '#000000'"
      :aria-label="panels.lowcodeColorChoose"
      :disabled="active === false"
      class="h-9 w-10 shrink-0 cursor-pointer rounded border border-border bg-input p-1"
      @focus="begin"
      @pointerdown="begin"
      @keydown="begin"
      @change="choose"
    />
    <InteractiveTextField
      :owner="owner"
      :model-value="modelValue"
      :label="label"
      placeholder="#2563eb"
      :reset-key="'color'"
      data-test-id="lowcode-interactive-value"
      :validate-value="
        (value) =>
          value === '' || isHexColorInputValue(value) ? undefined : panels.lowcodeColorInvalid
      "
      @commit="(value, target) => emit('commit', value, target)"
    />
  </div>
</template>
