<script setup lang="ts">
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle
} from 'reka-ui'

import { useI18n } from '@open-pencil/vue'

import { AppAlertDialogRoot, AppDialogBody, AppDialogFooter } from '@/components/ui/dialog'

const { open, presetName } = defineProps<{
  open: boolean
  presetName: string
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  confirm: []
}>()

const { panels } = useI18n()
</script>

<template>
  <AppAlertDialogRoot
    :open="open"
    data-test-id="motion-preset-delete-dialog"
    @escape-key-down="emit('update:open', false)"
    @overlay-click="emit('update:open', false)"
  >
    <header class="border-b border-border px-4 py-3">
      <AlertDialogTitle class="text-sm font-semibold text-surface">
        {{ panels.motionPresetDeleteDialogTitle }}
      </AlertDialogTitle>
      <AlertDialogDescription class="mt-1 text-[11px] leading-4 text-muted">
        {{ panels.motionPresetDeleteDialogDescription({ name: presetName }) }}
      </AlertDialogDescription>
    </header>
    <AppDialogBody>
      <p class="text-[11px] text-muted">{{ panels.motionPresetDeleteExistingNote }}</p>
    </AppDialogBody>
    <AppDialogFooter>
      <AlertDialogCancel as-child>
        <button
          type="button"
          class="rounded border border-border bg-input px-3 py-1.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
          @click="emit('update:open', false)"
        >
          {{ panels.motionPresetCancel }}
        </button>
      </AlertDialogCancel>
      <AlertDialogAction as-child>
        <button
          type="button"
          class="rounded bg-danger px-3 py-1.5 text-[11px] font-medium text-white hover:bg-danger/90"
          data-test-id="motion-preset-delete-confirm"
          @click="emit('confirm')"
        >
          {{ panels.motionPresetDeleteConfirm }}
        </button>
      </AlertDialogAction>
    </AppDialogFooter>
  </AppAlertDialogRoot>
</template>
