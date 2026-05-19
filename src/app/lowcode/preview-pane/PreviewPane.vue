<script setup lang="ts">
import { computed, ref } from 'vue'

import { useCompileOnChange } from './use-compile-on-change'

const { status } = useCompileOnChange()

const iframeKey = ref(0)
function reload(): void {
  iframeKey.value++
}

const url = computed(() => (status.value.kind === 'ready' ? status.value.url : null))
const statusLabel = computed(() => {
  switch (status.value.kind) {
    case 'idle':
      return 'Idle'
    case 'starting':
      return 'Starting dev server…'
    case 'ready':
      return status.value.url
    case 'error':
      return `Error: ${status.value.message}`
    case 'disabled':
      return status.value.reason
  }
  return ''
})
</script>

<template>
  <aside
    data-test-id="lowcode-preview-pane"
    class="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-border bg-panel"
  >
    <div
      class="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-2"
    >
      <span class="truncate text-xs text-muted">Preview · {{ statusLabel }}</span>
      <button
        v-if="url"
        type="button"
        class="rounded px-2 py-0.5 text-xs text-muted hover:bg-hover hover:text-surface"
        :title="`Reload (${url})`"
        @click="reload"
      >
        ↻
      </button>
    </div>
    <div class="relative flex-1 bg-white">
      <iframe
        v-if="url"
        :key="iframeKey"
        :src="url"
        class="absolute inset-0 size-full border-0"
        title="lowcode preview"
      />
      <div
        v-else
        class="flex h-full items-center justify-center px-4 text-center text-xs text-muted"
      >
        {{ statusLabel }}
      </div>
    </div>
  </aside>
</template>
