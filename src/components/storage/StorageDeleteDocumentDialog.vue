<script setup lang="ts">
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle
} from 'reka-ui'

import { useI18n } from '@open-pencil/vue'

import { AppAlertDialogRoot, AppDialogBody, AppDialogFooter } from '@/components/ui/dialog'

const { open, documentName, providerLabel, movesToTrash, busy, blocked } = defineProps<{
  open: boolean
  documentName: string
  providerLabel: string
  movesToTrash: boolean
  busy: boolean
  blocked: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  confirm: []
}>()

const { dialogs } = useI18n()
</script>

<template>
  <AppAlertDialogRoot
    :open="open"
    data-test-id="storage-delete-document-dialog"
    @escape-key-down="!busy && emit('update:open', false)"
    @overlay-click="!busy && emit('update:open', false)"
  >
    <header class="border-b border-border px-4 py-3">
      <AlertDialogTitle class="text-sm font-semibold text-surface">
        {{ dialogs.storageDeleteDocumentTitle({ name: documentName }) }}
      </AlertDialogTitle>
      <AlertDialogDescription class="mt-1 text-[11px] leading-4 text-muted">
        {{
          movesToTrash
            ? dialogs.storageDeleteDocumentTrashDescription({ provider: providerLabel })
            : dialogs.storageDeleteDocumentPermanentDescription({ provider: providerLabel })
        }}
      </AlertDialogDescription>
    </header>
    <AppDialogBody>
      <p v-if="blocked" class="text-[11px] leading-4 text-warning" role="alert">
        {{ dialogs.storageDeleteDocumentOpenWarning }}
      </p>
      <p v-else class="text-[11px] leading-4 text-muted">
        {{ dialogs.storageDeleteDocumentOfflineNote }}
      </p>
    </AppDialogBody>
    <AppDialogFooter>
      <AlertDialogCancel as-child>
        <button
          type="button"
          class="rounded border border-border bg-input px-3 py-1.5 text-[11px] text-muted hover:bg-hover hover:text-surface disabled:opacity-50"
          :disabled="busy"
          @click="emit('update:open', false)"
        >
          {{ dialogs.cancel }}
        </button>
      </AlertDialogCancel>
      <AlertDialogAction as-child>
        <button
          type="button"
          class="rounded bg-danger px-3 py-1.5 text-[11px] font-medium text-white hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="busy || blocked"
          data-test-id="storage-delete-document-confirm"
          @click="emit('confirm')"
        >
          {{
            busy
              ? dialogs.storageDeletingDocument
              : movesToTrash
                ? dialogs.storageMoveDocumentToTrash
                : dialogs.storageDeleteDocument
          }}
        </button>
      </AlertDialogAction>
    </AppDialogFooter>
  </AppAlertDialogRoot>
</template>
