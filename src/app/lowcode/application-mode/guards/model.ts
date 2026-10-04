import {
  deriveLowcodePageRoutes,
  validateLowcodeApplicationGuardFallback,
  validateLowcodeApplicationGuardRoutes,
  validateLowcodeApplicationPage
} from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'

import { applicationEntryEligible, applicationRawEntry } from '../model'
import type { ApplicationModeEditor } from '../types'

/** Draft fallback validation uses the same complete route set as the kernel scope check. */
export function applicationGuardFallbackValid(
  editor: ApplicationModeEditor | undefined,
  page: SceneNode | undefined,
  value: unknown
): boolean {
  if (!editor || !page || !validateLowcodeApplicationGuardFallback(value)) return false
  if (typeof value !== 'string') return false
  const pages = editor.graph.getPages().flatMap((candidate) => {
    const policy = validateLowcodeApplicationPage(candidate.lowcodeApplicationPage)
    if (
      !policy.ok ||
      policy.value.role !== 'application' ||
      candidate.pluginData.some((entry) => applicationRawEntry(entry, true)) ||
      !applicationEntryEligible(
        editor.graph,
        candidate,
        editor.graph.getNode(policy.value.entryNodeId ?? '')
      )
    )
      return []
    return [{ node: candidate, policy: policy.value }]
  })
  if (!pages.some((candidate) => candidate.node === page)) return false
  const routes = deriveLowcodePageRoutes(
    pages.map(({ node }) => ({
      pageId: node.id,
      pageName: node.name,
      ...(node.lowcodeRoutePattern ? { routePattern: node.lowcodeRoutePattern } : {})
    }))
  )
  return validateLowcodeApplicationGuardRoutes(
    pages.map(({ node, policy }) => {
      const enterGuard =
        node === page ? { conditionExpr: 'true', fallback: value } : policy.enterGuard
      return {
        pageId: node.id,
        route: routes.find((route) => route.pageId === node.id)?.route ?? '',
        ...(enterGuard ? { enterGuard } : {})
      }
    })
  ).ok
}
