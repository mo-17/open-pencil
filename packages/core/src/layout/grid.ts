import { Direction, Display, Gutter, Edge, type Node as YogaNode } from 'yoga-layout'

import { isAutoLayoutMode, type SceneNode } from '@open-pencil/scene-graph'

import { resolveNodeLayoutDirection } from '#core/text/direction'

import type { LayoutGraph } from './graph'
import { configureAbsoluteChild, createYogaNode, freeYogaTree, mapGridTrack } from './yoga-helpers'

function configureAsGrid(
  yogaNode: YogaNode,
  node: SceneNode,
  direction: Exclude<SceneNode['layoutDirection'], 'AUTO'>
): void {
  yogaNode.setDisplay(Display.Grid)
  yogaNode.setDirection(direction === 'RTL' ? Direction.RTL : Direction.LTR)
  yogaNode.setWidth(node.width)
  if (node.gridTemplateRows.length > 0 || node.height > 0) {
    yogaNode.setHeight(node.height)
  }

  if (node.gridTemplateColumns.length > 0) {
    yogaNode.setGridTemplateColumns(node.gridTemplateColumns.map(mapGridTrack))
  }
  if (node.gridTemplateRows.length > 0) {
    yogaNode.setGridTemplateRows(node.gridTemplateRows.map(mapGridTrack))
  }

  yogaNode.setGap(Gutter.Column, node.gridColumnGap)
  yogaNode.setGap(Gutter.Row, node.gridRowGap)

  yogaNode.setPadding(Edge.Top, node.paddingTop)
  yogaNode.setPadding(Edge.Right, node.paddingRight)
  yogaNode.setPadding(Edge.Bottom, node.paddingBottom)
  yogaNode.setPadding(Edge.Left, node.paddingLeft)
}

export function createGridChildNode(child: SceneNode): YogaNode {
  const yogaChild = createYogaNode()
  if (!child.visible) {
    yogaChild.setDisplay(Display.None)
  } else {
    const pos = child.gridPosition
    if (pos) {
      yogaChild.setGridColumnStart(pos.column)
      yogaChild.setGridColumnEndSpan(pos.columnSpan)
      yogaChild.setGridRowStart(pos.row)
      yogaChild.setGridRowEndSpan(pos.rowSpan)
    }
    const hasLayout = isAutoLayoutMode(child.layoutMode)
    const explicitStretch = child.layoutGrow > 0 || child.layoutAlignSelf === 'STRETCH'
    const inheritsContainerStretch = hasLayout && child.layoutAlignSelf === 'AUTO'

    if (explicitStretch || inheritsContainerStretch) {
      yogaChild.setWidthStretch()
    } else {
      yogaChild.setWidth(child.width)
    }
    if (explicitStretch) {
      yogaChild.setHeightStretch()
    } else {
      yogaChild.setHeight(child.height)
    }
  }
  return yogaChild
}

export function buildGridTree(
  graph: LayoutGraph,
  frame: SceneNode,
  inheritedDirection: 'LTR' | 'RTL'
): YogaNode {
  const steps = buildGridTreeSteps(graph, frame, inheritedDirection)
  let state = steps.next()
  while (!state.done) state = steps.next()
  return state.value
}

/** Yield once per child while preserving the exact synchronous build order. */
export function* buildGridTreeSteps(
  graph: LayoutGraph,
  frame: SceneNode,
  inheritedDirection: 'LTR' | 'RTL'
): Generator<void, YogaNode, void> {
  const root = createYogaNode()
  let completed = false
  try {
    const direction = resolveNodeLayoutDirection(frame, inheritedDirection)
    configureAsGrid(root, frame, direction)

    const children = graph.getChildren(frame.id)
    for (const child of children) {
      yield
      if (child.layoutPositioning === 'ABSOLUTE') {
        const yogaChild = createYogaNode()
        root.insertChild(yogaChild, root.getChildCount())
        configureAbsoluteChild(yogaChild, child)
      } else {
        const yogaChild = createGridChildNode(child)
        root.insertChild(yogaChild, root.getChildCount())
        if (isAutoLayoutMode(child.layoutMode)) {
          const childDirection = resolveNodeLayoutDirection(child, direction)
          yogaChild.setDirection(childDirection === 'RTL' ? Direction.RTL : Direction.LTR)
        }
      }
    }

    completed = true
    return root
  } finally {
    if (!completed) freeYogaTree(root)
  }
}
