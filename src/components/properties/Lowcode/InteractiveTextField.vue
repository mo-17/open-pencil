<script setup lang="ts">
import { computed, onScopeDispose, ref, useAttrs, watch } from 'vue'

import { isIsoLocalDateTime, isIsoTime } from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'
import { usePanelMessages, useRetainedActivity } from '@open-pencil/vue'

import AppInput from '@/components/ui/input/AppInput.vue'

const {
  modelValue,
  label,
  placeholder,
  owner,
  resetKey,
  timeValue = false,
  dateTimeValue = false,
  passwordValue = false,
  validateValue
} = defineProps<{
  timeValue?: boolean
  dateTimeValue?: boolean
  passwordValue?: boolean
  validateValue?: (value: string) => string | undefined
  modelValue: string
  label: string
  placeholder?: string
  owner?: SceneNode
  resetKey?: unknown
}>()
const emit = defineEmits<{ commit: [value: string, owner: SceneNode | undefined] }>()
defineOptions({ inheritAttrs: false })
const attrs = useAttrs()
const active = useRetainedActivity()
const panels = usePanelMessages()
const draft = ref(modelValue)
const validationMessage = computed(() => validateValue?.(draft.value))
const invalid = computed(
  () =>
    !!validationMessage.value ||
    (draft.value !== '' &&
      ((timeValue && !isIsoTime(draft.value)) ||
        (dateTimeValue && !isIsoLocalDateTime(draft.value))))
)
let disposed = false
onScopeDispose(() => {
  disposed = true
})
watch(
  () => [modelValue, owner, resetKey, timeValue, dateTimeValue, passwordValue] as const,
  ([value]) => {
    draft.value = value
  },
  { flush: 'sync' }
)
watch(
  () => active?.value,
  () => {
    draft.value = modelValue
  },
  { flush: 'sync' }
)
function commit(): void {
  if (disposed || active?.value === false || invalid.value || draft.value === modelValue) return
  emit('commit', draft.value, owner)
}
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col gap-1">
    <AppInput
      v-bind="attrs"
      :model-value="draft"
      :type="passwordValue ? 'password' : 'text'"
      :ariaLabel="label"
      :placeholder="placeholder"
      :state="invalid ? 'invalid' : 'idle'"
      :aria-invalid="invalid || undefined"
      spellcheck="false"
      @update:model-value="draft = String($event)"
      @change="commit"
      @enter="commit"
      @keydown.esc="draft = modelValue"
    />
    <p v-if="invalid" role="alert" class="text-[10px] text-error">
      {{
        validationMessage ||
        (dateTimeValue ? panels.lowcodeDateTimeInvalid : panels.lowcodeTimeInvalid)
      }}
    </p>
  </div>
</template>
