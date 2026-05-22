import type { Color, Matrix, Rect, Vector } from '#core/types'

export interface SceneGraphEvents {
  'node:created': (node: SceneNode) => void
  'node:updated': (id: string, changes: Partial<SceneNode>) => void
  'node:deleted': (id: string) => void
  'node:reparented': (nodeId: string, oldParentId: string | null, newParentId: string) => void
  'node:reordered': (nodeId: string, parentId: string, index: number) => void
}

export type SceneGraphEventHandlers = Partial<{
  created: (node: SceneNode) => void
  updated: (id: string, changes: Partial<SceneNode>) => void
  deleted: (id: string) => void
  reparented: (nodeId: string, oldParentId: string | null, newParentId: string) => void
  reordered: (nodeId: string, parentId: string, index: number) => void
}>

export type DocumentColorSpace = 'srgb' | 'display-p3'

export type HandleMirroring = 'NONE' | 'ANGLE' | 'ANGLE_AND_LENGTH'
export type WindingRule = 'NONZERO' | 'EVENODD'

export interface VectorVertex {
  x: number
  y: number
  strokeCap?: string
  strokeJoin?: string
  cornerRadius?: number
  handleMirroring?: HandleMirroring
}

export interface VectorSegment {
  start: number
  end: number
  tangentStart: Vector
  tangentEnd: Vector
}

export interface VectorRegion {
  windingRule: WindingRule
  loops: number[][]
}

export interface VectorNetwork {
  vertices: VectorVertex[]
  segments: VectorSegment[]
  regions: VectorRegion[]
}

export interface GeometryPath {
  windingRule: WindingRule
  commandsBlob: Uint8Array
}

export type NodeType =
  | 'CANVAS'
  | 'FRAME'
  | 'RECTANGLE'
  | 'ROUNDED_RECTANGLE'
  | 'ELLIPSE'
  | 'TEXT'
  | 'LINE'
  | 'STAR'
  | 'POLYGON'
  | 'VECTOR'
  | 'BOOLEAN_OPERATION'
  | 'GROUP'
  | 'SECTION'
  | 'COMPONENT'
  | 'COMPONENT_SET'
  | 'INSTANCE'
  | 'CONNECTOR'
  | 'SHAPE_WITH_TEXT'
  | 'INPUT'
  | 'BUTTON'
  | 'SELECT'
  | 'CHECKBOX'
  | 'FORM'
  | 'LIST'

export type FillType =
  | 'SOLID'
  | 'GRADIENT_LINEAR'
  | 'GRADIENT_RADIAL'
  | 'GRADIENT_ANGULAR'
  | 'GRADIENT_DIAMOND'
  | 'IMAGE'
export type BlendMode =
  | 'NORMAL'
  | 'DARKEN'
  | 'MULTIPLY'
  | 'COLOR_BURN'
  | 'LIGHTEN'
  | 'SCREEN'
  | 'COLOR_DODGE'
  | 'OVERLAY'
  | 'SOFT_LIGHT'
  | 'HARD_LIGHT'
  | 'DIFFERENCE'
  | 'EXCLUSION'
  | 'HUE'
  | 'SATURATION'
  | 'COLOR'
  | 'LUMINOSITY'
  | 'PASS_THROUGH'
export type ImageScaleMode = 'FILL' | 'FIT' | 'CROP' | 'TILE'

export interface GradientStop {
  color: Color
  position: number
}

export type GradientTransform = Matrix

export interface Fill {
  type: FillType
  color: Color
  opacity: number
  visible: boolean
  blendMode?: BlendMode
  gradientStops?: GradientStop[]
  gradientTransform?: GradientTransform
  imageHash?: string
  imageScaleMode?: ImageScaleMode
  imageTransform?: GradientTransform
}

export type StrokeCap = 'NONE' | 'ROUND' | 'SQUARE' | 'ARROW_LINES' | 'ARROW_EQUILATERAL'
export type StrokeJoin = 'MITER' | 'BEVEL' | 'ROUND'
export type MaskType = 'ALPHA' | 'VECTOR' | 'LUMINANCE'

export interface Stroke {
  color: Color
  weight: number
  opacity: number
  visible: boolean
  align: 'INSIDE' | 'CENTER' | 'OUTSIDE'
  cap?: StrokeCap
  join?: StrokeJoin
  dashPattern?: number[]
}

export interface Effect {
  type: 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR' | 'FOREGROUND_BLUR'
  color: Color
  offset: Vector
  radius: number
  spread: number
  visible: boolean
  blendMode?: BlendMode
}

export type ConstraintType = 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE'
export type TextAutoResize = 'NONE' | 'HEIGHT' | 'WIDTH_AND_HEIGHT' | 'TRUNCATE'
export type TextAlignVertical = 'TOP' | 'CENTER' | 'BOTTOM'
export type TextCase = 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE'
export type TextDecoration = 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH'
export type TextDirection = 'AUTO' | 'LTR' | 'RTL'
export type LayoutDirection = 'AUTO' | 'LTR' | 'RTL'

export interface CharacterStyleOverride {
  fontWeight?: number
  italic?: boolean
  textDecoration?: TextDecoration
  fontSize?: number
  fontFamily?: string
  letterSpacing?: number
  lineHeight?: number | null
  fills?: Fill[]
}

export interface StyleRun {
  start: number
  length: number
  style: CharacterStyleOverride
}

export interface ArcData {
  startingAngle: number
  endingAngle: number
  innerRadius: number
}

export type LayoutMode = 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID'
export type LayoutSizing = 'FIXED' | 'HUG' | 'FILL'

export type GridTrackSizing = 'FIXED' | 'FR' | 'AUTO'

export interface GridTrack {
  sizing: GridTrackSizing
  value: number
}

export interface GridPosition {
  column: number
  row: number
  columnSpan: number
  rowSpan: number
}
export type LayoutAlign = 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN'
export type LayoutCounterAlign = 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'BASELINE'
export type LayoutAlignSelf = 'AUTO' | 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'BASELINE'
export type LayoutWrap = 'NO_WRAP' | 'WRAP'

export interface PluginDataEntry {
  pluginId: string
  key: string
  value: string
}

export interface PluginRelaunchDataEntry {
  pluginId: string
  command: string
  message: string
  isDeleted: boolean
}

export interface FigmaDerivedTextGlyph {
  commandsBlob: Uint8Array
  x: number
  y: number
  fontSize: number
}

export interface SymbolLink {
  uri: string
  displayName?: string
  displayText?: string
}

export interface VariantPropSpec {
  propDefId: string
  value: string
}

export interface SceneNode {
  id: string
  type: NodeType
  name: string
  parentId: string | null
  childIds: string[]

  x: number
  y: number
  width: number
  height: number
  rotation: number
  figmaDerivedLayout: Partial<Rect> | null

  fills: Fill[]
  strokes: Stroke[]
  effects: Effect[]
  opacity: number

  cornerRadius: number
  topLeftRadius: number
  topRightRadius: number
  bottomRightRadius: number
  bottomLeftRadius: number
  independentCorners: boolean
  cornerSmoothing: number

  visible: boolean
  locked: boolean
  clipsContent: boolean

  blendMode: BlendMode

  text: string
  fontSize: number
  fontFamily: string
  fontWeight: number
  italic: boolean
  textAlignHorizontal: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'
  textDirection: TextDirection
  textAlignVertical: TextAlignVertical
  textAutoResize: TextAutoResize
  textCase: TextCase
  textDecoration: TextDecoration
  lineHeight: number | null
  letterSpacing: number
  maxLines: number | null

  styleRuns: StyleRun[]

  horizontalConstraint: ConstraintType
  verticalConstraint: ConstraintType

  layoutMode: LayoutMode
  layoutDirection: LayoutDirection
  layoutWrap: LayoutWrap
  primaryAxisAlign: LayoutAlign
  counterAxisAlign: LayoutCounterAlign
  primaryAxisSizing: LayoutSizing
  counterAxisSizing: LayoutSizing
  itemSpacing: number
  counterAxisSpacing: number
  paddingTop: number
  paddingRight: number
  paddingBottom: number
  paddingLeft: number

  layoutPositioning: 'AUTO' | 'ABSOLUTE'
  layoutGrow: number
  layoutAlignSelf: LayoutAlignSelf

  vectorNetwork: VectorNetwork | null
  booleanOperation?: 'UNION' | 'SUBTRACT' | 'INTERSECT' | 'EXCLUDE'
  fillGeometry: GeometryPath[]
  strokeGeometry: GeometryPath[]

  arcData: ArcData | null

  strokeCap: StrokeCap
  strokeJoin: StrokeJoin
  dashPattern: number[]

  borderTopWeight: number
  borderRightWeight: number
  borderBottomWeight: number
  borderLeftWeight: number
  independentStrokeWeights: boolean

  strokeMiterLimit: number

  minWidth: number | null
  maxWidth: number | null
  minHeight: number | null
  maxHeight: number | null

  isMask: boolean
  maskType: MaskType

  gridTemplateColumns: GridTrack[]
  gridTemplateRows: GridTrack[]
  gridColumnGap: number
  gridRowGap: number
  gridPosition: GridPosition | null

  counterAxisAlignContent: 'AUTO' | 'SPACE_BETWEEN'
  itemReverseZIndex: boolean
  strokesIncludedInLayout: boolean

  expanded: boolean
  textTruncation: 'DISABLED' | 'ENDING'
  autoRename: boolean

  pointCount: number
  starInnerRadius: number

  componentId: string | null
  overrides: Record<string, unknown>
  componentPropertyDefinitions: ComponentPropertyDefinition[]
  componentPropertyValues: Record<string, string>
  componentKey: string | null
  sourceLibraryKey: string | null
  publishId: string | null
  overrideKey: string | null
  sharedSymbolVersion: string | null
  publishedVersion: string | null
  isPublishable: boolean
  isSymbolPublishable: boolean
  symbolDescription: string
  symbolLinks: SymbolLink[]
  variantPropSpecs: VariantPropSpec[]

  boundVariables: Record<string, string>

  pluginData: PluginDataEntry[]
  pluginRelaunchData: PluginRelaunchDataEntry[]

  internalOnly: boolean

  flipX: boolean
  flipY: boolean

  textPicture: Uint8Array | null
  figmaDerivedTextGlyphs: FigmaDerivedTextGlyph[] | null

  // ── Lowcode (Phase 0) ──
  // All fields optional so existing .pen / .fig files round-trip unchanged.
  state?: StateDef[]
  bindings?: Record<string, BindingExpr>
  events?: Partial<Record<EventName, ActionDef[]>>
  interactiveProps?: Record<string, unknown>
  // ── Lowcode (Phase 2 §9) ──
  // Optional render-condition expression (sub-language matches §7.3 valueExpr).
  // Compiler wraps the emitted node in `{(<expr>) && (...)}`. Empty string or
  // undefined → unconditional render (decision §9.2 #8). Persisted via §12
  // pluginData under `lowcode/renderCondition`.
  renderCondition?: string
  // ── Lowcode (Phase 2 §2) ──
  // Document-level "Document State" variable declarations. Bubble-style
  // runtime K-V, distinct from Figma-style Variable / VariableCollection
  // (which are design tokens with multi-mode). Only the root node
  // (`graph.rootId`) populates this; on other nodes the field stays
  // undefined. Persisted via §12 pluginData under `lowcode/documentState`.
  lowcodeDocumentState?: DocumentStateDef[]
}

export type ComponentPropertyType = 'VARIANT' | 'TEXT' | 'BOOLEAN' | 'INSTANCE_SWAP'

export interface ComponentPropertyDefinition {
  id: string
  name: string
  type: ComponentPropertyType
  defaultValue: string
  variantOptions?: string[]
}

export type VariableType = 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN'
export type VariableValue = Color | number | string | boolean | { aliasId: string }

export interface Variable {
  id: string
  name: string
  type: VariableType
  collectionId: string
  valuesByMode: Record<string, VariableValue>
  description: string
  hiddenFromPublishing: boolean
}

export interface VariableCollectionMode {
  modeId: string
  name: string
}

export interface VariableCollection {
  id: string
  name: string
  modes: VariableCollectionMode[]
  defaultModeId: string
  variableIds: string[]
}

// ── Lowcode (Phase 0) ──────────────────────────────────────────────
// Page- / component-scoped state declarations. Compiler emits one
// `useState(defaultValue)` per StateDef when generating React output.

export type StateValueType = 'string' | 'number' | 'boolean' | 'object' | 'array'

export interface StateDef {
  id: string
  name: string
  type: StateValueType
  defaultValue: unknown
  description?: string
}

// Phase 2 §2: document-level "Document State" variable declarations.
// Same shape as page-scoped StateDef; the distinction is *where* it is
// attached (root node's `lowcodeDocumentState`) and *how* the compiler
// emits it (a zustand-backed runtime store via `_lowcode_state.ts` rather
// than per-page `useState`). Strictly different from Figma `Variable`
// (which is a multi-mode design token, see types.ts:408).
export type DocumentStateDef = StateDef

// Binding describes how a node property pulls its value at runtime.
// kind=literal → use literalValue directly.
// kind=ref → resolve to the StateDef with id === stateId.
// kind=expr (Phase 2 §9) → evaluate `expr` (§7.3 sub-language) at IR-collect
//   time; identifiers in `expr` resolve against either declared states or the
//   in-scope item/index identifiers when inside a LIST template subtree.
// kind=docState (Phase 2 §2) → resolve to a DocumentStateDef by name on the
//   root node's `lowcodeDocumentState`. Independent from `stateId` so doc-state
//   and page-state can coexist without ID collisions.
export interface BindingExpr {
  kind: 'literal' | 'ref' | 'expr' | 'docState'
  stateId?: string
  literalValue?: unknown
  expr?: string
  docStateName?: string
}

export type EventName = 'onClick' | 'onChange' | 'onSubmit' | 'onFocus' | 'onBlur'

/** Update a page-scoped state variable. The compiler emits the matching
 *  `setStateName(<expr>)` call from the `useState` pair. */
export interface SetStateAction {
  id: string
  kind: 'setState'
  targetStateId?: string
  /** Restricted expression: identifier | number | string | `expr + 1` |
   *  `expr - 1` | `!expr`. Validated at edit-time; emitted verbatim. */
  valueExpr?: string
}

/** Navigate to another route. Implemented for multi-page compiles via
 *  `react-router-dom`'s `useNavigate`; single-page compiles drop the
 *  handler with a `action-navigate-no-router` warning. */
export interface NavigateAction {
  id: string
  kind: 'navigate'
  /** Target path, e.g. `/about`. Phase 1 §7.4 keeps this a literal string
   *  — expressions are a future candidate. */
  to?: string
}

/** Reserved stub for runtime variable writes. The compiler currently emits
 *  an `action-setvariable-not-implemented` warning and drops the handler —
 *  the discriminated-union slot is in place so future work can wire it to
 *  a real runtime store (localStorage / context / scene-graph variables). */
export interface SetVariableAction {
  id: string
  kind: 'setVariable'
  /** Variable name (target store key). */
  targetName?: string
  /** Same restricted expression sub-language as `SetStateAction.valueExpr`. */
  valueExpr?: string
}

/** Phase 2 §3: fire an HTTP request on an event and write the parsed JSON
 *  response into a Document State (§2). GET + POST only. Phase 2 §4: the URL
 *  may carry `${ … }` interpolation — the compiler parses it as a template. */
export interface ApiCallAction {
  id: string
  kind: 'apiCall'
  method: 'GET' | 'POST'
  /** Request URL. A raw string that may contain `${ … }` interpolation
   *  (Phase 2 §4); parsed as a template at compile time. */
  url: string
  /** POST request body — a JSON literal string, parsed + validated like a
   *  StatePanel array/object default. Undefined / ignored for GET. */
  bodyJson?: string
  /** Name of the DocumentStateDef the parsed JSON response is written into. */
  targetName: string
}

/** Phase 1 §7.4: discriminated union so the compiler can exhaustively
 *  dispatch on `kind` and the editor UI can render per-kind inputs.
 *  Phase 2 §3 adds `ApiCallAction`. */
export type ActionDef = SetStateAction | NavigateAction | SetVariableAction | ApiCallAction

export type ActionKind = ActionDef['kind']
