<script setup lang="ts">
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui'
import { ref, watch } from 'vue'

import { readLocalStorageText, writeLocalStorageText } from '@/app/cache'

const {
  id,
  title,
  defaultOpen = true,
  highlighted = false
} = defineProps<{
  id: string
  title: string
  defaultOpen?: boolean
  highlighted?: boolean
}>()

const STORAGE_PREFIX = 'open-pencil:inspector-section:'

function readOpen(id: string, fallback: boolean): boolean {
  const saved = readLocalStorageText(`${STORAGE_PREFIX}${id}`)
  if (saved === 'open') return true
  if (saved === 'closed') return false
  return fallback
}

const open = ref(readOpen(id, defaultOpen))

watch(open, (next) => {
  writeLocalStorageText(`${STORAGE_PREFIX}${id}`, next ? 'open' : 'closed')
})
</script>

<template>
  <CollapsibleRoot
    v-model:open="open"
    :data-test-id="`inspector-section-${id}`"
    class="border-b border-border"
  >
    <CollapsibleTrigger
      :data-test-id="`inspector-section-trigger-${id}`"
      class="flex h-8 w-full items-center gap-2 px-3 text-left text-[11px] font-medium text-muted hover:bg-hover hover:text-surface"
      :class="highlighted ? 'bg-accent/10 text-accent' : ''"
    >
      <icon-lucide-chevron-down
        class="size-3 transition-transform [[data-state=closed]>&]:-rotate-90"
      />
      <span class="min-w-0 truncate">{{ title }}</span>
    </CollapsibleTrigger>
    <CollapsibleContent
      :data-test-id="`inspector-section-content-${id}`"
      class="data-[state=closed]:collapsible-up data-[state=open]:collapsible-down overflow-hidden"
    >
      <slot />
    </CollapsibleContent>
  </CollapsibleRoot>
</template>
