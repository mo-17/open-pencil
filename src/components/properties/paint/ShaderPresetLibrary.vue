<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core'
import { computed, ref } from 'vue'

import type { ShaderPreset } from '@open-pencil/scene-graph'
import { contentShaderFilter, useI18n } from '@open-pencil/vue'

import { shaderPresetCopy } from '@/app/editor/shaders/preset-copy'
import {
  copyPersonalShaderPreset,
  emptyShaderPresetLibrary,
  readShaderPresetLibrary,
  savePersonalShaderPreset,
  SHADER_PRESET_LIBRARY_KEY
} from '@/app/editor/shaders/preset-library'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import PanelFieldGroup from '@/components/ui/panel/PanelFieldGroup.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

const { preset, disabled = false } = defineProps<{ preset: ShaderPreset; disabled?: boolean }>()
const emit = defineEmits<{ apply: [preset: ShaderPreset] }>()
const { locale } = useI18n()
const copy = computed(() => shaderPresetCopy(locale.value))
const name = ref('')
const selected = ref('')
const feedback = ref<'invalid' | 'full' | 'storage' | 'saved' | null>(null)
const storageFailed = ref(false)
const library = useLocalStorage(SHADER_PRESET_LIBRARY_KEY, emptyShaderPresetLibrary(), {
  writeDefaults: false,
  flush: 'sync',
  serializer: { read: readShaderPresetLibrary, write: JSON.stringify },
  onError: () => {
    storageFailed.value = true
    feedback.value = 'storage'
  }
})
const options = computed(() =>
  library.value.entries.map((entry) => ({ value: entry.id, label: entry.name }))
)
const entry = computed(() => library.value.entries.find((entry) => entry.id === selected.value))
function save() {
  if (storageFailed.value) {
    feedback.value = 'storage'
    return
  }
  const result = savePersonalShaderPreset(library.value, name.value, preset)
  if (!result.ok) {
    feedback.value = result.reason
    return
  }
  feedback.value = 'saved'
  library.value = result.library
  selected.value = result.id
}
function remove() {
  if (storageFailed.value) {
    feedback.value = 'storage'
    return
  }
  if (!entry.value) return
  feedback.value = null
  library.value = {
    version: 1,
    entries: library.value.entries.filter((item) => item.id !== selected.value)
  }
  selected.value = ''
}
function applySelected() {
  if (!entry.value || disabled) return
  const preset = copyPersonalShaderPreset(entry.value.preset)
  if (preset) emit('apply', preset)
  else feedback.value = 'invalid'
}
</script>

<template>
  <div class="flex flex-col gap-1.5" data-property="shader-preset-library">
    <PanelFieldGroup :label="copy.title">
      <AppSelect
        v-model="selected"
        placement="below"
        :options="options"
        :label="copy.select"
        :placeholder="options.length ? copy.select : copy.empty"
      />
    </PanelFieldGroup>
    <div class="flex flex-wrap gap-1">
      <AppButton size="xs" :disabled="disabled || !entry" @click="applySelected">
        {{ copy.apply }}
      </AppButton>
      <AppButton size="xs" :disabled="!entry" @click="remove">{{ copy.remove }}</AppButton>
    </div>
    <AppInput
      v-model="name"
      :aria-label="copy.name"
      :placeholder="copy.name"
      maxlength="48"
      size="xs"
    />
    <AppButton size="xs" :disabled="!name.trim() || !contentShaderFilter(preset)" @click="save">{{
      copy.save
    }}</AppButton>
    <p class="text-[10px] text-muted">{{ copy.scope }}</p>
    <AppAlert
      v-if="feedback"
      :tone="feedback === 'saved' ? 'info' : 'warning'"
      :heading="copy[feedback]"
    />
  </div>
</template>
