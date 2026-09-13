<script setup lang="ts">
import { useI18n } from '@open-pencil/vue'
import { computed, watch } from 'vue'
import type { ManagedPreviewPlan } from '@open-pencil/compiler/managed-preview'

import AppButton from '@/components/ui/AppButton.vue'
import { AppDialog } from '@/components/ui/dialog'

import { backendPreviewCopy } from './copy'

const { plan, busy } = defineProps<{ plan: ManagedPreviewPlan; busy: boolean }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ confirm: [planId: string] }>()
const { locale } = useI18n()
const text = computed(() => backendPreviewCopy(locale.value))
watch(
  () => plan.planId,
  () => {
    open.value = false
  }
)

function confirm() {
  if (busy || plan.kind === 'blocked') return
  const planId = plan.planId
  open.value = false
  emit('confirm', planId)
}
</script>

<template>
  <AppDialog
    v-model:open="open"
    size="lg"
    :heading="plan.kind === 'initial' ? text.initialTitle : text.updateTitle"
    :description="text.reviewDescription"
    :close-label="text.reviewClose"
    :ui="{ overlay: 'z-[140]', content: 'z-[150]' }"
    data-test-id="managed-backend-review-dialog"
  >
    <ul class="list-inside list-disc space-y-1 text-xs leading-relaxed text-surface">
      <li v-for="item in plan.summary" :key="item">{{ item }}</li>
    </ul>
    <p class="mt-4 text-xs font-medium text-surface">{{ text.reviewSQL }}</p>
    <pre
      v-if="plan.sql"
      class="mt-2 max-h-[45vh] select-text overflow-auto rounded-lg border border-border bg-input p-4 text-xs leading-relaxed text-surface"
      data-test-id="managed-backend-sql"
      >{{ plan.sql }}</pre
    >
    <p v-else class="mt-2 text-xs text-muted">{{ text.noSQL }}</p>
    <ul v-if="plan.diagnostics.length" class="mt-3 space-y-1 text-xs text-amber-500">
      <li v-for="item in plan.diagnostics" :key="`${item.code}:${item.path}`">
        {{ item.message }}
      </li>
    </ul>
    <p v-if="plan.kind === 'blocked'" class="mt-3 text-xs text-amber-500">{{ text.blockedHint }}</p>
    <template #footer>
      <AppButton color="neutral" variant="ghost" @click="open = false">{{ text.cancel }}</AppButton>
      <AppButton
        v-if="plan.kind !== 'blocked'"
        color="primary"
        variant="solid"
        :disabled="busy"
        data-test-id="managed-backend-confirm"
        @click="confirm"
        >{{ plan.kind === 'initial' ? text.initialConfirm : text.updateConfirm }}</AppButton
      >
    </template>
  </AppDialog>
</template>
