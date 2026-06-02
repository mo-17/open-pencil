import { twirl } from 'twirlwind'

import { colorToCSSCompact } from '#core/color'
import { DEFAULT_FONT_FAMILY } from '#core/constants'
import type {
  GridTrack,
  ResponsiveBreakpoint,
  SceneGraph,
  SceneNode
} from '#core/scene-graph'
import { resolveNodeTextDirection } from '#core/text/direction'

import { formatTrack, getNodeContext, solidFillColor, solidStroke } from './helpers'

function px(v: number): string {
  return `${v}px`
}

function gridTemplateTw(tracks: GridTrack[]): string {
  const allEqual1Fr = tracks.every((t) => t.sizing === 'FR' && t.value === 1)
  if (allEqual1Fr) return String(tracks.length)
  return `[${tracks.map(formatTrack).join('_')}]`
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

function applyPadding(style: Record<string, string>, node: SceneNode): void {
  const { paddingTop: pt, paddingRight: pr, paddingBottom: pb, paddingLeft: pl } = node
  if (pt === 0 && pr === 0 && pb === 0 && pl === 0) return
  if (pt === pr && pr === pb && pb === pl) style.padding = px(pt)
  else if (pt === pb && pl === pr) style.padding = `${px(pt)} ${px(pl)}`
  else style.padding = `${px(pt)} ${px(pr)} ${px(pb)} ${px(pl)}`
}

function applyLayoutStyle(style: Record<string, string>, node: SceneNode, graph: SceneGraph): void {
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
  if (ctx.isAutoLayout) applyPadding(style, node)

  // Phase 2 §6: free positioning fires for two cases that share the same
  // CSS shape — parent opts the whole container into free layout (CANVAS
  // implicitly, or any FRAME with `layoutMode === 'FREE'`), OR a single
  // child opts itself out of the parent's auto-layout via Figma's existing
  // `layoutPositioning: 'ABSOLUTE'` field (canvas-side Yoga + drag/snap
  // honored it before; this is the emit honor that closes the gap).
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

function applyTextStyle(style: Record<string, string>, node: SceneNode): void {
  if (node.type !== 'TEXT') return
  style.fontSize = px(node.fontSize)
  if (node.fontFamily && node.fontFamily !== DEFAULT_FONT_FAMILY) style.fontFamily = node.fontFamily
  if (node.fontWeight !== 400) style.fontWeight = String(node.fontWeight)
  if (node.textAlignHorizontal !== 'LEFT') style.textAlign = node.textAlignHorizontal.toLowerCase()
  const textColor = solidFillColor(node.fills)
  if (textColor) style.color = textColor
}

function nodeToStyle(node: SceneNode, graph: SceneGraph): Record<string, string> {
  const style: Record<string, string> = {}
  applyLayoutStyle(style, node, graph)
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
 * `visible: false` is handled explicitly (nodeToStyle ignores `visible`) as
 * `${bp}:hidden`. Re-showing a base-hidden node is out of scope — the compiler
 * skips invisible nodes before emit, so they never reach here.
 */
export function collectResponsiveTailwindClasses(node: SceneNode, graph: SceneGraph): string[] {
  const overrides = node.responsiveOverrides
  if (!overrides) return []
  const baseStyle = nodeToStyle(node, graph)
  const out: string[] = []
  for (const bp of RESPONSIVE_BREAKPOINTS) {
    const override = overrides[bp]
    if (!override) continue
    const bpStyle = nodeToStyle({ ...node, ...override }, graph)
    const twirled = twirl(layoutStyleDelta(baseStyle, bpStyle))
    if (twirled) for (const cls of twirled.split(' ')) out.push(`${bp}:${cls}`)
    if (override.visible === false) out.push(`${bp}:hidden`)
  }
  return out
}

/** The CSS properties that differ between `base` and `bp`, with cleared
 *  properties re-asserted to their default (so twirl emits an explicit reset).
 *  Only layout props can change here — a responsive override never touches the
 *  appearance/shape/text style, so those stay equal and drop out of the diff. */
function layoutStyleDelta(
  base: Record<string, string>,
  bp: Record<string, string>
): Record<string, string> {
  const delta: Record<string, string> = {}
  for (const key of new Set([...Object.keys(base), ...Object.keys(bp)])) {
    if (base[key] === bp[key]) continue
    // Present at the breakpoint → use its value; cleared (only in base) →
    // re-assert the default so twirl emits an explicit reset utility.
    if (Object.hasOwn(bp, key)) delta[key] = bp[key]
    else if (key in LAYOUT_STYLE_RESET) delta[key] = LAYOUT_STYLE_RESET[key]
  }
  return delta
}

export function collectTailwindClasses(node: SceneNode, graph: SceneGraph): string[] {
  const style = nodeToStyle(node, graph)
  const ctx = getNodeContext(node, graph)

  const extraClasses: string[] = []

  if (ctx.isGrid) extraClasses.push(...collectGridClasses(node))
  if (ctx.parentIsGrid) extraClasses.push(...collectGridPositionClasses(node))
  if (node.layoutDirection === 'RTL') extraClasses.push('[direction:rtl]')
  if (node.type === 'TEXT' && resolveNodeTextDirection(node) === 'RTL')
    extraClasses.push('[direction:rtl]')
  extraClasses.push(...collectShapeExtraClasses(node))

  const twirlClasses = twirl(style)
  const combined = twirlClasses ? twirlClasses.split(' ') : []

  if (style.display === 'grid') {
    const filtered = combined.filter((c) => c !== 'grid')
    return [...extraClasses, ...filtered]
  }

  return [...extraClasses, ...combined]
}
