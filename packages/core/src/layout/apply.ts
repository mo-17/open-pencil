import type { Node as YogaNode } from 'yoga-layout'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { LayoutGraph } from './graph'

export type ComputeLayoutFn = (graph: LayoutGraph, frameId: string) => void
export type LayoutApplyStep = 'work' | 'atomic'
export type ComputeLayoutStepsFn = (
  graph: LayoutGraph,
  frameId: string
) => Iterable<LayoutApplyStep>

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

  const derived = frame.figmaDerivedLayout
  if (frame.primaryAxisSizing === 'HUG') {
    if (frame.layoutMode === 'HORIZONTAL') updates.width = derived?.width ?? computedW
    else updates.height = derived?.height ?? computedH
  }
  if (frame.counterAxisSizing === 'HUG') {
    if (frame.layoutMode === 'HORIZONTAL') updates.height = derived?.height ?? computedH
    else updates.width = derived?.width ?? computedW
  }

  graph.updateNode(frame.id, updates)
}

function updateChildFromYoga(graph: LayoutGraph, child: SceneNode, yogaChild: YogaNode): void {
  if (!child.visible || child.layoutPositioning === 'ABSOLUTE') return

  const derived = child.figmaDerivedLayout
  graph.updateNode(child.id, {
    x:
      child.type === 'INSTANCE'
        ? yogaChild.getComputedLeft()
        : (derived?.x ?? yogaChild.getComputedLeft()),
    y:
      child.type === 'INSTANCE'
        ? yogaChild.getComputedTop()
        : (derived?.y ?? yogaChild.getComputedTop()),
    width: derived?.width ?? yogaChild.getComputedWidth(),
    height: derived?.height ?? yogaChild.getComputedHeight()
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
  if (!updated || updated.layoutMode === 'NONE') return

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

    if (preservesImportedInstanceInternals(child)) continue

    if (child.layoutMode !== 'NONE') {
      if (child.layoutMode === 'GRID' && child.visible && child.layoutPositioning !== 'ABSOLUTE') {
        yield* computeLayoutSteps(graph, child.id)
      } else if (
        frame.layoutMode === 'GRID' &&
        child.visible &&
        child.layoutPositioning !== 'ABSOLUTE'
      ) {
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
