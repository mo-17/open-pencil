<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import { USER_MOTION_PRESET_LIMITS, type UserMotionPresetCategory } from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import type { MotionPresetEditorValue } from '@/app/motion-presets/types'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import {
  AppDialogBody,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogRoot
} from '@/components/ui/dialog'

const {
  open,
  mode,
  initialName = '',
  initialDescription = '',
  initialCategory = 'custom',
  error = ''
} = defineProps<{
  open: boolean
  mode: 'save' | 'edit'
  initialName?: string
  initialDescription?: string
  initialCategory?: UserMotionPresetCategory
  error?: string
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  submit: [value: MotionPresetEditorValue]
}>()

const { panels } = useI18n()

const name = ref('')
const description = ref('')
const category = ref<UserMotionPresetCategory>('custom')
const inputContainer = ref<HTMLElement | null>(null)
const categoryOptions = computed(() => [
  { value: 'entrance' as const, label: panels.value.motionPresetCategoryEntrance },
  { value: 'interaction' as const, label: panels.value.motionPresetCategoryInteraction },
  { value: 'emphasis' as const, label: panels.value.motionPresetCategoryEmphasis },
  { value: 'loop' as const, label: panels.value.motionPresetCategoryLoop },
  { value: 'custom' as const, label: panels.value.motionCustom }
])

watch(
  () => open,
  (next) => {
    if (!next) return
    name.value = initialName
    description.value = initialDescription
    category.value = initialCategory
    void nextTick(() => {
      const input = inputContainer.value?.querySelector<HTMLInputElement>('input')
      input?.select()
    })
  },
  { immediate: true }
)

function submit(): void {
  const normalized = name.value.trim()
  if (!normalized) return
  emit('submit', {
    name: normalized,
    description: description.value.trim() || undefined,
    category: category.value
  })
}
</script>

<template>
  <AppDialogRoot
    :open="open"
    size="sm"
    data-test-id="motion-preset-custom-dialog"
    @update:open="emit('update:open', $event)"
  >
    <AppDialogHeader
      :heading="
        mode === 'save' ? panels.motionPresetSaveDialogTitle : panels.motionPresetEditDialogTitle
      "
      :description="
        mode === 'save'
          ? panels.motionPresetSaveDialogDescription
          : panels.motionPresetEditDialogDescription
      "
      :close-label="panels.motionPresetClose"
    />
    <AppDialogBody>
      <div ref="inputContainer">
        <label class="block text-[11px] text-muted" for="motion-preset-name-input">
          {{ panels.motionPresetNameLabel }}
        </label>
        <AppInput
          id="motion-preset-name-input"
          v-model="name"
          autofocus
          :maxlength="USER_MOTION_PRESET_LIMITS.maxNameLength"
          data-test-id="motion-preset-custom-name"
          class="mt-1 w-full"
          :state="error ? 'invalid' : 'idle'"
          @enter="submit"
        />
      </div>
      <div class="mt-2">
        <label class="block text-[11px] text-muted" for="motion-preset-description-input">
          {{ panels.motionPresetDescriptionLabel }}
        </label>
        <textarea
          id="motion-preset-description-input"
          v-model="description"
          rows="2"
          :maxlength="USER_MOTION_PRESET_LIMITS.maxDescriptionLength"
          class="mt-1 w-full resize-y rounded border border-border bg-input p-1.5 text-[11px] text-surface outline-none focus:border-accent"
          data-test-id="motion-preset-custom-description"
        />
      </div>
      <div class="mt-2">
        <AppSelect
          v-model="category"
          :label="panels.motionPresetCategoryLabel"
          :options="categoryOptions"
          data-test-id="motion-preset-custom-category"
        />
      </div>
      <p v-if="error" role="alert" class="mt-1 text-[10px] text-danger">{{ error }}</p>
    </AppDialogBody>
    <AppDialogFooter>
      <button
        type="button"
        class="rounded border border-border bg-input px-3 py-1.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
        @click="emit('update:open', false)"
      >
        {{ panels.motionPresetCancel }}
      </button>
      <button
        type="button"
        class="rounded bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        :disabled="!name.trim()"
        data-test-id="motion-preset-custom-submit"
        @click="submit"
      >
        {{ mode === 'save' ? panels.motionPresetSave : panels.motionPresetSaveChanges }}
      </button>
    </AppDialogFooter>
  </AppDialogRoot>
</template>
