import { wcagLuminance } from 'culori'

import type { Fill, SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import type { Color } from '@open-pencil/scene-graph/primitives'

import { resolveFillColor } from '#core/canvas/renderer/colors'
import { colorToHex } from '#core/color'
import { TRANSPARENT } from '#core/constants'
import { firstVisibleSolidTextFill } from '#core/text/paint'

export const WCAG_AA_TEXT_CONTRAST_THRESHOLD = 4.5
export const WCAG_AA_LARGE_TEXT_CONTRAST_THRESHOLD = 3

const WCAG_LARGE_TEXT_MIN_SIZE = 24
const WCAG_LARGE_BOLD_TEXT_MIN_SIZE = 18.66
const WCAG_BOLD_WEIGHT = 700

interface PremultipliedColor {
  r: number
  g: number
  b: number
  a: number
}

export interface TextContrastResult {
  foreground: Color
  background: Color
  ratio: number
  threshold: number
}

export interface TextContrastIssue {
  message: string
  suggestion: string
}

const TRANSPARENT_PREMULTIPLIED: PremultipliedColor = TRANSPARENT
const OPAQUE_EPSILON = 0.001
const BOUNDS_EPSILON = 0.001
const RECTANGULAR_UNDERLAY_TYPES = new Set<SceneNode['type']>(['FRAME', 'RECTANGLE'])

interface LocalBounds {
  left: number
  top: number
  right: number
  bottom: number
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function sourceOver(
  foreground: PremultipliedColor,
  background: PremultipliedColor
): PremultipliedColor {
  const remaining = 1 - foreground.a
  return {
    r: foreground.r + background.r * remaining,
    g: foreground.g + background.g * remaining,
    b: foreground.b + background.b * remaining,
    a: foreground.a + background.a * remaining
  }
}

function withGroupOpacity(color: PremultipliedColor, opacity: number): PremultipliedColor {
  const alpha = clampUnit(opacity)
  return {
    r: color.r * alpha,
    g: color.g * alpha,
    b: color.b * alpha,
    a: color.a * alpha
  }
}

function premultiply(color: Color, opacity: number): PremultipliedColor {
  const alpha = clampUnit(color.a * opacity)
  return {
    r: clampUnit(color.r) * alpha,
    g: clampUnit(color.g) * alpha,
    b: clampUnit(color.b) * alpha,
    a: alpha
  }
}

function isSourceOverFill(fill: Fill): boolean {
  return fill.blendMode === undefined || fill.blendMode === 'NORMAL'
}

function isSourceOverNode(node: SceneNode): boolean {
  return node.blendMode === 'NORMAL' || node.blendMode === 'PASS_THROUGH'
}

/**
 * Resolve the flat color painted by a node at the audited pixel. Non-solid or
 * non-source-over paints vary spatially, so returning null avoids a false claim.
 */
function resolveSolidFillStack(node: SceneNode, graph: SceneGraph): PremultipliedColor | null {
  let painted = TRANSPARENT_PREMULTIPLIED
  for (let index = 0; index < node.fills.length; index++) {
    const fill = node.fills[index]
    if (!fill.visible || fill.opacity <= 0) continue
    if (fill.type !== 'SOLID' || !isSourceOverFill(fill)) return null
    const color = resolveFillColor(fill, index, node, graph)
    painted = sourceOver(premultiply(color, fill.opacity), painted)
  }
  return painted
}

function resolveStyleRunPaint(
  fills: readonly Fill[],
  node: SceneNode,
  graph: SceneGraph
): PremultipliedColor | null {
  const fill = firstVisibleSolidTextFill(fills)
  if (!fill || !isSourceOverFill(fill)) return null
  return premultiply(resolveFillColor(fill, fills.indexOf(fill), node, graph), fill.opacity)
}

/** Resolve every color that paints at least one character. Rich-text rendering
 * falls back to the node fill when a run has no visible fill override. */
function resolveTextPaints(node: SceneNode, graph: SceneGraph): PremultipliedColor[] | null {
  const base = resolveSolidFillStack(node, graph)
  if (!base) return null
  if (node.text.length === 0 || node.styleRuns.length === 0) return [base]

  const paints: PremultipliedColor[] = []
  let baseIsUsed = false
  let cursor = 0
  for (const run of node.styleRuns) {
    if (
      !Number.isInteger(run.start) ||
      !Number.isInteger(run.length) ||
      run.start < cursor ||
      run.length < 0 ||
      run.start + run.length > node.text.length
    ) {
      return null
    }
    if (run.start > cursor) baseIsUsed = true
    cursor = run.start + run.length
    if (run.length === 0) continue

    const fills = run.style.fills
    if (!fills || !firstVisibleSolidTextFill(fills)) {
      baseIsUsed = true
      continue
    }
    const paint = resolveStyleRunPaint(fills, node, graph)
    if (!paint) return null
    paints.push(paint)
  }
  if (cursor < node.text.length) baseIsUsed = true
  if (baseIsUsed) paints.push(base)
  return paints.length > 0 ? paints : [base]
}

function localBounds(node: SceneNode): LocalBounds | null {
  if (
    node.rotation !== 0 ||
    node.flipX ||
    node.flipY ||
    ![node.x, node.y, node.width, node.height].every(Number.isFinite) ||
    node.width <= 0 ||
    node.height <= 0
  ) {
    return null
  }
  return {
    left: node.x,
    top: node.y,
    right: node.x + node.width,
    bottom: node.y + node.height
  }
}

function boundsIntersect(left: LocalBounds, right: LocalBounds): boolean {
  return (
    left.left < right.right - BOUNDS_EPSILON &&
    left.right > right.left + BOUNDS_EPSILON &&
    left.top < right.bottom - BOUNDS_EPSILON &&
    left.bottom > right.top + BOUNDS_EPSILON
  )
}

function boundsCover(outer: LocalBounds, inner: LocalBounds): boolean {
  return (
    outer.left <= inner.left + BOUNDS_EPSILON &&
    outer.top <= inner.top + BOUNDS_EPSILON &&
    outer.right >= inner.right - BOUNDS_EPSILON &&
    outer.bottom >= inner.bottom - BOUNDS_EPSILON
  )
}

function hasVisibleStrokeOrEffect(node: SceneNode): boolean {
  return (
    node.strokes.some((stroke) => stroke.visible && stroke.opacity > 0 && stroke.weight > 0) ||
    node.effects.some((effect) => effect.visible)
  )
}

function hasPotentialSiblingPixels(node: SceneNode): boolean {
  return (
    node.fills.some((fill) => fill.visible && fill.opacity > 0) ||
    hasVisibleStrokeOrEffect(node) ||
    node.childIds.length > 0 ||
    node.generatedEffect !== undefined
  )
}

function isSimpleRectangularUnderlay(node: SceneNode): boolean {
  return (
    RECTANGULAR_UNDERLAY_TYPES.has(node.type) &&
    node.childIds.length === 0 &&
    !hasVisibleStrokeOrEffect(node) &&
    node.generatedEffect === undefined &&
    node.motion === undefined &&
    node.cornerRadius === 0 &&
    !node.independentCorners
  )
}

function siblingUnderlayPaint(
  sibling: SceneNode,
  index: number,
  textIndex: number,
  textBounds: LocalBounds,
  graph: SceneGraph
): PremultipliedColor | null | undefined {
  const siblingBounds = localBounds(sibling)
  if (!siblingBounds || hasVisibleStrokeOrEffect(sibling)) return null
  if (!boundsIntersect(siblingBounds, textBounds)) {
    return sibling.childIds.length > 0 && !sibling.clipsContent ? null : undefined
  }
  if (index > textIndex || !boundsCover(siblingBounds, textBounds)) return null
  if (!isSimpleRectangularUnderlay(sibling) || !isSourceOverNode(sibling)) return null
  const paint = resolveSolidFillStack(sibling, graph)
  return paint ? withGroupOpacity(paint, sibling.opacity) : null
}

/** Composite direct siblings that provably paint the same flat color beneath
 * the entire text box. Any partial overlap or later overdraw is indeterminate. */
function resolveSiblingUnderlay(node: SceneNode, graph: SceneGraph): PremultipliedColor | null {
  const parent = node.parentId ? graph.getNode(node.parentId) : undefined
  const textBounds = localBounds(node)
  if (!parent || !textBounds) return null
  const textIndex = parent.childIds.indexOf(node.id)
  if (textIndex === -1) return null

  let underlay = TRANSPARENT_PREMULTIPLIED
  for (let index = 0; index < parent.childIds.length; index++) {
    const sibling = graph.getNode(parent.childIds[index])
    if (!sibling || sibling.id === node.id || !sibling.visible || sibling.opacity <= 0) continue
    if (sibling.isMask || sibling.motion !== undefined) return null
    if (!hasPotentialSiblingPixels(sibling)) continue
    const paint = siblingUnderlayPaint(sibling, index, textIndex, textBounds, graph)
    if (paint === null) return null
    if (paint) underlay = sourceOver(paint, underlay)
  }
  return underlay
}

/** Siblings of a transparent ancestor can also contribute pixels behind the
 * text branch. Until those nested branches are composited explicitly, decline
 * the audit whenever one may intersect instead of silently using only the
 * ancestor fill. */
function hasIntersectingAncestorSibling(node: SceneNode, graph: SceneGraph): boolean {
  if (node.type === 'CANVAS' || !node.parentId) return false
  const parent = graph.getNode(node.parentId)
  const nodeBounds = localBounds(node)
  if (!parent || !nodeBounds) return true
  for (const siblingId of parent.childIds) {
    if (siblingId === node.id) continue
    const sibling = graph.getNode(siblingId)
    if (!sibling?.visible || sibling.opacity <= 0 || !hasPotentialSiblingPixels(sibling)) continue
    const siblingBounds = localBounds(sibling)
    if (!siblingBounds || boundsIntersect(siblingBounds, nodeBounds)) return true
  }
  return false
}

function ancestorChain(node: SceneNode, graph: SceneGraph): SceneNode[] {
  const ancestors: SceneNode[] = []
  let current = node.parentId ? graph.getNode(node.parentId) : undefined
  while (current) {
    ancestors.unshift(current)
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return ancestors
}

/** Render one nested branch from the leaf back through ancestor opacity groups. */
function compositeBranch(
  leaf: PremultipliedColor,
  ancestors: SceneNode[],
  graph: SceneGraph
): PremultipliedColor | null {
  let content = leaf
  for (let index = ancestors.length - 1; index >= 0; index--) {
    const ancestor = ancestors[index]
    if (!ancestor.visible || !isSourceOverNode(ancestor)) return null
    const background = resolveSolidFillStack(ancestor, graph)
    if (!background) return null
    content = withGroupOpacity(sourceOver(content, background), ancestor.opacity)
  }
  return content
}

function opaqueColor(color: PremultipliedColor): Color | null {
  if (color.a < 1 - OPAQUE_EPSILON) return null
  return {
    r: clampUnit(color.r / color.a),
    g: clampUnit(color.g / color.a),
    b: clampUnit(color.b / color.a),
    a: 1
  }
}

function contrastRatio(foreground: Color, background: Color): number {
  const foregroundLuminance = wcagLuminance({ mode: 'rgb', ...foreground })
  const backgroundLuminance = wcagLuminance({ mode: 'rgb', ...background })
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

function isWcagLargeText(fontSize: number, fontWeight: number): boolean {
  return (
    fontSize >= WCAG_LARGE_TEXT_MIN_SIZE ||
    (fontSize >= WCAG_LARGE_BOLD_TEXT_MIN_SIZE && fontWeight >= WCAG_BOLD_WEIGHT)
  )
}

function mergedCoverageLength(ranges: Array<{ start: number; end: number }>): number {
  ranges.sort((left, right) => left.start - right.start || left.end - right.end)
  let covered = 0
  let end = 0
  for (const range of ranges) {
    if (range.end <= end) continue
    covered += range.end - Math.max(end, range.start)
    end = range.end
  }
  return covered
}

/** WCAG permits 3:1 only when every visible character is large text. Styled
 * ranges are checked individually; uncovered characters use the node style. */
function textContrastThreshold(node: SceneNode): number {
  const textLength = node.text.length
  const ranges: Array<{ start: number; end: number }> = []
  for (const run of node.styleRuns) {
    const start = Math.max(0, Math.min(textLength, run.start))
    const end = Math.max(start, Math.min(textLength, run.start + run.length))
    if (end === start) continue
    ranges.push({ start, end })
    if (
      !isWcagLargeText(run.style.fontSize ?? node.fontSize, run.style.fontWeight ?? node.fontWeight)
    ) {
      return WCAG_AA_TEXT_CONTRAST_THRESHOLD
    }
  }
  const baseStyleIsUsed = textLength === 0 || mergedCoverageLength(ranges) < textLength
  if (baseStyleIsUsed && !isWcagLargeText(node.fontSize, node.fontWeight)) {
    return WCAG_AA_TEXT_CONTRAST_THRESHOLD
  }
  return WCAG_AA_LARGE_TEXT_CONTRAST_THRESHOLD
}

/** Resolve the actual opaque pixels produced by text and its ancestor backgrounds. */
export function analyzeTextContrast(node: SceneNode, graph: SceneGraph): TextContrastResult | null {
  if (
    node.type !== 'TEXT' ||
    !node.visible ||
    !isSourceOverNode(node) ||
    node.motion !== undefined ||
    node.generatedEffect !== undefined ||
    hasVisibleStrokeOrEffect(node)
  ) {
    return null
  }
  const ancestors = ancestorChain(node, graph)
  if (ancestors.length === 0) return null
  if (
    ancestors.some(
      (ancestor) =>
        ancestor.rotation !== 0 ||
        ancestor.flipX ||
        ancestor.flipY ||
        ancestor.motion !== undefined ||
        ancestor.generatedEffect !== undefined ||
        ancestor.isMask ||
        hasVisibleStrokeOrEffect(ancestor) ||
        hasIntersectingAncestorSibling(ancestor, graph)
    )
  ) {
    return null
  }

  const textPaints = resolveTextPaints(node, graph)
  const underlay = resolveSiblingUnderlay(node, graph)
  if (!textPaints || !underlay) return null
  const backgroundPixel = compositeBranch(underlay, ancestors, graph)
  if (!backgroundPixel) return null

  const background = opaqueColor(backgroundPixel)
  if (!background) return null
  let worst: TextContrastResult | null = null
  const threshold = textContrastThreshold(node)
  for (const textPaint of textPaints) {
    const foregroundPixel = compositeBranch(
      sourceOver(withGroupOpacity(textPaint, node.opacity), underlay),
      ancestors,
      graph
    )
    if (!foregroundPixel) return null
    const foreground = opaqueColor(foregroundPixel)
    if (!foreground) return null
    const ratio = contrastRatio(foreground, background)
    if (!worst || ratio < worst.ratio) worst = { foreground, background, ratio, threshold }
  }
  return worst
}

export function lowTextContrastIssue(node: SceneNode, graph: SceneGraph): TextContrastIssue | null {
  const contrast = analyzeTextContrast(node, graph)
  if (!contrast || contrast.ratio >= contrast.threshold) return null
  const label = node.name || node.text.slice(0, 20) || 'Text'
  return {
    message: `Low contrast: "${label}" ${colorToHex(contrast.foreground)} on ${colorToHex(contrast.background)} — ${contrast.ratio.toFixed(2)}:1 < ${contrast.threshold.toFixed(2)}:1 (WCAG AA)`,
    suggestion: `Increase text contrast to ≥${contrast.threshold.toFixed(2)}:1`
  }
}
