/* eslint-disable max-lines -- scene dispatch stays together while shape domains live in sibling modules */
import type { Canvas, Path } from 'canvaskit-wasm'

import type { SceneNode, SceneGraph, Fill } from '@open-pencil/scene-graph'
import { computeDescendantVisualBounds, polygonVertices } from '@open-pencil/scene-graph/geometry'
import type { Color, Rect } from '@open-pencil/scene-graph/primitives'

import {
  DEFAULT_SHADOW_COLOR,
  DROP_HIGHLIGHT_ALPHA,
  DROP_HIGHLIGHT_STROKE,
  SECTION_CORNER_RADIUS,
  TRANSPARENT
} from '#core/constants'
import {
  MOTION_VISUAL_IDENTITY,
  projectMotionAdvancedChannels,
  type MotionVisualState
} from '#core/motion'
import { transformTextCase } from '#core/text/case'
import { fontManager } from '#core/text/fonts'
import { vectorNetworkToCenterlinePath } from '#core/vector'
import { evalCubic, isLineSegment, segmentToAbsolute } from '#core/vector/curve-math'

import { figmaBlendModeToSkia, needsIsolatedBlendLayer } from './blend'
import { renderBooleanOperation } from './boolean'
import { drawVectorMultiStyleFills, paintFills } from './fills'
import { drawGeneratedEffect } from './generated-effect'
import { drawLayoutGrids } from './layout-grids'
import { renderButtonLabel, renderTextInputContent } from './lowcode'
import { renderMaskedChildIds } from './masks'
import {
  hasMotionDynamicStroke,
  measurePathLength,
  motionDashPhase,
  motionProjectionFlags,
  motionTrimProjection
} from './motion-projection'
import type { SkiaRenderer, RenderOverlays } from './renderer'
import { makeSmoothRRectPath, nodeHasRadius, nodeHasSmoothCorners } from './shapes'
import {
  configureStrokePaint,
  drawDashedRRectWithSolidCorners,
  drawStyledRRectStroke,
  getStrokeCapEntity,
  getStrokeJoinEntity
} from './strokes'
import { drawFigmaDerivedText } from './text/derived'
import { textNodeToOutlinePath } from './text/outlines'

function drawVisibleFills(
  r: SkiaRenderer,
  node: SceneNode,
  graph: SceneGraph,
  draw: (fill: Fill) => void
): void {
  paintFills(r, node.fills, node, graph, draw)
}
function motionVisual(overlays: RenderOverlays, nodeId: string): MotionVisualState {
  return overlays.motionVisualStates?.get(nodeId) ?? MOTION_VISUAL_IDENTITY
}

function motionLayoutNode(node: SceneNode, overlays: RenderOverlays): SceneNode {
  const layout = overlays.motionLayoutNodes?.get(node.id)
  return layout ? { ...node, ...layout } : node
}

function hasMotionGeometry(visual: MotionVisualState): boolean {
  return (
    visual.x !== 0 ||
    visual.y !== 0 ||
    visual.scaleX !== 1 ||
    visual.scaleY !== 1 ||
    visual.rotate !== 0 ||
    visual.width !== undefined ||
    visual.height !== undefined ||
    visual.pathProgress !== undefined ||
    visual.trimStart !== undefined ||
    visual.trimEnd !== undefined
  )
}

function hasMotionScaleOrRotation(visual: MotionVisualState): boolean {
  return visual.scaleX !== 1 || visual.scaleY !== 1 || visual.rotate !== 0
}

function subtreeHasMotionGeometry(
  graph: SceneGraph,
  nodeId: string,
  overlays: RenderOverlays
): boolean {
  const states = overlays.motionVisualStates
  if (!states || states.size === 0) return false
  for (const [targetId, visual] of states) {
    if (!hasMotionGeometry(visual)) continue
    let current = graph.getNode(targetId)
    while (current) {
      if (current.id === nodeId) return true
      current = current.parentId ? graph.getNode(current.parentId) : undefined
    }
  }
  return false
}

function isCulled(
  r: SkiaRenderer,
  node: SceneNode,
  absX: number,
  absY: number,
  visual: MotionVisualState
): boolean {
  const canCull =
    node.childIds.length === 0 ||
    ((node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') &&
      node.clipsContent)
  if (!canCull) return false

  const vp = r.worldViewport
  const bw = node.width * Math.abs(visual.scaleX)
  const bh = node.height * Math.abs(visual.scaleY)
  const scaledX = absX + (node.width - bw) / 2
  const scaledY = absY + (node.height - bh) / 2
  if (node.rotation + visual.rotate !== 0) {
    const diag = Math.hypot(bw, bh)
    const cx = absX + node.width / 2
    const cy = absY + node.height / 2
    return (
      cx - diag / 2 > vp.x + vp.w ||
      cy - diag / 2 > vp.y + vp.h ||
      cx + diag / 2 < vp.x ||
      cy + diag / 2 < vp.y
    )
  }
  return (
    scaledX > vp.x + vp.w || scaledY > vp.y + vp.h || scaledX + bw < vp.x || scaledY + bh < vp.y
  )
}

function applyNodeTransforms(
  _r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  nodeId: string,
  overlays: RenderOverlays,
  visual: MotionVisualState
): void {
  const rotation =
    overlays.rotationPreview?.nodeId === nodeId ? overlays.rotationPreview.angle : node.rotation
  if (rotation !== 0) {
    if (node.type === 'LINE') canvas.rotate(rotation, 0, 0)
    else canvas.rotate(rotation, node.width / 2, node.height / 2)
  }

  if (node.flipX || node.flipY) {
    canvas.translate(node.flipX ? node.width : 0, node.flipY ? node.height : 0)
    canvas.scale(node.flipX ? -1 : 1, node.flipY ? -1 : 1)
  }

  const originX = node.width * (visual.originX ?? 0.5)
  const originY = node.height * (visual.originY ?? 0.5)
  if (visual.rotate !== 0) {
    canvas.rotate(visual.rotate, originX, originY)
  }
  if (visual.scaleX !== 1 || visual.scaleY !== 1) {
    canvas.translate(originX, originY)
    canvas.scale(visual.scaleX, visual.scaleY)
    canvas.translate(-originX, -originY)
  }
}

function replaceFirstSolidFill(
  fills: SceneNode['fills'],
  color: NonNullable<MotionVisualState['fillColor']>
): SceneNode['fills'] {
  let replaced = false
  return fills.map((fill) => {
    if (replaced || !fill.visible || fill.type !== 'SOLID') return fill
    replaced = true
    return { ...fill, color: { ...color } }
  })
}

function replaceFirstVisibleStroke(
  strokes: SceneNode['strokes'],
  visual: MotionVisualState
): SceneNode['strokes'] {
  let replaced = false
  return strokes.map((stroke) => {
    if (replaced || !stroke.visible) return stroke
    replaced = true
    return {
      ...stroke,
      ...(visual.strokeColor ? { color: { ...visual.strokeColor } } : {}),
      ...(visual.strokeWidth !== undefined ? { weight: visual.strokeWidth } : {})
    }
  })
}

function vectorLength(node: SceneNode): number {
  if (node.type === 'STAR' || node.type === 'POLYGON') {
    const points = polygonVertices(node)
    let length = 0
    for (let index = 0; index < points.length; index++) {
      const from = points[index]
      const to = points[(index + 1) % points.length]
      length += Math.hypot(to.x - from.x, to.y - from.y)
    }
    return Math.max(1, length)
  }
  if (!node.vectorNetwork) return Math.max(1, Math.hypot(node.width, node.height))
  let length = 0
  for (let index = 0; index < node.vectorNetwork.segments.length; index++) {
    const segment = node.vectorNetwork.segments[index]
    const curve = segmentToAbsolute(node.vectorNetwork, index)
    if (isLineSegment(segment)) {
      length += Math.hypot(curve.p3.x - curve.p0.x, curve.p3.y - curve.p0.y)
      continue
    }
    // A fixed, bounded subdivision keeps preview cost deterministic while
    // avoiding the severe chord-length error on curved vector segments.
    let previous = curve.p0
    for (let sample = 1; sample <= 24; sample++) {
      const point = evalCubic(
        curve.p0.x,
        curve.p0.y,
        curve.cp1.x,
        curve.cp1.y,
        curve.cp2.x,
        curve.cp2.y,
        curve.p3.x,
        curve.p3.y,
        sample / 24
      )
      length += Math.hypot(point.x - previous.x, point.y - previous.y)
      previous = point
    }
  }
  return Math.max(1, length)
}

function trimProjection(
  node: SceneNode,
  visual: MotionVisualState
): {
  pattern?: number[]
  phase?: number
  hide?: boolean
  normalized?: { visibleFraction: number; phase: number }
} {
  if (visual.trimStart === undefined && visual.trimEnd === undefined) return {}
  const start = Math.min(1, Math.max(0, visual.trimStart ?? 0))
  const end = Math.min(1, Math.max(start, visual.trimEnd ?? 1))
  const total = vectorLength(node)
  const visibleFraction = end - start
  const phase = (((start + (visual.trimOffset ?? 0)) % 1) + 1) % 1
  // Once a trim channel is authored it owns dash visibility for the whole
  // track. A full interval is therefore a solid revealed stroke (matching the
  // compiler's normalized `1 0` SVG dash), not a return to authored dashes.
  if (visibleFraction >= 1 - 1e-6) {
    return { pattern: [], normalized: { visibleFraction: 1, phase } }
  }
  if (visibleFraction <= 1e-6) return { hide: true }
  const visible = visibleFraction * total
  return {
    pattern: [visible, total - visible],
    phase: -phase * total,
    normalized: { visibleFraction, phase }
  }
}

function applyMotionBlur(effects: SceneNode['effects'], visual: MotionVisualState): void {
  if (visual.blur === undefined) return
  const index = effects.findIndex(
    (effect) => effect.type === 'LAYER_BLUR' || effect.type === 'FOREGROUND_BLUR'
  )
  if (index !== -1) {
    effects[index] = { ...effects[index], radius: visual.blur, visible: true }
  } else if (visual.blur > 0) {
    effects.push({
      type: 'LAYER_BLUR',
      color: { ...TRANSPARENT },
      offset: { x: 0, y: 0 },
      radius: visual.blur,
      spread: 0,
      visible: true
    })
  }
}

function applyMotionShadow(effects: SceneNode['effects'], visual: MotionVisualState): void {
  if (
    visual.shadowX === undefined &&
    visual.shadowY === undefined &&
    visual.shadowBlur === undefined &&
    visual.shadowSpread === undefined &&
    !visual.shadowColor
  ) {
    return
  }
  const index = effects.findIndex((effect) => effect.type === 'DROP_SHADOW')
  const authored = index === -1 ? undefined : effects[index]
  const shadow = {
    type: 'DROP_SHADOW' as const,
    color: {
      ...valueOr(visual.shadowColor, valueOr(authored?.color, DEFAULT_SHADOW_COLOR))
    },
    offset: {
      x: valueOr(visual.shadowX, valueOr(authored?.offset.x, 0)),
      y: valueOr(visual.shadowY, valueOr(authored?.offset.y, 0))
    },
    radius: valueOr(visual.shadowBlur, valueOr(authored?.radius, 0)),
    spread: valueOr(visual.shadowSpread, valueOr(authored?.spread, 0)),
    visible: true,
    ...motionShadowExtras(authored)
  }
  if (index !== -1) effects[index] = shadow
  else effects.push(shadow)
}

function motionShadowExtras(authored: SceneNode['effects'][number] | undefined) {
  return {
    ...(authored?.blendMode ? { blendMode: authored.blendMode } : {}),
    ...(authored?.showShadowBehindNode === undefined
      ? {}
      : { showShadowBehindNode: authored.showShadowBehindNode })
  }
}

function motionEffects(node: SceneNode, visual: MotionVisualState): SceneNode['effects'] {
  const effects = node.effects.map((effect) => ({
    ...effect,
    color: { ...effect.color },
    offset: { ...effect.offset }
  }))
  applyMotionBlur(effects, visual)
  applyMotionShadow(effects, visual)
  return effects
}

function valueOr<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value
}

function motionCornerOverrides(visual: MotionVisualState) {
  if (visual.cornerRadius === undefined) return {}
  return {
    independentCorners: false,
    topLeftRadius: visual.cornerRadius,
    topRightRadius: visual.cornerRadius,
    bottomRightRadius: visual.cornerRadius,
    bottomLeftRadius: visual.cornerRadius
  }
}

function motionStrokes(node: SceneNode, visual: MotionVisualState): SceneNode['strokes'] {
  const trim = trimProjection(node, visual)
  const pattern = trim.pattern
  if (!visual.strokeColor && visual.strokeWidth === undefined && !pattern && !trim.hide) {
    return node.strokes
  }
  let strokes = node.strokes
  if (trim.hide) {
    strokes = node.strokes.map((stroke) => (stroke.visible ? { ...stroke, opacity: 0 } : stroke))
  } else if (pattern) {
    strokes = node.strokes.map((stroke) =>
      stroke.visible ? { ...stroke, dashPattern: [...pattern] } : stroke
    )
  }
  return replaceFirstVisibleStroke(strokes, visual)
}

function motionMainAxisGap(node: SceneNode, visual: MotionVisualState): number {
  const directional = node.layoutMode === 'HORIZONTAL' ? visual.columnGap : visual.rowGap
  return valueOr(directional, valueOr(visual.gap, node.itemSpacing))
}

function motionCounterAxisGap(node: SceneNode, visual: MotionVisualState): number {
  const directional = node.layoutMode === 'HORIZONTAL' ? visual.rowGap : visual.columnGap
  return valueOr(directional, valueOr(visual.gap, node.counterAxisSpacing))
}

function motionNode(node: SceneNode, visual: MotionVisualState): SceneNode {
  if (node.type === 'VECTOR' && (node.vectorNetwork?.segments.length ?? 0) === 0) {
    const {
      strokeWidth: _strokeWidth,
      trimStart: _trimStart,
      trimEnd: _trimEnd,
      trimOffset: _trimOffset,
      ...supportedVisual
    } = visual
    visual = supportedVisual as MotionVisualState
    if (node.fillGeometry.length === 0) {
      const { fillColor: _fillColor, ...fillSupportedVisual } = visual
      visual = fillSupportedVisual as MotionVisualState
    }
    if (node.strokeGeometry.length === 0) {
      const { strokeColor: _strokeColor, ...strokeSupportedVisual } = visual
      visual = strokeSupportedVisual as MotionVisualState
    }
  }
  const hasV2 = Object.keys(visual).some(
    (key) =>
      !['x', 'y', 'scaleX', 'scaleY', 'rotate', 'opacity', 'originX', 'originY'].includes(key)
  )
  if (!hasV2 && visual.originX === undefined && visual.originY === undefined) return node
  const trim = trimProjection(node, visual)
  const projectedNode: SceneNode = {
    ...node,
    ...motionProjectionFlags(
      trim.phase,
      visual.strokeWidth !== undefined || trim.normalized !== undefined || trim.hide === true,
      trim.normalized
    ),
    width: valueOr(visual.width, node.width),
    height: valueOr(visual.height, node.height),
    cornerRadius: valueOr(visual.cornerRadius, node.cornerRadius),
    ...motionCornerOverrides(visual),
    fills: visual.fillColor ? replaceFirstSolidFill(node.fills, visual.fillColor) : node.fills,
    strokes: motionStrokes(node, visual),
    effects: motionEffects(node, visual),
    itemSpacing: motionMainAxisGap(node, visual),
    counterAxisSpacing: motionCounterAxisGap(node, visual),
    paddingTop: valueOr(visual.paddingTop, node.paddingTop),
    paddingRight: valueOr(visual.paddingRight, node.paddingRight),
    paddingBottom: valueOr(visual.paddingBottom, node.paddingBottom),
    paddingLeft: valueOr(visual.paddingLeft, node.paddingLeft)
  }
  return projectMotionAdvancedChannels(projectedNode, visual).node
}
function renderNodeContent(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  node: SceneNode,
  nodeId: string,
  overlays: RenderOverlays
): void {
  if (node.type === 'SECTION') {
    r.renderSection(canvas, node, graph)
  } else if (node.type === 'COMPONENT_SET') {
    r.renderComponentSet(canvas, node, graph)
  } else if (node.type === 'BOOLEAN_OPERATION') {
    renderBooleanOperation(r, canvas, node, graph)
  } else {
    r.renderShape(canvas, node, graph)
  }

  if (overlays.editingTextId === nodeId && overlays.textEditor?.state?.paragraph) {
    r.drawTextEditOverlay(canvas, node, overlays.textEditor)
  }

  if (overlays.dropTargetId === nodeId) {
    r.auxStroke.setStrokeWidth(DROP_HIGHLIGHT_STROKE / r.zoom)
    r.auxStroke.setColor(r.selColor(DROP_HIGHLIGHT_ALPHA))
    canvas.drawRect(r.ck.LTRBRect(0, 0, node.width, node.height), r.auxStroke)
  }
}

function renderMaskNodeContent(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  node: SceneNode,
  nodeId: string,
  overlays: RenderOverlays
): void {
  const authoredNode = node
  node = motionLayoutNode(authoredNode, overlays)
  const visual = motionVisual(overlays, nodeId)
  const renderedNode = motionNode(node, visual)
  const opacity = Math.min(1, Math.max(0, renderedNode.opacity * visual.opacity))
  canvas.save()
  canvas.translate(node.x + visual.x, node.y + visual.y)
  if (opacity < 1) {
    r.opacityPaint.setAlphaf(opacity)
    r.opacityPaint.setBlendMode(r.ck.BlendMode.SrcOver)
    canvas.saveLayer(r.opacityPaint, null)
  }
  applyNodeTransforms(r, canvas, renderedNode, nodeId, overlays, visual)
  applyIntrinsicGeometryScale(canvas, authoredNode, renderedNode)
  renderNodeContent(r, canvas, graph, renderedNode, nodeId, {})
  if (opacity < 1) {
    canvas.restore()
    r.opacityPaint.setAlphaf(1)
  }
  canvas.restore()
}

function applyIntrinsicGeometryScale(
  canvas: Canvas,
  authoredNode: SceneNode,
  renderedNode: SceneNode
): void {
  if (authoredNode.type !== 'VECTOR' && authoredNode.type !== 'BOOLEAN_OPERATION') return
  const scaleX = authoredNode.width === 0 ? 1 : renderedNode.width / authoredNode.width
  const scaleY = authoredNode.height === 0 ? 1 : renderedNode.height / authoredNode.height
  // Layout-derived FILL/stretch dimensions are just as visual as dimensions
  // authored directly on the animated child. Comparing the projected node to
  // the source covers both routes without mutating intrinsic path geometry.
  if (scaleX === 1 && scaleY === 1) return
  canvas.scale(scaleX, scaleY)
}

function motionBounds(node: SceneNode, overlays: RenderOverlays): Rect {
  node = motionLayoutNode(node, overlays)
  const visual = motionVisual(overlays, node.id)
  const renderedNode = motionNode(node, visual)
  const width = renderedNode.width * Math.abs(visual.scaleX)
  const height = renderedNode.height * Math.abs(visual.scaleY)
  const centerX = node.x + visual.x + renderedNode.width / 2
  const centerY = node.y + visual.y + renderedNode.height / 2
  if (node.rotation + visual.rotate !== 0) {
    const diagonal = Math.hypot(width, height)
    return {
      x: centerX - diagonal / 2,
      y: centerY - diagonal / 2,
      width: diagonal,
      height: diagonal
    }
  }
  return { x: centerX - width / 2, y: centerY - height / 2, width, height }
}

function renderChildIds(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  childIds: string[],
  overlays: RenderOverlays,
  absX: number,
  absY: number,
  ancestorHasMotionTransform: boolean
): void {
  renderMaskedChildIds(
    r,
    canvas,
    childIds,
    (childId) => {
      const child = graph.getNode(childId)
      return child?.visible && child.isMask ? child.maskType : null
    },
    (childId) =>
      r.renderNode(canvas, graph, childId, overlays, absX, absY, ancestorHasMotionTransform),
    (childId) => {
      const child = graph.getNode(childId)
      if (child) renderMaskNodeContent(r, canvas, graph, child, childId, overlays)
    },
    (childId) => {
      const child = graph.getNode(childId)
      if (!child) return null
      return motionBounds(child, overlays)
    }
  )
}

function renderChildren(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  node: SceneNode,
  overlays: RenderOverlays,
  absX: number,
  absY: number,
  ancestorHasMotionTransform: boolean
): void {
  if (node.type === 'BOOLEAN_OPERATION') return
  const isClippableContainer =
    node.type === 'FRAME' ||
    node.type === 'COMPONENT' ||
    node.type === 'INSTANCE' ||
    node.type === 'FORM' ||
    node.type === 'LIST'
  if (isClippableContainer && node.clipsContent && node.childIds.length > 0) {
    canvas.save()
    if (nodeHasSmoothCorners(node)) {
      const clipPath = makeSmoothRRectPath(r, node)
      canvas.clipPath(clipPath, r.ck.ClipOp.Intersect, true)
      clipPath.delete()
    } else if (nodeHasRadius(node)) {
      canvas.clipRRect(r.makeRRect(node), r.ck.ClipOp.Intersect, true)
    } else {
      canvas.clipRect(r.ck.LTRBRect(0, 0, node.width, node.height), r.ck.ClipOp.Intersect, true)
    }
    renderChildIds(
      r,
      canvas,
      graph,
      node.childIds,
      overlays,
      absX,
      absY,
      ancestorHasMotionTransform
    )
    canvas.restore()
  } else {
    renderChildIds(
      r,
      canvas,
      graph,
      node.childIds,
      overlays,
      absX,
      absY,
      ancestorHasMotionTransform
    )
  }
}

function beginNodeOpacityLayer(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  node: SceneNode,
  nodeId: string,
  overlays: RenderOverlays,
  visual: MotionVisualState
): boolean {
  const effectiveOpacity = Math.min(1, Math.max(0, node.opacity * visual.opacity))
  const needsLayer = effectiveOpacity < 1 || needsIsolatedBlendLayer(node.blendMode)
  if (!needsLayer) return false

  const bounds = computeDescendantVisualBounds(
    [nodeId],
    (id) => graph.getNode(id) ?? undefined,
    (id) => graph.getAbsolutePosition(id)
  )
  // Only this subtree can invalidate the authored compositing bounds. Motion elsewhere
  // on the canvas must not turn every isolated layer into an unbounded saveLayer.
  const hasAnimatedGeometry = subtreeHasMotionGeometry(graph, nodeId, overlays)
  const authoredPosition = graph.getAbsolutePosition(nodeId)
  let layerBounds: Parameters<Canvas['saveLayer']>[1]
  if (hasAnimatedGeometry) {
    layerBounds = null
  } else if (bounds) {
    layerBounds = r.ck.LTRBRect(
      bounds.minX - authoredPosition.x,
      bounds.minY - authoredPosition.y,
      bounds.maxX - authoredPosition.x,
      bounds.maxY - authoredPosition.y
    )
  } else {
    layerBounds = r.ck.LTRBRect(0, 0, node.width, node.height)
  }
  r.opacityPaint.setAlphaf(effectiveOpacity)
  r.opacityPaint.setBlendMode(figmaBlendModeToSkia(r.ck, node.blendMode))
  canvas.saveLayer(r.opacityPaint, layerBounds)
  return true
}

function endNodeOpacityLayer(r: SkiaRenderer, canvas: Canvas, active: boolean): void {
  if (!active) return
  canvas.restore()
  r.opacityPaint.setAlphaf(1)
  r.opacityPaint.setBlendMode(r.ck.BlendMode.SrcOver)
}

function beginNodeBlurLayer(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  node: SceneNode,
  nodeId: string,
  overlays: RenderOverlays
): boolean {
  const layerBlur = node.effects.find(
    (effect) =>
      effect.visible && (effect.type === 'LAYER_BLUR' || effect.type === 'FOREGROUND_BLUR')
  )
  if (!layerBlur) return false

  r.effectLayerPaint.setImageFilter(null)
  r.effectLayerPaint.setColorFilter(null)
  r.effectLayerPaint.setBlendMode(r.ck.BlendMode.SrcOver)
  r.effectLayerPaint.setImageFilter(r.getCachedBlur(layerBlur.radius / 2))
  const blurPadding = layerBlur.radius * 2
  const blurBounds = subtreeHasMotionGeometry(graph, nodeId, overlays)
    ? null
    : r.ck.LTRBRect(-blurPadding, -blurPadding, node.width + blurPadding, node.height + blurPadding)
  canvas.saveLayer(r.effectLayerPaint, blurBounds)
  return true
}

function endNodeBlurLayer(r: SkiaRenderer, canvas: Canvas, active: boolean): void {
  if (!active) return
  canvas.restore()
  r.effectLayerPaint.setImageFilter(null)
  r.effectLayerPaint.setColorFilter(null)
  r.effectLayerPaint.setBlendMode(r.ck.BlendMode.SrcOver)
}

export function renderNode(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  nodeId: string,
  overlays: RenderOverlays,
  parentAbsX = 0,
  parentAbsY = 0,
  ancestorHasMotionTransform = false
): void {
  const authoredNode = graph.getNode(nodeId)
  if (
    !authoredNode ||
    authoredNode.internalOnly ||
    !authoredNode.visible ||
    authoredNode.isMask ||
    fontManager.isNodeBlocked(nodeId)
  ) {
    return
  }
  const node = motionLayoutNode(authoredNode, overlays)

  // Hide the node being edited in node-edit mode (overlay draws it live)
  if (overlays.nodeEditState?.nodeId === nodeId) return

  r._nodeCount++

  const visual = motionVisual(overlays, nodeId)
  const renderedNode = motionNode(node, visual)
  const absX = parentAbsX + node.x + visual.x
  const absY = parentAbsY + node.y + visual.y

  if (!ancestorHasMotionTransform && isCulled(r, renderedNode, absX, absY, visual)) {
    r._culledCount++
    return
  }

  canvas.save()
  canvas.translate(node.x + visual.x, node.y + visual.y)

  const hasNodeLayer = beginNodeOpacityLayer(
    r,
    canvas,
    graph,
    renderedNode,
    nodeId,
    overlays,
    visual
  )
  const hasBlurLayer = beginNodeBlurLayer(r, canvas, graph, renderedNode, nodeId, overlays)

  applyNodeTransforms(r, canvas, renderedNode, nodeId, overlays, visual)
  applyIntrinsicGeometryScale(canvas, authoredNode, renderedNode)
  renderNodeContent(r, canvas, graph, renderedNode, nodeId, overlays)
  drawLayoutGrids(r, canvas, renderedNode)
  renderChildren(
    r,
    canvas,
    graph,
    renderedNode,
    overlays,
    absX,
    absY,
    ancestorHasMotionTransform || hasMotionScaleOrRotation(visual)
  )
  drawGeneratedEffect(r, canvas, renderedNode, overlays)

  endNodeBlurLayer(r, canvas, hasBlurLayer)
  endNodeOpacityLayer(r, canvas, hasNodeLayer)
  canvas.restore()
}

function makeNodeRRect(r: SkiaRenderer, node: SceneNode, radius: number): Float32Array {
  const rect = r.ck.LTRBRect(0, 0, node.width, node.height)
  return r.ck.RRectXY(rect, radius, radius)
}

function forVisibleStrokes(
  r: SkiaRenderer,
  node: SceneNode,
  graph: SceneGraph,
  draw: (stroke: SceneNode['strokes'][number], color: Color) => void
): void {
  for (let index = 0; index < node.strokes.length; index++) {
    const stroke = node.strokes[index]
    if (!stroke.visible) continue
    draw(stroke, r.resolveStrokeColor(stroke, index, node, graph))
  }
}

export function renderSection(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph: SceneGraph
): void {
  const rrect = makeNodeRRect(r, node, SECTION_CORNER_RADIUS)

  drawVisibleFills(r, node, graph, () => canvas.drawRRect(rrect, r.fillPaint))

  forVisibleStrokes(r, node, graph, (stroke, color) => {
    configureStrokePaint(r, node, stroke, color)

    if (node.independentStrokeWeights) r.drawIndividualSideStrokes(canvas, node, stroke.align)
    else r.drawRRectStrokeWithAlign(canvas, rrect, node, stroke)
  })
}

export function renderComponentSet(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph: SceneGraph
): void {
  const rrect = makeNodeRRect(r, node, 5)

  drawVisibleFills(r, node, graph, () => canvas.drawRRect(rrect, r.fillPaint))

  const visibleStrokes = node.strokes.filter((stroke) => stroke.visible)
  if (visibleStrokes.length > 0) {
    forVisibleStrokes(r, node, graph, (stroke, color) => {
      const dashPhase = stroke.dashPattern?.[1] ?? 0
      if (stroke.dashPattern && stroke.dashPattern.length > 0) {
        drawDashedRRectWithSolidCorners(r, canvas, node, stroke, color, 5, dashPhase)
      } else {
        drawStyledRRectStroke(r, canvas, rrect, node, stroke, color, dashPhase)
      }
    })
    return
  }

  r.auxStroke.setStrokeWidth(r.COMPONENT_SET_BORDER_WIDTH / r.zoom)
  r.auxStroke.setColor(r.compColor())
  r.auxStroke.setPathEffect(
    r.ck.PathEffect.MakeDash([r.COMPONENT_SET_DASH / r.zoom, r.COMPONENT_SET_DASH_GAP / r.zoom], 0)
  )
  canvas.drawRRect(rrect, r.auxStroke)
  r.auxStroke.setPathEffect(null)
}

export function renderShape(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph: SceneGraph
): void {
  const authoredNode = graph.getNode(node.id)
  const hasProjectedVectorNetwork =
    node.type === 'VECTOR' &&
    authoredNode?.vectorNetwork !== undefined &&
    authoredNode.vectorNetwork !== node.vectorNetwork
  if (hasProjectedVectorNetwork) r.invalidateVectorPath(node.id)
  const hasEffects = node.effects.length > 0 && node.effects.some((e) => e.visible)
  const isMotionProjection = authoredNode !== node

  try {
    if (hasEffects && !isMotionProjection) {
      const cached = r.nodePictureCache.get(node.id)
      const cachedGeneration = r.nodePictureCacheGenerations.get(node.id)
      if (cached && cachedGeneration === r.fontGeneration) {
        canvas.drawPicture(cached)
        return
      }
      if (cached) cached.delete()
      r.nodePictureCache.delete(node.id)
      r.nodePictureCacheGenerations.delete(node.id)

      const margin = r.effectOverflow(node)
      const bounds = r.ck.LTRBRect(-margin, -margin, node.width + margin, node.height + margin)
      const recorder = new r.ck.PictureRecorder()
      const recCanvas = recorder.beginRecording(bounds)
      r.renderShapeUncached(recCanvas, node, graph)
      const picture = recorder.finishRecordingAsPicture()
      recorder.delete()
      r.nodePictureCache.set(node.id, picture)
      r.nodePictureCacheGenerations.set(node.id, r.fontGeneration)
      canvas.drawPicture(picture)
    } else {
      r.renderShapeUncached(canvas, node, graph)
    }
  } finally {
    // Projected vertices change every frame. Keep cache ownership bounded and
    // prevent the last preview/export frame from leaking into static rendering.
    if (hasProjectedVectorNetwork) r.invalidateVectorPath(node.id)
  }
}

function getShadowShapeChild(node: SceneNode, graph: SceneGraph): SceneNode | null {
  if (node.fills.some((f) => f.visible)) return null
  if (node.strokes.some((stroke) => stroke.visible)) return null
  if (node.childIds.length === 0) return null
  const child = graph.getNode(node.childIds[0])
  if (!child?.visible) return null
  return child
}

function drawVectorStrokeGeometry(
  r: SkiaRenderer,
  canvas: Canvas,
  sg: Path[],
  sc: Color,
  opacity: number
): void {
  r.fillPaint.setColor(r.ck.Color4f(sc.r, sc.g, sc.b, sc.a))
  r.fillPaint.setAlphaf(opacity)
  r.fillPaint.setShader(null)
  for (const p of sg) canvas.drawPath(p, r.fillPaint)
}

function vectorStrokePaths(r: SkiaRenderer, node: SceneNode): Path[] | null {
  if (!node.vectorNetwork) return null
  const cached = r.vectorStrokePathCache.get(node.id)
  if (cached) return cached

  const paths: Path[] = []
  for (const segment of node.vectorNetwork.segments) {
    const start = node.vectorNetwork.vertices[segment.start]
    const end = node.vectorNetwork.vertices[segment.end]

    const path = new r.ck.Path()
    path.moveTo(start.x, start.y)
    const isStraight =
      Math.abs(segment.tangentStart.x) < 0.001 &&
      Math.abs(segment.tangentStart.y) < 0.001 &&
      Math.abs(segment.tangentEnd.x) < 0.001 &&
      Math.abs(segment.tangentEnd.y) < 0.001
    if (isStraight) {
      path.lineTo(end.x, end.y)
    } else {
      path.cubicTo(
        start.x + segment.tangentStart.x,
        start.y + segment.tangentStart.y,
        end.x + segment.tangentEnd.x,
        end.y + segment.tangentEnd.y,
        end.x,
        end.y
      )
    }
    paths.push(path)
  }

  if (paths.length === 0) return null
  r.vectorStrokePathCache.set(node.id, paths)
  return paths
}

function drawVectorPathStrokes(
  r: SkiaRenderer,
  canvas: Canvas,
  vectorPaths: Path[],
  stroke: SceneNode['strokes'][0],
  sc: Color,
  miterLimit: number,
  outlineCacheKey?: string,
  dashPhase = 0,
  projectedNode?: SceneNode
): void {
  const trim = projectedNode ? motionTrimProjection(projectedNode) : undefined
  const dash = stroke.dashPattern
  if (trim) {
    drawTrimmedVectorPaths(r, canvas, vectorPaths, stroke, sc, miterLimit, trim)
    return
  }
  if (dash && dash.length > 0) {
    drawDashedVectorPaths(r, canvas, vectorPaths, stroke, sc, miterLimit, dash, dashPhase)
    return
  }
  drawVectorStrokeOutlines(r, canvas, vectorPaths, stroke, sc, miterLimit, outlineCacheKey)
}

function configureVectorStrokePaint(
  r: SkiaRenderer,
  stroke: SceneNode['strokes'][0],
  color: Color,
  miterLimit: number
): void {
  r.strokePaint.setColor(r.ck.Color4f(color.r, color.g, color.b, color.a))
  r.strokePaint.setAlphaf(stroke.opacity)
  r.strokePaint.setStrokeWidth(stroke.weight)
  r.strokePaint.setStrokeCap(getStrokeCapEntity(r, stroke.cap ?? 'NONE'))
  r.strokePaint.setStrokeJoin(getStrokeJoinEntity(r, stroke.join ?? 'MITER'))
  r.strokePaint.setStrokeMiter(miterLimit)
  r.strokePaint.setShader(null)
}

function drawTrimmedVectorPaths(
  r: SkiaRenderer,
  canvas: Canvas,
  vectorPaths: Path[],
  stroke: SceneNode['strokes'][0],
  color: Color,
  miterLimit: number,
  trim: NonNullable<ReturnType<typeof motionTrimProjection>>
): void {
  configureVectorStrokePaint(r, stroke, color, miterLimit)
  if (trim.visibleFraction >= 1 - 1e-6) {
    r.strokePaint.setPathEffect(null)
    for (const path of vectorPaths) canvas.drawPath(path, r.strokePaint)
    return
  }
  // SVG pathLength normalization restarts trim for every emitted geometry.
  // Mirror that contract by measuring and dashing each CanvasKit Path
  // independently rather than sharing one aggregate length across siblings.
  for (const path of vectorPaths) {
    const length = measurePathLength(r.ck, [path])
    const effect = r.ck.PathEffect.MakeDash(
      [trim.visibleFraction * length, (1 - trim.visibleFraction) * length],
      -trim.phase * length
    )
    r.strokePaint.setPathEffect(effect)
    try {
      canvas.drawPath(path, r.strokePaint)
    } finally {
      r.strokePaint.setPathEffect(null)
      effect.delete()
    }
  }
}

function drawDashedVectorPaths(
  r: SkiaRenderer,
  canvas: Canvas,
  vectorPaths: Path[],
  stroke: SceneNode['strokes'][0],
  color: Color,
  miterLimit: number,
  dash: readonly number[],
  dashPhase: number
): void {
  configureVectorStrokePaint(r, stroke, color, miterLimit)
  const effect = r.ck.PathEffect.MakeDash([...dash], dashPhase)
  r.strokePaint.setPathEffect(effect)
  try {
    for (const path of vectorPaths) canvas.drawPath(path, r.strokePaint)
  } finally {
    r.strokePaint.setPathEffect(null)
    effect.delete()
  }
}

function drawVectorStrokeOutlines(
  r: SkiaRenderer,
  canvas: Canvas,
  vectorPaths: Path[],
  stroke: SceneNode['strokes'][0],
  color: Color,
  miterLimit: number,
  outlineCacheKey: string | undefined
): void {
  const strokeOpts = {
    width: stroke.weight,
    miter_limit: miterLimit,
    cap: getStrokeCapEntity(r, stroke.cap ?? 'NONE'),
    join: getStrokeJoinEntity(r, stroke.join ?? 'MITER')
  }
  r.fillPaint.setColor(r.ck.Color4f(color.r, color.g, color.b, color.a))
  r.fillPaint.setAlphaf(stroke.opacity)
  r.fillPaint.setShader(null)

  let outlines = outlineCacheKey ? r.vectorStrokeOutlineCache.get(outlineCacheKey) : undefined
  if (!outlines) {
    outlines = []
    for (const vp of vectorPaths) {
      const outline = vp.copy().stroke(strokeOpts)
      if (outline) outlines.push(outline)
    }
    if (outlineCacheKey) r.vectorStrokeOutlineCache.set(outlineCacheKey, outlines)
  }
  for (const outline of outlines) canvas.drawPath(outline, r.fillPaint)
}

function dynamicVectorStrokePaths(
  node: SceneNode,
  vectorPaths: Path[] | null,
  vectorStroke: Path[] | null
): Path[] | null {
  if (node.type !== 'VECTOR' || !hasMotionDynamicStroke(node)) return null
  return vectorPaths ?? vectorStroke
}

function isVectorCenterlineStroke(
  node: SceneNode,
  stroke: SceneNode['strokes'][0],
  vectorStroke: Path[] | null
): vectorStroke is Path[] {
  return Boolean(
    vectorStroke &&
    stroke.align === 'CENTER' &&
    node.cornerRadius === 0 &&
    node.type === 'VECTOR' &&
    !node.fills.some((fill) => fill.visible)
  )
}

function drawRegularStroke(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  rect: Float32Array,
  hasRadius: boolean,
  stroke: SceneNode['strokes'][0],
  sc: Color
): void {
  configureStrokePaint(r, node, stroke, sc)
  if (stroke.dashPattern && stroke.dashPattern.length > 0) {
    r.strokePaint.setPathEffect(r.ck.PathEffect.MakeDash(stroke.dashPattern, motionDashPhase(node)))
  } else {
    r.strokePaint.setPathEffect(null)
  }

  if (node.independentStrokeWeights && r.isRectangularType(node.type)) {
    r.drawIndividualSideStrokes(canvas, node, stroke.align)
  } else {
    r.drawStrokeWithAlign(canvas, node, rect, hasRadius, stroke.align)
  }
}

function drawNodeStroke(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  rect: Float32Array,
  hasRadius: boolean,
  stroke: SceneNode['strokes'][0],
  sc: Color,
  sg: Path[] | null,
  vectorPaths: Path[] | null,
  vectorStroke: Path[] | null
): void {
  const motionPaths = dynamicVectorStrokePaths(node, vectorPaths, vectorStroke)
  if (motionPaths) {
    // `getVectorPaths` groups paths the same way as SVG geometry emission
    // (one per region / imported geometry, one aggregate open-network path).
    // Keep trim reset boundaries identical across Canvas and compiled SVG.
    drawVectorPathStrokes(
      r,
      canvas,
      motionPaths,
      stroke,
      sc,
      node.strokeMiterLimit,
      undefined,
      motionDashPhase(node),
      node
    )
    return
  }
  if (isVectorCenterlineStroke(node, stroke, vectorStroke)) {
    const outlineKey = `${node.id}|${stroke.weight}|${stroke.cap ?? node.strokeCap}|${stroke.join ?? node.strokeJoin}|${node.strokeMiterLimit}`
    drawVectorPathStrokes(
      r,
      canvas,
      vectorStroke,
      stroke,
      sc,
      node.strokeMiterLimit,
      outlineKey,
      motionDashPhase(node),
      node
    )
    return
  }
  if (!sg) {
    if (vectorPaths) {
      drawVectorPathStrokes(
        r,
        canvas,
        vectorPaths,
        stroke,
        sc,
        node.strokeMiterLimit,
        undefined,
        motionDashPhase(node),
        node
      )
    } else drawRegularStroke(r, canvas, node, rect, hasRadius, stroke, sc)
    return
  }
  if (stroke.align !== 'INSIDE') {
    if (node.type === 'VECTOR') drawVectorStrokeGeometry(r, canvas, sg, sc, stroke.opacity)
    else drawRegularStroke(r, canvas, node, rect, hasRadius, stroke, sc)
    return
  }

  const clipPaths = node.type === 'VECTOR' ? r.getFillGeometry(node) : null
  if (node.type === 'VECTOR' && !clipPaths) {
    drawVectorStrokeGeometry(r, canvas, sg, sc, stroke.opacity)
    return
  }

  canvas.save()
  if (clipPaths) {
    for (const path of clipPaths) canvas.clipPath(path, r.ck.ClipOp.Intersect, true)
  } else {
    r.clipNodeShape(canvas, node, rect, hasRadius)
  }
  drawVectorStrokeGeometry(r, canvas, sg, sc, stroke.opacity)
  canvas.restore()
}

export function renderShapeUncached(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph: SceneGraph
): void {
  const rect = r.ck.LTRBRect(0, 0, node.width, node.height)
  const hasRadius = nodeHasRadius(node)

  const shadowChild = getShadowShapeChild(node, graph)
  r.renderEffects(canvas, node, rect, hasRadius, 'behind', shadowChild)

  if (!drawVectorMultiStyleFills(r, canvas, node, graph)) {
    drawVisibleFills(r, node, graph, (fill) => r.drawNodeFill(canvas, node, rect, hasRadius, fill))
  }

  const sg = node.strokeGeometry.length > 0 ? r.getStrokeGeometry(node) : null
  const vectorPaths = node.type === 'VECTOR' ? r.getVectorPaths(node) : null
  const vectorStroke = node.type === 'VECTOR' ? vectorStrokePaths(r, node) : null
  forVisibleStrokes(r, node, graph, (stroke, color) => {
    if (
      stroke.dashPattern &&
      stroke.dashPattern.length > 0 &&
      node.type === 'VECTOR' &&
      node.vectorNetwork &&
      !motionTrimProjection(node)
    ) {
      const centerline = vectorNetworkToCenterlinePath(r.ck, node.vectorNetwork)
      drawVectorPathStrokes(
        r,
        canvas,
        [centerline],
        stroke,
        color,
        node.strokeMiterLimit,
        undefined,
        motionDashPhase(node),
        node
      )
      centerline.delete()
      return
    }
    drawNodeStroke(r, canvas, node, rect, hasRadius, stroke, color, sg, vectorPaths, vectorStroke)
  })
  r.renderEffects(canvas, node, rect, hasRadius, 'front', shadowChild)
  if (node.type === 'BUTTON') renderButtonLabel(r, canvas, node)
  if (node.type === 'INPUT' || node.type === 'TEXTAREA') renderTextInputContent(r, canvas, node)
}

function isGradientFill(fill?: Fill): boolean {
  return fill?.type.startsWith('GRADIENT') === true
}

function shouldRenderTextAsOutline(fill?: Fill): boolean {
  return fill !== undefined && fill.type !== 'SOLID'
}

export function textVerticalOffset(node: SceneNode, contentHeight: number): number {
  const available = Math.max(0, node.height - contentHeight)
  if (node.textAlignVertical === 'CENTER') return available / 2
  if (node.textAlignVertical === 'BOTTOM') return available
  return 0
}

function drawOutlinedText(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  paragraphY: number
): boolean {
  const outlineNode =
    node.textCase === 'ORIGINAL'
      ? node
      : { ...node, text: transformTextCase(node.text, node.textCase), styleRuns: [] }
  const path = textNodeToOutlinePath(r, outlineNode)
  if (!path) return false
  canvas.save()
  canvas.translate(0, paragraphY)
  canvas.drawPath(path, r.fillPaint)
  canvas.restore()
  path.delete()
  return true
}

function drawGradientText(r: SkiaRenderer, canvas: Canvas, node: SceneNode): boolean {
  if (!r.fontsLoaded || !r.fontProvider) return false

  const paragraph = r.buildParagraph(node, r.ck.Color4f(0, 0, 0, 1), {
    halfLeading: true
  })
  try {
    const paragraphY = textVerticalOffset(node, paragraph.getHeight())
    r.effectLayerPaint.setImageFilter(null)
    r.effectLayerPaint.setColorFilter(null)
    r.effectLayerPaint.setBlendMode(r.ck.BlendMode.SrcOver)
    const bounds = r.ck.LTRBRect(0, paragraphY, node.width, paragraphY + node.height)
    canvas.saveLayer(r.effectLayerPaint, bounds)
    canvas.drawParagraph(paragraph, 0, paragraphY)

    r.effectLayerPaint.setBlendMode(r.ck.BlendMode.SrcIn)
    canvas.saveLayer(r.effectLayerPaint, bounds)
    canvas.drawRect(r.ck.LTRBRect(0, 0, node.width, node.height), r.fillPaint)
    canvas.restore()
    canvas.restore()
    return true
  } finally {
    paragraph.delete()
    r.effectLayerPaint.setImageFilter(null)
    r.effectLayerPaint.setColorFilter(null)
    r.effectLayerPaint.setBlendMode(r.ck.BlendMode.SrcOver)
  }
}

export function renderText(r: SkiaRenderer, canvas: Canvas, node: SceneNode, fill?: Fill): void {
  const text = node.text
  if (!text) return

  canvas.save()
  const shouldClipText = node.textAutoResize === 'NONE' || node.textAutoResize === 'TRUNCATE'
  if (shouldClipText) {
    canvas.clipRect(r.ck.LTRBRect(0, 0, node.width, node.height), r.ck.ClipOp.Intersect, false)
  }

  const fontReadiness = r.nodeFontReadiness(node)
  if (fontReadiness !== 'ready') {
    if (fontReadiness === 'exhausted') {
      if (node.textPicture && r.isTextPictureCurrent(node)) {
        const pic = r.ck.MakePicture(node.textPicture)
        if (pic) {
          canvas.drawPicture(pic)
          pic.delete()
          canvas.restore()
          return
        }
      }
      if (drawFigmaDerivedText(r, canvas, node)) {
        canvas.restore()
        return
      }
    }
    canvas.restore()
    return
  }
  if (shouldRenderTextAsOutline(fill)) {
    let paragraphY = 0
    if (node.textAlignVertical !== 'TOP') {
      const paragraph = r.buildParagraph(node, r.ck.Color4f(0, 0, 0, 1), {
        halfLeading: true
      })
      paragraphY = textVerticalOffset(node, paragraph.getHeight())
      paragraph.delete()
    }
    if (drawOutlinedText(r, canvas, node, paragraphY)) {
      canvas.restore()
      return
    }
  }
  if (isGradientFill(fill) && drawGradientText(r, canvas, node)) {
    canvas.restore()
    return
  }
  if (r.fontsLoaded && r.fontProvider) {
    const paragraph = r.buildParagraph(node, r.fillPaint.getColor(), {
      halfLeading: true
    })
    const paragraphY = textVerticalOffset(node, paragraph.getHeight())
    canvas.drawParagraph(paragraph, 0, paragraphY)
    paragraph.delete()
  } else if (r.textFont) {
    const fontSize = node.fontSize || r.DEFAULT_FONT_SIZE
    const paragraphY = textVerticalOffset(node, fontSize)
    canvas.drawText(
      transformTextCase(text, node.textCase),
      0,
      paragraphY + fontSize,
      r.fillPaint,
      r.textFont
    )
  }

  canvas.restore()
}
