<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'

import { USER_MOTION_PRESET_LIMITS, type MotionPresetMergePolicy } from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import { isTauri } from '@/app/tauri/env'
import AppSelect from '@/components/ui/AppSelect.vue'

const { disabled = false, exportJson = '' } = defineProps<{
  disabled?: boolean
  exportJson?: string
}>()

const emit = defineEmits<{
  import: [json: string, policy: MotionPresetMergePolicy]
  export: []
  'import-file': [file: File | undefined, policy: MotionPresetMergePolicy]
  'export-file': []
}>()

const { panels } = useI18n()
const open = ref(false)
const importJson = ref('')
const importPolicy = ref<MotionPresetMergePolicy>('error')
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const policyOptions = computed<Array<{ value: MotionPresetMergePolicy; label: string }>>(() => [
  { value: 'error', label: panels.value.motionPresetImportPolicyReject },
  { value: 'skip', label: panels.value.motionPresetImportPolicyKeep },
  { value: 'replace', label: panels.value.motionPresetImportPolicyReplace }
])

function submitImport(): void {
  const json = importJson.value.trim()
  if (json) emit('import', json, importPolicy.value)
}

function requestImportFile(): void {
  if (isTauri()) emit('import-file', undefined, importPolicy.value)
  else fileInput.value?.click()
}

function importBrowserFile(event: Event): void {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  const file = input.files?.[0]
  input.value = ''
  if (file) emit('import-file', file, importPolicy.value)
}

watch(
  () => exportJson,
  (value) => {
    if (value) open.value = true
  }
)
</script>

<template>
  <div class="mt-2 border-t border-border pt-2">
    <button
      type="button"
      class="flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-[10px] text-muted outline-none hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-accent"
      data-test-id="motion-preset-json-toggle"
      :aria-expanded="open"
      @click="open = !open"
    >
      {{ panels.motionPresetJsonToggle }}
      <icon-lucide-chevron-down class="size-3" :class="open ? 'rotate-180' : ''" />
    </button>

    <div v-if="open" class="mt-1.5 space-y-1.5" data-test-id="motion-preset-json-panel">
      <textarea
        v-model="importJson"
        rows="4"
        :maxlength="USER_MOTION_PRESET_LIMITS.maxJsonBytes"
        class="w-full resize-y rounded border border-border bg-input p-1.5 font-mono text-[10px] text-surface outline-none focus:border-accent"
        :placeholder="panels.motionPresetJsonPastePlaceholder"
        :aria-label="panels.motionPresetJsonLibraryAria"
        data-test-id="motion-preset-json-input"
      />
      <input
        ref="fileInput"
        type="file"
        accept=".json,application/json"
        class="hidden"
        data-test-id="motion-preset-import-file-input"
        @change="importBrowserFile"
      />
      <div class="flex gap-1.5">
        <AppSelect
          v-model="importPolicy"
          class="min-w-0 flex-1"
          :label="panels.motionPresetImportPolicyAria"
          :options="policyOptions"
          data-test-id="motion-preset-import-policy"
        />
        <button
          type="button"
          class="rounded border border-border bg-input px-2 text-[10px] text-surface hover:bg-hover disabled:opacity-50"
          data-test-id="motion-preset-import-json"
          :disabled="disabled || !importJson.trim()"
          @click="submitImport"
        >
          {{ panels.motionPresetImport }}
        </button>
        <button
          type="button"
          class="rounded border border-border bg-input px-2 text-[10px] text-surface hover:bg-hover disabled:opacity-50"
          data-test-id="motion-preset-export-json"
          :disabled="disabled"
          @click="emit('export')"
        >
          {{ panels.motionPresetExport }}
        </button>
      </div>
      <div class="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          class="rounded border border-border bg-input px-2 py-1 text-[10px] text-surface hover:bg-hover disabled:opacity-50"
          data-test-id="motion-preset-import-file"
          :disabled="disabled"
          @click="requestImportFile"
        >
          {{ panels.motionPresetImport }} .json
        </button>
        <button
          type="button"
          class="rounded border border-border bg-input px-2 py-1 text-[10px] text-surface hover:bg-hover disabled:opacity-50"
          data-test-id="motion-preset-export-file"
          :disabled="disabled"
          @click="emit('export-file')"
        >
          {{ panels.motionPresetExport }} .json
        </button>
      </div>
      <textarea
        v-if="exportJson"
        :value="exportJson"
        readonly
        rows="4"
        class="w-full resize-y rounded border border-border bg-panel p-1.5 font-mono text-[10px] text-muted"
        :aria-label="panels.motionPresetExportedJsonAria"
        data-test-id="motion-preset-export-output"
      />
    </div>
  </div>
</template>
