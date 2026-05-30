<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { derivePagePaths, type PagePathInfo } from '@open-pencil/compiler'
import type { IRTree } from '@open-pencil/compiler/ir/types'

import { useCollabInjected } from '@/app/collab/use'
import type { PreviewDocStatePayload } from '@/app/collab/use'
import { useEditorStore } from '@/app/editor/active-store'

import { useCompileOnChange } from './use-compile-on-change'

// docs/lowcode-phase-0.md §5.4 + Phase 2 §7 — bridge protocol over postMessage.
// Message kinds: 'select' (overlay highlight, Alt/Option-click round-trip),
// 'navigate' (editor↔iframe page sync), and Phase 3 §4.6 'docState' (runtime
// state mirrored across collaborators). The compiled iframe ships the other
// side in packages/compiler/src/adapters/react/preview-bridge.ts.
const INBOUND_SOURCE = 'op-lowcode-preview'
const OUTBOUND_SOURCE = 'op-lowcode-editor'

const { status, forceRecompile } = useCompileOnChange()
const store = useEditorStore()
const collab = useCollabInjected()

const iframeKey = ref(0)
const iframeEl = ref<HTMLIFrameElement | null>(null)

// §7 decision #f mirror: while the editor is replaying an inbound `navigate`
// (iframe → editor) via `store.switchPage`, the resulting `currentPageId`
// change must not post outbound navigate back to the iframe. Without this
// flag the iframe → editor → iframe echo would loop until one side missed
// a frame.
let suppressOutboundNavigate = false

function reload(): void {
  forceRecompile()
  iframeKey.value++
}

const url = computed(() => (status.value.kind === 'ready' ? status.value.url : null))

// §7: the sidecar's `status.url` is only the dev-server origin (e.g.
// `http://localhost:58856/`). On its own it never updates, which makes the
// preview header look "stuck on /" after the user switches pages. Compose
// the displayed URL from the origin + the route that maps to the editor's
// current page so the header tracks navigation 1:1 with what the iframe
// would render. Iframe-initiated navs (`<button onClick={navigate(...)}>`)
// reach the editor via the inbound `navigate` channel → switchPage →
// currentPageId, so this derivation stays correct in both directions.
function formatPreviewUrl(origin: string, route: string): string {
  const base = origin.replace(/\/$/, '')
  return `${base}${route}`
}

const statusLabel = computed(() => {
  switch (status.value.kind) {
    case 'idle':
      return 'Idle'
    case 'starting':
      return 'Starting dev server…'
    case 'ready': {
      const route = findRouteForPageId(store.state.currentPageId) ?? '/'
      return formatPreviewUrl(status.value.url, route)
    }
    case 'error':
      return `Error: ${status.value.message}`
    case 'disabled':
      return status.value.reason
  }
  return ''
})

// §7 decision #g: pageId↔slug round-trip uses the compiler's single source
// of truth (`derivePagePaths`). `derivePagePaths` only reads `ir.pageId`
// and `ir.pageName`, so we hand it minimal IR stubs built from the
// SceneGraph and skip the full `collectTree` pass on every nav.
function getPagePathInfos(): readonly PagePathInfo[] {
  const stubs: IRTree[] = store.graph.getPages().map((p) => ({
    pageId: p.id,
    pageName: p.name,
    children: [],
    states: [],
    docStates: [],
    docStateReads: [],
    docStateWrites: [],
    warnings: []
  }))
  return derivePagePaths(stubs)
}

function findRouteForPageId(pageId: string): string | null {
  return getPagePathInfos().find((info) => info.pageId === pageId)?.route ?? null
}

function findPageIdForRoute(route: string): string | null {
  return getPagePathInfos().find((info) => info.route === route)?.pageId ?? null
}

// §7 decision #b: a selection of a node on a non-current page needs the
// iframe to mount that page's DOM first or the bridge's `data-node-id`
// querySelector misses and the overlay stays hidden.
function findPageIdOfNode(nodeId: string): string | null {
  let cur = store.graph.getNode(nodeId)
  while (cur && cur.type !== 'CANVAS') {
    cur = cur.parentId ? store.graph.getNode(cur.parentId) : undefined
  }
  return cur?.id ?? null
}

function currentSelectionId(): string | null {
  const ids = [...store.state.selectedIds]
  return ids.length === 1 ? ids[0] : null
}

function postIframe(
  payload:
    | { type: 'select'; id: string | null }
    | { type: 'navigate'; route: string }
    | ({ type: 'docState' } & PreviewDocStatePayload)
): void {
  iframeEl.value?.contentWindow?.postMessage({ source: OUTBOUND_SOURCE, ...payload }, '*')
}

function postNavigateToCurrent(): void {
  const route = findRouteForPageId(store.state.currentPageId)
  if (!route) return
  postIframe({ type: 'navigate', route })
}

function postSelection(): void {
  const id = currentSelectionId()
  if (id) {
    const nodePageId = findPageIdOfNode(id)
    if (nodePageId) {
      const route = findRouteForPageId(nodePageId)
      // The bridge's inbound navigate handler no-ops on same-route, so
      // always sending is safe and saves a comparison branch here.
      if (route) postIframe({ type: 'navigate', route })
    }
  }
  postIframe({ type: 'select', id })
}

function onIframeLoad(): void {
  // After every iframe reload the bridge starts fresh — replay current
  // editor state (target page + selection) so the iframe doesn't sit on
  // the default `/` route or with a stale overlay.
  postNavigateToCurrent()
  postSelection()
}

let unsubscribeSelection: (() => void) | null = null

useEventListener(window, 'message', (event: MessageEvent) => {
  if (event.source !== iframeEl.value?.contentWindow) return
  const data = event.data as {
    source?: unknown
    type?: unknown
    id?: unknown
    route?: unknown
    name?: unknown
    value?: unknown
  } | null
  if (!data || data.source !== INBOUND_SOURCE) return

  // §7 step 4 walker concern: dispatch on `type` must stay exhaustive.
  // The bridge widens its outbound `type` from 'select' to
  // 'select' | 'navigate' — both branches handled below; unknown values
  // silently drop (acceptable for a postMessage channel).
  if (data.type === 'select') {
    if (typeof data.id !== 'string' || data.id === '') return
    if (!store.graph.getNode(data.id)) return
    store.select([data.id])
    return
  }

  if (data.type === 'navigate') {
    if (typeof data.route !== 'string') return
    const targetPageId = findPageIdForRoute(data.route)
    if (!targetPageId || targetPageId === store.state.currentPageId) return
    suppressOutboundNavigate = true
    void store.switchPage(targetPageId).finally(() => {
      suppressOutboundNavigate = false
    })
    return
  }

  // §4.6: a runtime docState change in this peer's iframe → broadcast to the
  // room (no-op when not in a collab session).
  if (data.type === 'docState') {
    if (typeof data.name !== 'string') return
    collab?.sendPreviewDocState({
      name: data.name,
      value: data.value as PreviewDocStatePayload['value']
    })
  }
})

// §7 decision #4: switching pages just navigates the iframe — no recompile
// (the watcher used to live in use-compile-on-change.ts and forced a full
// rebuild; the new compile path runs once per scene mutation instead).
watch(
  () => store.state.currentPageId,
  () => {
    if (suppressOutboundNavigate) return
    postNavigateToCurrent()
  }
)

onMounted(() => {
  unsubscribeSelection = store.onEditorEvent('selection:changed', () => {
    postSelection()
  })
  // §4.6: a remote peer's runtime docState change → push it into this iframe.
  // The bridge applies it with its own suppress flag so it doesn't echo back.
  collab?.onPreviewDocState((payload) => postIframe({ type: 'docState', ...payload }))
})

onBeforeUnmount(() => {
  unsubscribeSelection?.()
  unsubscribeSelection = null
  collab?.onPreviewDocState(null)
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
