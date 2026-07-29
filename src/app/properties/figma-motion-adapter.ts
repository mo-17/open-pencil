import {
  buildFigmaMotionPluginScript,
  createFigmaNativeMotionPlan,
  type FigmaNativeMotionPlan
} from '@open-pencil/fig'
import type { SceneNode } from '@open-pencil/scene-graph'

export interface FigmaMotionAdapterView {
  plan: FigmaNativeMotionPlan
  script: string | null
}

/** Build the safe, selection-based Figma Motion adapter output for one node. */
export function createFigmaMotionAdapterView(
  node: Pick<SceneNode, 'motion' | 'opacity'>
): FigmaMotionAdapterView {
  const plan = createFigmaNativeMotionPlan(node.motion, { nodeOpacity: node.opacity })
  return {
    plan,
    script: plan.supported
      ? buildFigmaMotionPluginScript(plan, {
          conflictPolicy: 'replace-owned',
          allowTimelineGrowth: false
        })
      : null
  }
}
