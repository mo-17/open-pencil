<script setup lang="ts">
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui'
import { ref, watch } from 'vue'

import { IS_BROWSER } from '@open-pencil/core/constants'

const props = withDefaults(
  defineProps<{
    id: string
    title: string
    defaultOpen?: boolean
  }>(),
  { defaultOpen: true }
)

const STORAGE_PREFIX = 'open-pencil:inspector-section:'

function readOpen(id: string, fallback: boolean): boolean {
  if (!IS_BROWSER) return fallback
  const saved = window.localStorage.getItem(`${STORAGE_PREFIX}${id}`)
  if (saved === 'open') return true
  if (saved === 'closed') return false
  return fallback
}

const open = ref(readOpen(props.id, props.defaultOpen))

watch(open, (next) => {
  if (!IS_BROWSER) return
  window.localStorage.setItem(`${STORAGE_PREFIX}${props.id}`, next ? 'open' : 'closed')
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
