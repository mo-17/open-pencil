import type { Node as YogaNode } from 'yoga-layout'

import { isAutoLayoutMode, type SceneNode } from '@open-pencil/scene-graph'

import { usesDetachedDerivedLayout } from './derived'
import type { LayoutGraph } from './graph'

export type ComputeLayoutFn = (graph: LayoutGraph, frameId: string) => void
export type LayoutApplyStep = 'work' | 'atomic'
export type ComputeLayoutStepsFn = (
  graph: LayoutGraph,
  frameId: string
) => Iterable<LayoutApplyStep>

function preservesImportedHugCrossSize(
  graph: LayoutGraph,
  frame: SceneNode,
  axis: 'width' | 'height'
): boolean {
  if (frame.source.format !== 'fig' || frame.counterAxisSizing !== 'HUG') return false
  const expectedMode = axis === 'width' ? 'VERTICAL' : 'HORIZONTAL'
  if (frame.layoutMode !== expectedMode) return false
  return graph
    .getChildren(frame.id)
    .some(
      (child) => child.layoutAlignSelf === 'STRETCH' && child.derivedLayout?.[axis] !== undefined
    )
}

function applyFrameSize(graph: LayoutGraph, frame: SceneNode, yogaNode: YogaNode): void {
  if (frame.layoutMode === 'GRID') {
    if (frame.gridTemplateRows.length === 0) {
      graph.updateNode(frame.id, { height: yogaNode.getComputedHeight() })
    }
    return
  }

  if (frame.primaryAxisSizing !== 'HUG' && frame.counterAxisSizing !== 'HUG') return

  const computedW = yogaNode.getComputedWidth()
  const computedH = yogaNode.getComputedHeight()
  const updates: Partial<SceneNode> = {}

  const derived = frame.derivedLayout
  if (frame.primaryAxisSizing === 'HUG') {
    if (frame.layoutMode === 'HORIZONTAL') updates.width = derived?.width ?? computedW
    else updates.height = derived?.height ?? computedH
  }
  if (frame.counterAxisSizing === 'HUG') {
    if (frame.layoutMode === 'HORIZONTAL') {
      updates.height = preservesImportedHugCrossSize(graph, frame, 'height')
        ? frame.height
        : (derived?.height ?? computedH)
    } else {
      updates.width = preservesImportedHugCrossSize(graph, frame, 'width')
        ? frame.width
        : (derived?.width ?? computedW)
    }
  }

  graph.updateNode(frame.id, updates)
}

function frameSourceIsFig(graph: LayoutGraph, parentId: string | null): boolean {
  return parentId ? graph.getNode(parentId)?.source.format === 'fig' : false
}

function computedChildPosition(
  child: SceneNode,
  yogaChild: YogaNode,
  axis: 'x' | 'y',
  preservesImportedGeometry: boolean
): number {
  if (preservesImportedGeometry) return child[axis]
  const computed = axis === 'x' ? yogaChild.getComputedLeft() : yogaChild.getComputedTop()
  if (child.type === 'INSTANCE') return computed
  return child.derivedLayout?.[axis] ?? computed
}

function preservesStaleImportedTextSize(child: SceneNode, axis: 'width' | 'height'): boolean {
  const derivedSize = child.derivedLayout?.[axis]
  return (
    child.type === 'TEXT' &&
    child.source.format === 'fig' &&
    derivedSize !== undefined &&
    Math.abs(child[axis] - derivedSize) > 0.001
  )
}

function computedChildSize(
  child: SceneNode,
  yogaChild: YogaNode,
  axis: 'width' | 'height',
  preservesImportedFrameGeometry: boolean
): number {
  if (preservesImportedFrameGeometry || preservesStaleImportedTextSize(child, axis)) {
    return child[axis]
  }
  const computed = axis === 'width' ? yogaChild.getComputedWidth() : yogaChild.getComputedHeight()
  if (child.type === 'TEXT' && child.source.format === 'fig') {
    return computed > 0 ? computed : child[axis]
  }
  return child.derivedLayout?.[axis] ?? computed
}

function updateChildFromYoga(graph: LayoutGraph, child: SceneNode, yogaChild: YogaNode): void {
  if (!child.visible || child.layoutPositioning === 'ABSOLUTE') return

  const preservesImportedFrameGeometry =
    child.type === 'FRAME' &&
    child.source.format === 'fig' &&
    frameSourceIsFig(graph, child.parentId)
  const preservesImportedPosition =
    preservesImportedFrameGeometry ||
    (child.source.format === 'fig' && Math.abs(child.rotation) > 0.001)
  graph.updateNode(child.id, {
    x: computedChildPosition(child, yogaChild, 'x', preservesImportedPosition),
    y: computedChildPosition(child, yogaChild, 'y', preservesImportedPosition),
    width: computedChildSize(child, yogaChild, 'width', preservesImportedFrameGeometry),
    height: computedChildSize(child, yogaChild, 'height', preservesImportedFrameGeometry)
  })
}

function preservesImportedInstanceInternals(child: SceneNode): boolean {
  return child.type === 'INSTANCE' && child.source.format === 'fig'
}

function* recomputeGridChildSteps(
  graph: LayoutGraph,
  child: SceneNode,
  computeLayoutSteps: ComputeLayoutStepsFn
): Generator<LayoutApplyStep, void, void> {
  const updated = graph.getNode(child.id)
  if (!updated || !isAutoLayoutMode(updated.layoutMode)) return

  const savedPrimary = updated.primaryAxisSizing
  const savedCounter = updated.counterAxisSizing
  const updates: Partial<SceneNode> = {}

  if (savedPrimary === 'HUG') updates.primaryAxisSizing = 'FIXED'
  if (savedCounter === 'HUG') updates.counterAxisSizing = 'FIXED'
  const restore: Partial<SceneNode> = {}
  if (updates.primaryAxisSizing) restore.primaryAxisSizing = savedPrimary
  if (updates.counterAxisSizing) restore.counterAxisSizing = savedCounter
  try {
    if (Object.keys(updates).length > 0) graph.updateNode(child.id, updates)
    yield 'work'
    yield* computeLayoutSteps(graph, child.id)
  } finally {
    // A cooperative run may be cancelled while the nested grid layout is
    // suspended. Never leave its temporary FIXED sizing overrides authored.
    if (Object.keys(restore).length > 0) graph.updateNode(child.id, restore)
  }
  yield 'work'
}

/**
 * Apply calculated Yoga geometry one node at a time. The yielded work markers
 * let async callers checkpoint AbortSignal between graph writes instead of
 * synchronously walking an arbitrarily deep subtree.
 */
export function* applyYogaLayoutSteps(
  graph: LayoutGraph,
  frame: SceneNode,
  yogaNode: YogaNode,
  computeLayoutSteps: ComputeLayoutStepsFn
): Generator<LayoutApplyStep, void, void> {
  applyFrameSize(graph, frame, yogaNode)
  yield 'work'

  const children = graph.getChildren(frame.id)
  let yogaIndex = 0
  for (const child of children) {
    if (yogaIndex >= yogaNode.getChildCount()) continue
    const yogaChild = yogaNode.getChild(yogaIndex)
    yogaIndex++

    updateChildFromYoga(graph, child, yogaChild)
    yield 'work'

    if (!child.visible) continue
    if (preservesImportedInstanceInternals(child)) continue

    if (usesDetachedDerivedLayout(child)) {
      yield* computeLayoutSteps(graph, child.id)
      continue
    }

    if (isAutoLayoutMode(child.layoutMode)) {
      if (child.layoutMode === 'GRID' && child.layoutPositioning !== 'ABSOLUTE') {
        yield* computeLayoutSteps(graph, child.id)
      } else if (frame.layoutMode === 'GRID' && child.layoutPositioning !== 'ABSOLUTE') {
        yield* recomputeGridChildSteps(graph, child, computeLayoutSteps)
      } else {
        yield* applyYogaLayoutSteps(graph, child, yogaChild, computeLayoutSteps)
      }
    }
  }
}

/** Synchronous compatibility wrapper used by direct layout callers. */
export function applyYogaLayout(
  graph: LayoutGraph,
  frame: SceneNode,
  yogaNode: YogaNode,
  computeLayout: ComputeLayoutFn
): void {
  const steps = applyYogaLayoutSteps(graph, frame, yogaNode, (nestedGraph, frameId) => {
    computeLayout(nestedGraph, frameId)
    return []
  })
  let state = steps.next()
  while (!state.done) state = steps.next()
}
