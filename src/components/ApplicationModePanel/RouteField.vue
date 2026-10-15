<script setup lang="ts">
import { computed, useAttrs } from 'vue'

import { usePageMessages, useRetainedActivity } from '@open-pencil/vue'

import { applicationRouteValid } from '@/app/lowcode/application-mode/model'
import { useApplicationRouteDraft } from '@/app/lowcode/application-mode/route'
import AppInput from '@/components/ui/input/AppInput.vue'

const { modelValue, version, disabled, label, id } = defineProps<{
  modelValue: string
  version: number
  disabled: boolean
  label: string
  id: string
}>()
const emit = defineEmits<{ commit: [value: string] }>()
defineOptions({ inheritAttrs: false })
const attrs = useAttrs()
const messages = usePageMessages()
const field = useApplicationRouteDraft(
  () => ({
    value: modelValue,
    version,
    disabled,
    commit: (value) => emit('commit', value)
  }),
  useRetainedActivity()
)
const invalid = computed(() => !applicationRouteValid(field.draft.value))
</script>

<template>
  <div class="space-y-1">
    <AppInput
      v-bind="attrs"
      :id="id"
      :model-value="field.draft.value"
      :aria-label="label"
      :disabled="disabled"
      :state="invalid ? 'invalid' : 'idle'"
      :aria-invalid="invalid || undefined"
      :aria-describedby="invalid ? `${id}-error` : undefined"
      spellcheck="false"
      @update:model-value="field.edit"
      @change="field.commit"
      @blur="field.commit"
      @enter="field.commit"
      @keydown.esc="field.cancel"
    />
    <p v-if="invalid" :id="`${id}-error`" role="alert" class="text-[10px] text-error">
      {{ messages.applicationModeRouteInvalid }}
    </p>
  </div>
</template>
