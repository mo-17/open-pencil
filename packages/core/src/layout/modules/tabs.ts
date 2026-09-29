import type { SceneNode } from '@open-pencil/scene-graph'

import type { ComputeLayoutStepsFn, LayoutApplyStep } from '#core/layout/apply'
import type { LayoutGraph } from '#core/layout/graph'
import type { TabsContentProjection } from '#core/plugins/content/tabs'

import { createContentLayoutGraph, layoutContentSteps } from './content'

function constrainPanel(view: LayoutGraph, panel: SceneNode, projection: TabsContentProjection) {
  const isRow = panel.layoutMode === 'HORIZONTAL'
  const widthSizing = isRow ? 'primaryAxisSizing' : 'counterAxisSizing'
  const heightSizing = isRow ? 'counterAxisSizing' : 'primaryAxisSizing'
  const updates: Partial<SceneNode> = { x: projection.content.x, y: projection.content.y }
  if (panel[widthSizing] === 'FILL') {
    updates.width = projection.content.width
    updates[widthSizing] = 'FIXED'
  }
  if (panel[heightSizing] === 'FILL') {
    updates.height = projection.content.height
    updates[heightSizing] = 'FIXED'
  }
  view.updateNode(panel.id, updates)
}

export function* computeTabsContentLayoutSteps(
  graph: LayoutGraph,
  projection: TabsContentProjection,
  computeLayoutSteps: ComputeLayoutStepsFn
): Generator<LayoutApplyStep, void, void> {
  for (const panel of projection.panels) {
    const { view, publish } = createContentLayoutGraph(graph)
    constrainPanel(view, panel, projection)
    yield* layoutContentSteps(view, panel.id, computeLayoutSteps)
    yield* publish()
  }
}
