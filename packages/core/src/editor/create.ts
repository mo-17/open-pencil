import type { CanvasKit } from 'canvaskit-wasm'
import { createNanoEvents } from 'nanoevents'
import type { Emitter } from 'nanoevents'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { UndoManager } from '@open-pencil/scene-graph/undo'

import type { SkiaRenderer } from '#core/canvas/renderer'
import { prefetchFigmaSchema } from '#core/clipboard'
import { IS_BROWSER } from '#core/constants'
import {
  getPageColor,
  hasStoredBackground,
  setDefaultPageBackground
} from '#core/figma-api/page-backgrounds'
import { iconify } from '#core/icons'
import { releaseFigPopulationWorker } from '#core/kiwi/fig/population/client'
import { releaseOriginalFigArchive } from '#core/kiwi/fig/session/original-archive'
import { installTextMeasurer } from '#core/layout'
import { createLayoutRunner } from '#core/layout/mutations'
import { emitNavigationTrace } from '#core/profiler'
import { TextEditor } from '#core/text/editor'
import { fontManager } from '#core/text/fonts'
import { fontResolver } from '#core/text/resolver'

import { createAlignmentActions } from './alignment'
import { createClipboardBridge } from './bridges/clipboard'
import { createComponentBridge } from './bridges/components'
import { createFrameNavigationBridge } from './bridges/frames'
import { createLintFixBridge } from './bridges/lint'
import { createStructureBridge } from './bridges/structure'
import { createUndoBridge } from './bridges/undo'
import { createClipboardActions } from './clipboard'
import { createColorSpaceActions } from './color-space'
import { createComponentSyncScheduler } from './component-sync'
import { createComponentActions } from './components'
import { createContentEditActions } from './content-edit'
import { createDesignTokenActions } from './design-tokens'
import { createGraphEventSubscription } from './graph-events'
import { createGraphReadActions } from './graph-reads'
import { createGuideActions } from './guides'
import { createIconActions } from './icons'
import { createDesignIssueActions } from './issues'
import { createMotionPreviewActions } from './motion-preview'
import { createNodeActions } from './nodes'
import { createPageActions } from './pages'
import { createPlayActions } from './play/actions'
import { createSelectionActions } from './selection'
import { createShaderActions } from './shaders/actions'
import { createShaderFrames } from './shaders/frames'
import { createShapeActions } from './shapes'
import { createDefaultEditorState } from './state'
import { createStructureActions } from './structure'
import { createTabsPreviewActions } from './tabs-preview'
import { createTextActions } from './text'
import { createPendingTextLayout } from './text/pending-layout'
import { createTextSelectionStyle } from './text/selection-style'
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

function defaultViewportSize(): { width: number; height: number } {
  return IS_BROWSER
    ? { width: window.innerWidth, height: window.innerHeight }
    : { width: 800, height: 600 }
}

function systemPrefersReducedMotion(): boolean {
  return (
    IS_BROWSER &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function createEditor(options: EditorOptions = {}) {
  let _graph = options.graph ?? new SceneGraph()
  const skipInitialGraphSetup = options.skipInitialGraphSetup ?? false
  const undo = new UndoManager({
    onChange: () => emitEditorEvent('history:changed')
  })
  const _loadFont = options.loadFont ?? fontManager.loadFont.bind(fontManager)
  const _getViewportSize = options.getViewportSize ?? defaultViewportSize
  const _prefersReducedMotion = options.prefersReducedMotion ?? systemPrefersReducedMotion
  let _ck: CanvasKit | null = null
  let _renderer: SkiaRenderer | null = null
  const _renderers = new Set<SkiaRenderer>()
  let uninstallTextMeasurer: (() => void) | null = null
  const interactiveEdits = new Set<symbol>()
  let _textEditor: TextEditor | null = null
  let loadingLeaseCount = 0
  let cacheReleasingLeaseCount = 0
  const events: Emitter<EditorEvents> = createNanoEvents()
  const stopFontResolutionEvents = fontResolver.subscribe((event, snapshot) => {
    if (event === 'settled') pendingTextLayout.relayoutReady(_renderer)
    events.emit('font:resolution-changed', event, snapshot)
  })

  void prefetchFigmaSchema()

  const state: EditorState = options.state ?? createDefaultEditorState(_graph.getPages()[0].id)
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

  function requestRender(reason?: 'page-navigation') {
    state.renderVersion++
    state.sceneVersion++
    state.canvasVersion++
    emitNavigationTrace('render:requested', {
      kind: 'render',
      renderVersion: state.renderVersion,
      sceneVersion: state.sceneVersion
    })
    emitEditorEvent('render:requested', {
      renderVersion: state.renderVersion,
      sceneVersion: state.sceneVersion,
      ...(reason ? { reason } : {})
    })
  }

  /**
   * The caret or selection of the edited text moved: the canvas repaints its overlay and the
   * views that follow the selection update, without the document counting as changed.
   */
  function textSelectionChanged() {
    state.textSelectionVersion++
    requestRepaint()
  }

  function requestRefresh() {
    state.sceneVersion++
  }

  function requestRepaint() {
    state.renderVersion++
    emitNavigationTrace('render:requested', {
      kind: 'repaint',
      renderVersion: state.renderVersion,
      sceneVersion: state.sceneVersion
    })
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

  /** Track an actual live edit independently of history batching. Release is idempotent. */
  function beginInteractiveEdit() {
    const token = Symbol('interactive-edit')
    interactiveEdits.add(token)
    requestRepaint()
    return () => {
      if (interactiveEdits.delete(token)) requestRepaint()
    }
  }

  function setNavigationPhase(phase: EditorState['navigation']['phase'], inputAt = 0) {
    const previous = { ...state.navigation }
    const active = phase === 'pan' || phase === 'zoom' || phase === 'momentum'
    const wasActive =
      previous.phase === 'pan' || previous.phase === 'zoom' || previous.phase === 'momentum'
    state.navigation = {
      phase,
      generation: active && !wasActive ? previous.generation + 1 : previous.generation,
      lastInputAt: inputAt || previous.lastInputAt
    }
    if (
      state.navigation.phase !== previous.phase ||
      state.navigation.generation !== previous.generation ||
      state.navigation.lastInputAt !== previous.lastInputAt
    ) {
      emitNavigationTrace('navigation:phase', {
        phase: state.navigation.phase,
        previousPhase: previous.phase,
        generation: state.navigation.generation,
        lastInputAt: state.navigation.lastInputAt
      })
      emitEditorEvent('navigation:changed', state.navigation, previous)
    }
  }

  function setSelectedIds(ids: Set<string>) {
    const previous = [...state.selectedIds]
    state.selectedIds = ids
    if (ids.size === 0) state.measurementMode = 'off'
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
    if (tool !== 'SELECT') state.measurementMode = 'off'
    if (previous !== tool) emitEditorEvent('tool:changed', tool, previous)
  }

  const graphReads = createGraphReadActions(() => _graph)
  const { runLayoutForNode, runMutationWithLayout } = createLayoutRunner(() => _graph)
  const pendingTextLayout = createPendingTextLayout({
    getGraph: () => _graph,
    runLayoutForNode,
    requestRender
  })
  const { scheduleComponentSync } = createComponentSyncScheduler(() => _graph, requestRender)

  const { subscribeToGraph, unsubscribeFromGraph } = createGraphEventSubscription({
    getGraph: () => _graph,
    getRenderers: () => _renderers,
    scheduleComponentSync,
    requestRender,
    emitEditorEvent
  })

  if (!skipInitialGraphSetup) {
    subscribeToGraph()
    // A new document's first page takes Figma's background for the interface theme the app gives;
    // a page that already has one keeps it.
    const firstPage = _graph.getPages()[0]
    if (options.state?.theme && !hasStoredBackground(firstPage)) {
      setDefaultPageBackground(_graph, firstPage, options.state.theme)
      options.state.pageColor = getPageColor(firstPage)
    }
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
    resolveFigmaClipboardImages: options.resolveFigmaClipboardImages ?? null,
    getViewportSize: _getViewportSize,
    prefersReducedMotion: _prefersReducedMotion,
    icons: options.icons ?? iconify,
    getCk: () => _ck,
    getRenderer: () => _renderer,
    getRenderers: () => _renderers,
    getTextEditor: () => _textEditor,
    requestRender,
    requestRefresh,
    requestRepaint,
    requestOverlayRepaint,
    beginLoading,
    beginInteractiveEdit,
    onEditorEvent,
    emitEditorEvent,
    setSelectedIds,
    setActiveTool,
    setNavigationPhase,
    runLayoutForNode,
    runMutationWithLayout,
    subscribeToGraph
  }

  // Assemble domain modules
  const viewport = createViewportActions(ctx)
  const designIssues = createDesignIssueActions(ctx)
  const shapes = createShapeActions(ctx)
  const text = createTextActions(ctx)
  const contentEdit = createContentEditActions(ctx, (preserveDrafts) => {
    if (!preserveDrafts) _textEditor?.stop()
    text.commitTextEdit()
    if (preserveDrafts && state.penState) shapes.penCommit(false)
    shapes.penCancel()
  })
  const tabsPreview = createTabsPreviewActions(ctx, (preserveDrafts) => {
    if (!preserveDrafts) _textEditor?.stop()
    text.commitTextEdit()
  })
  const selection = createSelectionActions(ctx)
  const shaderFrames = createShaderFrames(ctx, options)
  const { cancelPendingSwitch, ...pages } = createPageActions(ctx, shaderFrames)
  const guides = createGuideActions(ctx)
  const structure = createStructureActions(ctx)
  const components = createComponentActions(ctx)
  const clipboard = createClipboardActions(ctx)
  const colorSpace = createColorSpaceActions(ctx)
  const undoActions = createUndoActions(ctx)
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
  const designTokens = createDesignTokenActions(ctx, variables, nodes)
  const vectorize = createVectorizeActions(ctx)
  const icons = createIconActions(ctx)
  const shaders = createShaderActions(ctx, nodes)
  const alignment = createAlignmentActions(ctx)
  const preview = createPlayActions(ctx)
  const clipboardBridge = createClipboardBridge(clipboard, selection)
  const componentBridge = createComponentBridge(components, selection, structure, pages)
  const structureBridge = createStructureBridge(structure, selection)
  const frameNavigation = createFrameNavigationBridge(ctx, selection, viewport)
  const undoBridge = createUndoBridge(undoActions, selection, nodes.flushNudge)
  const lintFixBridge = createLintFixBridge(ctx, nodes, structure, clipboard)
  const textSelectionStyle = createTextSelectionStyle(ctx, text.runTextEditStep)

  // The edited text follows changes made outside the editor, such as a panel field being
  // dragged, so its caret and selection move with the text instead of after the change.
  const invalidateEditedText = (id: string) => {
    if (id !== state.editingTextId) return
    const node = _graph.getNode(id)
    if (node) _textEditor?.invalidateParagraph(node)
  }
  onEditorEvent('node:updated', invalidateEditedText)
  onEditorEvent('node:previewUpdated', invalidateEditedText)

  function setCanvasKit(ck: CanvasKit, renderer: SkiaRenderer) {
    _ck = ck
    _renderer = renderer
    _renderers.add(renderer)
    _textEditor ??= new TextEditor(ck)
    uninstallTextMeasurer?.()
    uninstallTextMeasurer =
      typeof renderer.measureTextNode === 'function'
        ? installTextMeasurer((node, maxWidth) =>
            pendingTextLayout.measure(renderer, node, maxWidth)
          )
        : null
  }

  function releaseTextMeasurer() {
    uninstallTextMeasurer?.()
    uninstallTextMeasurer = null
  }

  function removeCanvasRenderer(renderer: SkiaRenderer) {
    _renderers.delete(renderer)
    if (_renderer === renderer) {
      _renderer = _renderers.values().next().value ?? null
    }
    if (_renderers.size === 0) releaseTextMeasurer()
  }

  function replaceGraph(newGraph: SceneGraph, options: { currentPageId?: string } = {}) {
    cancelPendingSwitch()
    nodes.cancelNodePreviews()
    undo.discardBatches()
    _graph = newGraph
    pendingTextLayout.clear()
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
    state.transforming = false
    state.measurementMode = 'off'
    state.snapGuides = []
    state.guides = {
      preview: null,
      hovered: null,
      selected: null,
      redline: null
    }
    state.layoutInsertIndicator = null
    state.dropTargetId = null
    pages.clearPageViewports()
    for (const renderer of _renderers) renderer.tiledScene.invalidateStructure()
    emitEditorEvent('graph:replaced', _graph)
    if (previousPageId !== state.currentPageId) {
      emitEditorEvent('page:changed', state.currentPageId, previousPageId)
    }
    requestRender()
  }

  function dispose() {
    releaseTextMeasurer()
    nodes.cancelNodePreviews()
    interactiveEdits.clear()
    stopFontResolutionEvents()
    unsubscribeFromGraph()
  }

  function releaseGraphResources(graph: SceneGraph = _graph) {
    releaseFigPopulationWorker(graph)
    releaseOriginalFigArchive(graph)
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
    runLayoutForNode,
    runMutationWithLayout,
    ...graphReads,

    // Lifecycle
    beginInteractiveEdit,
    isInteractiveEditing: () => interactiveEdits.size > 0,
    requestRender,
    requestRefresh,
    textSelectionChanged,
    requestRepaint,
    requestOverlayRepaint,
    setLoading,
    beginLoading,
    onEditorEvent,
    setCanvasKit,
    setNavigationPhase,
    removeCanvasRenderer,
    replaceGraph,
    subscribeToGraph,
    dispose,
    releaseGraphResources,

    // Selection
    ...selection,
    ...contentEdit,
    ...tabsPreview,

    // Pages
    ...pages,

    // Canvas and frame guides
    ...guides,
    ...designIssues,

    // Shapes & tools
    ...shapes,

    // Structure (group, reorder, reparent, z-order)
    ...structure,

    // Nodes (update, layout); while text is edited, character styles go to its selection
    ...nodes,
    updateNode: (id: string, changes: Partial<SceneNode>) =>
      textSelectionStyle.updateNode(id, changes, nodes.updateNode),
    updateNodeWithUndo: (id: string, changes: Partial<SceneNode>, label = 'Update') =>
      textSelectionStyle.updateNodeWithUndo(id, changes, (target, next) =>
        nodes.updateNodeWithUndo(target, next, label)
      ),
    getTextSelectionStyle: textSelectionStyle.selectionStyle,

    // Ephemeral motion preview (never mutates the SceneGraph)
    ...motionPreview,

    // Alignment (align, flip, rotate)
    ...alignment,

    // Preview: instances with a behaviour respond to the pointer on this canvas
    ...preview,

    // Bitmap-to-vector replacement
    ...vectorize,
    ...icons,
    ...shaders,
    ...shaderFrames,

    // Variables
    ...variables,
    ...designTokens,

    // Text editing
    ...text,

    // Viewport
    ...viewport,
    ...frameNavigation,

    // Undo — bridge functions that need cross-module refs
    ...undoBridge,
    commitNodeUpdate: (id: string, previous: Partial<SceneNode>, label = 'Update') =>
      textSelectionStyle.commitNodeUpdate(
        id,
        previous,
        (target, values) => undoBridge.commitNodeUpdate(target, values, label),
        (target, next) => nodes.updateNodeWithUndo(target, next, label)
      ),
    // While text is edited, what was typed undoes first and the editor keeps the result.
    undoAction: () => text.runTextEditStep(undoBridge.undoAction),
    redoAction: () => text.runTextEditStep(undoBridge.redoAction),

    setDocumentColorSpace: colorSpace.setDocumentColorSpace,

    // Clipboard — bridge functions that need selectedNodes
    ...clipboardBridge,

    // Components — bridge functions
    ...componentBridge,

    // Structure — bridge functions that need selectedNodes
    ...structureBridge,

    // Lint fixes, which touch nodes, structure and deletion in one undo step
    ...lintFixBridge
  }
}

/** Stable public name for the composed editor surface used by SDK declarations. */
export interface Editor extends ReturnType<typeof createEditor> {
  state: EditorState
}
