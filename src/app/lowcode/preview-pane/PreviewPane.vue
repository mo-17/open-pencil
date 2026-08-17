<script setup lang="ts">
/* oxlint-disable eslint/max-lines -- Existing preview controls and runtime transport share lifecycle state. */
import { useElementSize, useEventListener, useLocalStorage } from '@vueuse/core'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from 'reka-ui'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { derivePagePaths, type PagePathInfo } from '@open-pencil/compiler'
import type { IRTree } from '@open-pencil/compiler/ir/types'

import { useCollabInjected } from '@/app/collab/use'
import type { PreviewDocStatePayload } from '@/app/collab/use'
import { useEditorStore } from '@/app/editor/active-store'
import { appPluginStore, appPluginStoreSnapshot } from '@/app/plugins/app'
import { runInstalledPluginCommand } from '@/app/plugins/host'
import {
  COMPILER_PREVIEW_POPOUT_COMMAND,
  COMPILER_PREVIEW_POPOUT_PLUGIN_ID
} from '@/app/plugins/host/ids'
import { compilerPreviewPopoutControls } from '@/app/settings/compiler-preview-popout-controls'
import { openSettingsDialog } from '@/app/settings/dialog'
import { previewToolbarLayout } from '@/app/settings/preview-toolbar-layout'
import { toast } from '@/app/shell/ui'
import Tip from '@/components/ui/Tip.vue'
import { menuItem, useMenuUI } from '@/components/ui/menu'

import {
  summarizeStructuredCompileDiagnostics,
  type CompileDiagnostic
} from './compile-diagnostics'
import CodePenShowcaseControls from './CodePenShowcaseControls.vue'
import {
  DEFAULT_PREVIEW_REFRESH_POLICY,
  normalizePreviewRefreshPolicy,
  type PreviewRefreshPolicy
} from './compile-scheduler'
import DeployControls from './DeployControls.vue'
import {
  createPreviewEditorMessage,
  parsePreviewInboundMessage,
  parsePreviewMessageEvent,
  serializePreviewFrameName,
  type PreviewEditorPayload,
  type PreviewInboundMessage
} from './iframe/messages'
import MicrofrontendExportControls from './MicrofrontendExportControls.vue'
import {
  compilerPreviewPopoutBusy,
  compilerPreviewPopoutOpen,
  registerCompilerPreviewPopoutSession,
  setCompilerPreviewPopoutDisabled,
  syncActiveCompilerPreviewPopout
} from './popout/session'
import type { CompilerPreviewPopoutIntent } from './popout/intent'
import PreviewSettingsPopover from './PreviewSettingsPopover.vue'
import { resolvePreviewToolbarBand } from './toolbar-layout'
import { useCompileOnChange, type PreviewTarget, type PreviewUIKit } from './use-compile-on-change'

const emit = defineEmits<{ close: []; 'request-expand': [complete: () => void] }>()
const { embeddedVisible = true } = defineProps<{ embeddedVisible?: boolean }>()

// docs/lowcode-phase-0.md §5.4 + Phase 2 §7 — bridge protocol over postMessage.
// Message kinds: 'select' (overlay highlight, Alt/Option-click round-trip),
// 'navigate' (editor↔iframe page sync), and Phase 3 §4.6 'docState' (runtime
// state mirrored across collaborators). The compiled iframe ships the other
// side in packages/compiler/src/adapters/react/preview-bridge.ts.
const previewTarget = ref<PreviewTarget>('react')
const previewUIKit = ref<PreviewUIKit>('none')
const previewI18nEnabled = ref(false)
const previewLocalesInput = ref('')
const previewTheme = ref<'light' | 'dark'>('light')
const toolbarEl = ref<HTMLElement | null>(null)
const { width: toolbarWidth } = useElementSize(toolbarEl)
const toolbarBand = computed(() => resolvePreviewToolbarBand(toolbarWidth.value))
const groupedToolbar = computed(() => previewToolbarLayout.value !== 'classic')
const compactToolbar = computed(() => previewToolbarLayout.value === 'compact')
const showToolbarSummary = computed(
  () =>
    previewToolbarLayout.value === 'adaptive' &&
    toolbarBand.value !== 'narrow' &&
    toolbarBand.value !== 'tiny'
)
const showToolbarActionLabels = computed(
  () => previewToolbarLayout.value === 'adaptive' && toolbarBand.value === 'wide'
)
const showDiagnosticsInline = computed(
  () =>
    previewToolbarLayout.value === 'adaptive' &&
    toolbarBand.value !== 'narrow' &&
    toolbarBand.value !== 'tiny'
)
const showInlineTarget = computed(() => toolbarBand.value !== 'tiny')
const showInlineReload = computed(() => toolbarBand.value !== 'tiny')
const showInlineMicrofrontendExport = computed(() => toolbarBand.value !== 'tiny')
const showInlineCodePen = computed(() => !compactToolbar.value && toolbarBand.value === 'wide')
const showInlinePopout = computed(
  () => !compactToolbar.value && (toolbarBand.value === 'wide' || toolbarBand.value === 'medium')
)
const showMicrofrontendExportLabel = computed(
  () => !compactToolbar.value && (toolbarBand.value === 'wide' || toolbarBand.value === 'medium')
)
const microfrontendExportControls = ref<{ openExport(): void } | null>(null)
const codePenShowcaseControls = ref<{ openShowcase(): void } | null>(null)
const deployControls = ref<{ openDeploy(): void } | null>(null)
const moreMenuUI = useMenuUI({ content: 'min-w-44' })
const moreMenuItemClass = menuItem({ justify: 'start' })
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
  hostKind,
  compileState,
  compileMetrics,
  compileDiagnostics,
  motionWarnings,
  motionCompileError,
  forceRecompile,
  markRuntimeReady,
  reportRuntimeError
} = useCompileOnChange({
  target: previewTarget,
  uiKit: previewUIKit,
  i18nEnabled: previewI18nEnabled,
  localesInput: previewLocalesInput,
  refreshPolicy: previewRefreshPolicy
})
const store = useEditorStore()
const collab = useCollabInjected()
const compilerPreviewPopoutCommand = computed(() => {
  // The snapshot makes the store's imperative lookup reactive across plugin
  // load, enable/disable, uninstall, blocking, and update transitions.
  void appPluginStoreSnapshot.value
  return appPluginStore.command(
    COMPILER_PREVIEW_POPOUT_PLUGIN_ID,
    COMPILER_PREVIEW_POPOUT_COMMAND.commandId
  )
})
const compilerPreviewPopoutReady = computed(
  () =>
    compilerPreviewPopoutCommand.value !== null &&
    status.value.kind === 'ready' &&
    status.value.port !== null &&
    !compilerPreviewPopoutBusy.value
)

const iframeKey = ref(0)
const iframeEl = ref<HTMLIFrameElement | null>(null)
let browserMessagePort: MessagePort | null = null
let browserMessagePortChannel: string | null = null

function closeBrowserMessagePort(): void {
  browserMessagePort?.close()
  browserMessagePort = null
  browserMessagePortChannel = null
}

function closeTransferredPorts(ports: readonly MessagePort[]): void {
  for (const port of ports) port.close()
}
const diagnosticsOpen = ref(false)
const diagnosticSummary = computed(() =>
  summarizeStructuredCompileDiagnostics(compileDiagnostics.value)
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
  if (compileMetrics.value) {
    return `${Math.round(compileMetrics.value.totalMs)}ms`
  }
  if (compileState.value.lastDurationMs !== null) {
    return `${Math.round(compileState.value.lastDurationMs)}ms`
  }
  return 'Waiting'
})
const previewStatusShort = computed(() => {
  switch (status.value.kind) {
    case 'ready':
      return 'Ready'
    case 'starting':
      return 'Compiling'
    case 'error':
      return 'Error'
    case 'unsupported':
      return 'Unsupported'
    case 'idle':
      return 'Idle'
  }
})
const previewStatusTone = computed(() => {
  if (status.value.kind === 'ready') return 'bg-emerald-500'
  if (status.value.kind === 'error') return 'bg-red-500'
  if (status.value.kind === 'unsupported') return 'bg-violet-500'
  if (status.value.kind === 'starting') return 'bg-amber-500'
  return 'bg-muted/60'
})
const previewSettingsSummary = computed(() => {
  const uiKit = previewUIKit.value === 'shadcn' ? 'shadcn/ui' : 'Tailwind'
  const theme = previewTheme.value === 'dark' ? 'Dark' : 'Light'
  let refresh = 'Auto'
  if (previewRefreshPolicy.value === 'realtime') refresh = 'Real-time'
  else if (previewRefreshPolicy.value === 'manual') refresh = 'Manual'
  return [uiKit, theme, refresh, previewI18nEnabled.value ? 'i18n' : null]
    .filter(Boolean)
    .join(' · ')
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
  if (hostKind.value) parts.push(`host: ${hostKind.value}`)
  if (compileMetrics.value) {
    const metrics = compileMetrics.value
    parts.push(`compile: ${Math.round(metrics.compileMs)}ms`)
    parts.push(`bundle: ${Math.round(metrics.bundleMs)}ms`)
    parts.push(`output: ${metrics.outputBytes} bytes / ${metrics.fileCount} files`)
  }
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

const activeFrame = computed(() => {
  if (status.value.kind === 'ready') return status.value.frame
  if (status.value.kind === 'starting') return status.value.frame ?? null
  return null
})
watch(activeFrame, (frame) => {
  if (browserMessagePortChannel && frame?.channelId !== browserMessagePortChannel) {
    closeBrowserMessagePort()
  }
})
const url = computed(() => activeFrame.value?.src ?? null)
const frameName = computed(() => {
  const frame = activeFrame.value
  if (!frame) return undefined
  try {
    return serializePreviewFrameName(
      frame.channelId,
      window.location.origin,
      hostKind.value === 'browser-worker' ? 'message-port' : 'window'
    )
  } catch {
    return undefined
  }
})
const canRecompile = computed(() => hostKind.value !== null && status.value.kind !== 'starting')

// §7: the sidecar's `status.url` is only the dev-server origin (e.g.
// `http://localhost:58856/`). On its own it never updates, which makes the
// preview header look "stuck on /" after the user switches pages. Compose
// the displayed URL from the origin + the route that maps to the editor's
// current page so the header tracks navigation 1:1 with what the iframe
// would render. Iframe-initiated navs (`<button onClick={navigate(...)}>`)
// reach the editor via the inbound `navigate` channel → switchPage →
// currentPageId, so this derivation stays correct in both directions.
function formatPreviewURL(origin: string, route: string): string {
  const base = origin.replace(/\/$/, '')
  return `${base}${route}`
}

const statusLabel = computed(() => {
  switch (status.value.kind) {
    case 'idle':
      return 'Idle'
    case 'starting':
      return status.value.host === 'tauri-sidecar' ? 'Starting dev server…' : 'Compiling…'
    case 'ready': {
      const route = findRouteForPageId(store.state.currentPageId) ?? '/'
      return formatPreviewURL(status.value.frame.displayURL, route)
    }
    case 'error':
      return `Error: ${status.value.message}`
    case 'unsupported':
      return `Unsupported: ${status.value.reason}`
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

async function openCompilerPreviewPopout(): Promise<void> {
  const installed = compilerPreviewPopoutCommand.value
  if (!installed) {
    openSettingsDialog('plugins')
    toast.warning('Enable Compiler Preview Popout in Settings → Plugins.')
    return
  }
  try {
    // Re-enter through the reviewed plugin host on every click. This preserves
    // its exact identity, enablement, declaration, and argument gates while the
    // plugin itself never receives a URL or native window option.
    const result = await runInstalledPluginCommand(store, installed.plugin, installed.contribution)
    toast.info(result.message)
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : String(cause))
  }
}

function requestEmbeddedAction(action: () => void): Promise<void> {
  if (embeddedVisible) {
    action()
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    emit('request-expand', () => {
      action()
      resolve()
    })
  })
}

async function handleCompilerPreviewPopoutIntent(
  intent: CompilerPreviewPopoutIntent
): Promise<void> {
  await requestEmbeddedAction(() => {
    if (intent.type === 'diagnostics') {
      diagnosticsOpen.value = true
      return
    }
    if (intent.type === 'exportMicrofrontend') {
      microfrontendExportControls.value?.openExport()
      return
    }
    deployControls.value?.openDeploy()
  })
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

function postIframe(payload: PreviewEditorPayload): void {
  if (status.value.kind !== 'ready') return
  const message = createPreviewEditorMessage(status.value.frame.channelId, payload)
  if (!message) return
  if (hostKind.value === 'browser-worker') {
    if (!browserMessagePort || browserMessagePortChannel !== status.value.frame.channelId) {
      return
    }
    // oxlint-disable-next-line eslint-plugin-unicorn/require-post-message-target-origin -- MessagePort has no target origin; possession is the capability.
    browserMessagePort.postMessage(message)
    return
  }
  const frameWindow = iframeEl.value?.contentWindow
  if (!frameWindow) return
  frameWindow.postMessage(message, status.value.frame.postMessageTargetOrigin)
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

function replayPreviewState(): void {
  resetMotionDebugForReload()
  if (status.value.kind !== 'ready') return
  postNavigateToCurrent()
  postTheme()
  postSelection()
  if (motionDebugEnabled.value) postIframe({ type: 'motionDebug', enabled: true })
}

let loadedBrowserFrameChannel: string | null = null

function onIframeLoad(event: Event): void {
  const frameElement = event.currentTarget
  if (!(frameElement instanceof HTMLIFrameElement) || frameElement !== iframeEl.value) return
  const frame = activeFrame.value
  if (!frame) return
  if (hostKind.value !== 'browser-worker') {
    // Tauri sidecar reloads are trusted HMR navigations and retain their
    // existing state-replay behavior.
    replayPreviewState()
    return
  }
  if (loadedBrowserFrameChannel !== frame.channelId) {
    loadedBrowserFrameChannel = frame.channelId
    return
  }
  // The opaque-origin sandbox moves onto a MessagePort after one verified handshake.
  // A replacement
  // document cannot inherit. Refuse the second document and close our endpoint.
  closeBrowserMessagePort()
  reportRuntimeError(
    frame.channelId,
    'Browser preview navigation was blocked because the sandbox document cannot replace its compiled artifact.'
  )
}

let unsubscribeSelection: (() => void) | null = null
let unregisterPopoutSession: (() => void) | null = null

function handleMotionDebugMessage(
  data: Extract<PreviewInboundMessage, { type: 'motionDebug' }>
): void {
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

function handlePreviewSelectMessage(
  data: Extract<PreviewInboundMessage, { type: 'select' }>
): void {
  if (!store.graph.getNode(data.id)) return
  store.select([data.id])
}

function handlePreviewNavigateMessage(
  data: Extract<PreviewInboundMessage, { type: 'navigate' }>
): void {
  const targetPageId = findPageIdForRoute(data.route)
  if (!targetPageId || targetPageId === store.state.currentPageId) return
  suppressOutboundNavigate = true
  void store.switchPage(targetPageId).finally(() => {
    suppressOutboundNavigate = false
  })
}

function handlePreviewDocStateMessage(
  data: Extract<PreviewInboundMessage, { type: 'docState' }>
): void {
  collab?.sendPreviewDocState({
    name: data.name,
    value: data.value as PreviewDocStatePayload['value']
  })
}

function handlePreviewContentMessage(
  data: Exclude<PreviewInboundMessage, { type: 'ready' } | { type: 'runtimeError' }>
): void {
  if (data.type === 'select') handlePreviewSelectMessage(data)
  else if (data.type === 'navigate') handlePreviewNavigateMessage(data)
  else if (data.type === 'docState') handlePreviewDocStateMessage(data)
  else handleMotionDebugMessage(data)
}

function installBrowserMessagePort(port: MessagePort, channelId: string): void {
  closeBrowserMessagePort()
  browserMessagePort = port
  browserMessagePortChannel = channelId
  port.addEventListener('message', (event: MessageEvent) => {
    const frame = activeFrame.value
    if (
      browserMessagePort !== port ||
      browserMessagePortChannel !== channelId ||
      !frame ||
      frame.channelId !== channelId
    ) {
      return
    }
    if (event.ports.length !== 0) {
      closeTransferredPorts(event.ports)
      closeBrowserMessagePort()
      reportRuntimeError(channelId, 'Browser preview message channel transferred an extra port.')
      return
    }
    const data = parsePreviewInboundMessage(event.data, channelId)
    if (!data || data.type === 'ready') return
    if (data.type === 'runtimeError') {
      closeBrowserMessagePort()
      reportRuntimeError(channelId, data.message)
      return
    }
    if (status.value.kind === 'ready') handlePreviewContentMessage(data)
  })
  port.addEventListener('messageerror', () => {
    if (browserMessagePort !== port || browserMessagePortChannel !== channelId) return
    closeBrowserMessagePort()
    reportRuntimeError(channelId, 'Browser preview message channel received malformed data.')
  })
  port.start()
}

function handlePreviewReadyWindowMessage(event: MessageEvent, channelId: string): void {
  if (hostKind.value === 'browser-worker') {
    if (browserMessagePort !== null) {
      closeTransferredPorts(event.ports)
      return
    }
    if (event.ports.length !== 1) {
      closeTransferredPorts(event.ports)
      reportRuntimeError(channelId, 'Browser preview did not provide its isolated channel.')
      return
    }
    installBrowserMessagePort(event.ports[0], channelId)
  } else if (event.ports.length !== 0) {
    closeTransferredPorts(event.ports)
    return
  }
  if (markRuntimeReady(channelId)) replayPreviewState()
}

function handlePreviewRuntimeErrorWindowMessage(
  event: MessageEvent,
  channelId: string,
  message: string
): void {
  if (hostKind.value === 'browser-worker') {
    closeTransferredPorts(event.ports)
    if (browserMessagePort !== null || event.ports.length !== 0) return
  }
  reportRuntimeError(channelId, message)
}

useEventListener(window, 'message', (event: MessageEvent) => {
  const frame = activeFrame.value
  if (!frame) return
  const frameWindow = iframeEl.value?.contentWindow
  if (!frameWindow) return
  const eventMatchesFrame =
    event.source === frameWindow && event.origin === frame.expectedMessageOrigin
  const data = parsePreviewMessageEvent(
    event,
    frameWindow,
    frame.expectedMessageOrigin,
    frame.channelId
  )
  if (!data) {
    if (eventMatchesFrame) closeTransferredPorts(event.ports)
    return
  }

  if (hostKind.value !== 'browser-worker' && event.ports.length !== 0) {
    closeTransferredPorts(event.ports)
    return
  }

  if (data.type === 'ready') {
    handlePreviewReadyWindowMessage(event, frame.channelId)
    return
  }

  if (data.type === 'runtimeError') {
    handlePreviewRuntimeErrorWindowMessage(event, frame.channelId, data.message)
    return
  }

  if (hostKind.value === 'browser-worker') {
    closeTransferredPorts(event.ports)
    return
  }
  if (status.value.kind !== 'ready') return
  handlePreviewContentMessage(data)
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

watch([previewUIKit, previewI18nEnabled, previewLocalesInput], () => {
  recompilePreviewOptions()
})

watch(previewTarget, (target) => {
  // Vue v1 has no React UI-kit or react-intl runtime. Clear incompatible
  // controls as the sidecar restarts so the visible settings match the
  // compiler request instead of silently preserving ignored values.
  if (target === 'vue') {
    previewUIKit.value = 'none'
    previewI18nEnabled.value = false
    previewLocalesInput.value = ''
  }
  resetMotionDebugForReload()
  iframeKey.value++
})

watch(previewTheme, () => {
  postTheme()
})

watch(
  [status, () => store.state.currentPageId, compilerPreviewPopoutControls],
  () => {
    if (compilerPreviewPopoutOpen.value || compilerPreviewPopoutBusy.value) {
      void syncActiveCompilerPreviewPopout()
    }
  },
  { flush: 'post' }
)

watch(
  compilerPreviewPopoutCommand,
  (command) => {
    // Update the gate synchronously even while native open is still in flight;
    // the session queue will close any window that completes after disable.
    void setCompilerPreviewPopoutDisabled(command === null)
  },
  { immediate: true }
)

onMounted(() => {
  unregisterPopoutSession = registerCompilerPreviewPopoutSession({
    getRequest() {
      if (status.value.kind !== 'ready' || status.value.port === null) return null
      const path = findRouteForPageId(store.state.currentPageId)
      return path
        ? {
            url: status.value.url,
            port: status.value.port,
            path,
            controls: compilerPreviewPopoutControls.value
          }
        : null
    },
    handleIntent: handleCompilerPreviewPopoutIntent
  })
  unsubscribeSelection = store.onEditorEvent('selection:changed', () => {
    postSelection()
  })
  // §4.6: a remote peer's runtime docState change → push it into this iframe.
  // The bridge applies it with its own suppress flag so it doesn't echo back.
  collab?.onPreviewDocState((payload) => postIframe({ type: 'docState', ...payload }))
})

onBeforeUnmount(() => {
  unregisterPopoutSession?.()
  unregisterPopoutSession = null
  if (motionDebugEnabled.value) postIframe({ type: 'motionDebug', enabled: false })
  unsubscribeSelection?.()
  unsubscribeSelection = null
  collab?.onPreviewDocState(null)
  closeBrowserMessagePort()
})
</script>

<template>
  <aside
    id="lowcode-preview-pane"
    data-test-id="lowcode-preview-pane"
    :data-preview-status="status.kind"
    :data-preview-host="hostKind ?? undefined"
    class="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-border bg-panel"
    :class="{ hidden: !embeddedVisible }"
  >
    <div
      ref="toolbarEl"
      class="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2"
      :data-layout="previewToolbarLayout"
      :data-band="groupedToolbar ? toolbarBand : undefined"
      data-test-id="lowcode-preview-toolbar"
    >
      <template v-if="groupedToolbar">
        <Tip v-if="toolbarBand !== 'tiny'" :label="statusLabel">
          <div class="flex min-w-0 items-center gap-1 text-xs text-muted">
            <span v-if="!compactToolbar && toolbarBand !== 'narrow'" class="shrink-0">
              Preview
            </span>
            <span class="size-1.5 shrink-0 rounded-full" :class="previewStatusTone" />
            <span v-if="!compactToolbar && toolbarBand !== 'narrow'" class="shrink-0 text-surface">
              {{ previewStatusShort }}
            </span>
            <span
              data-test-id="lowcode-preview-compile-activity"
              :data-policy="compileState.policy"
              :data-in-flight="compileState.inFlight"
              :data-pending="compileState.pending"
              :data-latest-revision="compileState.latestRevision"
              :class="
                compactToolbar || toolbarBand === 'narrow'
                  ? 'sr-only'
                  : 'max-w-20 shrink truncate text-[10px] text-muted'
              "
            >
              · {{ compileActivityLabel }}
            </span>
          </div>
        </Tip>

        <div class="ml-auto flex min-w-0 shrink-0 items-center gap-1">
          <Tip v-if="showInlineTarget" label="Compiler preview framework">
            <label class="flex shrink-0 items-center gap-1 text-xs text-muted">
              <span v-if="showToolbarActionLabels">Target</span>
              <select
                v-model="previewTarget"
                data-test-id="lowcode-preview-target"
                aria-label="Compiler preview framework"
                class="h-7 max-w-24 rounded border border-border bg-input px-1.5 text-xs text-surface outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                <option value="react">React</option>
                <option value="vue">Vue 3</option>
              </select>
            </label>
          </Tip>

          <PreviewSettingsPopover
            v-model:target="previewTarget"
            v-model:ui-kit="previewUIKit"
            v-model:theme="previewTheme"
            v-model:i18n-enabled="previewI18nEnabled"
            v-model:locales-input="previewLocalesInput"
            v-model:refresh-policy="previewRefreshPolicy"
            :summary="previewSettingsSummary"
            :icon-only="!showToolbarSummary"
            :show-target="!showInlineTarget"
          />

          <Tip
            v-if="showInlineReload"
            :label="
              canRecompile
                ? url
                  ? `Reload (${statusLabel})`
                  : 'Recompile preview'
                : 'Preview is compiling'
            "
          >
            <button
              type="button"
              data-test-id="lowcode-preview-reload"
              aria-label="Reload compiler preview"
              class="flex size-7 shrink-0 items-center justify-center rounded text-muted outline-none transition-colors hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="!canRecompile"
              @click="reload"
            >
              <icon-lucide-refresh-cw class="size-3.5" />
            </button>
          </Tip>

          <MicrofrontendExportControls
            ref="microfrontendExportControls"
            :target="previewTarget"
            :ui-kit="previewUIKit"
            :i18n-enabled="previewI18nEnabled"
            :show-trigger="showInlineMicrofrontendExport"
            :icon-only="!showMicrofrontendExportLabel"
          />

          <CodePenShowcaseControls
            ref="codePenShowcaseControls"
            :target="previewTarget"
            :ui-kit="previewUIKit"
            :i18n-enabled="previewI18nEnabled"
            :locales-input="previewLocalesInput"
            :show-trigger="showInlineCodePen"
            :icon-only="!showToolbarActionLabels"
          />

          <Tip
            v-if="compilerPreviewPopoutCommand && showInlinePopout"
            :label="
              compilerPreviewPopoutOpen
                ? 'Focus compiler preview window'
                : 'Open compiler preview in a separate window'
            "
          >
            <button
              type="button"
              data-test-id="lowcode-preview-popout-toggle"
              aria-label="Open compiler preview in a separate window"
              :aria-pressed="compilerPreviewPopoutOpen"
              class="flex h-7 shrink-0 items-center gap-1 rounded px-2 text-xs outline-none transition-colors hover:bg-hover focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
              :class="compilerPreviewPopoutOpen ? 'bg-hover text-surface' : 'text-muted'"
              :disabled="!compilerPreviewPopoutReady"
              @click="openCompilerPreviewPopout"
            >
              <icon-lucide-loader-circle
                v-if="compilerPreviewPopoutBusy"
                class="size-3.5 animate-spin"
              />
              <icon-lucide-picture-in-picture-2 v-else class="size-3.5" />
              <span v-if="showToolbarActionLabels">Pop out</span>
            </button>
          </Tip>

          <DeployControls ref="deployControls" show-icon :icon-only="!showToolbarActionLabels" />

          <Tip v-if="showDiagnosticsInline" label="Inspect compiler diagnostics">
            <button
              type="button"
              data-test-id="lowcode-preview-diagnostics-toggle"
              aria-controls="lowcode-preview-diagnostics"
              :aria-expanded="diagnosticsOpen"
              aria-label="Inspect compiler diagnostics"
              class="flex h-7 shrink-0 items-center gap-1 rounded px-2 text-xs outline-none transition-colors hover:bg-hover focus-visible:ring-1 focus-visible:ring-accent"
              :class="diagnosticsOpen ? 'bg-hover text-surface' : 'text-muted'"
              @click="diagnosticsOpen = !diagnosticsOpen"
            >
              <icon-lucide-activity class="size-3.5" />
              <span v-if="showToolbarActionLabels">Diagnostics</span>
              <span
                v-if="diagnosticSummary.total > 0"
                data-test-id="lowcode-preview-diagnostics-count"
                class="rounded bg-amber-500/15 px-1 text-[10px] text-amber-500"
              >
                {{ diagnosticSummary.total }}
              </span>
            </button>
          </Tip>

          <DropdownMenuRoot>
            <DropdownMenuTrigger as-child>
              <button
                type="button"
                data-test-id="lowcode-preview-more-toggle"
                aria-label="More preview actions"
                class="relative flex size-7 shrink-0 items-center justify-center rounded text-muted outline-none transition-colors hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-accent"
              >
                <icon-lucide-ellipsis class="size-3.5" />
                <span
                  v-if="!showDiagnosticsInline && diagnosticSummary.total > 0"
                  class="absolute -mt-5 ml-5 min-w-3 rounded-full bg-amber-500 px-0.5 text-center text-[8px] leading-3 text-black"
                >
                  {{ diagnosticSummary.total }}
                </span>
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuPortal>
              <DropdownMenuContent
                side="bottom"
                :side-offset="4"
                align="end"
                :class="moreMenuUI.content"
                data-test-id="lowcode-preview-more-menu"
              >
                <DropdownMenuItem
                  v-if="!showInlineReload"
                  :class="moreMenuItemClass"
                  :disabled="!canRecompile"
                  @select="reload"
                >
                  <icon-lucide-refresh-cw class="size-3.5 text-muted" />
                  <span>Reload preview</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  v-if="!showDiagnosticsInline"
                  :class="moreMenuItemClass"
                  @select="diagnosticsOpen = !diagnosticsOpen"
                >
                  <icon-lucide-activity class="size-3.5 text-muted" />
                  <span class="flex-1">Diagnostics</span>
                  <span v-if="diagnosticSummary.total > 0" class="text-amber-500">
                    {{ diagnosticSummary.total }}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  v-if="!showInlineMicrofrontendExport"
                  :class="moreMenuItemClass"
                  @select="microfrontendExportControls?.openExport()"
                >
                  <icon-lucide-package-open class="size-3.5 text-muted" />
                  <span>Export microfrontend…</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  v-if="!showInlineCodePen"
                  data-test-id="lowcode-preview-more-codepen"
                  :class="moreMenuItemClass"
                  @select="codePenShowcaseControls?.openShowcase()"
                >
                  <icon-lucide-code-2 class="size-3.5 text-muted" />
                  <span>Open in CodePen…</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  v-if="compilerPreviewPopoutCommand && !showInlinePopout"
                  data-test-id="lowcode-preview-more-popout"
                  :class="moreMenuItemClass"
                  :disabled="!compilerPreviewPopoutReady"
                  @select="openCompilerPreviewPopout"
                >
                  <icon-lucide-picture-in-picture-2 class="size-3.5 text-muted" />
                  <span class="flex-1">
                    {{ compilerPreviewPopoutOpen ? 'Focus preview window' : 'Open preview window' }}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  :class="moreMenuItemClass"
                  @select="setMotionDebugEnabled(!motionDebugEnabled)"
                >
                  <icon-lucide-gauge class="size-3.5 text-muted" />
                  <span class="flex-1">Motion runtime</span>
                  <span class="text-muted">{{ motionDebugEnabled ? 'On' : 'Off' }}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator :class="moreMenuUI.separator" />
                <DropdownMenuItem
                  :class="moreMenuItemClass"
                  @select="openSettingsDialog('appearance')"
                >
                  <icon-lucide-layout-panel-top class="size-3.5 text-muted" />
                  <span>Toolbar layout…</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>

          <Tip label="Close compiler preview">
            <button
              type="button"
              data-test-id="lowcode-preview-close"
              aria-label="Close compiler preview"
              aria-controls="lowcode-preview-pane"
              :aria-expanded="true"
              class="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded text-muted outline-none transition-colors hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-accent"
              @click="emit('close')"
            >
              <icon-lucide-panel-right-close class="size-3.5" />
            </button>
          </Tip>
        </div>
      </template>

      <template v-else>
        <span class="min-w-0 flex-1 truncate text-xs text-muted">
          Preview · {{ statusLabel }}
        </span>
        <div class="flex shrink-0 items-center gap-1">
          <Tip label="Compiler preview framework">
            <label class="flex items-center gap-1 text-xs text-muted">
              <span>Target</span>
              <select
                v-model="previewTarget"
                data-test-id="lowcode-preview-target"
                class="h-6 rounded border border-border bg-input px-1 text-xs text-surface"
              >
                <option value="react">React</option>
                <option value="vue">Vue 3</option>
              </select>
            </label>
          </Tip>
          <Tip label="Preview UI components">
            <label class="flex items-center gap-1 text-xs text-muted">
              <span>UI</span>
              <select
                v-model="previewUIKit"
                :disabled="previewTarget === 'vue'"
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
            <label
              class="flex h-6 items-center gap-1 rounded px-1 text-xs text-muted hover:bg-hover"
            >
              <input
                v-model="previewI18nEnabled"
                :disabled="previewTarget === 'vue'"
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
          <MicrofrontendExportControls
            ref="microfrontendExportControls"
            :target="previewTarget"
            :ui-kit="previewUIKit"
            :i18n-enabled="previewI18nEnabled"
            icon-only
          />
          <CodePenShowcaseControls
            ref="codePenShowcaseControls"
            :target="previewTarget"
            :ui-kit="previewUIKit"
            :i18n-enabled="previewI18nEnabled"
            :locales-input="previewLocalesInput"
            icon-only
          />
          <Tip
            v-if="compilerPreviewPopoutCommand"
            :label="
              compilerPreviewPopoutOpen
                ? 'Focus compiler preview window'
                : 'Open compiler preview in a separate window'
            "
          >
            <button
              type="button"
              data-test-id="lowcode-preview-popout-toggle"
              aria-label="Open compiler preview in a separate window"
              :aria-pressed="compilerPreviewPopoutOpen"
              class="flex size-6 shrink-0 items-center justify-center rounded text-muted outline-none transition-colors hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="!compilerPreviewPopoutReady"
              @click="openCompilerPreviewPopout"
            >
              <icon-lucide-loader-circle
                v-if="compilerPreviewPopoutBusy"
                class="size-3.5 animate-spin"
              />
              <icon-lucide-picture-in-picture-2 v-else class="size-3.5" />
            </button>
          </Tip>
          <DeployControls ref="deployControls" />
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
          <Tip
            :label="
              canRecompile ? (url ? `Reload (${statusLabel})` : 'Recompile preview') : undefined
            "
          >
            <button
              v-if="canRecompile"
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
      </template>
    </div>
    <div class="flex min-h-0 flex-1 flex-col bg-white">
      <div class="relative min-h-0 flex-1">
        <iframe
          v-if="url && embeddedVisible"
          :key="iframeKey"
          ref="iframeEl"
          :name="frameName"
          :sandbox="activeFrame?.sandbox ?? undefined"
          :src="url"
          referrerpolicy="no-referrer"
          class="absolute inset-0 size-full border-0"
          :class="{ invisible: status.kind !== 'ready' }"
          aria-label="lowcode preview"
          @load="onIframeLoad"
        />
        <div
          v-if="!url || status.kind === 'starting'"
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
              <span v-if="diagnostic.path" class="block truncate text-muted">
                {{ diagnostic.path
                }}<template v-if="diagnostic.line"
                  >:{{ diagnostic.line
                  }}<template v-if="diagnostic.column">:{{ diagnostic.column }}</template></template
                >
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
