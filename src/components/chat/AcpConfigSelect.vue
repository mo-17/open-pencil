<script setup lang="ts">
import { computed } from 'vue'

import type { ACPConfigCategory } from '@/app/ai/acp/config-options'
import {
  findACPConfigOption,
  groupACPConfigOptions,
  selectedACPConfigLabel
} from '@/app/ai/acp/config-options'
import { useAIChat } from '@/app/ai/chat/use'
import { toast } from '@/app/shell/ui'
import AppGroupedSelect from '@/components/ui/AppGroupedSelect.vue'

const { category, disabled = false } = defineProps<{
  category: ACPConfigCategory
  disabled?: boolean
}>()

const { acpConfigOptions, acpConfigUpdating, setACPConfigOption } = useAIChat()

const option = computed(() => findACPConfigOption(acpConfigOptions.value, category))
const groups = computed(() => (option.value ? groupACPConfigOptions(option.value) : []))
const displayValue = computed(() => {
  if (option.value) return selectedACPConfigLabel(option.value)
  return category === 'model' ? 'Model' : 'Reasoning'
})
const selectedValue = computed({
  get: () => option.value?.currentValue ?? '',
  set: (value: string) => {
    void updateValue(value)
  }
})
const testID = computed(() =>
  category === 'model' ? 'chat-acp-model-selector' : 'chat-acp-reasoning-selector'
)

async function updateValue(value: string) {
  const currentOption = option.value
  if (!currentOption || value === currentOption.currentValue || acpConfigUpdating.value) return

  try {
    await setACPConfigOption(currentOption.id, value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    toast.error(`Failed to update ${currentOption.name}: ${message}`)
  }
}
</script>

<template>
  <AppGroupedSelect
    v-if="option && groups.length > 0"
    v-model="selectedValue"
    :data-test-id="testID"
    :aria-label="option.name"
    :groups="groups"
    :display-value="displayValue"
    :disabled="disabled || acpConfigUpdating"
    :ui="{
      trigger:
        'min-w-0 max-w-32 gap-1 rounded border-none bg-transparent px-1.5 py-0.5 text-[10px] text-muted disabled:opacity-50',
      content: 'max-h-64',
      item: 'max-w-72'
    }"
  >
    <template #value>
      <icon-lucide-bot v-if="category === 'model'" class="size-3 shrink-0" />
      <icon-lucide-brain v-else class="size-3 shrink-0" />
      <span class="truncate">{{ displayValue }}</span>
    </template>
  </AppGroupedSelect>
</template>
