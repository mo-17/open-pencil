import type { CanvasKit } from 'canvaskit-wasm'

import type {
  MotionSpec,
  MotionTrigger,
  SceneGraph,
  SceneGraphEvents,
  SceneNode,
  VectorSegment,
  VectorVertex
} from '@open-pencil/scene-graph'
import type { Color, Rect, Vector } from '@open-pencil/scene-graph/primitives'
import type { SnapGuide } from '@open-pencil/scene-graph/snap'
import type { UndoManager } from '@open-pencil/scene-graph/undo'

import type { RulerTheme, SkiaRenderer } from '#core/canvas/renderer'
import type { RenderOverlays } from '#core/canvas/renderer/types'
import type {
  MotionScenePlanIssue,
  MotionVisualState,
  PreparedMotionSamplingPlan
} from '#core/motion'
import type { TextEditor } from '#core/text/editor'
import type { FontLoadOptions } from '#core/text/fonts'
import type { FontResolutionEvent, FontResolutionSnapshot } from '#core/text/resolver'

export type Tool =
  | 'SELECT'
  | 'FRAME'
  | 'SECTION'
  | 'RECTANGLE'
  | 'ELLIPSE'
  | 'LINE'
  | 'POLYGON'
  | 'STAR'
  | 'TEXT'
  | 'PEN'
  | 'HAND'
  | 'INPUT'
  | 'BUTTON'
  | 'SELECT_FIELD'
  | 'CHECKBOX'
  | 'FORM'
  | 'LIST'
  | 'RADIO'
  | 'TEXTAREA'
  | 'DATEPICKER'
  | 'SWITCH'
  | 'MAP'

export interface MotionPreviewTarget {
  readonly nodeId: string
  readonly spec: MotionSpec
  /** Prepared once when preview starts and reused for every frame. */
  readonly plan: PreparedMotionSamplingPlan
}

export interface MotionPreviewOptions {
  /** Restrict the preview to one authored track. */
  readonly trackId?: string
  /** Author infinite playback as one finite cycle without mutating the document. */
  readonly infiniteAsSingleCycle?: boolean
  /** Static authoring seeks keep the finite end value even when runtime fill does not. */
  readonly holdFinalFrame?: boolean
}

export type MotionPreviewSelection =
  | { readonly mode: 'all' }
  | { readonly mode: 'trigger'; readonly trigger: MotionTrigger }

export interface MotionPreviewSpecTarget {
  readonly nodeId: string
  /** Untrusted input is strictly parsed before it reaches the preview sampler. */
  readonly spec: unknown
}

export interface MotionPreviewSpecsOptions extends MotionPreviewOptions {
  /** Preview every track by default, or only tracks matching one authored trigger. */
  readonly selection?: MotionPreviewSelection
}

export interface MotionScenePreviewResult {
  readonly started: boolean
  /** Opaque preview ownership token. It can be used to stop only the preview this call started. */
  readonly previewId?: number
  readonly durationMs: number
  readonly issues: readonly MotionScenePlanIssue[]
}

export interface MotionPreviewState {
  /** Monotonic editor-local token identifying the surface that most recently replaced the preview. */
  readonly id: number
  readonly targets: readonly MotionPreviewTarget[]
  /** Legacy trigger label. `all` is used by previewMotionSpecs() when every track participates. */
  readonly trigger: MotionTrigger | 'all'
  readonly prefersReducedMotion: boolean
  /** True only while the render loop should advance the preview clock. */
  readonly playing: boolean
  readonly startedAtMs: number | null
  /** Last sampled timeline position, independent of the RAF timestamp origin. */
  readonly elapsedMs: number
  readonly visuals: ReadonlyMap<string, MotionVisualState>
  readonly finished: boolean
}

export interface EditorState {
  activeTool: Tool
  currentPageId: string
  selectedIds: Set<string>
  marquee: Rect | null
  snapGuides: SnapGuide[]
  rotationPreview: { nodeId: string; angle: number } | null
  dropTargetId: string | null
  layoutInsertIndicator: {
    parentId: string
    index: number
    x: number
    y: number
    length: number
    direction: 'HORIZONTAL' | 'VERTICAL'
  } | null
  hoveredNodeId: string | null
  editingTextId: string | null
  penState: {
    vertices: VectorVertex[]
    segments: VectorSegment[]
    dragTangent: Vector | null
    oppositeDragTangent: Vector | null
    pendingClose?: boolean
    closingToFirst: boolean
    resumingNodeId?: string
    resumedFills?: SceneNode['fills']
    resumedStrokes?: SceneNode['strokes']
  } | null
  penCursorX: number | null
  penCursorY: number | null
  remoteCursors: Array<{
    name: string
    color: Color
    x: number
    y: number
    selection?: string[]
  }>
  autoLayoutHover: {
    nodeId: string
    kind: 'frame' | 'children' | 'spacing' | 'spacing-value' | 'padding' | 'padding-value'
    index?: number
    side?: 'top' | 'right' | 'bottom' | 'left'
  } | null
  documentName: string
  panX: number
  pageColor: Color
  rulerTheme?: RulerTheme
  panY: number
  zoom: number
  renderVersion: number
  sceneVersion: number
  loading: boolean
  enteredContainerId: string | null
  nodeEditState?: RenderOverlays['nodeEditState'] | null
  cursorCanvasX?: number | null
  cursorCanvasY?: number | null
  motionPreview: MotionPreviewState | null
}

export interface ClipboardImageResolution {
  total: number
  missing: number
  fetchAttempted: boolean
}

export interface FontLoadProgress {
  /** Monotonic editor-local identifier for one page font-loading operation. */
  readonly operationId: number
  readonly pageId: string
  readonly completed: number
  readonly total: number
  readonly failed: number
  readonly status: 'loading' | 'completed' | 'cancelled'
}

export type FigmaClipboardImageResolver = (
  fileKey: string,
  hashes: string[]
) => Promise<ReadonlyMap<string, Uint8Array>>

export interface EditorEvents extends SceneGraphEvents {
  'render:requested': (versions: { renderVersion: number; sceneVersion: number }) => void
  'repaint:requested': (versions: { renderVersion: number; sceneVersion: number }) => void
  'overlay:requested': (versions: { renderVersion: number; sceneVersion: number }) => void
  'graph:replaced': (graph: SceneGraph) => void
  'selection:changed': (selectedIds: string[], previousIds: string[]) => void
  'tool:changed': (tool: Tool, previousTool: Tool) => void
  'page:changed': (pageId: string, previousPageId: string) => void
  'font:load-progress': (progress: FontLoadProgress) => void
  'clipboard:images-missing': (resolution: ClipboardImageResolution) => void
  'font:resolution-changed': (event: FontResolutionEvent, snapshot: FontResolutionSnapshot) => void
  'viewport:changed': (
    viewport: { panX: number; panY: number; zoom: number },
    previous: { panX: number; panY: number; zoom: number }
  ) => void
}

export type EditorEventName = keyof EditorEvents

export interface EditorOptions {
  graph?: SceneGraph
  state?: EditorState
  loadFont?: (
    family: string,
    style: string,
    characters?: string,
    options?: FontLoadOptions
  ) => Promise<ArrayBuffer | null>
  resolveFigmaClipboardImages?: FigmaClipboardImageResolver
  getViewportSize?: () => { width: number; height: number }
  prefersReducedMotion?: () => boolean
  skipInitialGraphSetup?: boolean
}

export interface EditorContext {
  get graph(): SceneGraph
  set graph(g: SceneGraph)
  undo: UndoManager
  state: EditorState
  loadFont: (
    family: string,
    style: string,
    characters?: string,
    options?: FontLoadOptions
  ) => Promise<ArrayBuffer | null>
  resolveFigmaClipboardImages: FigmaClipboardImageResolver | null
  getViewportSize: () => { width: number; height: number }
  prefersReducedMotion: () => boolean
  getCk: () => CanvasKit | null
  getRenderer: () => SkiaRenderer | null
  getRenderers: () => ReadonlySet<SkiaRenderer>
  getTextEditor: () => TextEditor | null
  requestRender: () => void
  requestRepaint: () => void
  requestOverlayRepaint: () => void
  beginLoading: (options?: { releaseDocumentCaches?: boolean }) => () => void
  emitEditorEvent: <K extends EditorEventName>(
    event: K,
    ...args: Parameters<EditorEvents[K]>
  ) => void
  setSelectedIds: (ids: Set<string>) => void
  setActiveTool: (tool: Tool) => void
  runLayoutForNode: (id: string) => void
  subscribeToGraph: () => void
}
