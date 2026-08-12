<script setup lang="ts">
import { computed } from 'vue'
import { NodeList, type LinkNodeRendererProps } from 'vue-stream-markdown'

import { applicationRuntimeGuideExternalURL } from '@/app/help/application-runtime-guide'
import { openExternalLink } from '@/app/shell/ui'

const { markdownParser, nodeRenderers, node, nodeKey, blockIndex, prevNode, nextNode, deep } =
  defineProps<LinkNodeRendererProps>()
const externalURL = computed(() => applicationRuntimeGuideExternalURL(node.url))

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
    <NodeList
      :markdown-parser="markdownParser"
      :node-renderers="nodeRenderers"
      :nodes="node.children"
      :node-key="nodeKey"
      :block-index="blockIndex"
      :parent-node="node"
      :prev-node="prevNode"
      :next-node="nextNode"
      :deep="deep + 1"
    />
    <icon-lucide-external-link class="ml-0.5 inline size-3 align-text-bottom" aria-hidden="true" />
  </button>
</template>
