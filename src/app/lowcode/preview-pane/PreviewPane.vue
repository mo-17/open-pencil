<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useEditorStore } from '@/app/editor/active-store'

import { useCompileOnChange } from './use-compile-on-change'

// docs/lowcode-phase-0.md §5.4 — two-way selection bridge over postMessage.
// The compiled iframe ships an Alt/Option-click handler + a highlight overlay
// (see packages/compiler/src/adapters/react/preview-bridge.ts).
const INBOUND_SOURCE = 'op-lowcode-preview'
const OUTBOUND_SOURCE = 'op-lowcode-editor'

const { status, forceRecompile } = useCompileOnChange()
const store = useEditorStore()

const iframeKey = ref(0)
const iframeEl = ref<HTMLIFrameElement | null>(null)

function reload(): void {
  forceRecompile()
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

function currentSelectionId(): string | null {
  const ids = [...store.state.selectedIds]
  return ids.length === 1 ? ids[0] : null
}

function postSelection(): void {
  const target = iframeEl.value?.contentWindow
  if (!target) return
  target.postMessage(
    { source: OUTBOUND_SOURCE, type: 'select', id: currentSelectionId() },
    '*'
  )
}

function onIframeLoad(): void {
  // Bridge installs on every reload — sync the current selection so the
  // overlay matches state from the previous mount.
  postSelection()
}

let unsubscribeSelection: (() => void) | null = null

useEventListener(window, 'message', (event: MessageEvent) => {
  if (event.source !== iframeEl.value?.contentWindow) return
  const data = event.data as { source?: unknown; type?: unknown; id?: unknown } | null
  if (!data || data.source !== INBOUND_SOURCE || data.type !== 'select') return
  if (typeof data.id !== 'string' || data.id === '') return
  if (!store.graph.getNode(data.id)) return
  store.select([data.id])
})

onMounted(() => {
  unsubscribeSelection = store.onEditorEvent('selection:changed', () => {
    postSelection()
  })
})

onBeforeUnmount(() => {
  unsubscribeSelection?.()
  unsubscribeSelection = null
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
        ref="iframeEl"
        :src="url"
        class="absolute inset-0 size-full border-0"
        title="lowcode preview"
        @load="onIframeLoad"
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
