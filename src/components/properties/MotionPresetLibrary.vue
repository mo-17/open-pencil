<script setup lang="ts">
import { computed, ref } from 'vue'

import type {
  MotionPresetMergePolicy,
  SharedMotionPresetLibraryState
} from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import type {
  MotionPresetLibraryItem,
  MotionPresetLibraryKey,
  MotionPresetEditorValue,
  MotionPresetStaggerDirection,
  MotionPresetStaggerOptions,
  MotionPresetStaggerRhythm
} from '@/app/motion-presets/types'
import MotionPresetBrowser from '@/components/properties/motion-presets/MotionPresetBrowser.vue'
import MotionPresetDeleteDialog from '@/components/properties/motion-presets/MotionPresetDeleteDialog.vue'
import MotionPresetNameDialog from '@/components/properties/motion-presets/MotionPresetNameDialog.vue'
import MotionSharedPresetLibraries from '@/components/properties/motion-presets/MotionSharedPresetLibraries.vue'
import MotionPresetStaggerControls from '@/components/properties/motion-presets/MotionPresetStaggerControls.vue'
import MotionPresetTransfer from '@/components/properties/motion-presets/MotionPresetTransfer.vue'

const {
  items,
  favoriteKeys,
  sharedLibraries,
  selectionCount = 0,
  canSaveCurrent = false,
  selectedKey,
  disabled = false,
  authoringDisabled = false,
  error = '',
  exportJson = '',
  staggerEnabled = false,
  staggerStepMs = 80,
  staggerDirection = 'forward',
  staggerRhythm = 'linear',
  sharedBusyId = ''
} = defineProps<{
  items: readonly MotionPresetLibraryItem[]
  favoriteKeys: readonly MotionPresetLibraryKey[]
  sharedLibraries: readonly SharedMotionPresetLibraryState[]
  selectionCount?: number
  canSaveCurrent?: boolean
  selectedKey?: MotionPresetLibraryKey
  disabled?: boolean
  authoringDisabled?: boolean
  error?: string
  exportJson?: string
  staggerEnabled?: boolean
  staggerStepMs?: number
  staggerDirection?: MotionPresetStaggerDirection
  staggerRhythm?: MotionPresetStaggerRhythm
  sharedBusyId?: string
}>()

const emit = defineEmits<{
  apply: [item: MotionPresetLibraryItem, stagger: MotionPresetStaggerOptions]
  'preview-start': [item: MotionPresetLibraryItem, stagger: MotionPresetStaggerOptions]
  'preview-stop': [item: MotionPresetLibraryItem]
  'toggle-favorite': [item: MotionPresetLibraryItem]
  'save-current': [value: MotionPresetEditorValue, finish: (error?: string) => void]
  edit: [
    item: MotionPresetLibraryItem,
    value: MotionPresetEditorValue,
    finish: (error?: string) => void
  ]
  'update-current': [item: MotionPresetLibraryItem]
  delete: [item: MotionPresetLibraryItem]
  'import-json': [json: string, policy: MotionPresetMergePolicy]
  'export-json': []
  'import-file': [file: File | undefined, policy: MotionPresetMergePolicy]
  'export-file': []
  'accept-shared-json': [json: string]
  'check-shared': [libraryId: string]
  'accept-shared': [libraryId: string]
  'remove-shared': [libraryId: string]
  'update:stagger-enabled': [enabled: boolean]
  'update:stagger-step-ms': [stepMs: number]
  'update:stagger-direction': [direction: MotionPresetStaggerDirection]
  'update:stagger-rhythm': [rhythm: MotionPresetStaggerRhythm]
}>()

const { panels } = useI18n()
const nameDialogOpen = ref(false)
const nameDialogMode = ref<'save' | 'edit'>('save')
const nameDialogError = ref('')
const editingItem = ref<MotionPresetLibraryItem | null>(null)
const deleteDialogOpen = ref(false)
const deletingItem = ref<MotionPresetLibraryItem | null>(null)
const stagger = computed<MotionPresetStaggerOptions>(() => ({
  enabled: selectionCount > 1 && staggerEnabled,
  stepMs: staggerStepMs,
  direction: staggerDirection,
  rhythm: staggerRhythm
}))

function openSaveDialog(): void {
  editingItem.value = null
  nameDialogError.value = ''
  nameDialogMode.value = 'save'
  nameDialogOpen.value = true
}

function openEditDialog(item: MotionPresetLibraryItem): void {
  editingItem.value = item
  nameDialogError.value = ''
  nameDialogMode.value = 'edit'
  nameDialogOpen.value = true
}

function submitName(value: MotionPresetEditorValue): void {
  const finish = (nextError?: string) => {
    nameDialogError.value = nextError ?? ''
    if (!nextError) nameDialogOpen.value = false
  }
  if (nameDialogMode.value === 'save') emit('save-current', value, finish)
  else if (editingItem.value) emit('edit', editingItem.value, value, finish)
}

function openDeleteDialog(item: MotionPresetLibraryItem): void {
  deletingItem.value = item
  deleteDialogOpen.value = true
}

function confirmDelete(): void {
  if (deletingItem.value) emit('delete', deletingItem.value)
  deleteDialogOpen.value = false
  deletingItem.value = null
}

function importJson(json: string, policy: MotionPresetMergePolicy): void {
  emit('import-json', json, policy)
}

function importFile(file: File | undefined, policy: MotionPresetMergePolicy): void {
  emit('import-file', file, policy)
}
</script>

<template>
  <section data-test-id="motion-preset-library" :aria-label="panels.motionPresetLibraryAria">
    <MotionPresetBrowser
      :items="items"
      :favorite-keys="favoriteKeys"
      :can-save-current="canSaveCurrent"
      :selected-key="selectedKey"
      :disabled="disabled"
      :authoring-disabled="authoringDisabled"
      @apply="emit('apply', $event, stagger)"
      @preview-start="emit('preview-start', $event, stagger)"
      @preview-stop="emit('preview-stop', $event)"
      @toggle-favorite="emit('toggle-favorite', $event)"
      @save-current="openSaveDialog"
      @edit="openEditDialog"
      @update-current="emit('update-current', $event)"
      @delete="openDeleteDialog"
    />

    <MotionSharedPresetLibraries
      :libraries="sharedLibraries"
      :busy-id="sharedBusyId"
      :disabled="disabled"
      @accept-json="emit('accept-shared-json', $event)"
      @check="emit('check-shared', $event)"
      @accept="emit('accept-shared', $event)"
      @remove="emit('remove-shared', $event)"
    />

    <MotionPresetStaggerControls
      :selection-count="selectionCount"
      :enabled="staggerEnabled"
      :step-ms="staggerStepMs"
      :direction="staggerDirection"
      :rhythm="staggerRhythm"
      :disabled="disabled || authoringDisabled"
      @update:enabled="emit('update:stagger-enabled', $event)"
      @update:step-ms="emit('update:stagger-step-ms', $event)"
      @update:direction="emit('update:stagger-direction', $event)"
      @update:rhythm="emit('update:stagger-rhythm', $event)"
    />

    <MotionPresetTransfer
      :disabled="disabled"
      :export-json="exportJson"
      @import="importJson"
      @export="emit('export-json')"
      @import-file="importFile"
      @export-file="emit('export-file')"
    />

    <p v-if="error" role="alert" class="mt-1.5 text-[10px] leading-4 text-danger">
      {{ error }}
    </p>

    <MotionPresetNameDialog
      :open="nameDialogOpen"
      :mode="nameDialogMode"
      :initial-name="editingItem?.name"
      :initial-description="editingItem?.description"
      :initial-category="editingItem?.category"
      :error="nameDialogError"
      @update:open="nameDialogOpen = $event"
      @submit="submitName"
    />
    <MotionPresetDeleteDialog
      :open="deleteDialogOpen"
      :preset-name="deletingItem?.name ?? ''"
      @update:open="deleteDialogOpen = $event"
      @confirm="confirmDelete"
    />
  </section>
</template>
