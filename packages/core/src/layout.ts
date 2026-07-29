import {
  Align,
  Direction,
  Display,
  FlexDirection,
  Gutter,
  Edge,
  MeasureMode,
  Overflow,
  Wrap,
  type Node as YogaNode
} from 'yoga-layout'

import { applyYogaLayout } from './layout/apply'
import type { LayoutGraph } from './layout/graph'
import { buildGridTree, createGridChildNode } from './layout/grid'
import { resolveNodeLayoutDirection } from './text/direction'
export {
  estimateTextSize,
  getTextMeasurer,
  setTextMeasurer,
  type TextMeasurer
} from './layout/text-measurement'
import { isAutoLayoutMode, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { estimateTextSize, getTextMeasurer } from './layout/text-measurement'
import {
  applyMinMaxConstraints,
  configureAbsoluteChild,
  createYogaNode,
  freeYogaTree,
  mapAlign,
  mapAlignSelf,
  mapGridTrack,
  mapJustify
} from './layout/yoga-helpers'
import type { MotionVisualState } from './motion'

export function computeLayout(graph: LayoutGraph, frameId: string): void {
  const frame = graph.getNode(frameId)
  if (!frame || !isAutoLayoutMode(frame.layoutMode)) return

  const rootDirection = resolveComputedLayoutDirection(graph, frame)
  const yogaRoot =
    frame.layoutMode === 'GRID'
      ? buildGridTree(graph, frame, rootDirection)
      : buildYogaTree(graph, frame, rootDirection)
  yogaRoot.calculateLayout(
    undefined,
    undefined,
    rootDirection === 'RTL' ? Direction.RTL : Direction.LTR
  )
  applyYogaLayout(graph, frame, yogaRoot, computeLayout)
  freeYogaTree(yogaRoot)
}

function resolveComputedLayoutDirection(
  graph: LayoutGraph,
  node: Pick<SceneNode, 'layoutDirection' | 'parentId'>
): 'LTR' | 'RTL' {
  const parent = node.parentId ? graph.getNode(node.parentId) : null
  const inheritedDirection = parent ? resolveComputedLayoutDirection(graph, parent) : 'LTR'
  return resolveNodeLayoutDirection(node, inheritedDirection)
}

export function computeAllLayouts(graph: SceneGraph, scopeId?: string): void {
  const visited = new Set<string>()
  computeLayoutsBottomUp(graph, scopeId ?? graph.rootId, visited)
}

export type MotionLayoutPreviewNode = Pick<SceneNode, 'x' | 'y' | 'width' | 'height'>

/**
 * Compute the ephemeral Yoga geometry needed by MotionSpec layout channels.
 * The authored SceneGraph is never mutated: writes are captured by a small
 * copy-on-write graph facade and only the resulting geometry is returned.
 */
export function computeMotionLayoutPreview(
  graph: SceneGraph,
  visuals: ReadonlyMap<string, MotionVisualState> | undefined
): ReadonlyMap<string, MotionLayoutPreviewNode> {
  if (!visuals || visuals.size === 0) return new Map()

  const preview = new MotionLayoutPreviewGraph(graph)
  const roots = new Set<string>()
  for (const [nodeId, visual] of visuals) {
    if (!hasMotionLayoutGeometry(visual)) continue
    const node = graph.getNode(nodeId)
    if (!node) continue
    preview.project(node, visual)
    const root = motionLayoutRoot(graph, node)
    if (root) roots.add(root.id)
  }
  if (roots.size === 0) return new Map()

  for (const rootId of roots) preview.clearDerivedLayout(rootId)
  for (const rootId of roots) computeLayout(preview, rootId)
  return preview.geometry()
}

function hasMotionLayoutGeometry(visual: MotionVisualState): boolean {
  return (
    visual.width !== undefined ||
    visual.height !== undefined ||
    visual.gap !== undefined ||
    visual.rowGap !== undefined ||
    visual.columnGap !== undefined ||
    visual.paddingTop !== undefined ||
    visual.paddingRight !== undefined ||
    visual.paddingBottom !== undefined ||
    visual.paddingLeft !== undefined
  )
}

function motionLayoutRoot(graph: SceneGraph, node: SceneNode): SceneNode | undefined {
  let current: SceneNode | undefined
  if (isAutoLayoutMode(node.layoutMode)) current = node
  else if (node.layoutPositioning !== 'ABSOLUTE' && node.parentId) {
    current = graph.getNode(node.parentId)
  }
  if (!current || !isAutoLayoutMode(current.layoutMode)) return undefined

  while (current.parentId && current.layoutPositioning !== 'ABSOLUTE') {
    const parent = graph.getNode(current.parentId)
    if (!parent || !isAutoLayoutMode(parent.layoutMode)) break
    current = parent
  }
  return current
}

class MotionLayoutPreviewGraph {
  private readonly changed = new Map<string, SceneNode>()

  constructor(private readonly source: SceneGraph) {}

  getNode(id: string): SceneNode | undefined {
    return this.changed.get(id) ?? this.source.getNode(id)
  }

  getChildren(id: string): SceneNode[] {
    const node = this.getNode(id)
    return node ? node.childIds.flatMap((childId) => this.getNode(childId) ?? []) : []
  }

  updateNode(id: string, changes: Partial<SceneNode>): void {
    const node = this.mutable(id)
    if (node) Object.assign(node, changes)
  }

  project(node: SceneNode, visual: MotionVisualState): void {
    const projected = this.mutable(node.id)
    if (!projected) return
    projectMotionDimensions(projected, visual, this.parentOf(projected))
    projectMotionTextResize(projected, visual)
    projectMotionGaps(projected, visual)
    projectMotionPadding(projected, visual)
  }

  clearDerivedLayout(rootId: string): void {
    const stack = [rootId]
    while (stack.length > 0) {
      const nodeId = stack.pop()
      if (!nodeId) continue
      const node = this.mutable(nodeId)
      if (!node) continue
      node.figmaDerivedLayout = null
      if (node.type === 'INSTANCE' && node.source.format === 'fig' && nodeId !== rootId) continue
      stack.push(...node.childIds)
    }
  }

  geometry(): ReadonlyMap<string, MotionLayoutPreviewNode> {
    const result = new Map<string, MotionLayoutPreviewNode>()
    for (const [id, node] of this.changed) {
      const source = this.source.getNode(id)
      if (
        !source ||
        (node.x === source.x &&
          node.y === source.y &&
          node.width === source.width &&
          node.height === source.height)
      ) {
        continue
      }
      result.set(id, { x: node.x, y: node.y, width: node.width, height: node.height })
    }
    return result
  }

  private mutable(id: string): SceneNode | undefined {
    const existing = this.changed.get(id)
    if (existing) return existing
    const source = this.source.getNode(id)
    if (!source) return undefined
    const clone = { ...source }
    this.changed.set(id, clone)
    return clone
  }

  private parentOf(node: SceneNode): SceneNode | undefined {
    return node.parentId ? this.getNode(node.parentId) : undefined
  }
}

function projectMotionDimensions(
  node: SceneNode,
  visual: MotionVisualState,
  parent: SceneNode | undefined
): void {
  if (visual.width !== undefined) {
    node.width = visual.width
    fixAnimatedAxis(node, 'width', parent)
  }
  if (visual.height !== undefined) {
    node.height = visual.height
    fixAnimatedAxis(node, 'height', parent)
  }
}

function projectMotionTextResize(node: SceneNode, visual: MotionVisualState): void {
  if (node.type !== 'TEXT') return
  if (visual.height !== undefined) node.textAutoResize = 'NONE'
  else if (visual.width !== undefined && node.textAutoResize === 'WIDTH_AND_HEIGHT') {
    node.textAutoResize = 'HEIGHT'
  }
}

function projectMotionGaps(node: SceneNode, visual: MotionVisualState): void {
  if (node.layoutMode === 'GRID') {
    node.gridRowGap = visual.rowGap ?? visual.gap ?? node.gridRowGap
    node.gridColumnGap = visual.columnGap ?? visual.gap ?? node.gridColumnGap
    return
  }
  const mainGap = node.layoutMode === 'HORIZONTAL' ? visual.columnGap : visual.rowGap
  const crossGap = node.layoutMode === 'HORIZONTAL' ? visual.rowGap : visual.columnGap
  node.itemSpacing = mainGap ?? visual.gap ?? node.itemSpacing
  node.counterAxisSpacing = crossGap ?? visual.gap ?? node.counterAxisSpacing
}

function projectMotionPadding(node: SceneNode, visual: MotionVisualState): void {
  if (visual.paddingTop !== undefined) node.paddingTop = visual.paddingTop
  if (visual.paddingRight !== undefined) node.paddingRight = visual.paddingRight
  if (visual.paddingBottom !== undefined) node.paddingBottom = visual.paddingBottom
  if (visual.paddingLeft !== undefined) node.paddingLeft = visual.paddingLeft
}

function fixAnimatedAxis(
  node: SceneNode,
  axis: 'width' | 'height',
  parent: SceneNode | undefined
): void {
  if (isAutoLayoutMode(node.layoutMode) && node.layoutMode !== 'GRID') {
    const isPrimary =
      (node.layoutMode === 'HORIZONTAL' && axis === 'width') ||
      (node.layoutMode === 'VERTICAL' && axis === 'height')
    if (isPrimary) node.primaryAxisSizing = 'FIXED'
    else node.counterAxisSizing = 'FIXED'
  }
  if (!parent || !isAutoLayoutMode(parent.layoutMode)) return
  const isParentMain =
    parent.layoutMode === 'GRID' ||
    (parent.layoutMode === 'HORIZONTAL' && axis === 'width') ||
    (parent.layoutMode === 'VERTICAL' && axis === 'height')
  if (isParentMain) node.layoutGrow = 0
  if (parent.layoutMode === 'GRID' || !isParentMain) node.layoutAlignSelf = 'MIN'
}

function computeLayoutsBottomUp(graph: SceneGraph, nodeId: string, visited: Set<string>): void {
  const node = graph.getNode(nodeId)
  if (!node || visited.has(nodeId)) return
  visited.add(nodeId)

  for (const childId of node.childIds) {
    computeLayoutsBottomUp(graph, childId, visited)
  }

  if (isAutoLayoutMode(node.layoutMode) && !preservesImportedInstanceLayout(node)) {
    computeLayout(graph, nodeId)
  }
}

function preservesImportedInstanceLayout(node: SceneNode): boolean {
  return node.type === 'INSTANCE' && node.source.format === 'fig'
}

// --- Flex layout ---

function buildYogaTree(
  graph: LayoutGraph,
  frame: SceneNode,
  inheritedDirection: 'LTR' | 'RTL'
): YogaNode {
  const root = createYogaNode()
  const direction = resolveNodeLayoutDirection(frame, inheritedDirection)

  if (frame.primaryAxisSizing === 'FIXED') {
    if (frame.layoutMode === 'HORIZONTAL') root.setWidth(frame.width)
    else root.setHeight(frame.height)
  }
  if (frame.counterAxisSizing === 'FIXED') {
    if (frame.layoutMode === 'HORIZONTAL') root.setHeight(frame.height)
    else root.setWidth(frame.width)
  }

  configureFlexContainer(root, frame, direction)

  const children = graph.getChildren(frame.id)
  for (const child of children) {
    const yogaChild = createYogaNode()

    if (child.layoutPositioning === 'ABSOLUTE') {
      configureAbsoluteChild(yogaChild, child)
    } else if (!child.visible) {
      yogaChild.setDisplay(Display.None)
    } else if (child.layoutMode === 'GRID') {
      configureChildAsGrid(yogaChild, child, frame, graph, direction)
    } else if (isAutoLayoutMode(child.layoutMode)) {
      configureChildAsAutoLayout(yogaChild, child, frame, graph, direction)
    } else {
      configureChildAsLeaf(yogaChild, child, frame)
    }

    root.insertChild(yogaChild, root.getChildCount())
  }

  return root
}

function configureFlexContainer(
  yogaNode: YogaNode,
  node: SceneNode,
  direction: Exclude<SceneNode['layoutDirection'], 'AUTO'>
): void {
  yogaNode.setDirection(direction === 'RTL' ? Direction.RTL : Direction.LTR)
  yogaNode.setFlexDirection(
    node.layoutMode === 'HORIZONTAL' ? FlexDirection.Row : FlexDirection.Column
  )
  yogaNode.setFlexWrap(node.layoutWrap === 'WRAP' ? Wrap.Wrap : Wrap.NoWrap)
  yogaNode.setJustifyContent(mapJustify(node.primaryAxisAlign))
  yogaNode.setAlignItems(mapAlign(node.counterAxisAlign))
  if (node.clipsContent) yogaNode.setOverflow(Overflow.Hidden)

  if (node.layoutWrap === 'WRAP' && node.counterAxisAlignContent === 'SPACE_BETWEEN') {
    yogaNode.setAlignContent(Align.SpaceBetween)
  }

  yogaNode.setPadding(Edge.Top, node.paddingTop)
  yogaNode.setPadding(Edge.Right, node.paddingRight)
  yogaNode.setPadding(Edge.Bottom, node.paddingBottom)
  yogaNode.setPadding(Edge.Left, node.paddingLeft)

  yogaNode.setGap(
    Gutter.Column,
    node.layoutMode === 'HORIZONTAL' ? node.itemSpacing : node.counterAxisSpacing
  )
  yogaNode.setGap(
    Gutter.Row,
    node.layoutMode === 'HORIZONTAL' ? node.counterAxisSpacing : node.itemSpacing
  )

  applyMinMaxConstraints(yogaNode, node)
}

function configureChildAsGrid(
  yogaChild: YogaNode,
  child: SceneNode,
  parent: SceneNode,
  graph: LayoutGraph,
  inheritedDirection: 'LTR' | 'RTL'
): void {
  const direction = resolveNodeLayoutDirection(child, inheritedDirection)
  yogaChild.setDisplay(Display.Grid)
  yogaChild.setDirection(direction === 'RTL' ? Direction.RTL : Direction.LTR)

  if (child.gridTemplateColumns.length > 0) {
    yogaChild.setGridTemplateColumns(child.gridTemplateColumns.map(mapGridTrack))
  }
  if (child.gridTemplateRows.length > 0) {
    yogaChild.setGridTemplateRows(child.gridTemplateRows.map(mapGridTrack))
  }

  yogaChild.setGap(Gutter.Column, child.gridColumnGap)
  yogaChild.setGap(Gutter.Row, child.gridRowGap)

  yogaChild.setPadding(Edge.Top, child.paddingTop)
  yogaChild.setPadding(Edge.Right, child.paddingRight)
  yogaChild.setPadding(Edge.Bottom, child.paddingBottom)
  yogaChild.setPadding(Edge.Left, child.paddingLeft)

  const isParentRow = parent.layoutMode === 'HORIZONTAL'
  const selfOverride = child.layoutAlignSelf !== 'AUTO'
  const stretchCross = selfOverride
    ? child.layoutAlignSelf === 'STRETCH'
    : parent.counterAxisAlign === 'STRETCH'

  if (child.layoutGrow > 0) {
    yogaChild.setFlexGrow(child.layoutGrow)
    yogaChild.setFlexShrink(1)
    yogaChild.setFlexBasis(0)
    if (!stretchCross) {
      if (isParentRow) yogaChild.setHeight(child.height)
      else yogaChild.setWidth(child.width)
    }
  } else {
    if (isParentRow) {
      yogaChild.setWidth(child.width)
      if (!stretchCross) yogaChild.setHeight(child.height)
    } else {
      if (child.gridTemplateRows.length > 0) yogaChild.setHeight(child.height)
      if (!stretchCross) yogaChild.setWidth(child.width)
    }
  }

  const selfAlign = mapAlignSelf(child.layoutAlignSelf)
  if (selfAlign != null) yogaChild.setAlignSelf(selfAlign)

  applyMinMaxConstraints(yogaChild, child)

  const grandchildren = graph.getChildren(child.id)
  for (const gc of grandchildren) {
    if (gc.layoutPositioning === 'ABSOLUTE') {
      const yogaGC = createYogaNode()
      configureAbsoluteChild(yogaGC, gc)
      yogaChild.insertChild(yogaGC, yogaChild.getChildCount())
    } else {
      yogaChild.insertChild(createGridChildNode(gc), yogaChild.getChildCount())
    }
  }
}

function configureChildAsAutoLayout(
  yogaChild: YogaNode,
  child: SceneNode,
  parent: SceneNode,
  graph: LayoutGraph,
  inheritedDirection: 'LTR' | 'RTL'
): void {
  const direction = resolveNodeLayoutDirection(child, inheritedDirection)
  const isParentRow = parent.layoutMode === 'HORIZONTAL'
  const isChildRow = child.layoutMode === 'HORIZONTAL'

  const widthSizing = isChildRow ? child.primaryAxisSizing : child.counterAxisSizing
  const heightSizing = isChildRow ? child.counterAxisSizing : child.primaryAxisSizing

  // Main axis: width for row parent, height for col parent — use grow for FILL
  // Cross axis: height for row parent, width for col parent — use stretch for FILL
  if (isParentRow) {
    setMainAxisSizing(yogaChild, 'width', widthSizing, child.width, child.layoutGrow)
    setCrossAxisSizing(yogaChild, 'height', heightSizing, child.height)
  } else {
    setCrossAxisSizing(yogaChild, 'width', widthSizing, child.width)
    setMainAxisSizing(yogaChild, 'height', heightSizing, child.height, child.layoutGrow)
  }

  const selfAlign = mapAlignSelf(child.layoutAlignSelf)
  if (selfAlign != null) yogaChild.setAlignSelf(selfAlign)

  configureFlexContainer(yogaChild, child, direction)

  const grandchildren = graph.getChildren(child.id)
  for (const gc of grandchildren) {
    const yogaGC = createYogaNode()
    if (gc.layoutPositioning === 'ABSOLUTE') {
      configureAbsoluteChild(yogaGC, gc)
    } else if (!gc.visible) {
      yogaGC.setDisplay(Display.None)
    } else if (gc.layoutMode === 'GRID') {
      configureChildAsGrid(yogaGC, gc, child, graph, direction)
    } else if (isAutoLayoutMode(gc.layoutMode)) {
      configureChildAsAutoLayout(yogaGC, gc, child, graph, direction)
    } else {
      configureChildAsLeaf(yogaGC, gc, child)
    }
    yogaChild.insertChild(yogaGC, yogaChild.getChildCount())
  }
}

function configureChildAsLeaf(yogaChild: YogaNode, child: SceneNode, parent: SceneNode): void {
  const isRow = parent.layoutMode === 'HORIZONTAL'
  const selfOverride = child.layoutAlignSelf !== 'AUTO'
  const stretchCross = selfOverride
    ? child.layoutAlignSelf === 'STRETCH'
    : parent.counterAxisAlign === 'STRETCH'

  const isText = child.type === 'TEXT'
  const textMeasurer = getTextMeasurer()
  const needsMeasureFunc = isText && textMeasurer && child.textAutoResize !== 'NONE'

  if (needsMeasureFunc) {
    configureTextLeaf(yogaChild, child, parent)
  } else if (isText && !textMeasurer && child.textAutoResize !== 'NONE') {
    // No CanvasKit — prefer stored dimensions from .fig import (Figma's
    // ground truth) over the rough character-count estimate. Only fall back
    // to estimateTextSize for newly-created nodes that still carry the
    // 100×100 default SceneNode size.
    const hasStoredSize =
      child.width > 0 && child.height > 0 && !(child.width === 100 && child.height === 100)

    if (child.textAutoResize === 'WIDTH_AND_HEIGHT') {
      if (hasStoredSize) {
        yogaChild.setWidth(child.width)
        yogaChild.setHeight(child.height)
      } else {
        const est = estimateTextSize(child)
        yogaChild.setWidth(est.width)
        yogaChild.setHeight(est.height)
      }
    } else if (child.textAutoResize === 'HEIGHT') {
      const stretches =
        child.layoutAlignSelf === 'STRETCH' ||
        (child.layoutAlignSelf === 'AUTO' && parent.counterAxisAlign === 'STRETCH')
      if (!(!isRow && stretches)) {
        yogaChild.setWidth(child.width)
      }
      if (hasStoredSize) {
        yogaChild.setHeight(child.height)
      } else {
        const est = estimateTextSize(child, child.width)
        yogaChild.setHeight(est.height)
      }
    }
  } else {
    configureNonTextLeaf(yogaChild, child, isRow, stretchCross)
  }

  const selfAlign = mapAlignSelf(child.layoutAlignSelf)
  if (selfAlign != null) yogaChild.setAlignSelf(selfAlign)

  applyMinMaxConstraints(yogaChild, child)
}

function configureTextLeaf(yogaChild: YogaNode, child: SceneNode, parent: SceneNode): void {
  const autoResize = child.textAutoResize
  const isRow = parent.layoutMode === 'HORIZONTAL'

  if (child.layoutGrow > 0) {
    yogaChild.setFlexGrow(child.layoutGrow)
  }

  const cache = new Map<number, { width: number; height: number }>()
  const UNCONSTRAINED_KEY = -1

  if (autoResize === 'WIDTH_AND_HEIGHT') {
    const importedSize = child.figmaDerivedLayout
    if (importedSize?.width !== undefined && importedSize.height !== undefined) {
      yogaChild.setWidth(child.width)
      yogaChild.setHeight(child.height)
      return
    }

    yogaChild.setMeasureFunc((width, widthMode, _height, _heightMode) => {
      const maxW = widthMode === MeasureMode.Undefined ? undefined : width
      const cacheKey = maxW === undefined ? UNCONSTRAINED_KEY : Math.round(maxW)
      const cached = cache.get(cacheKey)
      if (cached) return cached

      const measured = getTextMeasurer()?.(child, maxW)
      const result = measured ?? estimateTextSize(child, maxW)
      cache.set(cacheKey, result)
      return result
    })
  } else if (autoResize === 'HEIGHT') {
    const stretchesCross =
      child.layoutAlignSelf === 'STRETCH' ||
      (child.layoutAlignSelf === 'AUTO' && parent.counterAxisAlign === 'STRETCH')
    // Don't set fixed width when text stretches on cross axis (w="fill" in
    // flex="col" parent) — setWidth blocks Yoga's alignSelf:stretch, leaving
    // text at 100px default instead of filling the parent.
    const fillsWidth = !isRow && stretchesCross
    const fixedWidth = child.width
    if (child.layoutGrow <= 0 && !fillsWidth) {
      yogaChild.setWidth(fixedWidth)
    }
    yogaChild.setMeasureFunc((width, widthMode, _height, _heightMode) => {
      let constraintW = fixedWidth
      if (fillsWidth) {
        if (widthMode !== MeasureMode.Undefined) constraintW = width
      } else if (widthMode !== MeasureMode.Undefined) {
        constraintW = Math.min(width, fixedWidth || width)
      }
      const cacheKey = Math.round(constraintW)
      const cached = cache.get(cacheKey)
      if (cached) return cached

      const measured = getTextMeasurer()?.(child, constraintW)
      const result = {
        width: constraintW,
        height: measured?.height ?? estimateTextSize(child, constraintW).height
      }
      cache.set(cacheKey, result)
      return result
    })
  }
}

function configureNonTextLeaf(
  yogaChild: YogaNode,
  child: SceneNode,
  isRow: boolean,
  stretchCross: boolean
): void {
  const w = child.width
  const h = child.height

  if (child.layoutGrow > 0) {
    yogaChild.setFlexGrow(child.layoutGrow)
    if (!stretchCross) {
      if (isRow) yogaChild.setHeight(h)
      else yogaChild.setWidth(w)
    }
  } else {
    if (isRow) {
      yogaChild.setWidth(w)
      if (!stretchCross) yogaChild.setHeight(h)
    } else {
      yogaChild.setHeight(h)
      if (!stretchCross) yogaChild.setWidth(w)
    }
  }
}

function setMainAxisSizing(
  yogaNode: YogaNode,
  axis: 'width' | 'height',
  sizing: string,
  fixedValue: number,
  grow: number
): void {
  if (grow > 0) {
    yogaNode.setFlexGrow(grow)
    yogaNode.setFlexShrink(1)
    yogaNode.setFlexBasis(0)
    return
  }

  switch (sizing) {
    case 'FIXED':
      if (axis === 'width') yogaNode.setWidth(fixedValue)
      else yogaNode.setHeight(fixedValue)
      break
    case 'HUG':
      break
    case 'FILL':
      yogaNode.setFlexGrow(1)
      yogaNode.setFlexShrink(1)
      yogaNode.setFlexBasis(0)
      break
  }
}

function setCrossAxisSizing(
  yogaNode: YogaNode,
  axis: 'width' | 'height',
  sizing: string,
  fixedValue: number
): void {
  switch (sizing) {
    case 'FIXED':
      if (axis === 'width') yogaNode.setWidth(fixedValue)
      else yogaNode.setHeight(fixedValue)
      break
    case 'HUG':
      break
    case 'FILL':
      yogaNode.setAlignSelf(Align.Stretch)
      break
  }
}
