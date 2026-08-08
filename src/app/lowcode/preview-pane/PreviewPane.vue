<script setup lang="ts">
import { useEventListener, useLocalStorage } from '@vueuse/core'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { derivePagePaths, type PagePathInfo } from '@open-pencil/compiler'
import type { IRTree } from '@open-pencil/compiler/ir/types'

import { useCollabInjected } from '@/app/collab/use'
import type { PreviewDocStatePayload } from '@/app/collab/use'
import { useEditorStore } from '@/app/editor/active-store'
import Tip from '@/components/ui/Tip.vue'

import { summarizeCompileDiagnostics, type CompileDiagnostic } from './compile-diagnostics'
import {
  DEFAULT_PREVIEW_REFRESH_POLICY,
  normalizePreviewRefreshPolicy,
  type PreviewRefreshPolicy
} from './compile-scheduler'
import DeployControls from './DeployControls.vue'
import { useCompileOnChange, type PreviewUiKit } from './use-compile-on-change'

const emit = defineEmits<{ close: [] }>()

// docs/lowcode-phase-0.md §5.4 + Phase 2 §7 — bridge protocol over postMessage.
// Message kinds: 'select' (overlay highlight, Alt/Option-click round-trip),
// 'navigate' (editor↔iframe page sync), and Phase 3 §4.6 'docState' (runtime
// state mirrored across collaborators). The compiled iframe ships the other
// side in packages/compiler/src/adapters/react/preview-bridge.ts.
const INBOUND_SOURCE = 'op-lowcode-preview'
const OUTBOUND_SOURCE = 'op-lowcode-editor'

const previewUiKit = ref<PreviewUiKit>('none')
const previewI18nEnabled = ref(false)
const previewLocalesInput = ref('')
const previewTheme = ref<'light' | 'dark'>('light')
const storedPreviewRefreshPolicy = useLocalStorage<unknown>(
  'open-pencil:preview-refresh-policy',
  DEFAULT_PREVIEW_REFRESH_POLICY
)
const previewRefreshPolicy = computed<PreviewRefreshPolicy>({
  get: () => normalizePreviewRefreshPolicy(storedPreviewRefreshPolicy.value),
  set: (policy) => {
    storedPreviewRefreshPolicy.value = normalizePreviewRefreshPolicy(policy)
  }
})
watch(
  storedPreviewRefreshPolicy,
  (value) => {
    const normalized = normalizePreviewRefreshPolicy(value)
    if (value !== normalized) storedPreviewRefreshPolicy.value = normalized
  },
  { immediate: true }
)
const {
  status,
  compileState,
  compileWarnings,
  compileError,
  motionWarnings,
  motionCompileError,
  forceRecompile
} = useCompileOnChange({
  uiKit: previewUiKit,
  i18nEnabled: previewI18nEnabled,
  localesInput: previewLocalesInput,
  refreshPolicy: previewRefreshPolicy
})
const store = useEditorStore()
const collab = useCollabInjected()

const iframeKey = ref(0)
const iframeEl = ref<HTMLIFrameElement | null>(null)
const diagnosticsOpen = ref(false)
const diagnosticSummary = computed(() =>
  summarizeCompileDiagnostics(compileWarnings.value, compileError.value)
)
const diagnosticSummaryLabel = computed(() => {
  const { errorCount, warningCount, total } = diagnosticSummary.value
  if (total === 0) return 'No compile diagnostics.'
  const parts: string[] = []
  if (errorCount > 0) parts.push(`${errorCount} error${errorCount === 1 ? '' : 's'}`)
  if (warningCount > 0) parts.push(`${warningCount} warning${warningCount === 1 ? '' : 's'}`)
  return parts.join(' · ')
})
const compileActivityLabel = computed(() => {
  if (compileState.value.inFlight) return 'Compiling…'
  if (compileState.value.pending) {
    return compileState.value.policy === 'manual'
      ? 'Changes pending'
      : `Queued ${compileState.value.autoDelayMs}ms`
  }
  if (compileState.value.lastDurationMs !== null) {
    return `${Math.round(compileState.value.lastDurationMs)}ms`
  }
  return 'Waiting'
})
const compileActivityDetail = computed(() => {
  const state = compileState.value
  const parts = [
    `Policy: ${state.policy}`,
    `adaptive delay: ${state.autoDelayMs}ms`,
    `latest revision: ${state.latestRevision}`
  ]
  if (state.lastPushedRevision !== null) parts.push(`last pushed: ${state.lastPushedRevision}`)
  if (state.coalescedRequests > 0) parts.push(`coalesced: ${state.coalescedRequests}`)
  if (state.supersededRuns > 0) parts.push(`superseded: ${state.supersededRuns}`)
  return parts.join(' · ')
})

type MotionDebugStatus = 'idle' | 'waiting' | 'ready' | 'unavailable' | 'error'

interface MotionDebugEntry {
  nodeId: string
  trackId: string
  trigger: string
  source: string
  playState: string
  progress: number | null
  currentTime: number | null
  token: string | null
  reducedMotion: string | null
  exit: string | null
  timing: Record<string, unknown> | null
}

interface MotionDebugSnapshot {
  capturedAt: number | null
  activeAnimationCount: number | null
  entries: MotionDebugEntry[]
}

interface UnknownRecord {
  [key: string]: unknown
}

interface PreviewMessage {
  source?: unknown
  type?: unknown
  id?: unknown
  route?: unknown
  name?: unknown
  value?: unknown
  status?: unknown
  snapshot?: unknown
  error?: unknown
}

const motionDebugEnabled = ref(false)
const motionDebugStatus = ref<MotionDebugStatus>('idle')
const motionDebugError = ref('')
const motionDebugSnapshot = ref<MotionDebugSnapshot | null>(null)

// §7 decision #f mirror: while the editor is replaying an inbound `navigate`
// (iframe → editor) via `store.switchPage`, the resulting `currentPageId`
// change must not post outbound navigate back to the iframe. Without this
// flag the iframe → editor → iframe echo would loop until one side missed
// a frame.
let suppressOutboundNavigate = false

function reload(): void {
  resetMotionDebugForReload()
  forceRecompile()
  iframeKey.value++
}

function recompilePreviewOptions(): void {
  resetMotionDebugForReload()
  forceRecompile()
  iframeKey.value++
}

function resetMotionDebugForReload(): void {
  if (!motionDebugEnabled.value) return
  motionDebugStatus.value = 'waiting'
  motionDebugError.value = ''
  motionDebugSnapshot.value = null
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
    // §16.1: route params are irrelevant to slug derivation; dynamic-route
    // preview navigation is a real-machine follow-up, so the stub stays minimal.
    usesRouteParams: false,
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

function canJumpToDiagnostic(diagnostic: CompileDiagnostic): boolean {
  return diagnostic.nodeId ? findPageIdOfNode(diagnostic.nodeId) !== null : false
}

function jumpToDiagnostic(diagnostic: CompileDiagnostic): void {
  const nodeId = diagnostic.nodeId
  if (!nodeId || !store.graph.getNode(nodeId)) return
  const pageId = findPageIdOfNode(nodeId)
  if (!pageId) return
  if (pageId === store.state.currentPageId) {
    store.select([nodeId])
    return
  }
  void store.switchPage(pageId).then(() => {
    if (store.graph.getNode(nodeId)) store.select([nodeId])
    return undefined
  })
}

function currentSelectionId(): string | null {
  const ids = [...store.state.selectedIds]
  return ids.length === 1 ? ids[0] : null
}

function postIframe(
  payload:
    | { type: 'select'; id: string | null }
    | { type: 'navigate'; route: string }
    | { type: 'theme'; theme: 'light' | 'dark' }
    | { type: 'motionDebug'; enabled: boolean }
    | ({ type: 'docState' } & PreviewDocStatePayload)
): void {
  iframeEl.value?.contentWindow?.postMessage({ source: OUTBOUND_SOURCE, ...payload }, '*')
}

function postTheme(): void {
  postIframe({ type: 'theme', theme: previewTheme.value })
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

function setMotionDebugEnabled(enabled: boolean): void {
  motionDebugEnabled.value = enabled
  motionDebugError.value = ''
  if (enabled) {
    motionDebugStatus.value = 'waiting'
  } else {
    motionDebugStatus.value = 'idle'
    motionDebugSnapshot.value = null
  }
  postIframe({ type: 'motionDebug', enabled })
}

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asRecord(value: unknown): UnknownRecord | null {
  return isUnknownRecord(value) ? value : null
}

function asText(value: unknown, fallback = '—'): string {
  return typeof value === 'string' && value !== '' ? value : fallback
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeMotionDebugEntry(value: unknown): MotionDebugEntry | null {
  const entry = asRecord(value)
  if (!entry) return null
  return {
    nodeId: asText(entry.nodeId),
    trackId: asText(entry.trackId),
    trigger: asText(entry.trigger),
    source: asText(entry.source),
    playState: asText(entry.playState),
    progress: asFiniteNumber(entry.progress),
    currentTime: asFiniteNumber(entry.currentTime),
    token: typeof entry.token === 'string' ? entry.token : null,
    reducedMotion: typeof entry.reducedMotion === 'string' ? entry.reducedMotion : null,
    exit: typeof entry.exit === 'string' ? entry.exit : null,
    timing: asRecord(entry.timing)
  }
}

function normalizeMotionDebugSnapshot(value: unknown): MotionDebugSnapshot {
  const snapshot = asRecord(value)
  const entries = Array.isArray(snapshot?.entries)
    ? snapshot.entries
        .map(normalizeMotionDebugEntry)
        .filter((entry): entry is MotionDebugEntry => entry !== null)
    : []
  return {
    capturedAt: asFiniteNumber(snapshot?.capturedAt),
    activeAnimationCount: asFiniteNumber(snapshot?.activeAnimationCount),
    entries
  }
}

function formatProgress(value: number | null): string {
  if (value === null) return '—'
  return `${Math.round(value * 100)}%`
}

function formatCurrentTime(value: number | null): string {
  if (value === null) return '—'
  return `${Math.round(value)} ms`
}

const motionDebugMessage = computed(() => {
  switch (motionDebugStatus.value) {
    case 'idle':
      return 'Motion Debug is off.'
    case 'waiting':
      return 'Waiting for Motion runtime…'
    case 'unavailable':
      return 'No Motion runtime is available in this preview.'
    case 'error':
      return motionDebugError.value || 'Motion runtime inspection failed.'
    case 'ready': {
      if (!motionDebugSnapshot.value?.entries.length) {
        return 'Motion runtime is ready; no tracks are registered.'
      }
      const trackSummary =
        motionDebugSnapshot.value.entries.length > 100
          ? `Showing 100 / ${motionDebugSnapshot.value.entries.length} Motion tracks`
          : `${motionDebugSnapshot.value.entries.length} Motion track${motionDebugSnapshot.value.entries.length === 1 ? '' : 's'}`
      const activeAnimationCount = motionDebugSnapshot.value.activeAnimationCount
      return activeAnimationCount === null
        ? trackSummary
        : `${trackSummary} · ${activeAnimationCount} active runtime animation${activeAnimationCount === 1 ? '' : 's'}`
    }
  }
})

const visibleMotionDebugEntries = computed(
  () => motionDebugSnapshot.value?.entries.slice(0, 100) ?? []
)

function onIframeLoad(): void {
  // After every iframe reload the bridge starts fresh — replay current
  // editor state (target page + selection) so the iframe doesn't sit on
  // the default `/` route or with a stale overlay.
  resetMotionDebugForReload()
  postNavigateToCurrent()
  postTheme()
  postSelection()
  if (motionDebugEnabled.value) postIframe({ type: 'motionDebug', enabled: true })
}

let unsubscribeSelection: (() => void) | null = null

function handleMotionDebugMessage(data: PreviewMessage): void {
  if (!motionDebugEnabled.value) return
  if (data.status === 'ready') {
    motionDebugStatus.value = 'ready'
    motionDebugError.value = ''
    motionDebugSnapshot.value = normalizeMotionDebugSnapshot(data.snapshot)
    return
  }
  if (data.status === 'unavailable') {
    motionDebugStatus.value = 'unavailable'
    motionDebugSnapshot.value = null
    return
  }
  if (data.status === 'error') {
    motionDebugStatus.value = 'error'
    motionDebugError.value = asText(data.error, 'Motion runtime inspection failed.')
    motionDebugSnapshot.value = null
  }
}

useEventListener(window, 'message', (event: MessageEvent) => {
  if (event.source !== iframeEl.value?.contentWindow) return
  const data = event.data as PreviewMessage | null
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
    return
  }

  if (data.type === 'motionDebug') handleMotionDebugMessage(data)
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

watch([previewUiKit, previewI18nEnabled, previewLocalesInput], () => {
  recompilePreviewOptions()
})

watch(previewTheme, () => {
  postTheme()
})

onMounted(() => {
  unsubscribeSelection = store.onEditorEvent('selection:changed', () => {
    postSelection()
  })
  // §4.6: a remote peer's runtime docState change → push it into this iframe.
  // The bridge applies it with its own suppress flag so it doesn't echo back.
  collab?.onPreviewDocState((payload) => postIframe({ type: 'docState', ...payload }))
})

onBeforeUnmount(() => {
  if (motionDebugEnabled.value) postIframe({ type: 'motionDebug', enabled: false })
  unsubscribeSelection?.()
  unsubscribeSelection = null
  collab?.onPreviewDocState(null)
})
</script>

<template>
  <aside
    id="lowcode-preview-pane"
    data-test-id="lowcode-preview-pane"
    class="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-border bg-panel"
  >
    <div class="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
      <span class="truncate text-xs text-muted">Preview · {{ statusLabel }}</span>
      <div class="flex shrink-0 items-center gap-1">
        <Tip label="Preview UI components">
          <label class="flex items-center gap-1 text-xs text-muted">
            <span>UI</span>
            <select
              v-model="previewUiKit"
              data-test-id="lowcode-preview-uikit"
              class="h-6 rounded border border-border bg-input px-1 text-xs text-surface"
            >
              <option value="none">Tailwind</option>
              <option value="shadcn">shadcn</option>
            </select>
          </label>
        </Tip>
        <Tip label="Preview theme">
          <label class="flex items-center gap-1 text-xs text-muted">
            <span>Theme</span>
            <select
              v-model="previewTheme"
              data-test-id="lowcode-preview-theme"
              class="h-6 rounded border border-border bg-input px-1 text-xs text-surface"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </Tip>
        <Tip label="Preview i18n">
          <label class="flex h-6 items-center gap-1 rounded px-1 text-xs text-muted hover:bg-hover">
            <input
              v-model="previewI18nEnabled"
              type="checkbox"
              data-test-id="lowcode-preview-i18n"
            />
            <span>i18n</span>
          </label>
        </Tip>
        <input
          v-if="previewI18nEnabled"
          v-model="previewLocalesInput"
          type="text"
          data-test-id="lowcode-preview-locales"
          placeholder="ar, fr"
          class="h-6 w-20 rounded border border-border bg-input px-1 text-xs text-surface"
        />
        <Tip label="Preview refresh policy">
          <label class="flex items-center gap-1 text-xs text-muted">
            <span>Refresh</span>
            <select
              v-model="previewRefreshPolicy"
              data-test-id="lowcode-preview-refresh-policy"
              class="h-6 rounded border border-border bg-input px-1 text-xs text-surface"
            >
              <option value="realtime">Real-time</option>
              <option value="auto">Auto</option>
              <option value="manual">Manual</option>
            </select>
          </label>
        </Tip>
        <Tip :label="compileActivityDetail">
          <span
            data-test-id="lowcode-preview-compile-activity"
            :data-policy="compileState.policy"
            :data-in-flight="compileState.inFlight"
            :data-pending="compileState.pending"
            :data-latest-revision="compileState.latestRevision"
            class="max-w-24 truncate rounded bg-hover px-1.5 py-0.5 text-[10px] text-muted"
          >
            {{ compileActivityLabel }}
          </span>
        </Tip>
        <DeployControls />
        <Tip label="Inspect compiler diagnostics">
          <button
            type="button"
            data-test-id="lowcode-preview-diagnostics-toggle"
            aria-controls="lowcode-preview-diagnostics"
            :aria-expanded="diagnosticsOpen"
            class="flex h-6 items-center gap-1 rounded px-2 text-xs outline-none transition-colors hover:bg-hover focus-visible:ring-1 focus-visible:ring-accent"
            :class="diagnosticsOpen ? 'bg-hover text-surface' : 'text-muted'"
            @click="diagnosticsOpen = !diagnosticsOpen"
          >
            Diagnostics
            <span
              v-if="diagnosticSummary.total > 0"
              data-test-id="lowcode-preview-diagnostics-count"
              class="rounded bg-amber-500/15 px-1 text-[10px] text-amber-500"
            >
              {{ diagnosticSummary.total }}
            </span>
          </button>
        </Tip>
        <Tip label="Inspect Motion runtime tracks">
          <button
            type="button"
            data-test-id="lowcode-preview-motion-debug-toggle"
            aria-controls="lowcode-preview-motion-debug"
            :aria-pressed="motionDebugEnabled"
            class="h-6 rounded px-2 text-xs outline-none transition-colors hover:bg-hover focus-visible:ring-1 focus-visible:ring-accent"
            :class="motionDebugEnabled ? 'bg-hover text-surface' : 'text-muted'"
            @click="setMotionDebugEnabled(!motionDebugEnabled)"
          >
            Motion
          </button>
        </Tip>
        <Tip :label="url ? `Reload (${url})` : undefined">
          <button
            v-if="url"
            type="button"
            class="rounded px-2 py-0.5 text-xs text-muted hover:bg-hover hover:text-surface"
            @click="reload"
          >
            ↻
          </button>
        </Tip>
        <Tip label="Close compiler preview">
          <button
            type="button"
            data-test-id="lowcode-preview-close"
            aria-label="Close compiler preview"
            aria-controls="lowcode-preview-pane"
            :aria-expanded="true"
            class="flex size-6 cursor-pointer items-center justify-center rounded text-muted outline-none transition-colors hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-accent"
            @click="emit('close')"
          >
            <icon-lucide-panel-right-close class="size-3.5" />
          </button>
        </Tip>
      </div>
    </div>
    <div class="flex min-h-0 flex-1 flex-col bg-white">
      <div class="relative min-h-0 flex-1">
        <iframe
          v-if="url"
          :key="iframeKey"
          ref="iframeEl"
          :src="url"
          class="absolute inset-0 size-full border-0"
          aria-label="lowcode preview"
          @load="onIframeLoad"
        />
        <div
          v-else
          class="flex h-full items-center justify-center px-4 text-center text-xs text-muted"
        >
          {{ statusLabel }}
        </div>
      </div>
      <section
        v-if="diagnosticsOpen"
        id="lowcode-preview-diagnostics"
        data-test-id="lowcode-preview-diagnostics"
        aria-label="Preview Diagnostics"
        class="max-h-48 shrink-0 overflow-auto border-t border-border bg-panel text-xs text-surface"
      >
        <div class="sticky top-0 flex items-center justify-between bg-panel px-2 py-1.5">
          <h2 class="font-medium">Diagnostics</h2>
          <span class="text-muted" aria-live="polite">{{ diagnosticSummaryLabel }}</span>
        </div>
        <p
          v-if="diagnosticSummary.total === 0"
          data-test-id="lowcode-preview-diagnostics-empty"
          class="border-t border-border px-2 py-2 text-muted"
        >
          The latest preview compile completed without diagnostics.
        </p>
        <ul v-else class="border-t border-border">
          <li
            v-for="(diagnostic, index) in diagnosticSummary.items"
            :key="`${diagnostic.severity}:${diagnostic.code}:${diagnostic.nodeId ?? ''}:${index}`"
            data-test-id="lowcode-preview-diagnostic"
            :data-severity="diagnostic.severity"
            class="flex items-start gap-2 border-b border-border px-2 py-1.5 last:border-b-0"
          >
            <span
              class="mt-0.5 shrink-0 uppercase"
              :class="diagnostic.severity === 'error' ? 'text-red-500' : 'text-amber-500'"
            >
              {{ diagnostic.severity }}
            </span>
            <span class="min-w-0 flex-1 break-words">
              <code>{{ diagnostic.code }}</code
              >: {{ diagnostic.message }}
              <span v-if="diagnostic.nodeId" class="block truncate text-muted">
                Node {{ diagnostic.nodeId }}
              </span>
            </span>
            <button
              v-if="canJumpToDiagnostic(diagnostic)"
              type="button"
              data-test-id="lowcode-preview-diagnostic-jump"
              :aria-label="`Select node ${diagnostic.nodeId}`"
              class="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
              @click="jumpToDiagnostic(diagnostic)"
            >
              Select
            </button>
          </li>
        </ul>
      </section>
      <section
        v-if="motionDebugEnabled"
        id="lowcode-preview-motion-debug"
        data-test-id="lowcode-preview-motion-debug"
        aria-label="Motion Debug"
        class="max-h-48 shrink-0 overflow-auto border-t border-border bg-panel text-xs text-surface"
      >
        <div class="sticky top-0 flex items-center justify-between bg-panel px-2 py-1.5">
          <h2 class="font-medium">Motion Debug</h2>
          <span class="text-muted" aria-live="polite">{{ motionDebugMessage }}</span>
        </div>
        <div
          v-if="motionCompileError"
          role="alert"
          class="border-t border-border px-2 py-1.5 text-red-500"
        >
          Motion compile failed: {{ motionCompileError }}
        </div>
        <ul
          v-if="motionWarnings.length"
          aria-label="Motion compile warnings"
          class="border-t border-border px-2 py-1.5 text-amber-500"
        >
          <li
            v-for="(warning, index) in motionWarnings"
            :key="`${warning.code}:${warning.nodeId ?? ''}:${index}`"
          >
            <code>{{ warning.code }}</code
            >: {{ warning.message }}
          </li>
        </ul>
        <table
          v-if="motionDebugStatus === 'ready' && visibleMotionDebugEntries.length"
          class="w-full table-fixed border-collapse text-left"
          aria-label="Motion runtime tracks"
        >
          <thead class="text-muted">
            <tr class="border-t border-border">
              <th scope="col" class="w-2/5 px-2 py-1 font-normal">Node / track</th>
              <th scope="col" class="w-1/5 px-2 py-1 font-normal">Trigger / source</th>
              <th scope="col" class="w-1/5 px-2 py-1 font-normal">State</th>
              <th scope="col" class="w-1/5 px-2 py-1 font-normal">Progress / time</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(entry, index) in visibleMotionDebugEntries"
              :key="`${entry.nodeId}:${entry.trackId}:${index}`"
              class="border-t border-border align-top"
            >
              <td class="px-2 py-1">
                <Tip :label="entry.nodeId">
                  <span class="block truncate">{{ entry.nodeId }}</span>
                </Tip>
                <Tip :label="entry.trackId">
                  <span class="block truncate text-muted">{{ entry.trackId }}</span>
                </Tip>
                <Tip v-if="entry.token" :label="entry.token">
                  <span class="block truncate text-muted">{{ entry.token }}</span>
                </Tip>
              </td>
              <td class="px-2 py-1">
                <div>{{ entry.trigger }}</div>
                <div class="text-muted">{{ entry.source }}</div>
              </td>
              <td class="px-2 py-1">
                <div>{{ entry.playState }}</div>
                <div v-if="entry.reducedMotion || entry.exit" class="text-muted">
                  {{ entry.reducedMotion ?? '—' }} · {{ entry.exit ?? '—' }}
                </div>
              </td>
              <td class="px-2 py-1">
                <Tip :label="entry.timing ? JSON.stringify(entry.timing) : undefined">
                  <span class="block">
                    <span class="block">{{ formatProgress(entry.progress) }}</span>
                    <span class="block text-muted">{{ formatCurrentTime(entry.currentTime) }}</span>
                  </span>
                </Tip>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </aside>
</template>
