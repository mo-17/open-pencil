<script setup lang="ts">
import { computed } from 'vue'

import type { AppPluginModuleEditorText } from '@/app/plugins/localization'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

const {
  modelValue,
  options,
  copy,
  showMissingWarning = true
} = defineProps<{
  modelValue: string
  options: { value: string; label: string; disabled?: boolean }[]
  copy: AppPluginModuleEditorText
  showMissingWarning?: boolean
}>()
const emit = defineEmits<{ commit: [value: string] }>()
const missing = computed(
  () =>
    Boolean(modelValue) &&
    !options.some((option) => option.value === modelValue && !option.disabled)
)
const choices = computed(() => [
  { value: 'text', label: copy.contentChildNone },
  ...options.map((option) => ({ ...option, value: `child:${option.value}` })),
  ...(modelValue && !options.some((option) => option.value === modelValue)
    ? [{ value: `child:${modelValue}`, label: modelValue, disabled: true }]
    : [])
])
</script>

<template>
  <div class="flex flex-col gap-1" data-test-id="module-content-child-select">
    <AppSelect
      :model-value="modelValue ? `child:${modelValue}` : 'text'"
      :options="choices"
      :label="copy.contentChild"
      @update:model-value="emit('commit', $event === 'text' ? '' : $event.slice(6))"
    />
    <AppAlert
      v-if="missing && showMissingWarning"
      tone="warning"
      :heading="copy.contentChildMissing"
    />
    <p class="text-[10px] leading-relaxed text-muted">{{ copy.contentChildHint }}</p>
  </div>
</template>
