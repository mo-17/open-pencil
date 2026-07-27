import type { Color, Matrix, Rect, Vector } from './primitives'

export interface SceneGraphEvents {
  'node:created': (node: SceneNode) => void
  'node:updated': (id: string, changes: Partial<SceneNode>) => void
  'node:previewUpdated': (id: string, changes: Partial<SceneNode>) => void
  'node:deleted': (id: string) => void
  'node:reparented': (nodeId: string, oldParentId: string | null, newParentId: string) => void
  'node:reordered': (nodeId: string, parentId: string, index: number) => void
}

export type SceneGraphEventHandlers = Partial<{
  created: (node: SceneNode) => void
  updated: (id: string, changes: Partial<SceneNode>) => void
  previewUpdated: (id: string, changes: Partial<SceneNode>) => void
  deleted: (id: string) => void
  reparented: (nodeId: string, oldParentId: string | null, newParentId: string) => void
  reordered: (nodeId: string, parentId: string, index: number) => void
}>

export type DocumentColorSpace = 'srgb' | 'display-p3'

export type LibrarySource =
  | {
      kind: 'file'
      ref: string
    }
  | {
      kind: 'url'
      ref: string
    }

export interface LibraryImportedComponent {
  key: string
  version: string
}

export interface LibraryRef {
  libraryId: string
  name: string
  source: LibrarySource
  importedComponents: LibraryImportedComponent[]
}

export interface FigmaSourcePayload {
  rawSize: Vector | null
  rawTransform: Matrix | null
  rawNodeFields: Record<string, unknown>
  layout: FigmaLayoutMetadata | null
  symbolOverrides: unknown[]
  componentPropAssignments: unknown[]
  derivedSymbolData: unknown[]
  derivedSymbolDataLayoutVersion: number | null
  uniformScaleFactor: number | null
}

export interface SourceMetadata {
  format: 'fig' | null
  id: string | null
  orderKey: string | null
  editedFields: string[]
  fig: FigmaSourcePayload
}

export interface SeoMetadata {
  title?: string
  description?: string
  image?: string
  canonicalUrl?: string
}

export type LowcodeHeadMetaKind = 'name' | 'property' | 'httpEquiv'
export type LowcodeHeadLinkCrossOrigin = 'anonymous' | 'use-credentials'

export interface LowcodeHeadMeta {
  kind: LowcodeHeadMetaKind
  key: string
  content: string
}

export interface LowcodeHeadLink {
  rel: string
  href: string
  as?: string
  type?: string
  media?: string
  crossorigin?: LowcodeHeadLinkCrossOrigin
}

export interface LowcodeHeadMetadata {
  meta?: LowcodeHeadMeta[]
  link?: LowcodeHeadLink[]
  styles?: string[]
}

export type AnalyticsProvider = 'ga4' | 'plausible' | 'posthog'
export type AnalyticsConsentRegionPreset = 'eea'

export interface AnalyticsConsentCopy {
  /** Short banner body copy. Rendered as plain text in the generated app. */
  bannerText?: string
  /** Optional override for the Analytics category description. */
  analyticsDescription?: string
  /** Optional privacy/cookie policy URL. Rendered as an href, not raw HTML. */
  privacyPolicyUrl?: string
  /** Optional link label for `privacyPolicyUrl`. */
  privacyPolicyLabel?: string
}

export interface AnalyticsConfig {
  enabled?: boolean
  provider: AnalyticsProvider
  /** GA4 measurement id, Plausible domain, or PostHog project API key. */
  id: string
  /** Optional provider host/script endpoint. Defaults are provider-specific. */
  endpoint?: string
  /** Auto-send page_view on app load and route changes. Defaults to true. */
  pageViews?: boolean
  /** Honor browser/user Do Not Track signals. Defaults to false for backward compatibility. */
  respectDoNotTrack?: boolean
  /**
   * Require generated-app code to call `__opGrantAnalyticsConsent()` before loading
   * provider scripts or sending events. Defaults to false.
   */
  consentRequired?: boolean
  /**
   * Starter preset for generated consent defaults. This is not legal advice; it
   * only pre-fills runtime behavior that authors can override explicitly.
   */
  consentRegionPreset?: AnalyticsConsentRegionPreset
  /** Initial checked state for the optional Analytics category. Defaults to true. */
  consentAnalyticsDefault?: boolean
  /** Plain-text copy overrides for the generated consent preference banner. */
  consentCopy?: AnalyticsConsentCopy
}

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
  | 'RADIO'
  | 'TEXTAREA'
  | 'DATEPICKER'
  | 'SWITCH'

export type FillType =
  | 'SOLID'
  | 'GRADIENT_LINEAR'
  | 'GRADIENT_RADIAL'
  | 'GRADIENT_ANGULAR'
  | 'GRADIENT_DIAMOND'
  | 'IMAGE'
  | 'VIDEO'
  | 'PATTERN'
  | 'NOISE'
  | 'CUSTOM'
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
export type NoiseType = 'MULTITONE' | 'MONOTONE' | 'DUOTONE'
export type PatternTileType = 'RECTANGULAR' | 'HORIZONTAL_HEXAGONAL' | 'VERTICAL_HEXAGONAL'
export type PatternAlignment = 'START' | 'CENTER' | 'END'

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
  sourceNodeId?: string
  scale?: number
  spacing?: number
  patternSpacing?: Vector
  patternTileType?: PatternTileType
  verticalAlignment?: PatternAlignment
  horizontalAlignment?: PatternAlignment
  noiseType?: NoiseType
  density?: number
  noiseSize?: Vector
  customEffectId?: string
}

export type StrokeCap = 'NONE' | 'ROUND' | 'SQUARE' | 'ARROW_LINES' | 'ARROW_EQUILATERAL'
export type StrokeJoin = 'MITER' | 'BEVEL' | 'ROUND'
export type SharedStyleType = 'FILL' | 'TEXT' | 'EFFECT' | 'GRID'
export type SharedStyleKind = 'fill' | 'stroke' | 'text' | 'effect' | 'grid'
export type MaskType = 'ALPHA' | 'VECTOR' | 'LUMINANCE'

export interface LayoutGrid {
  visible?: boolean
  color?: Color
  pattern?: 'COLUMNS' | 'ROWS' | 'GRID'
  axis?: 'X' | 'Y'
  type?: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH'
  alignment?: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH'
  numSections?: number
  count?: number
  offset?: number
  sectionSize?: number
  gutterSize?: number
}

export interface SharedStyle {
  id: string
  nodeId: string
  name: string
  type: SharedStyleType
}

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
  showShadowBehindNode?: boolean
}

export type ConstraintType = 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE'
export type TextAutoResize = 'NONE' | 'HEIGHT' | 'WIDTH_AND_HEIGHT' | 'TRUNCATE'
export type TextAlignVertical = 'TOP' | 'CENTER' | 'BOTTOM'
export type TextCase = 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE'
export type TextDecoration = 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH'
export type TextDecorationStyle = 'SOLID' | 'DOTTED' | 'WAVY'
export type LeadingTrim = 'NONE' | 'CAP_HEIGHT'
export type TextDirection = 'AUTO' | 'LTR' | 'RTL'
export type LayoutDirection = 'AUTO' | 'LTR' | 'RTL'

export interface FontVariation {
  axis: string
  value: number
}

export interface FontFeature {
  tag: string
  enabled: boolean
}

export interface CharacterStyleOverride {
  fontWeight?: number
  italic?: boolean
  textDecoration?: TextDecoration
  textDecorationStyle?: TextDecorationStyle
  textDecorationThickness?: number | null
  textDecorationFills?: Fill[]
  textDecorationSkipInk?: boolean
  textUnderlineOffset?: number | null
  fontSize?: number
  fontFamily?: string
  letterSpacing?: number
  lineHeight?: number | null
  fills?: Fill[]
  fontVariations?: FontVariation[]
  fontFeatures?: FontFeature[]
  textLanguage?: string | null
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

export type LayoutMode = 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID' | 'FREE'
export type LayoutSizing = 'FIXED' | 'HUG' | 'FILL'

/**
 * True when the layout mode runs an auto-layout (flex / grid) engine over
 * the node's children. `'NONE'` and `'FREE'` both opt out of auto-layout
 * (NONE = legacy/editor default; `'FREE'` = the explicit lowcode authoring
 * marker). Canvas and generated-code rendering preserve child x/y for both;
 * FREE remains distinct for authoring UI and persistence. Use this helper
 * wherever a callsite wants the "is auto-layout?" semantic — direct equality
 * with `'NONE'` would silently exclude `'FREE'`.
 *
 * Phase 2 §6 — introduced alongside the `'FREE'` variant; swept across
 * every existing `layoutMode === 'NONE'` / `!== 'NONE'` callsite in the
 * codebase as part of step 1 (经验 A: scalar equality survives a union
 * widening with no tsgo error).
 */
export function isAutoLayoutMode(mode: LayoutMode): mode is 'HORIZONTAL' | 'VERTICAL' | 'GRID' {
  return mode === 'HORIZONTAL' || mode === 'VERTICAL' || mode === 'GRID'
}

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

export type ExportFormatId = 'png' | 'jpg' | 'webp' | 'svg' | 'pdf'

export interface ExportSetting {
  scale: number
  format: ExportFormatId
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

export type FigmaLayoutMetadata = Partial<
  Record<
    | 'stackMode'
    | 'stackCounterAlign'
    | 'stackJustify'
    | 'stackCounterAlignItems'
    | 'stackPrimaryAlignItems'
    | 'stackPrimarySizing'
    | 'stackCounterSizing'
    | 'stackWrap'
    | 'stackPositioning'
    | 'stackChildAlignSelf',
    string
  > &
    Record<
      | 'stackSpacing'
      | 'stackPadding'
      | 'stackPaddingRight'
      | 'stackPaddingBottom'
      | 'stackVerticalPadding'
      | 'stackHorizontalPadding'
      | 'stackChildPrimaryGrow'
      | 'stackCounterSpacing',
      number
    > &
    Record<'bordersTakeSpace' | 'stackReverseZIndex', boolean>
>

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
  source: SourceMetadata
  figmaDerivedLayout: Partial<Rect> | null

  fills: Fill[]
  strokes: Stroke[]
  effects: Effect[]
  layoutGrids: LayoutGrid[]
  fillStyleId: string | null
  strokeStyleId: string | null
  textStyleId: string | null
  effectStyleId: string | null
  gridStyleId: string | null
  sharedStyleType: SharedStyleType | null
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
  textLanguage: string | null
  textAlignVertical: TextAlignVertical
  textAutoResize: TextAutoResize
  textCase: TextCase
  textDecoration: TextDecoration
  textDecorationStyle: TextDecorationStyle
  textDecorationThickness: number | null
  textDecorationFills: Fill[]
  textDecorationSkipInk: boolean
  textUnderlineOffset: number | null
  leadingTrim: LeadingTrim
  lineHeight: number | null
  letterSpacing: number
  maxLines: number | null

  styleRuns: StyleRun[]
  fontVariations: FontVariation[]
  fontFeatures: FontFeature[]

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
  maskIsOutline: boolean

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
  /** Phase 3 §8 v11: load-time-only carrier for instance overrides restored from
   *  `lowcode/overrides` pluginData. Keyed by the STABLE master-child id
   *  (`<masterChildId>:<prop>` → snapshot value) because instance child ids are
   *  reassigned when `populateInstances` re-clones the subtree on load.
   *  `reapplyInstanceOverrides` (run after populate) remaps these onto the freshly
   *  cloned children — setting each child's value and rebuilding `overrides` keyed
   *  by the new child id — then clears this field. Never serialized. */
  pendingInstanceOverrides?: Record<string, unknown>
  componentPropertyDefinitions: ComponentPropertyDefinition[]
  componentPropertyReferences: ComponentPropertyReference[]
  componentPropertyAssignments: Record<string, string>
  componentPropertyValues: Record<string, string>
  componentKey: string | null
  /** Phase 4 §14: cross-file library identity for cached local COMPONENT
   *  masters. `componentKey` remains the generic Figma-compatible global key;
   *  this field makes lowcode team-library metadata explicit for publish/import
   *  tooling and `.fig` pluginData round-trip. */
  libraryComponentKey?: string
  libraryId?: string
  libraryVersion?: string
  libraryReadonly?: boolean
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
  variableModes: VariableModeMap
  exportSettings: ExportSetting[]

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
  // ── Lowcode (Phase 3 §2) ──
  // Supabase connection config. Like `lowcodeDocumentState`, only the root
  // node carries this in practice. Presence unlocks the Supabase runtime
  // emit + `$currentUser` auto-registration. Persisted via §12 pluginData
  // under `lowcode/supabaseConfig`.
  lowcodeSupabaseConfig?: SupabaseConfig
  // ── Lowcode (Phase 5 §3) ──
  // Static HTML metadata authored for generated lowcode output. The root node
  // carries document defaults; page CANVAS nodes may carry a single-page
  // override. Persisted via §12 pluginData under `lowcode/seoMetadata`.
  lowcodeSeoMetadata?: SeoMetadata
  // ── Lowcode (Phase 5 §10) ──
  // Document-level analytics config for generated lowcode output. Root-only,
  // public identifiers only (GA measurement id / Plausible domain / PostHog
  // project API key), never a secret. Persisted via §12 pluginData under
  // `lowcode/analyticsConfig`.
  lowcodeAnalyticsConfig?: AnalyticsConfig
  // ── Lowcode (Phase 5 §11) ──
  // Controlled custom-code escape hatch for generated lowcode output. Root-only.
  // `lowcodeHeadMetadata` is deliberately structured instead of raw HTML, so the
  // compiler can emit only whitelisted <meta>, <link>, and <style> tags. Custom
  // CSS is appended to `src/index.css`; arbitrary JS/raw scripts stay out of scope.
  lowcodeHeadMetadata?: LowcodeHeadMetadata
  lowcodeCustomCss?: string
  // ── Lowcode (Phase 3 §7) ──
  // Per-breakpoint layout overrides. Bubble-style responsive design via
  // Tailwind viewport prefixes (`md:` / `lg:` …). Only the layout-affecting
  // props that differ at a breakpoint are stored; the compiler re-derives
  // Tailwind classes from the overridden node and emits just the prefixed
  // diff against the base. Absent ≡ single (base) layout. Persisted via §12
  // pluginData under `lowcode/responsiveOverrides`.
  responsiveOverrides?: ResponsiveOverrides
  // ── Lowcode (Phase 4 §20) — interaction-state styling ──
  // Per-state appearance overrides for the four core CSS interaction states
  // (hover/focus/active/disabled). Like `responsiveOverrides`, but the
  // re-derived CSS diff is prefixed with the state (`hover:bg-…`) instead of a
  // breakpoint, and only appearance props (fills/strokes/cornerRadius/opacity/
  // effects) may change — interaction feedback is visual, not a reflow. Absent
  // ≡ no state styling. Persisted via §12 pluginData under `lowcode/stateOverrides`.
  stateOverrides?: StateOverrides
  // ── Lowcode (Phase 3 §9 v7) ──
  // Document-level translation catalog. Like `lowcodeDocumentState`, only the
  // root node carries this in practice. Keyed by locale code → source message
  // string → translated string. The compiler pre-fills each target
  // `locales/<code>.json` from this (missing entries fall back to the source
  // string). Authored via the `set_translations` tool (GUI panel deferred).
  // Persisted via §12 pluginData under `lowcode/translations`.
  lowcodeTranslations?: LowcodeTranslations
  // ── Lowcode (Phase 3 §10 v4) ──
  // Document-level named, reusable workflows. Like `lowcodeDocumentState`, only
  // the root node carries this in practice. Each `WorkflowDef` is a labelled
  // ActionDef chain that any node's event handler (or another workflow) invokes
  // by id via a `CallWorkflowAction`; the compiler expands the chain inline at
  // each call site. Persisted via §12 pluginData under `lowcode/workflows`.
  lowcodeWorkflows?: WorkflowDef[]
  // ── Lowcode (Phase 4 §16.1) — dynamic routing ──
  // Page-level (CANVAS node) route pattern, e.g. `/product/:id`. Like per-page
  // `state`, only a page node carries this in practice. When set, the multi-page
  // router emits `<Route path="<pattern>">` instead of the slug-derived path, and
  // any page expression may read `$params.<name>` (compiled to `useParams()`).
  // Absent ≡ slug-derived route (`/` first page, `/<slug>` others). Persisted
  // via §12 pluginData under `lowcode/routePattern`.
  lowcodeRoutePattern?: string
  // ── Lowcode (Phase 4 §16.3) — auth guard ──
  // Page-level (CANVAS node) flag: when true the multi-page compile emits a
  // redirect-if-unauthenticated guard (`if (!$currentUser.signedIn) return
  // <Navigate to=… replace />`) at the top of the page module. Requires Supabase
  // (the `$currentUser` doc-state) — otherwise the compiler warns + skips.
  // Absent ≡ public page. Persisted via §12 pluginData under `lowcode/requiresAuth`.
  lowcodeRequiresAuth?: boolean
  // Document-level (root node) login route the auth guard redirects to, e.g.
  // `/login`. Shared by every `lowcodeRequiresAuth` page (mirrors the root-only
  // `lowcodeSupabaseConfig`). Absent ≡ the `/login` default. Persisted via §12
  // pluginData under `lowcode/authRedirect`.
  lowcodeAuthRedirect?: string
  // ── Lowcode (Phase 4 §14) — team-library manifest refs ──
  // Root-level list of local/remote library sources imported into this document,
  // plus the component keys/versions cached locally. Cached masters remain normal
  // COMPONENT/COMPONENT_SET nodes so the compiler needs no special handling.
  // Persisted via §12 pluginData under `lowcode/libraries`.
  lowcodeLibraries?: LibraryRef[]
}

// ── Lowcode (Phase 3 §9 v7) ──
// Document-level translation catalog: locale code → (source message string →
// translated string). Keyed by the *source* string (what the builder sees on
// the canvas / the ICU canonical message), NOT the compiler's content-hash
// messageId — so the data model is decoupled from the hashing implementation
// and editor-authorable. Only the root node populates this in practice.
export type LowcodeTranslations = Record<string, Record<string, string>>

// ── Lowcode (Phase 3 §7) — responsive breakpoints ──────────────────
// Tailwind's default viewport breakpoints, used as class prefixes. Ordered
// smallest → largest; the base (un-prefixed) layout is the implicit "mobile"
// state (min-width semantics — an override applies at its breakpoint and up).
export type ResponsiveBreakpoint = 'sm' | 'md' | 'lg' | 'xl'

// The subset of SceneNode layout props that may be overridden per breakpoint.
// `Pick` keeps this in lockstep with SceneNode's own field types — every key
// here is also read by `collectTailwindClasses`, so the compiler can re-derive
// the breakpoint's classes by shallow-merging the override onto the node.
export type ResponsiveOverride = Partial<
  Pick<
    SceneNode,
    | 'layoutMode'
    | 'layoutWrap'
    | 'primaryAxisAlign'
    | 'counterAxisAlign'
    | 'primaryAxisSizing'
    | 'counterAxisSizing'
    | 'itemSpacing'
    | 'counterAxisSpacing'
    | 'paddingTop'
    | 'paddingRight'
    | 'paddingBottom'
    | 'paddingLeft'
    | 'width'
    | 'height'
    | 'layoutGrow'
    | 'visible'
  >
>

export type ResponsiveOverrides = Partial<Record<ResponsiveBreakpoint, ResponsiveOverride>>

// ── Lowcode (Phase 4 §20) — interaction-state styling ──────────────
// The four core CSS interaction pseudo-states, used as Tailwind class prefixes
// (`hover:` / `focus:` / `active:` / `disabled:`). Ordered as authored; the
// base (un-prefixed) style is the resting state. `disabled:` only matches form
// controls (input/button/select/textarea); on other nodes the utility is inert.
export type InteractionState = 'hover' | 'focus' | 'active' | 'disabled'

// The subset of SceneNode appearance props that may be overridden per state.
// Appearance-only (no layout) — an interaction state gives visual feedback
// (background / border / shadow / opacity / radius), not a reflow. Every key
// here is also read by `collectTailwindClasses`, so the compiler re-derives the
// state's classes by shallow-merging the override onto the node — the same
// style-level diff as `ResponsiveOverride`.
export type StateOverride = Partial<
  Pick<SceneNode, 'fills' | 'strokes' | 'cornerRadius' | 'opacity' | 'effects'>
>

export type StateOverrides = Partial<Record<InteractionState, StateOverride>>

export type ComponentPropertyType = 'VARIANT' | 'TEXT' | 'BOOLEAN' | 'INSTANCE_SWAP'

export type ComponentPropertyReferenceField = 'VISIBLE' | 'TEXT' | 'INSTANCE_SWAP'

export interface ComponentPropertyReference {
  propertyId: string
  field: ComponentPropertyReferenceField
}

export interface ComponentPropertyDefinition {
  id: string
  name: string
  type: ComponentPropertyType
  defaultValue: string
  variantOptions?: string[]
  preferredValues?: string[]
}

export type VariableType = 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN'
export type VariableValue = Color | number | string | boolean | { aliasId: string }
export type VariableModeMap = Record<string, string>

export interface Variable {
  id: string
  name: string
  type: VariableType
  collectionId: string
  valuesByMode: Record<string, VariableValue>
  description: string
  hiddenFromPublishing: boolean
  /** Published library key (from NodeChange.key). Used for assetRef resolution in colorVar. */
  key?: string
  /** Published library version (from NodeChange.version). Used for assetRef resolution in colorVar. */
  version?: string
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
  // Phase 4 §27.2: page-scoped read-only derived state. Compiler validates the
  // expression against page state, document state, and route/query built-ins.
  // Document state rejects this field at the lowcode tool boundary for now.
  computedExpr?: string
  // Phase 4 §27.1: document-state persistence metadata. The fields live on the
  // shared StateDef shape for storage/tooling simplicity, but only root
  // lowcodeDocumentState entries consume them; page-scoped state rejects them
  // at the lowcode tool boundary and the compiler ignores them there.
  persist?: boolean
  storageKey?: string
  storageVersion?: string
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
  /** Target path, e.g. `/about`, or a dynamic route pattern `/product/:id`
   *  (Phase 4 §16.1). A literal string — the path itself is not an expression. */
  to?: string
  /** Phase 4 §16.2: values for a dynamic target's route params, keyed by param
   *  name (the `:id` segment → `id`). Each value is an expression string in the
   *  same sub-language as `setState.valueExpr` (resolves against page state /
   *  docState / `$params` / in-scope). Emitted as
   *  `navigate(generatePath(to, { id: <expr> }))`; absent / empty → `navigate(to)`. */
  params?: Record<string, string>
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
  /** Phase 3 §10 v9 — DocumentStateDef the caught error is written into (parity
   *  with the Supabase actions); undefined → error not captured. */
  errorTarget?: string
  /** Phase 3 §10 v9 — result-branch sub-workflows: `onSuccess` runs after the
   *  response is stored, `onError` on a network / non-2xx / parse failure. They
   *  nest recursively (like {@link ConditionalAction} consequent/alternate) and
   *  the compiler emits them where `data` / the error are fresh locals — closing
   *  the "call API → branch on result → toast" loop without docState snapshot
   *  staleness. */
  onSuccess?: ActionDef[]
  onError?: ActionDef[]
}

/** Phase 3 §2: a where-clause filter on a Supabase query or mutation.
 *  `valueExpr` uses the same restricted expression sub-language as
 *  `SetStateAction.valueExpr` so a filter value can reference page state,
 *  docState, or a literal. Resolved at compile time. */
export interface SupabaseFilter {
  column: string
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in'
  valueExpr: string
}

/** Phase 3 §2: typed read against a Supabase table. The compiler emits
 *  `supabase.from(table).select(columns).<filter chain>.<single?>` and
 *  writes the result into `resultTarget` (a DocumentStateDef name).
 *  Error path writes to `errorTarget` when set; otherwise dropped silently.
 *  Static table / column names only — schema-aware autocomplete is §2.v2. */
export interface SupabaseQueryAction {
  id: string
  kind: 'supabaseQuery'
  table: string
  /** Comma-separated column list; defaults to `'*'` when undefined. */
  columns?: string
  filters?: SupabaseFilter[]
  /** When true, emits `.single()` and writes a single row; otherwise array. */
  single?: boolean
  /** Name of the DocumentStateDef the result rows / row are written into. */
  resultTarget: string
  /** Name of the DocumentStateDef the error is written into, if any. */
  errorTarget?: string
  /** Phase 3 §10 v9 — result-branch sub-workflows; see {@link ApiCallAction}.
   *  `onSuccess` runs in the no-error branch, `onError` on a returned error. */
  onSuccess?: ActionDef[]
  onError?: ActionDef[]
}

/** Phase 3 §3.v2: a single payload field built from a value expression
 *  rather than a JSON literal. `valueExpr` uses the same restricted
 *  expression sub-language as `SupabaseFilter.valueExpr` /
 *  `SetStateAction.valueExpr` (page state, doc state, `$prev`, literals),
 *  so a mutation can write the value of an INPUT or any other reactive
 *  source into a row. `key` must be a JS identifier (column name). */
export interface SupabasePayloadEntry {
  key: string
  valueExpr: string
}

/** Phase 3 §2: typed write against a Supabase table. Payload comes from
 *  one of two channels:
 *   - `payloadEntries` — Phase 3 §3.v2 expression-based, one entry per
 *     column, supports docState / page-state references. Preferred when
 *     present.
 *   - `payloadJson` — Phase 3 §2 JSON literal string parsed + validated
 *     like `ApiCallAction.bodyJson`. Static values only.
 *  When both are set, IR collect emits a `payload-source-conflict`
 *  warning and prefers `payloadEntries` (decision §3.v2.2 #e).
 *  `filters` is required for update/delete (where clause). Result and
 *  error targets are optional — mutations are usually fire-and-forget at
 *  the UI level. */
export interface SupabaseMutationAction {
  id: string
  kind: 'supabaseMutation'
  operation: 'insert' | 'update' | 'delete' | 'upsert'
  table: string
  payloadJson?: string
  payloadEntries?: SupabasePayloadEntry[]
  filters?: SupabaseFilter[]
  resultTarget?: string
  errorTarget?: string
  /** Phase 3 §10 v9 — result-branch sub-workflows; see {@link ApiCallAction}.
   *  `onSuccess` runs in the no-error branch, `onError` on a returned error. */
  onSuccess?: ActionDef[]
  onError?: ActionDef[]
}

/** Phase 3 §2.v2: sign a user in / out against the Supabase project's auth.
 *  Phase 3 §2.v3 adds `signUp` (registration). Phase 3 §2.v4 adds
 *  `resetPassword` (send a reset email) + `updatePassword` (set a new password).
 *  The compiler emits the matching `getSupabaseClient().auth.*` call inline:
 *  signInWithPassword / signUp / signOut / resetPasswordForEmail(email,
 *  { redirectTo: window.location.origin }) / updateUser({ password }).
 *  Per-operation credential gating (decision §2.v4.2 b): signIn + signUp use
 *  both `emailExpr` + `passwordExpr`; `resetPassword` uses `emailExpr` only;
 *  `updatePassword` uses `passwordExpr` only (the new password); `signOut`
 *  uses neither. The exprs use the same restricted expression sub-language as
 *  `SupabaseFilter.valueExpr`, so credentials can come from controlled INPUT
 *  docState. There is no `resultTarget`: the emitted runtime keeps
 *  `$currentUser` in sync via `onAuthStateChange` (decision §2.v2.2 e). With
 *  email confirmation enabled (Supabase default), `signUp` returns no session
 *  until the user confirms, so `$currentUser.signedIn` stays false until then
 *  (decision §2.v3.2 e). `errorTarget` optionally captures the auth error. */
export interface SupabaseAuthAction {
  id: string
  kind: 'supabaseAuth'
  operation: 'signIn' | 'signOut' | 'signUp' | 'resetPassword' | 'updatePassword'
  emailExpr?: string
  passwordExpr?: string
  errorTarget?: string
}

/** Phase 3 §10: branch a workflow on a runtime condition. `condExpr` uses the
 *  same restricted expression sub-language as `SetStateAction.valueExpr` (full
 *  boolean / comparison / ternary / member access), evaluated for truthiness;
 *  `then` runs when truthy, `else` (optional) when falsy. Branches are nested
 *  ActionDef chains — the compiler emits
 *  `if (<cond>) { <consequent> } else { <alternate> }` and lowers each branch
 *  through the same pipeline as the top-level chain, so conditions nest
 *  arbitrarily. `consequent` / `alternate` mirror the ternary `ExprAst` vocab.
 *  `$prev` is rejected (not a setState context). */
export interface ConditionalAction {
  id: string
  kind: 'condition'
  condExpr?: string
  consequent: ActionDef[]
  alternate?: ActionDef[]
}

/** Phase 3 §10: pause the workflow for `ms` milliseconds. The compiler emits
 *  `await new Promise((resolve) => setTimeout(resolve, ms))`, which forces the
 *  enclosing handler to be `async`. `ms` must be a finite non-negative number;
 *  collect drops the handler with a warning otherwise. */
export interface DelayAction {
  id: string
  kind: 'delay'
  ms?: number
}

/** Phase 3 §10: stop the workflow early. The compiler emits `return`, so any
 *  later steps in the same chain (or enclosing branch) do not run. Carries no
 *  payload. */
export interface StopAction {
  id: string
  kind: 'stop'
}

/** Phase 3 §10 v2: show a transient toast notification. `messageExpr` uses the
 *  same restricted expression sub-language as `SetStateAction.valueExpr`, so the
 *  message can interpolate state / docState / `$currentUser` (a static message is
 *  a quoted-string expression). `variant` selects the toast's severity styling
 *  (default `info`). The compiler emits `__opToast(<message>, <variant?>)` against
 *  an auto-mounted `<ToastHost/>` runtime; an empty / unparseable `messageExpr`
 *  drops the action with a warning at collect time. */
export interface ToastAction {
  id: string
  kind: 'toast'
  messageExpr?: string
  variant?: 'info' | 'success' | 'error'
  // Phase 3 §10 v5: screen corner the toast renders in (default 'bottom-right',
  // = the v2 fixed position). Per-toast, so different actions can target
  // different corners.
  position?: ToastPosition
  // Phase 3 §10 v5: auto-dismiss delay in milliseconds (default 3000). A finite
  // non-negative number; collect falls back to the default on an invalid value.
  durationMs?: number
}

/** Phase 3 §10 v5: the six screen corners a toast can render in. */
export type ToastPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

/** Phase 3 §10 v3: ask the user to confirm before running the consequent chain.
 *  `messageExpr` uses the same restricted expression sub-language as
 *  `SetStateAction.valueExpr` (the prompt can interpolate state / docState /
 *  `$currentUser`). The compiler emits
 *  `if (await __opConfirm(<message>)) { <consequent> } else { <alternate> }`
 *  against an auto-mounted `<ConfirmHost/>` runtime — so confirm is a
 *  `condition` whose predicate is a runtime user choice. `consequent` /
 *  `alternate` are nested action chains lowered through the same pipeline, so
 *  confirms nest. An empty / unparseable `messageExpr` drops the action with a
 *  warning at collect time. */
export interface ConfirmAction {
  id: string
  kind: 'confirm'
  messageExpr?: string
  consequent: ActionDef[]
  alternate?: ActionDef[]
  // Phase 3 §10 v5: custom button labels (static strings, default 'OK' /
  // 'Cancel'). Static — not the expression sub-language — since button labels
  // are rarely dynamic; the prompt message stays an expression.
  confirmLabel?: string
  cancelLabel?: string
}

/** Phase 3 §10 v3: copy a value to the clipboard. `valueExpr` uses the same
 *  restricted expression sub-language as `SetStateAction.valueExpr`, so the
 *  copied text can interpolate state / docState / `$currentUser`. The compiler
 *  emits `navigator.clipboard.writeText(<value>)` (fire-and-forget, not
 *  awaited); an empty / unparseable `valueExpr` drops the action with a warning
 *  at collect time. No runtime surface — pair with a `toast` for feedback. */
export interface ClipboardAction {
  id: string
  kind: 'clipboard'
  valueExpr?: string
}

/** Phase 5 §10: send an analytics event through the generated
 * `_lowcode_analytics` runtime. `eventNameExpr` uses the same restricted
 * expression sub-language as toast/clipboard values; optional property
 * values are also expressions in the current event scope. The document-level
 * `lowcodeAnalyticsConfig` chooses the provider and public id. */
export interface TrackEventAction {
  id: string
  kind: 'trackEvent'
  eventNameExpr?: string
  properties?: Record<string, string>
}

/** Phase 5 §12: start a Stripe Checkout flow through the app author's own
 * server endpoint. The generated SPA never receives a Stripe secret key; it
 * POSTs optional expression-valued payload fields to `endpoint` and redirects
 * to the returned `{ url }` / `{ checkoutUrl }`. When `includeAuthToken` is
 * true, generated apps attach the current Supabase session bearer token if one
 * exists so server templates can map the authenticated user to a Stripe
 * customer. */
export interface StripeCheckoutAction {
  id: string
  kind: 'stripeCheckout'
  endpoint?: string
  payloadEntries?: SupabasePayloadEntry[]
  includeAuthToken?: boolean
  errorTarget?: string
}

/** Phase 5 §12: open a Stripe Customer Portal session through the app author's
 * own server endpoint. Mirrors `StripeCheckoutAction` but expects a returned
 * `{ url }` / `{ portalUrl }` that sends the current customer to billing
 * management. `includeAuthToken` mirrors checkout and is usually enabled for
 * portal endpoints, because customer lookup must stay server-side. Secret keys
 * and customer lookup stay server-side. */
export interface StripeCustomerPortalAction {
  id: string
  kind: 'stripeCustomerPortal'
  endpoint?: string
  payloadEntries?: SupabasePayloadEntry[]
  includeAuthToken?: boolean
  errorTarget?: string
}

/** Phase 3 §10 v4: invoke a named, reusable workflow (`WorkflowDef`) by id. The
 *  referenced workflow's action chain is expanded **inline** at the call site by
 *  the IR collect pass (`resolveBranch` with the caller's context), so a workflow
 *  that does `setState` / `navigate` resolves against the calling component's
 *  page-local hooks naturally — there is no emitted function, no runtime surface.
 *  Workflows may call other workflows; a cycle (A → B → A) is detected at collect
 *  and dropped with a warning. An unknown / empty `workflowId` is likewise dropped
 *  with a warning. NOTE: a `stop` inside a called workflow terminates the entire
 *  enclosing handler (an inline-expansion consequence, documented as intended). */
export interface CallWorkflowAction {
  id: string
  kind: 'callWorkflow'
  workflowId?: string
  /** Phase 3 §10 v6: argument expressions, keyed by the referenced workflow's
   *  formal parameter name (`WorkflowDef.params`). Each value is an expression
   *  string in the **caller's** scope (parsed + validated at collect time);
   *  the IR collect pass substitutes the parsed argument AST for every
   *  occurrence of the parameter identifier in the inlined workflow body. A
   *  parameter with no matching arg (or an unparseable / invalid arg) drops the
   *  whole `callWorkflow` with a warning. */
  args?: Record<string, string>
}

/** Phase 1 §7.4: discriminated union so the compiler can exhaustively
 *  dispatch on `kind` and the editor UI can render per-kind inputs.
 *  Phase 2 §3 adds `ApiCallAction`; Phase 3 §2 adds Supabase {Query,Mutation};
 *  Phase 3 §2.v2 adds `SupabaseAuthAction` (overturns §2 decision #5's
 *  6-kind lock). Phase 3 §10 adds workflow-orchestration kinds
 *  `ConditionalAction` / `DelayAction` / `StopAction`; §10 v2 adds
 *  `ToastAction`; §10 v3 adds `ConfirmAction` / `ClipboardAction`; §10 v4 adds
 *  `CallWorkflowAction`. */
export type ActionDef =
  | SetStateAction
  | NavigateAction
  | SetVariableAction
  | ApiCallAction
  | SupabaseQueryAction
  | SupabaseMutationAction
  | SupabaseAuthAction
  | ConditionalAction
  | DelayAction
  | StopAction
  | ToastAction
  | ConfirmAction
  | ClipboardAction
  | TrackEventAction
  | StripeCheckoutAction
  | StripeCustomerPortalAction
  | CallWorkflowAction

export type ActionKind = ActionDef['kind']

/** Phase 3 §10 v4: a named, reusable workflow — a labelled `ActionDef` chain
 *  that any node's event handler (or another workflow) can invoke by id via a
 *  `CallWorkflowAction`. Stored document-level on the root node
 *  (`SceneNode.lowcodeWorkflows`), like `lowcodeDocumentState`. `name` is a
 *  human label for the editor / debugging; the compiler inlines the chain at
 *  each call site, so `name` never reaches the emitted code. */
export interface WorkflowDef {
  id: string
  name: string
  /** Phase 4 §10 follow-up: optional authoring scope for page-local state.
   *  When set, editor/tooling can validate the workflow body against that page's
   *  `state[]` instead of the currently selected page approximation. Runtime
   *  expansion still inlines at the call site; cross-page local state writes
   *  should be modeled as document state. */
  pageId?: string
  /** Phase 3 §10 v6: formal parameter names. Each is a plain identifier the
   *  workflow's action expressions may reference; at a `CallWorkflowAction`
   *  call site the matching `args` expression (caller scope) is substituted in.
   *  Absent / empty = a parameterless workflow (§10 v4 behaviour). */
  params?: string[]
  /** Phase 3 §10 v7: default argument expressions, keyed by formal parameter
   *  name (a subset of `params`). When a `CallWorkflowAction` omits the `arg`
   *  for a parameter that has a default, the default expression is used instead
   *  of dropping the call — parsed + validated in the **caller's** scope, the
   *  same path an explicit `arg` takes (workflows expand inline, so the body's
   *  state references already resolve against the caller). A parameter with
   *  neither an arg nor a default still drops the `callWorkflow` with a warning
   *  (§10 v6 behaviour). Absent = every parameter is required. */
  paramDefaults?: Record<string, string>
  /** Phase 3 §10 v8: parameter names (a subset of `params`) that may be omitted
   *  at a `CallWorkflowAction` even without a `paramDefaults` entry. When such a
   *  parameter has neither an explicit `arg` nor a default, it resolves to the
   *  literal `undefined` in the inlined body (rather than dropping the whole
   *  `callWorkflow` as §10 v6 does for a required parameter). A parameter with a
   *  `paramDefaults` entry never reaches this case (the default wins). Absent =
   *  every parameter without a default is required. */
  optionalParams?: string[]
  actions: ActionDef[]
}

/** Phase 3 §2: connection settings for a Supabase project. Persisted on the
 *  root node via `lowcode/supabaseConfig` pluginData. `anonKey` is the
 *  public anon JWT — safe to commit because Supabase enforces auth via
 *  Row Level Security in the database. NEVER store a service_role key here;
 *  the editor UI rejects them on entry. `schema` defaults to `'public'`. */
export interface SupabaseConfig {
  url: string
  anonKey: string
  schema?: string
}
