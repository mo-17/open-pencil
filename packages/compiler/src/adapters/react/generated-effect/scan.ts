import type { ComponentDef, IRNode, IRTree } from '#compiler/ir/types'

import { buildGeneratedEffectRuntime } from './runtime'

export interface ReactGeneratedEffectPlan {
  runtime?: string
}

/** Emit the DOM runtime only when a reachable page/component owns a strict layer. */
export function buildGeneratedEffectPlan(
  irs: readonly IRTree[],
  components: readonly ComponentDef[]
): ReactGeneratedEffectPlan {
  const visit = (node: IRNode): boolean => {
    if (node.kind === 'element') {
      return node.generatedEffect !== undefined || node.children.some(visit)
    }
    if (node.kind === 'conditional') return visit(node.consequent)
    if (node.kind === 'list') return visit(node.template)
    return false
  }
  const active =
    irs.some((ir) => ir.children.some(visit)) ||
    components.some(
      (component) =>
        component.children.some(visit) ||
        (component.variants ?? []).some((variant) => variant.children.some(visit))
    )
  return active ? { runtime: buildGeneratedEffectRuntime() } : {}
}
