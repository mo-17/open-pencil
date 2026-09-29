<script setup lang="ts">
import { computed } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import { usePanelMessages } from '@open-pencil/vue'

import {
  editRadioOptions,
  radioOptions,
  selectRadioDefault
} from '@/app/lowcode/controls/radio-options'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

import InteractiveTextField from './InteractiveTextField.vue'

const { owner, properties, valueBound } = defineProps<{
  owner?: SceneNode
  properties: Record<string, unknown>
  valueBound: boolean
}>()
const emit = defineEmits<{
  commit: [properties: Record<string, unknown>, owner: SceneNode | undefined]
}>()
const panels = usePanelMessages()
const options = computed(() => radioOptions(properties.options))
const selected = computed(() => {
  const value = properties.value
  return typeof value === 'string' && value !== '' ? options.value.indexOf(value) : -1
})
const choices = computed(() => [
  { value: -1, label: panels.value.lowcodeInteractiveDefaultSelectedNone },
  ...options.value.flatMap((label, value) => (label === '' ? [] : [{ value, label }]))
])

function rename(index: number, value: string, editOwner: SceneNode | undefined): void {
  emit('commit', editRadioOptions(properties, { kind: 'rename', index, value }), editOwner)
}

function chooseDefault(index: number): void {
  if (!valueBound) emit('commit', selectRadioDefault(properties, index), owner)
}
</script>

<template>
  <div class="flex flex-col gap-1.5" data-test-id="lowcode-radio-options">
    <div
      v-for="(option, index) in options"
      :key="index"
      class="flex items-center gap-1"
      data-test-id="lowcode-interactive-option"
    >
      <InteractiveTextField
        :owner="owner"
        :model-value="option"
        :label="`${panels.lowcodeInteractiveOptionValue} ${index + 1}`"
        :placeholder="panels.lowcodeInteractiveOptionPlaceholder"
        class="min-w-0 flex-1"
        data-test-id="lowcode-interactive-option-input"
        @commit="(value, editOwner) => rename(index, value, editOwner)"
      />
      <AppButton
        variant="ghost"
        size="xs"
        :aria-label="`${panels.lowcodeInteractiveOptionRemove} ${index + 1}`"
        data-test-id="lowcode-interactive-option-remove"
        @click="emit('commit', editRadioOptions(properties, { kind: 'remove', index }), owner)"
      >
        <icon-lucide-x class="size-3" />
      </AppButton>
    </div>
    <AppButton
      variant="ghost"
      size="xs"
      class="self-start"
      data-test-id="lowcode-interactive-option-add"
      @click="emit('commit', editRadioOptions(properties, { kind: 'add' }), owner)"
    >
      {{ panels.lowcodeInteractiveOptionAdd }}
    </AppButton>
    <label class="text-[10px] text-muted">{{ panels.lowcodeInteractiveDefaultSelected }}</label>
    <AppSelect
      :model-value="selected"
      :label="panels.lowcodeInteractiveDefaultSelected"
      :options="choices"
      :disabled="valueBound"
      data-test-id="lowcode-interactive-value"
      @update:model-value="chooseDefault"
    />
    <p v-if="valueBound" class="text-[10px] text-muted" data-test-id="lowcode-radio-bound-hint">
      {{ panels.lowcodeInteractiveRadioBoundHint }}
    </p>
  </div>
</template>
