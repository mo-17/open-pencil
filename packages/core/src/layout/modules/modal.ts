import type { SceneNode } from '@open-pencil/scene-graph'

import type { ComputeLayoutStepsFn, LayoutApplyStep } from '#core/layout/apply'
import type { LayoutGraph } from '#core/layout/graph'

import { createContentLayoutGraph, layoutContentSteps } from './content'

/** A dialog body has its own design bounds, independent of the compact trigger. */
export function* computeModalContentLayoutSteps(
  graph: LayoutGraph,
  body: SceneNode,
  computeLayoutSteps: ComputeLayoutStepsFn
): Generator<LayoutApplyStep, void, void> {
  const { view, publish } = createContentLayoutGraph(graph)
  const constraints: Partial<SceneNode> = {}
  // FILL needs a containing box. The body is an independent Yoga root here, so
  // constrain it to its authored bounds without persisting a different sizing mode.
  if (body.primaryAxisSizing === 'FILL') constraints.primaryAxisSizing = 'FIXED'
  if (body.counterAxisSizing === 'FILL') constraints.counterAxisSizing = 'FIXED'
  view.updateNode(body.id, constraints)
  yield* layoutContentSteps(view, body.id, computeLayoutSteps)
  yield* publish()
}
