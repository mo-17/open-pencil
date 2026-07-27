import type { ComponentDef, IRNode, IRTree } from '#compiler/ir/types'

import { buildMotionCss } from './css'
import { motionToken } from './key'
import { buildMotionRuntime } from './runtime'
import type { ReactMotionEntry, ReactMotionPlan } from './types'

/** Collect, de-duplicate, and lower all reachable page/component motion assets. */
export function buildMotionPlan(
  irs: readonly IRTree[],
  components: readonly ComponentDef[]
): ReactMotionPlan {
  const entries = new Map<string, ReactMotionEntry>()
  const animatedComponentNames = new Set<string>()
  const visit = (node: IRNode): void => {
    if (node.kind === 'element' || node.kind === 'componentRef') {
      if (node.motion) {
        const token = motionToken(node.motion)
        if (!entries.has(token)) entries.set(token, { token, motion: node.motion })
        if (node.kind === 'componentRef') animatedComponentNames.add(node.name)
      }
      if (node.kind === 'element') node.children.forEach(visit)
      return
    }
    if (node.kind === 'conditional') visit(node.consequent)
    else if (node.kind === 'list') visit(node.template)
  }

  for (const ir of irs) ir.children.forEach(visit)
  for (const component of components) {
    component.children.forEach(visit)
    for (const variant of component.variants ?? []) variant.children.forEach(visit)
  }

  const sortedEntries = [...entries.values()].sort((a, b) => a.token.localeCompare(b.token))
  return {
    css: buildMotionCss(sortedEntries),
    runtime: buildMotionRuntime(sortedEntries),
    animatedComponentNames
  }
}
