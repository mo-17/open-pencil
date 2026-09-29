<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'

import { useCodeMessages } from '@open-pencil/vue'

import AppButton from '@/components/ui/button/AppButton.vue'

const DesignBriefDialog = defineAsyncComponent(() => import('./DesignBriefDialog.vue'))
const messages = useCodeMessages()
const open = ref(false)
const loaded = ref(false)

function showBrief() {
  loaded.value = true
  open.value = true
}
</script>

<template>
  <AppButton
    color="neutral"
    variant="ghost"
    size="xs"
    data-test-id="design-brief-open"
    @click="showBrief"
  >
    <template #leading><icon-lucide-file-text class="size-3.5" /></template>
    {{ messages.briefTitle }}
  </AppButton>
  <DesignBriefDialog v-if="loaded" v-model:open="open" />
</template>
