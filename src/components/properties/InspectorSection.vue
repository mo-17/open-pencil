<script setup lang="ts">
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui'
import { computed, ref, watch } from 'vue'

import { readLocalStorageText, writeLocalStorageText } from '@/app/cache'
import Tip from '@/components/ui/Tip.vue'

const {
  id,
  label,
  defaultOpen = true,
  highlighted = false,
  storageScope,
  forceOpen = false,
  hideable = false,
  hideLabel
} = defineProps<{
  id: string
  label: string
  defaultOpen?: boolean
  highlighted?: boolean
  storageScope?: string
  forceOpen?: boolean
  hideable?: boolean
  hideLabel?: string
}>()

const emit = defineEmits<{
  hide: []
}>()

const STORAGE_PREFIX = 'open-pencil:inspector-section:'

function readOpen(storageKey: string, fallback: boolean): boolean {
  const saved = readLocalStorageText(storageKey)
  if (saved === 'open') return true
  if (saved === 'closed') return false
  return fallback
}

const storageKey = computed(() =>
  storageScope ? `${STORAGE_PREFIX}${storageScope}:${id}` : `${STORAGE_PREFIX}${id}`
)
const open = ref(readOpen(storageKey.value, defaultOpen))
const displayedOpen = computed({
  get: () => forceOpen || open.value,
  set: (next: boolean) => {
    if (!forceOpen) open.value = next
  }
})

watch(storageKey, (next) => {
  open.value = readOpen(next, defaultOpen)
})

watch(open, (next) => {
  writeLocalStorageText(storageKey.value, next ? 'open' : 'closed')
})
</script>

<template>
  <CollapsibleRoot
    v-model:open="displayedOpen"
    :data-test-id="`inspector-section-${id}`"
    class="border-b border-border"
  >
    <CollapsibleTrigger
      v-if="!hideable"
      :data-test-id="`inspector-section-trigger-${id}`"
      class="flex h-8 w-full items-center gap-2 px-3 text-left text-[11px] font-medium text-muted hover:bg-hover hover:text-surface"
      :class="highlighted ? 'bg-accent/10 text-accent' : ''"
    >
      <icon-lucide-chevron-down
        class="size-3 transition-transform motion-reduce:transition-none [[data-state=closed]>&]:-rotate-90"
      />
      <span class="min-w-0 truncate">{{ label }}</span>
    </CollapsibleTrigger>
    <div v-else class="flex h-8 min-w-0 items-center" :class="highlighted ? 'bg-accent/10' : ''">
      <CollapsibleTrigger
        :data-test-id="`inspector-section-trigger-${id}`"
        class="flex h-8 min-w-0 flex-1 items-center gap-2 py-0 pr-1 pl-3 text-left text-[11px] font-medium text-muted hover:bg-hover hover:text-surface"
        :class="highlighted ? 'text-accent' : ''"
      >
        <icon-lucide-chevron-down
          class="size-3 shrink-0 transition-transform motion-reduce:transition-none [[data-state=closed]>&]:-rotate-90"
        />
        <span class="min-w-0 truncate">{{ label }}</span>
      </CollapsibleTrigger>
      <Tip :label="hideLabel" side="left">
        <button
          type="button"
          :data-test-id="`inspector-section-hide-${id}`"
          :aria-label="hideLabel"
          class="flex size-8 shrink-0 touch-manipulation items-center justify-center text-muted outline-none hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
          @click="emit('hide')"
        >
          <icon-lucide-eye-off class="size-3.5" aria-hidden="true" />
        </button>
      </Tip>
    </div>
    <CollapsibleContent
      :data-test-id="`inspector-section-content-${id}`"
      class="data-[state=closed]:collapsible-up data-[state=open]:collapsible-down overflow-hidden motion-reduce:animate-none"
    >
      <slot />
    </CollapsibleContent>
  </CollapsibleRoot>
</template>
