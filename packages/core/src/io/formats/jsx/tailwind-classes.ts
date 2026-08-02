import { twirl } from 'twirlwind'

import {
  isAutoLayoutMode,
  normalizeFontFamily,
  type Fill,
  type GridTrack,
  type InteractionState,
  type ResponsiveBreakpoint,
  type SceneGraph,
  type SceneNode,
  type StateOverride,
  type Stroke
} from '@open-pencil/scene-graph'

import { colorToCSSCompact, colorToFill } from '#core/color'
import { DEFAULT_FONT_FAMILY } from '#core/constants'
import { resolveNodeTextDirection } from '#core/text/direction'
import { buttonLabelTextNode } from '#core/text/lowcode'

import { formatColor, formatTrack, getNodeContext, solidFillColor, solidStroke } from './helpers'

function px(v: number): string {
  return `${v}px`
}

function gridTemplateTw(tracks: GridTrack[]): string {
  const allEqual1Fr = tracks.every((t) => t.sizing === 'FR' && t.value === 1)
  if (allEqual1Fr) return String(tracks.length)
  return `[${tracks.map(formatTrack).join('_')}]`
}

export interface TailwindClassOptions {
  logicalProperties?: boolean
}

function collectGridClasses(node: SceneNode): string[] {
  const classes = ['grid']
  if (node.gridTemplateColumns.length > 0)
    classes.push(`grid-cols-${gridTemplateTw(node.gridTemplateColumns)}`)
  if (node.gridTemplateRows.length > 0)
    classes.push(`grid-rows-${gridTemplateTw(node.gridTemplateRows)}`)
  return classes
}

function collectGridPositionClasses(node: SceneNode): string[] {
  if (!node.gridPosition) return []
  const classes: string[] = []
  const pos = node.gridPosition
  if (pos.column > 0) classes.push(`col-start-${pos.column}`)
  if (pos.row > 0) classes.push(`row-start-${pos.row}`)
  if (pos.columnSpan > 1) classes.push(`col-span-${pos.columnSpan}`)
  if (pos.rowSpan > 1) classes.push(`row-span-${pos.rowSpan}`)
  return classes
}

const MIX_BLEND_CLASS: Record<string, string> = {
  DARKEN: 'mix-blend-darken',
  MULTIPLY: 'mix-blend-multiply',
  COLOR_BURN: 'mix-blend-color-burn',
  LIGHTEN: 'mix-blend-lighten',
  SCREEN: 'mix-blend-screen',
  COLOR_DODGE: 'mix-blend-color-dodge',
  OVERLAY: 'mix-blend-overlay',
  SOFT_LIGHT: 'mix-blend-soft-light',
  HARD_LIGHT: 'mix-blend-hard-light',
  DIFFERENCE: 'mix-blend-difference',
  EXCLUSION: 'mix-blend-exclusion',
  HUE: 'mix-blend-hue',
  SATURATION: 'mix-blend-saturation',
  COLOR: 'mix-blend-color',
  LUMINOSITY: 'mix-blend-luminosity'
}

function collectBlendModeClasses(node: SceneNode): string[] {
  const cls = MIX_BLEND_CLASS[node.blendMode]
  return cls ? [cls] : []
}

const JUSTIFY_MAP: Record<string, string> = {
  CENTER: 'center',
  MAX: 'flex-end',
  SPACE_BETWEEN: 'space-between'
}

const ALIGN_MAP: Record<string, string> = {
  CENTER: 'center',
  MAX: 'flex-end',
  STRETCH: 'stretch'
}

function applyFlexStyle(style: Record<string, string>, node: SceneNode): void {
  style.display = 'flex'
  if (node.layoutMode === 'VERTICAL') style.flexDirection = 'column'
  if (node.layoutWrap === 'WRAP') style.flexWrap = 'wrap'
  if (node.itemSpacing > 0) style.gap = px(node.itemSpacing)
  if (node.layoutWrap === 'WRAP' && node.counterAxisSpacing > 0)
    style.rowGap = px(node.counterAxisSpacing)
  if (JUSTIFY_MAP[node.primaryAxisAlign]) style.justifyContent = JUSTIFY_MAP[node.primaryAxisAlign]
  if (ALIGN_MAP[node.counterAxisAlign]) style.alignItems = ALIGN_MAP[node.counterAxisAlign]
}

function applyFlexSizing(style: Record<string, string>, node: SceneNode): void {
  const primaryAxis = node.layoutMode === 'HORIZONTAL' ? 'width' : 'height'
  const crossAxis = node.layoutMode === 'HORIZONTAL' ? 'height' : 'width'
  if (node.primaryAxisSizing === 'FILL') style[primaryAxis] = '100%'
  else if (node.primaryAxisSizing !== 'HUG') style[primaryAxis] = px(node[primaryAxis])
  if (node.counterAxisSizing === 'FILL') style[crossAxis] = '100%'
  else if (node.counterAxisSizing !== 'HUG') style[crossAxis] = px(node[crossAxis])
}

function applyPadding(
  style: Record<string, string>,
  node: SceneNode,
  options: TailwindClassOptions = {}
): void {
  const { paddingTop: pt, paddingRight: pr, paddingBottom: pb, paddingLeft: pl } = node
  if (pt === 0 && pr === 0 && pb === 0 && pl === 0) return
  if (options.logicalProperties === true) {
    if (pt === pr && pr === pb && pb === pl) {
      style.padding = px(pt)
    } else if (pt === pb && pl === pr) {
      style.paddingBlock = px(pt)
      style.paddingInline = px(pl)
    } else {
      style.paddingBlockStart = px(pt)
      style.paddingInlineEnd = px(pr)
      style.paddingBlockEnd = px(pb)
      style.paddingInlineStart = px(pl)
    }
    return
  }
  if (pt === pr && pr === pb && pb === pl) style.padding = px(pt)
  else if (pt === pb && pl === pr) style.padding = `${px(pt)} ${px(pl)}`
  else style.padding = `${px(pt)} ${px(pr)} ${px(pb)} ${px(pl)}`
}

function needsLocalPositioningContext(node: SceneNode, graph: SceneGraph): boolean {
  if (node.childIds.length === 0) return false
  if (!isAutoLayoutMode(node.layoutMode)) return true
  return node.childIds.some((childId) => graph.getNode(childId)?.layoutPositioning === 'ABSOLUTE')
}

function applyLayoutStyle(
  style: Record<string, string>,
  node: SceneNode,
  graph: SceneGraph,
  options: TailwindClassOptions = {}
): void {
  const ctx = getNodeContext(node, graph)

  if (ctx.isGrid) {
    style.display = 'grid'
    if (node.gridColumnGap > 0) style.columnGap = px(node.gridColumnGap)
    if (node.gridRowGap > 0) style.rowGap = px(node.gridRowGap)
    if (node.width > 0) style.width = px(node.width)
    if (node.gridTemplateRows.length > 0 && node.height > 0) style.height = px(node.height)
  } else if (ctx.isFlex) {
    applyFlexStyle(style, node)
    applyFlexSizing(style, node)
  } else {
    if (node.width > 0) style.width = px(node.width)
    if (node.height > 0) style.height = px(node.height)
  }

  if (ctx.parentIsAutoLayout && node.layoutGrow > 0) style.flexGrow = '1'
  if (ctx.isAutoLayout) applyPadding(style, node, options)

  // Absolute descendants must resolve x/y inside their own design container,
  // not against the generated page root. `absolute` below overrides this for
  // a container that is itself freely positioned while still establishing the
  // same containing block for its children.
  if (needsLocalPositioningContext(node, graph)) style.position = 'relative'

  // Free positioning fires for two cases that share the same CSS shape: a
  // non-auto-layout parent positions all children from stored x/y coordinates,
  // or one child opts out of auto-layout through layoutPositioning=ABSOLUTE.
  if (ctx.parentIsFreeLayout || node.layoutPositioning === 'ABSOLUTE') {
    style.position = 'absolute'
    style.left = px(node.x)
    style.top = px(node.y)
    // §6 decision #g: sizing fallback for both code paths — HUG-sized
    // children would otherwise collapse once `position: absolute` removes
    // them from the parent's flow.
    if (!style.width) style.width = px(node.width)
    if (!style.height) style.height = px(node.height)
  }
}

function applyAppearanceStyle(style: Record<string, string>, node: SceneNode): void {
  const bg = solidFillColor(node.fills)
  if (bg && node.type !== 'TEXT') style.backgroundColor = bg

  const stroke = solidStroke(node.strokes)
  if (stroke) {
    style.borderWidth = px(stroke.weight)
    style.borderColor = stroke.color
    style.borderStyle = 'solid'
  }

  if (node.cornerRadius > 0) {
    if (node.independentCorners) {
      style.borderRadius = `${px(node.topLeftRadius)} ${px(node.topRightRadius)} ${px(node.bottomRightRadius)} ${px(node.bottomLeftRadius)}`
    } else {
      style.borderRadius = node.cornerRadius >= 9999 ? '9999px' : px(node.cornerRadius)
    }
  }

  if (node.opacity < 1) style.opacity = String(node.opacity)
  if (node.rotation !== 0) style.transform = `rotate(${node.rotation}deg)`
  if (node.clipsContent) style.overflow = 'hidden'

  for (const effect of node.effects) {
    if (!effect.visible) continue
    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      const inset = effect.type === 'INNER_SHADOW' ? 'inset ' : ''
      const spread = effect.spread !== 0 ? ` ${px(effect.spread)}` : ''
      const color = colorToCSSCompact(effect.color)
      style.boxShadow = `${inset}${px(effect.offset.x)} ${px(effect.offset.y)} ${px(effect.radius)}${spread} ${color}`
    } else if (effect.type === 'LAYER_BLUR' || effect.type === 'FOREGROUND_BLUR') {
      style.filter = `blur(${px(effect.radius)})`
    } else {
      style.backdropFilter = `blur(${px(effect.radius)})`
    }
  }
}

/**
 * Round to 3 decimals; trailing zeros stripped. Keeps clip-path values
 * stable and short in the emitted Tailwind class.
 */
function roundPct(n: number): string {
  return Number(n.toFixed(3)).toString()
}

/**
 * Tailwind v4 silently drops `clip-path-[polygon(...)]` (the value the v3
 * `clip-path-*` utility expects); only the arbitrary-property form
 * `[clip-path:polygon(...)]` survives `@source inline(...)`. We bypass
 * twirl for this CSS prop and emit the class directly. Inside the brackets
 * Tailwind reads `_` as a space, so we never emit literal whitespace there.
 */
function polygonClipPathClass(pointCount: number): string {
  const n = pointCount >= 3 ? pointCount : 3
  const points: string[] = []
  for (let i = 0; i < n; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n
    points.push(`${roundPct(50 + 50 * Math.cos(angle))}%_${roundPct(50 + 50 * Math.sin(angle))}%`)
  }
  return `[clip-path:polygon(${points.join(',_')})]`
}

function starClipPathClass(pointCount: number, innerRatio: number): string {
  const n = pointCount >= 3 ? pointCount : 5
  const inner = innerRatio > 0 && innerRatio < 1 ? innerRatio : 0.38
  const points: string[] = []
  for (let i = 0; i < 2 * n; i++) {
    const r = i % 2 === 0 ? 50 : 50 * inner
    const angle = -Math.PI / 2 + (i * Math.PI) / n
    points.push(`${roundPct(50 + r * Math.cos(angle))}%_${roundPct(50 + r * Math.sin(angle))}%`)
  }
  return `[clip-path:polygon(${points.join(',_')})]`
}

/**
 * Vector shapes (ELLIPSE / LINE / POLYGON / STAR) need overrides on top
 * of the generic <div> styling because Figma represents them geometrically,
 * not via CSS box properties. Runs after `applyAppearanceStyle` so it can
 * supersede the border / radius emit when needed.
 *
 *   ELLIPSE  → border-radius: 50%
 *   LINE     → stroke becomes background; height becomes stroke weight
 *   POLYGON  → clip-path: regular polygon with `pointCount` vertices
 *   STAR     → clip-path: star with `pointCount` outer points
 *
 * Stroke→border emit is suppressed for clip-pathed shapes because a CSS
 * border on the bounding box would be clipped to the polygon shape and
 * read as a thick fill, not an outline. A true outline would require SVG.
 */
function applyShapeStyle(style: Record<string, string>, node: SceneNode): void {
  if (node.type === 'ELLIPSE') {
    // ELLIPSE is intrinsically round in Figma; cornerRadius doesn't apply.
    // '50%' (not '9999px') so width≠height nodes become true ellipses, not
    // pill shapes.
    style.borderRadius = '50%'
    return
  }

  if (node.type === 'LINE') {
    // OpenPencil stores LINE as the diagonal vector from (0, 0) to
    // (width, height) in local coords (canvas renders it via
    // `canvas.drawLine(0, 0, node.width, node.height, r.fillPaint)`).
    // The diagonal angle is encoded into the bounding box geometry — not
    // into `node.rotation` — so we have to convert (w, h) into
    //   length = sqrt(w² + h²)
    //   angle  = atan2(h, w)
    // and render a thin horizontal bar of that length, rotated around the
    // first endpoint.
    //
    // Colour: canvas uses `fillPaint` (default 1px hairline) — fill drives
    // the visible line. If a real stroke is present, it takes precedence
    // (Figma-imported files store the colour there). `applyAppearanceStyle`
    // has already pushed the fill colour onto backgroundColor, so we only
    // override when a stroke is present.
    delete style.borderWidth
    delete style.borderColor
    delete style.borderStyle

    const stroke = solidStroke(node.strokes)
    if (stroke) style.backgroundColor = stroke.color
    if (!style.backgroundColor) return

    const weight = stroke?.weight ?? 1
    const length = Math.hypot(node.width, node.height)
    const angleDeg = (Math.atan2(node.height, node.width) * 180) / Math.PI
    const totalRotation = node.rotation + angleDeg

    style.width = px(length)
    style.height = px(weight)
    // Centreline alignment: lift `top` by half the line weight so the
    // visible centreline coincides with node.y. Only fires when canvas-
    // direct positioning is in effect.
    if (style.top) style.top = px(node.y - weight / 2)
    // Pivot at the first endpoint on the centreline; combine the diagonal-
    // encoded angle with any user-applied rotation. Override the rotation
    // value that `applyAppearanceStyle` may have already written for plain
    // `node.rotation`.
    if (totalRotation !== 0) {
      style.transform = `rotate(${totalRotation}deg)`
    } else {
      delete style.transform
    }
    style.transformOrigin = '0 50%'
    return
  }

  if (node.type === 'POLYGON' || node.type === 'STAR') {
    // The clip-path class itself is appended later in
    // `collectTailwindClasses` (see `collectShapeExtraClasses`) so it
    // bypasses twirl. Here we only suppress the box-model border, which
    // would otherwise be clipped to the polygon and read as a thick fill.
    delete style.borderWidth
    delete style.borderColor
    delete style.borderStyle
  }
}

function collectShapeExtraClasses(node: SceneNode): string[] {
  if (node.type === 'POLYGON') return [polygonClipPathClass(node.pointCount)]
  if (node.type === 'STAR') return [starClipPathClass(node.pointCount, node.starInnerRadius)]
  return []
}

/**
 * Phase 4 §24.2: a gradient fill → a `bg-[linear-gradient(...)]` /
 * `bg-[radial-gradient(...)]` / `bg-[conic-gradient(...)]` arbitrary-value
 * class. twirl can't express a gradient background-image, so (like the
 * clip-path bypass) we build the CSS value and emit the class directly,
 * replacing spaces with `_` (Tailwind reads `_` as a space inside `[...]`).
 * Skipped on TEXT because a gradient there is text color, not background.
 */
function collectGradientClasses(node: SceneNode): string[] {
  if (node.type === 'TEXT') return []
  const fill = node.fills.find(
    (f) =>
      f.visible &&
      f.opacity > 0 &&
      (f.type === 'GRADIENT_LINEAR' ||
        f.type === 'GRADIENT_RADIAL' ||
        f.type === 'GRADIENT_ANGULAR' ||
        f.type === 'GRADIENT_DIAMOND')
  )
  if (!fill) return []
  const css = gradientFillCss(fill, node.width, node.height)
  return css === null ? [] : [`bg-[${css.replace(/ /g, '_')}]`]
}

/** Build the CSS gradient value for a linear / radial / angular / diamond fill,
 *  or null when its stops / transform are missing. Colors are hex8 (no spaces);
 *  positions are percentages. Linear/conic orientation is derived from
 *  Figma's gradientTransform. DIAMOND uses the same radial approximation as
 *  the Canvas/SVG fallback paths. */
export function gradientFillCss(fill: Fill, width: number, height: number): string | null {
  const stops = fill.gradientStops
  const t = fill.gradientTransform
  if (!stops || stops.length === 0 || !t) return null
  const stopList = stops
    .map((s) => `${formatColor(s.color, s.color.a)} ${roundPct(s.position * 100)}%`)
    .join(', ')
  if (fill.type === 'GRADIENT_RADIAL') return `radial-gradient(circle, ${stopList})`
  if (fill.type === 'GRADIENT_DIAMOND') {
    const center = gradientCenter(t)
    return `radial-gradient(circle at ${center.x}% ${center.y}%, ${stopList})`
  }
  if (fill.type === 'GRADIENT_ANGULAR') {
    const angle = cssGradientAngle(t.m00, t.m10)
    const center = gradientCenter(t)
    return `conic-gradient(from ${angle}deg at ${center.x}% ${center.y}%, ${stopList})`
  }
  // GRADIENT_LINEAR — endpoints in pixel space (mirrors canvas/fills.ts), then
  // the CSS angle (0deg = up, clockwise) from the start→end direction (y-down).
  const startX = (t.m00 + t.m02) * width
  const startY = (t.m10 + t.m12) * height
  const endX = t.m02 * width
  const endY = t.m12 * height
  const angle = cssGradientAngle(endX - startX, endY - startY)
  return `linear-gradient(${angle}deg, ${stopList})`
}

function gradientCenter(t: NonNullable<Fill['gradientTransform']>): { x: string; y: string } {
  return {
    x: roundPct((t.m00 * 0.5 + t.m01 * 0.5 + t.m02) * 100),
    y: roundPct((t.m10 * 0.5 + t.m11 * 0.5 + t.m12) * 100)
  }
}

/** CSS linear-gradient angle (degrees) for a direction vector in screen (y-down)
 *  coordinates: 0deg points up, increasing clockwise. */
function cssGradientAngle(dx: number, dy: number): number {
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI
  return Math.round(((deg % 360) + 360) % 360)
}

function applyTextStyle(style: Record<string, string>, node: SceneNode): void {
  const textNode = buttonLabelTextNode(node) ?? node
  if (textNode.type !== 'TEXT') return
  style.fontSize = px(textNode.fontSize)
  const fontFamily = normalizeFontFamily(textNode.fontFamily)
  if (fontFamily && fontFamily !== DEFAULT_FONT_FAMILY) style.fontFamily = fontFamily
  if (textNode.fontWeight !== 400) style.fontWeight = String(textNode.fontWeight)
  if (textNode.italic) style.fontStyle = 'italic'
  if (textNode.lineHeight != null) style.lineHeight = px(textNode.lineHeight)
  if (textNode.letterSpacing !== 0) style.letterSpacing = px(textNode.letterSpacing)
  if (textNode.textAlignHorizontal !== 'LEFT')
    style.textAlign = textNode.textAlignHorizontal.toLowerCase()
  // BUTTON fills describe the control background; canvas renders its label
  // with the inherited/default foreground rather than reusing that fill.
  const textColor = node.type === 'TEXT' ? solidFillColor(textNode.fills) : null
  if (textColor) style.color = textColor
}

function nodeToStyle(
  node: SceneNode,
  graph: SceneGraph,
  options: TailwindClassOptions = {}
): Record<string, string> {
  const style: Record<string, string> = {}
  applyLayoutStyle(style, node, graph, options)
  applyAppearanceStyle(style, node)
  applyShapeStyle(style, node)
  applyTextStyle(style, node)
  return style
}

// Tailwind's default viewport breakpoints, smallest → largest (min-width).
const RESPONSIVE_BREAKPOINTS: readonly ResponsiveBreakpoint[] = ['sm', 'md', 'lg', 'xl']

// CSS values the canvas style object OMITS at their default — when a breakpoint
// override clears one of these layout properties (e.g. VERTICAL→HORIZONTAL drops
// `flexDirection`), we re-assert the default so `twirl` emits the explicit reset
// utility. Without this, `flex-col` would linger at every breakpoint because the
// removal of a class can't be expressed by adding one (`md:flex-row` is needed).
const LAYOUT_STYLE_RESET: Record<string, string> = {
  flexDirection: 'row',
  flexWrap: 'nowrap',
  gap: '0px',
  rowGap: '0px',
  justifyContent: 'flex-start',
  alignItems: 'stretch',
  paddingTop: '0px',
  paddingRight: '0px',
  paddingBottom: '0px',
  paddingLeft: '0px',
  paddingBlock: '0px',
  paddingInline: '0px',
  paddingBlockStart: '0px',
  paddingInlineEnd: '0px',
  paddingBlockEnd: '0px',
  paddingInlineStart: '0px',
  width: 'auto',
  height: 'auto',
  flexGrow: '0',
  display: 'block'
}

/**
 * Phase 3 §7 — responsive (breakpoint-prefixed) Tailwind classes for a node's
 * `responsiveOverrides`. For each breakpoint we shallow-merge the override onto
 * the node, re-derive the FULL CSS style via the same {@link nodeToStyle} (one
 * source of truth), diff it against the base style at the CSS-property level,
 * and `twirl` only the changed properties — each class prefixed `md:` / `lg:`.
 *
 * Diffing at the style level (not the class level) is what makes column→row and
 * other "back to default" changes work: a property the breakpoint resets to its
 * CSS initial re-asserts that value (see LAYOUT_STYLE_RESET) so twirl emits the
 * explicit reset utility instead of silently dropping the class.
 *
 * Visibility is handled explicitly (nodeToStyle ignores `visible`): a
 * base-visible node hidden at a breakpoint emits `${bp}:hidden`; a base-hidden
 * node re-shown at a breakpoint (§7 v2) emits `${bp}:<display>` to re-assert its
 * display, overriding the base `hidden` (the compiler's `tailwindClassName`
 * appends `hidden` for an invisible node, and the tree walk now keeps a
 * base-hidden node that carries a responsive re-show). Tailwind orders
 * breakpoint variants after base utilities, so `hidden md:flex` shows at ≥md.
 */
export function collectResponsiveTailwindClasses(
  node: SceneNode,
  graph: SceneGraph,
  options: TailwindClassOptions = {}
): string[] {
  const overrides = node.responsiveOverrides
  if (!overrides) return []
  const baseStyle = nodeToStyle(node, graph, options)
  return collectVariantClasses(
    node,
    graph,
    options,
    baseStyle,
    RESPONSIVE_BREAKPOINTS,
    (bp) => overrides[bp],
    LAYOUT_STYLE_RESET,
    (bp, override, bpStyle) => {
      if (override.visible === false && node.visible) return [`${bp}:hidden`]
      if (override.visible === true && !node.visible) {
        // Re-assert the node's (breakpoint-effective) display so it un-hides;
        // fall back to `block` when the node carries no explicit display.
        const show = twirl({ display: bpStyle.display }) || 'block'
        return [`${bp}:${show}`]
      }
      return []
    }
  )
}

// Appearance-only interaction-state variants (Phase 4 §20) — the smallest set
// of CSS pseudo-states that cover hover/focus/active/disabled feedback.
const INTERACTION_STATES: readonly InteractionState[] = ['hover', 'focus', 'active', 'disabled']

// Appearance defaults re-asserted when a state override CLEARS a prop the base
// style sets (mirrors LAYOUT_STYLE_RESET, but for the appearance props a state
// override can touch) — e.g. removing a shadow on hover emits `hover:shadow-none`.
const STATE_STYLE_RESET: Record<string, string> = {
  backgroundColor: 'transparent',
  borderWidth: '0px',
  borderColor: 'transparent',
  borderRadius: '0px',
  opacity: '1',
  boxShadow: 'none'
}

const LEGACY_STATE_HEX_COLOR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i
const LEGACY_STATE_FILL_KEYS = new Set(['type', 'color', 'opacity', 'visible'])
const LEGACY_STATE_STROKE_KEYS = new Set(['type', 'color', 'weight', 'opacity', 'visible', 'align'])
const LEGACY_STATE_STROKE_ALIGNS = new Set<Stroke['align']>(['INSIDE', 'CENTER', 'OUTSIDE'])

interface LegacyStatePaintRecord {
  [key: string]: unknown
  type?: unknown
  color?: unknown
  weight?: unknown
  opacity?: unknown
  visible?: unknown
  align?: unknown
}

function isLegacyStatePaintRecord(value: unknown): value is LegacyStatePaintRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validUnitInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function validLegacySolidPaint(
  candidate: LegacyStatePaintRecord,
  allowedKeys: ReadonlySet<string>
): boolean {
  return (
    (candidate.type === undefined || candidate.type === 'SOLID') &&
    Object.keys(candidate).every((key) => allowedKeys.has(key))
  )
}

function legacyHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return LEGACY_STATE_HEX_COLOR.test(trimmed) ? trimmed : undefined
}

function validNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function validLegacyStrokeAlign(value: unknown): value is Stroke['align'] {
  return typeof value === 'string' && LEGACY_STATE_STROKE_ALIGNS.has(value as Stroke['align'])
}

function normalizeLegacyStateFill(fill: Fill): Fill {
  const raw: unknown = fill
  const candidate = isLegacyStatePaintRecord(raw) ? raw : undefined
  if (!candidate || !validLegacySolidPaint(candidate, LEGACY_STATE_FILL_KEYS)) return fill
  const color = legacyHexColor(candidate.color)
  if (!color) return fill
  const opacity = candidate.opacity ?? 1
  const visible = candidate.visible ?? true
  if (!validUnitInterval(opacity)) return fill
  if (typeof visible !== 'boolean') return fill
  return {
    ...colorToFill(color),
    opacity,
    visible
  }
}

function normalizeLegacyStateStroke(stroke: Stroke): Stroke {
  const raw: unknown = stroke
  const candidate = isLegacyStatePaintRecord(raw) ? raw : undefined
  if (!candidate || !validLegacySolidPaint(candidate, LEGACY_STATE_STROKE_KEYS)) return stroke
  const color = legacyHexColor(candidate.color)
  if (!color) return stroke
  const weight = candidate.weight ?? 1
  const opacity = candidate.opacity ?? 1
  const visible = candidate.visible ?? true
  const align = candidate.align ?? 'INSIDE'
  if (!validNonNegativeNumber(weight)) return stroke
  if (!validUnitInterval(opacity)) return stroke
  if (typeof visible !== 'boolean') return stroke
  if (!validLegacyStrokeAlign(align)) return stroke
  return {
    color: colorToFill(color).color,
    weight,
    opacity,
    visible,
    align
  }
}

function normalizeLegacyStatePaints<T>(values: T[], normalize: (value: T) => T): T[] {
  let normalizedValues: T[] | undefined
  for (const [index, value] of values.entries()) {
    const normalized = normalize(value)
    if (normalized === value) continue
    normalizedValues ??= [...values]
    normalizedValues[index] = normalized
  }
  return normalizedValues ?? values
}

/**
 * Older MCP-authored documents may contain the shorthand
 * `{ fills: [{ type: 'SOLID', color: '#RRGGBB' }] }`. Keep that compatibility
 * local to the state-variant projection so loading/exporting never mutates the
 * SceneGraph.
 */
function normalizeLegacyStateOverride(
  override: StateOverride | undefined
): StateOverride | undefined {
  if (!override) return override
  const fills = override.fills
    ? normalizeLegacyStatePaints(override.fills, normalizeLegacyStateFill)
    : undefined
  const strokes = override.strokes
    ? normalizeLegacyStatePaints(override.strokes, normalizeLegacyStateStroke)
    : undefined
  if (fills === override.fills && strokes === override.strokes) return override
  return { ...override, ...(fills ? { fills } : {}), ...(strokes ? { strokes } : {}) }
}

/**
 * Phase 4 §20 — interaction-state (pseudo-class-prefixed) Tailwind classes for
 * a node's `stateOverrides`. Same style-level diff as the responsive emitter
 * (one source of truth via {@link collectVariantClasses} → {@link nodeToStyle}),
 * but each changed class is prefixed with the CSS state (`hover:` / `focus:` /
 * `active:` / `disabled:`) and only appearance props change. Tailwind orders
 * state variants after base utilities, so `bg-white hover:bg-gray-100` takes
 * effect on hover.
 */
export function collectStateTailwindClasses(
  node: SceneNode,
  graph: SceneGraph,
  options: TailwindClassOptions = {}
): string[] {
  const overrides = node.stateOverrides
  if (!overrides) return []
  const baseStyle = nodeToStyle(node, graph, options)
  return collectVariantClasses(
    node,
    graph,
    options,
    baseStyle,
    INTERACTION_STATES,
    (state) => normalizeLegacyStateOverride(overrides[state]),
    STATE_STYLE_RESET
  )
}

interface LayoutPrimitiveConfig {
  position?: unknown
  top?: unknown
  right?: unknown
  bottom?: unknown
  left?: unknown
  inset?: unknown
  overflow?: unknown
  overflowX?: unknown
  overflowY?: unknown
  zIndex?: unknown
}

const LAYOUT_POSITIONS = new Set(['sticky', 'fixed'])
const OVERFLOW_VALUES = new Set(['auto', 'scroll', 'hidden', 'visible'])

/** Phase 4 §26 — user-authored layout primitives that do not map cleanly to
 *  Figma's layout fields: sticky/fixed positioning, offsets, overflow, and
 *  z-index. They ride `interactiveProps.layout` (or direct legacy keys) so this
 *  stays pure emit with zero scene-graph / codec changes. */
export function collectLayoutPrimitiveClasses(node: SceneNode): string[] {
  const ip = node.interactiveProps as
    | (LayoutPrimitiveConfig & { layout?: LayoutPrimitiveConfig })
    | undefined
  if (!ip) return []
  const cfg = ip.layout && typeof ip.layout === 'object' ? ip.layout : ip
  const classes: string[] = []
  if (typeof cfg.position === 'string' && LAYOUT_POSITIONS.has(cfg.position)) {
    classes.push(cfg.position)
  }
  classes.push(...offsetClasses(cfg))
  pushOverflow(classes, 'overflow', cfg.overflow)
  pushOverflow(classes, 'overflow-x', cfg.overflowX)
  pushOverflow(classes, 'overflow-y', cfg.overflowY)
  const z = zIndexClass(cfg.zIndex)
  if (z) classes.push(z)
  return classes
}

function offsetClasses(cfg: LayoutPrimitiveConfig): string[] {
  const classes: string[] = []
  const inset = offsetClass('inset', cfg.inset)
  if (inset) classes.push(inset)
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const cls = offsetClass(side, cfg[side])
    if (cls) classes.push(cls)
  }
  return classes
}

function offsetClass(
  name: 'inset' | 'top' | 'right' | 'bottom' | 'left',
  raw: unknown
): string | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return arbitraryClass(name, `${raw}px`)
  if (typeof raw !== 'string') return undefined
  const value = raw.trim()
  if (value === '') return undefined
  if (value === 'auto') return `${name}-auto`
  if (/^-?\d+(\.\d+)?$/.test(value)) return arbitraryClass(name, `${value}px`)
  if (/^-?\d+(\.\d+)?(px|rem|em|vh|vw|%|cqw|cqh)$/.test(value)) return arbitraryClass(name, value)
  if (/^-?\d+\/\d+$/.test(value) || value === 'full' || value === 'px') return `${name}-${value}`
  return undefined
}

function pushOverflow(
  classes: string[],
  prefix: 'overflow' | 'overflow-x' | 'overflow-y',
  raw: unknown
): void {
  if (typeof raw === 'string' && OVERFLOW_VALUES.has(raw)) classes.push(`${prefix}-${raw}`)
}

function zIndexClass(raw: unknown): string | undefined {
  let value = Number.NaN
  if (typeof raw === 'number') value = raw
  else if (typeof raw === 'string') value = Number(raw.trim())
  if (!Number.isFinite(value)) return undefined
  return arbitraryClass('z', String(value))
}

function arbitraryClass(name: string, value: string): string {
  return `${name}-[${value.replace(/ /g, '_')}]`
}

const RADIUS_CLASS: Record<string, string> = {
  '0px': 'rounded-none',
  '2px': 'rounded-sm',
  '4px': 'rounded',
  '6px': 'rounded-md',
  '8px': 'rounded-lg',
  '12px': 'rounded-xl',
  '16px': 'rounded-2xl',
  '24px': 'rounded-3xl',
  '9999px': 'rounded-full'
}

const BORDER_WIDTH_CLASS: Record<string, string> = {
  '0px': 'border-0',
  '1px': 'border',
  '2px': 'border-2',
  '4px': 'border-4',
  '8px': 'border-8'
}

const FONT_SIZE_CLASS: Record<string, string> = {
  '12px': 'text-xs',
  '14px': 'text-sm',
  '16px': 'text-base',
  '18px': 'text-lg',
  '20px': 'text-xl',
  '24px': 'text-2xl',
  '30px': 'text-3xl',
  '36px': 'text-4xl',
  '48px': 'text-5xl',
  '60px': 'text-6xl',
  '72px': 'text-7xl',
  '96px': 'text-8xl',
  '128px': 'text-9xl'
}

function borderWidthClasses(value: string | undefined): string[] {
  if (!value) return []
  return [BORDER_WIDTH_CLASS[value] ?? arbitraryClass('border', value)]
}

function roundedClasses(value: string | undefined): string[] {
  if (!value) return []
  const radii = expandBorderRadius(value)
  if (!radii) return []
  const [tl, tr, br, bl] = radii
  if (tl === tr && tr === br && br === bl) {
    return [RADIUS_CLASS[tl] ?? arbitraryClass('rounded', tl)]
  }
  return [
    arbitraryClass('rounded-tl', tl),
    arbitraryClass('rounded-tr', tr),
    arbitraryClass('rounded-br', br),
    arbitraryClass('rounded-bl', bl)
  ]
}

function fontSizeClasses(value: string | undefined): string[] {
  if (!value) return []
  return [FONT_SIZE_CLASS[value] ?? arbitraryClass('text', value)]
}

function expandBorderRadius(value: string): [string, string, string, string] | null {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]]
  if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]]
  if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]]
  if (parts.length === 4) return [parts[0], parts[1], parts[2], parts[3]]
  return null
}

function tailwindClassesFromStyle(style: Record<string, string>): string[] {
  const twirlStyle = { ...style }
  delete twirlStyle.borderWidth
  delete twirlStyle.borderRadius
  // twirlwind treats spacing multiples as dynamic text utilities (`40px` →
  // `text-10`), but Tailwind's numeric spacing scale does not apply to
  // font-size. Emit only real default typography tokens, otherwise preserve
  // the authored value with an arbitrary utility.
  delete twirlStyle.fontSize
  const twirled = twirl(twirlStyle)
  return [
    ...(twirled ? twirled.split(' ') : []),
    ...fontSizeClasses(style.fontSize),
    ...borderWidthClasses(style.borderWidth),
    ...roundedClasses(style.borderRadius)
  ]
}

/**
 * Shared core of the variant emitters (responsive breakpoints and interaction
 * states): for each variant whose override is present, shallow-merge it onto the
 * node, re-derive the FULL CSS style via {@link nodeToStyle}, diff against the
 * base style, and `twirl` the changed props — each class prefixed `${variant}:`.
 * `resetMap` re-asserts a cleared prop's CSS default so the diff emits an
 * explicit reset utility (e.g. `md:flex-row`, `hover:shadow-none`); the optional
 * `extra` hook contributes variant-specific classes (responsive visibility).
 */
function collectVariantClasses<V extends string>(
  node: SceneNode,
  graph: SceneGraph,
  options: TailwindClassOptions,
  baseStyle: Record<string, string>,
  variants: readonly V[],
  overrideFor: (variant: V) => Partial<SceneNode> | undefined,
  resetMap: Record<string, string>,
  extra?: (
    variant: V,
    override: Partial<SceneNode>,
    variantStyle: Record<string, string>
  ) => string[]
): string[] {
  const out: string[] = []
  for (const variant of variants) {
    const override = overrideFor(variant)
    if (!override) continue
    const variantStyle = nodeToStyle({ ...node, ...override }, graph, options)
    for (const cls of tailwindClassesFromStyle(styleDelta(baseStyle, variantStyle, resetMap))) {
      out.push(`${variant}:${cls}`)
    }
    if (extra) out.push(...extra(variant, override, variantStyle))
  }
  return out
}

/** The CSS properties that differ between `base` and a variant style, with
 *  cleared properties re-asserted to their `resetMap` default (so twirl emits an
 *  explicit reset utility instead of silently dropping the class). */
function styleDelta(
  base: Record<string, string>,
  variant: Record<string, string>,
  resetMap: Record<string, string>
): Record<string, string> {
  const delta: Record<string, string> = {}
  for (const key of new Set([...Object.keys(base), ...Object.keys(variant)])) {
    if (base[key] === variant[key]) continue
    // Present in the variant → use its value; cleared (only in base) →
    // re-assert the default so twirl emits an explicit reset utility.
    if (Object.hasOwn(variant, key)) delta[key] = variant[key]
    else if (key in resetMap) delta[key] = resetMap[key]
  }
  return delta
}

export function collectTailwindClasses(
  node: SceneNode,
  graph: SceneGraph,
  options: TailwindClassOptions = {}
): string[] {
  const style = nodeToStyle(node, graph, options)
  const ctx = getNodeContext(node, graph)

  const extraClasses: string[] = []

  if (ctx.isGrid) extraClasses.push(...collectGridClasses(node))
  if (ctx.parentIsGrid) extraClasses.push(...collectGridPositionClasses(node))
  if (node.layoutDirection === 'RTL') extraClasses.push('[direction:rtl]')
  if (node.type === 'TEXT' && resolveNodeTextDirection(node) === 'RTL')
    extraClasses.push('[direction:rtl]')
  extraClasses.push(...collectShapeExtraClasses(node))
  extraClasses.push(...collectBlendModeClasses(node))
  // Phase 4 §24.2: a gradient fill → `bg-[linear-gradient(...)]` arbitrary value
  // (twirl can't express it; mirrors the clip-path bypass).
  extraClasses.push(...collectGradientClasses(node))

  const combined = tailwindClassesFromStyle(style)

  if (style.display === 'grid') {
    const filtered = combined.filter((c) => c !== 'grid')
    return [...extraClasses, ...filtered]
  }

  return [...extraClasses, ...combined]
}
