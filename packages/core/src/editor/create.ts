import type { CanvasKit } from 'canvaskit-wasm'
import { createNanoEvents } from 'nanoevents'
import type { Emitter } from 'nanoevents'

import { SceneGraph } from '@open-pencil/scene-graph'
import { UndoManager } from '@open-pencil/scene-graph/undo'

import type { SkiaRenderer } from '#core/canvas/renderer'
import { prefetchFigmaSchema } from '#core/clipboard'
import { IS_BROWSER } from '#core/constants'
import { setTextMeasurer } from '#core/layout'
import { TextEditor } from '#core/text/editor'
import { fontManager } from '#core/text/fonts'
import { fontResolver } from '#core/text/resolver'

import { createAlignmentActions } from './alignment'
import { createClipboardBridge } from './bridges/clipboard'
import { createComponentBridge } from './bridges/components'
import { createStructureBridge } from './bridges/structure'
import { createUndoBridge } from './bridges/undo'
import { createClipboardActions } from './clipboard'
import { createColorSpaceActions } from './color-space'
import { createComponentSyncScheduler } from './component-sync'
import { createComponentActions } from './components'
import { createGraphEventSubscription } from './graph-events'
import { createGraphReadActions } from './graph-reads'
import { createLayoutRunner } from './layout-runner'
import { createMotionPreviewActions } from './motion-preview'
import { createNodeActions } from './nodes'
import { createPageActions } from './pages'
import { createSelectionActions } from './selection'
import { createShapeActions } from './shapes'
import { createDefaultEditorState } from './state'
import { createStructureActions } from './structure'
import { createTextActions } from './text'
import type {
  EditorContext,
  EditorEventName,
  EditorEvents,
  EditorOptions,
  EditorState
} from './types'
import { createUndoActions } from './undo'
import { createVariableActions } from './variables'
import { createVectorizeActions } from './vectorize'
import { createViewportActions } from './viewport'

export { createDefaultEditorState } from './state'

export function createEditor(options?: EditorOptions) {
  let _graph = options?.graph ?? new SceneGraph()
  const skipInitialGraphSetup = options?.skipInitialGraphSetup ?? false
  const undo = new UndoManager()
  const _loadFont = options?.loadFont ?? fontManager.loadFont.bind(fontManager)
  const _getViewportSize =
    options?.getViewportSize ??
    (() => {
      if (IS_BROWSER) return { width: window.innerWidth, height: window.innerHeight }
      return { width: 800, height: 600 }
    })
  const _prefersReducedMotion =
    options?.prefersReducedMotion ??
    (() =>
      IS_BROWSER &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  let _ck: CanvasKit | null = null
  let _renderer: SkiaRenderer | null = null
  const _renderers = new Set<SkiaRenderer>()
  let _textEditor: TextEditor | null = null
  let loadingLeaseCount = 0
  let cacheReleasingLeaseCount = 0
  const events: Emitter<EditorEvents> = createNanoEvents()
  const stopFontResolutionEvents = fontResolver.subscribe((event, snapshot) => {
    events.emit('font:resolution-changed', event, snapshot)
  })

  void prefetchFigmaSchema()

  const state: EditorState = options?.state ?? createDefaultEditorState(_graph.getPages()[0].id)
  let manualLoading = state.loading

  function emitEditorEvent<K extends EditorEventName>(
    event: K,
    ...args: Parameters<EditorEvents[K]>
  ) {
    events.emit(event, ...args)
  }

  function onEditorEvent<K extends EditorEventName>(event: K, handler: EditorEvents[K]) {
    return events.on(event, handler)
  }

  function requestRender() {
    state.renderVersion++
    state.sceneVersion++
    emitEditorEvent('render:requested', {
      renderVersion: state.renderVersion,
      sceneVersion: state.sceneVersion
    })
  }

  function requestRepaint() {
    state.renderVersion++
    emitEditorEvent('repaint:requested', {
      renderVersion: state.renderVersion,
      sceneVersion: state.sceneVersion
    })
  }

  function requestOverlayRepaint() {
    emitEditorEvent('overlay:requested', {
      renderVersion: state.renderVersion,
      sceneVersion: state.sceneVersion
    })
  }

  function clearRendererDocumentCaches() {
    for (const renderer of _renderers) renderer.clearDocumentCaches()
  }

  function updateLoadingState(loading: boolean) {
    if (state.loading === loading) return
    state.loading = loading
    // Render requests raised while loading are intentionally allowed to sleep.
    // A repaint on completion wakes every canvas without invalidating scene data.
    if (!loading) requestRepaint()
  }

  function setLoading(loading: boolean) {
    const enteringManualLoading = loading && !manualLoading
    manualLoading = loading
    if (enteringManualLoading) clearRendererDocumentCaches()
    updateLoadingState(manualLoading || loadingLeaseCount > 0)
  }

  function beginLoading(options: { releaseDocumentCaches?: boolean } = {}) {
    const releasesDocumentCaches = options.releaseDocumentCaches !== false
    if (releasesDocumentCaches && cacheReleasingLeaseCount === 0) {
      clearRendererDocumentCaches()
    }
    if (releasesDocumentCaches) cacheReleasingLeaseCount++
    loadingLeaseCount++
    updateLoadingState(true)

    let released = false
    return () => {
      if (released) return
      released = true
      loadingLeaseCount = Math.max(0, loadingLeaseCount - 1)
      if (releasesDocumentCaches) {
        cacheReleasingLeaseCount = Math.max(0, cacheReleasingLeaseCount - 1)
      }
      if (loadingLeaseCount !== 0) return
      updateLoadingState(manualLoading)
    }
  }

  function setSelectedIds(ids: Set<string>) {
    const previous = [...state.selectedIds]
    state.selectedIds = ids
    const selected = [...ids]
    if (
      previous.length !== selected.length ||
      previous.some((id, index) => id !== selected[index])
    ) {
      emitEditorEvent('selection:changed', selected, previous)
    }
  }

  function setActiveTool(tool: EditorState['activeTool']) {
    const previous = state.activeTool
    state.activeTool = tool
    if (previous !== tool) emitEditorEvent('tool:changed', tool, previous)
  }

  const graphReads = createGraphReadActions(() => _graph)
  const { runLayoutForNode } = createLayoutRunner(() => _graph)
  const { scheduleComponentSync } = createComponentSyncScheduler(() => _graph, requestRender)

  const { subscribeToGraph } = createGraphEventSubscription({
    getGraph: () => _graph,
    getRenderers: () => _renderers,
    scheduleComponentSync,
    requestRender,
    emitEditorEvent
  })

  if (!skipInitialGraphSetup) {
    subscribeToGraph()
  }

  // Build the shared context
  const ctx: EditorContext = {
    get graph() {
      return _graph
    },
    set graph(g) {
      _graph = g
    },
    undo,
    state,
    loadFont: _loadFont,
    resolveFigmaClipboardImages: options?.resolveFigmaClipboardImages ?? null,
    getViewportSize: _getViewportSize,
    prefersReducedMotion: _prefersReducedMotion,
    getCk: () => _ck,
    getRenderer: () => _renderer,
    getRenderers: () => _renderers,
    getTextEditor: () => _textEditor,
    requestRender,
    requestRepaint,
    requestOverlayRepaint,
    beginLoading,
    emitEditorEvent,
    setSelectedIds,
    setActiveTool,
    runLayoutForNode,
    subscribeToGraph
  }

  // Assemble domain modules
  const viewport = createViewportActions(ctx)
  const selection = createSelectionActions(ctx)
  const { cancelPendingSwitch, ...pages } = createPageActions(ctx)
  const shapes = createShapeActions(ctx)
  const structure = createStructureActions(ctx)
  const components = createComponentActions(ctx)
  const clipboard = createClipboardActions(ctx)
  const colorSpace = createColorSpaceActions(ctx)
  const undoActions = createUndoActions(ctx)
  const text = createTextActions(ctx)
  const nodes = createNodeActions(ctx)
  const motionPreview = createMotionPreviewActions(ctx)
  const clearPreviewForTarget = (nodeId: string) => {
    if (motionPreview.hasMotionPreview(nodeId)) motionPreview.stopMotionPreview()
  }
  onEditorEvent('node:updated', clearPreviewForTarget)
  onEditorEvent('node:deleted', clearPreviewForTarget)
  onEditorEvent('selection:changed', () => motionPreview.stopMotionPreview())
  onEditorEvent('page:changed', () => motionPreview.stopMotionPreview())
  // Release the previous page before lazy population, font loading, and the next draw can overlap
  // it in native CanvasKit memory.
  onEditorEvent('page:changed', clearRendererDocumentCaches)
  // A replacement graph may intentionally reuse the same page and node IDs. Clear immediately so
  // native geometry and image caches cannot be read under the new graph identity.
  onEditorEvent('graph:replaced', clearRendererDocumentCaches)
  const variables = createVariableActions(ctx)
  const vectorize = createVectorizeActions(ctx)
  const alignment = createAlignmentActions(ctx)
  const clipboardBridge = createClipboardBridge(clipboard, selection)
  const componentBridge = createComponentBridge(components, selection, structure, pages)
  const structureBridge = createStructureBridge(structure, selection)
  const undoBridge = createUndoBridge(undoActions, selection)

  function setCanvasKit(ck: CanvasKit, renderer: SkiaRenderer) {
    _ck = ck
    _renderer = renderer
    _renderers.add(renderer)
    _textEditor ??= new TextEditor(ck)
    setTextMeasurer(
      typeof renderer.measureTextNode === 'function'
        ? (node, maxWidth) => renderer.measureTextNode(node, maxWidth)
        : null
    )
  }

  function removeCanvasRenderer(renderer: SkiaRenderer) {
    _renderers.delete(renderer)
    if (_renderer === renderer) {
      _renderer = _renderers.values().next().value ?? null
    }
  }

  function replaceGraph(newGraph: SceneGraph, options: { currentPageId?: string } = {}) {
    cancelPendingSwitch()
    _graph = newGraph
    subscribeToGraph()
    const previousPageId = state.currentPageId
    const requestedPage = options.currentPageId ? _graph.getNode(options.currentPageId) : null
    state.currentPageId =
      requestedPage?.type === 'CANVAS'
        ? requestedPage.id
        : (_graph.getPages()[0]?.id ?? _graph.rootId)
    setSelectedIds(new Set())
    state.hoveredNodeId = null
    state.motionPreview = null
    pages.clearPageViewports()
    emitEditorEvent('graph:replaced', _graph)
    if (previousPageId !== state.currentPageId) {
      emitEditorEvent('page:changed', state.currentPageId, previousPageId)
    }
    requestRender()
  }

  return {
    get graph() {
      return _graph
    },
    get renderer() {
      return _renderer
    },
    get canvasRenderers() {
      return [..._renderers]
    },
    get textEditor() {
      return _textEditor
    },
    undo,
    state,

    // Graph reads
    ...graphReads,

    // Lifecycle
    requestRender,
    requestRepaint,
    requestOverlayRepaint,
    setLoading,
    beginLoading,
    onEditorEvent,
    setCanvasKit,
    removeCanvasRenderer,
    replaceGraph,
    subscribeToGraph,
    dispose: stopFontResolutionEvents,

    // Selection
    ...selection,

    // Pages
    ...pages,

    // Shapes & tools
    ...shapes,

    // Structure (group, reorder, reparent, z-order)
    ...structure,

    // Nodes (update, layout)
    ...nodes,

    // Ephemeral motion preview (never mutates the SceneGraph)
    ...motionPreview,

    // Alignment (align, flip, rotate)
    ...alignment,

    // Bitmap-to-vector replacement
    ...vectorize,

    // Variables
    ...variables,

    // Text editing
    ...text,

    // Viewport
    ...viewport,

    // Undo — bridge functions that need cross-module refs
    ...undoBridge,

    setDocumentColorSpace: colorSpace.setDocumentColorSpace,

    // Clipboard — bridge functions that need selectedNodes
    ...clipboardBridge,

    // Components — bridge functions
    ...componentBridge,

    // Structure — bridge functions that need selectedNodes
    ...structureBridge
  }
}

export type Editor = ReturnType<typeof createEditor>
