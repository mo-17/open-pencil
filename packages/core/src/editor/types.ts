import type { CanvasKit } from 'canvaskit-wasm'

import type {
  MotionScenePlanIssue,
  MotionVisualState,
  PreparedMotionSamplingPlan
} from '@open-pencil/motion'
import type {
  MotionSpec,
  MotionTrigger,
  DocumentColorSpace,
  SceneGraph,
  SceneGraphEvents,
  SceneNode,
  VectorSegment,
  VectorVertex
} from '@open-pencil/scene-graph'
import type { CanvasGuide } from '@open-pencil/scene-graph/guides'
import type { Color, Rect, Vector } from '@open-pencil/scene-graph/primitives'
import type { SnapGuide } from '@open-pencil/scene-graph/snap'
import type { UndoManager } from '@open-pencil/scene-graph/undo'

import type { GuideOverlayState } from '#core/canvas/guides/types'
import type { DesignIssueOverlay } from '#core/canvas/issues/types'
import type { RulerTheme, SkiaRenderer } from '#core/canvas/renderer'
import type {
  MeasurementMode,
  PresenceCursor,
  RenderOverlays,
  SelectionTheme
} from '#core/canvas/renderer/types'
import type { InterfaceTheme } from '#core/constants'
import type { PlayState } from '#core/editor/play/actions'
import type { SnappingPreferences } from '#core/editor/preferences'
import type { ShaderRasterizer } from '#core/editor/shaders/types'
import type { RotationPreview, ShapeHandleKind } from '#core/geometry'
import type { IconProvider } from '#core/icons/provider'
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
  | 'PENCIL'
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
  | 'COMMENT'

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

/** The gradient whose handles the canvas shows while its paint picker is open. */
export interface GradientEdit {
  nodeId: string
  paint: 'fills' | 'strokes'
  index: number
  /** The selected stop, shared by the canvas handles and the picker. */
  stop: number
}

/** The selected shape's radius, point count, and ratio handles, shown while the pointer is over it. */
export interface ShapeHandleHover {
  nodeId: string
  /** Whether a drag changes only the corner it holds; each handle then shows a dot. */
  single: boolean
  /** The handle under the pointer or being dragged, whose value the label shows. */
  handle: ShapeHandleKind | null
  /** The handle's name in the label, in the interface language. */
  label: string
  /** The pointer in screen coordinates, which the label follows. */
  pointer: Vector
}

export interface EditorSharedState {
  activeTool: Tool
  snappingPreferences: SnappingPreferences
  /** Draw the pixel grid once zoomed in far enough, as Figma's View › Pixel grid; shown unless false. */
  showPixelGrid?: boolean
  /** The gradient being edited, whose handles the canvas draws and drags. */
  gradientEdit?: GradientEdit | null
  presenceCursors: PresenceCursor[]
  documentName: string
  /** Design check markers and highlight, shared by every canvas pane. */
  designIssues: DesignIssueOverlay | null
  /** The layer of the code element around the cursor in a code editor, shown in every pane. */
  codeFocusNodeId: string | null
  rulerTheme?: RulerTheme
  /** Selection chrome on the canvas, following the interface accent; the default blue when unset. */
  selectionTheme?: SelectionTheme
  /** The interface theme new sections take their fill from; light when unset. */
  theme?: InterfaceTheme
  /** Bumped by every document change; views, saving, and recovery follow it. */
  sceneVersion: number
  loading: boolean
  /** One editor-owned ephemeral preview shared by every canvas pane. */
  motionPreview: MotionPreviewState | null
  canvasVersion: number
}

export interface PencilState {
  points: Vector[]
  /** The point Shift was pressed at; the stroke runs straight from it while Shift is held. */
  straightFrom: number | null
  /** How the stroke shows while it is drawn. */
  preview: { color: Color; weight: number }
}

export interface EditorViewState {
  /** View-only Tabs choice; never persisted in the SceneGraph. */
  tabsPreview: { nodeId: string; tabId: string } | null
  /** Ephemeral isolated editing of an existing Modal content subtree. */
  contentEdit: {
    rootId: string
    hostId: string
    previousViewport: { panX: number; panY: number; zoom: number }
  } | null
  currentPageId: string
  selectedIds: Set<string>
  marquee: Rect | null
  snapGuides: SnapGuide[]
  guides: GuideOverlayState
  rotationPreview: RotationPreview | null
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
  /** A pointer move, resize, or rotation is in progress. */
  transforming: boolean
  measurementMode: MeasurementMode
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
  /** The freehand stroke being drawn with the pencil, in canvas coordinates. */
  pencilState: PencilState | null
  autoLayoutHover: {
    nodeId: string
    kind: 'frame' | 'children' | 'spacing' | 'spacing-value' | 'padding' | 'padding-value'
    index?: number
    side?: 'top' | 'right' | 'bottom' | 'left'
  } | null
  shapeHandleHover: ShapeHandleHover | null
  panX: number
  pageColor: Color
  panY: number
  zoom: number
  navigation: NavigationState
  renderVersion: number
  /** Bumped when the caret or selection of the text being edited moves, which changes nothing else. */
  textSelectionVersion: number
  enteredContainerId: string | null
  nodeEditState?: RenderOverlays['nodeEditState'] | null
  cursorCanvasX?: number | null
  cursorCanvasY?: number | null
  /** This canvas's preview, or null while it edits. */
  play: PlayState | null
}

export type NavigationPhase = 'idle' | 'pan' | 'zoom' | 'momentum' | 'settling'

export interface NavigationState {
  phase: NavigationPhase
  generation: number
  lastInputAt: number
}

export interface EditorState extends EditorSharedState, EditorViewState {}

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
  'render:requested': (versions: {
    renderVersion: number
    sceneVersion: number
    reason?: 'page-navigation'
  }) => void
  'repaint:requested': (versions: { renderVersion: number; sceneVersion: number }) => void
  'overlay:requested': (versions: { renderVersion: number; sceneVersion: number }) => void
  'graph:replaced': (graph: SceneGraph) => void
  'document:color-space-changed': (colorSpace: DocumentColorSpace) => void
  'history:changed': () => void
  'selection:changed': (selectedIds: string[], previousIds: string[]) => void
  'rotation:preview-changed': (preview: RotationPreview | null) => void
  'tool:changed': (tool: Tool, previousTool: Tool) => void
  'page:changed': (pageId: string, previousPageId: string) => void
  'font:load-progress': (progress: FontLoadProgress) => void
  'guides:changed': (ownerId: string, guides: readonly CanvasGuide[]) => void
  'clipboard:images-missing': (resolution: ClipboardImageResolution) => void
  'font:resolution-changed': (event: FontResolutionEvent, snapshot: FontResolutionSnapshot) => void
  'viewport:changed': (
    viewport: { panX: number; panY: number; zoom: number },
    previous: { panX: number; panY: number; zoom: number }
  ) => void
  'navigation:changed': (navigation: NavigationState, previous: NavigationState) => void
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
  /** Where icons are searched and fetched; defaults to Iconify. */
  icons?: IconProvider
  /** What draws shader frames, which needs a GPU; without one, saved frames stay. */
  shaderRasterizer?: ShaderRasterizer | null
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
  icons: IconProvider
  getCk: () => CanvasKit | null
  getRenderer: () => SkiaRenderer | null
  getRenderers: () => ReadonlySet<SkiaRenderer>
  getTextEditor: () => TextEditor | null
  requestRender: (reason?: 'page-navigation') => void
  requestRefresh: () => void
  requestRepaint: () => void
  requestOverlayRepaint: () => void
  beginLoading: (options?: { releaseDocumentCaches?: boolean }) => () => void
  beginInteractiveEdit: () => () => void
  onEditorEvent: <K extends EditorEventName>(event: K, handler: EditorEvents[K]) => () => void
  emitEditorEvent: <K extends EditorEventName>(
    event: K,
    ...args: Parameters<EditorEvents[K]>
  ) => void
  setSelectedIds: (ids: Set<string>) => void
  setActiveTool: (tool: Tool) => void
  setNavigationPhase: (phase: NavigationPhase, inputAt?: number) => void
  runLayoutForNode: (id: string) => void
  runMutationWithLayout: <T>(
    operation: () => T | Promise<T>,
    fallbackId?: string,
    beforeLayout?: (result: T) => Promise<void> | void
  ) => Promise<T>
  subscribeToGraph: () => void
}
