<script setup lang="ts">
import { computed } from 'vue'
import type { MarkdownComponentProps } from 'vue-stream-markdown'

import { applicationRuntimeGuideExternalURL } from '@/app/help/application-runtime-guide'
import { openExternalLink } from '@/app/shell/ui'

defineOptions({ inheritAttrs: false })

const { node } = defineProps<MarkdownComponentProps>()
const externalURL = computed(() => {
  const href = node[1].href
  return typeof href === 'string' ? applicationRuntimeGuideExternalURL(href) : null
})

function openLink(): void {
  if (externalURL.value) void openExternalLink(externalURL.value)
}
</script>

<template>
  <button
    type="button"
    class="inline cursor-pointer bg-transparent p-0 text-accent underline decoration-accent/50 underline-offset-2 hover:decoration-accent disabled:cursor-default disabled:text-muted disabled:no-underline"
    :disabled="!externalURL"
    @click="openLink"
  >
    <slot />
    <icon-lucide-external-link class="ml-0.5 inline size-3 align-text-bottom" aria-hidden="true" />
  </button>
</template>
