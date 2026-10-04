import type { CompilerOptions } from '#compiler/types'

import {
  deriveLowcodePageRoutes,
  lowcodeNavigationPathname,
  lowcodeRouteMatches,
  parseExpression,
  validateLowcodeNavigationTarget,
  type ExprAst
} from '@open-pencil/lowcode'
import type { SceneGraph } from '@open-pencil/scene-graph'

import type { IRTree, IRWarning } from '../types'

const BUILTINS = new Set(['true', 'false', 'null', 'undefined', '$params', '$query', '$route'])

function safeMembers(ast: ExprAst): boolean {
  if (ast.kind === 'member')
    return (
      !['__proto__', 'prototype', 'constructor'].includes(ast.property) && safeMembers(ast.object)
    )
  if (ast.kind === 'binary') return safeMembers(ast.left) && safeMembers(ast.right)
  if (ast.kind === 'unary') return safeMembers(ast.arg)
  if (ast.kind === 'ternary')
    return safeMembers(ast.test) && safeMembers(ast.consequent) && safeMembers(ast.alternate)
  return ast.kind !== 'template'
}

function expression(source: unknown, scope: ReadonlySet<string>) {
  if (typeof source !== 'string' || source.length > 2048) return null
  const parsed = parseExpression(source)
  if (!parsed.ok || !safeMembers(parsed.ast)) return null
  const references = [...parsed.references]
  if (references.some((name) => !BUILTINS.has(name) && !scope.has(name))) return null
  return { ast: parsed.ast, references }
}

/** Invalid authored policy blocks an application export rather than dropping its guard. */
export function projectApplicationGuards(graph: SceneGraph, pages: readonly IRTree[]) {
  const warnings: IRWarning[] = []
  const routes = deriveLowcodePageRoutes(pages)
  const edges = new Map<string, string>()
  const enabled = pages.some((page) => {
    const policy = graph.getNode(page.pageId)?.lowcodeApplicationPage
    return Boolean(policy?.enterGuard || policy?.leaveConfirm)
  })
  // oxlint-disable-next-line complexity -- Projection preserves two independent optional authored policies and their explicit rejection paths.
  const trees = pages.map((page): IRTree => {
    const policy = graph.getNode(page.pageId)?.lowcodeApplicationPage
    if (!policy?.enterGuard && !policy?.leaveConfirm) return page
    const next = { ...page }
    const docNames = new Set(page.docStates.map((state) => state.name))
    const pageNames = new Set(page.states.map((state) => state.name))
    const fail = (kind: string): void => {
      warnings.push({
        nodeId: page.pageId,
        code: 'application-page-guard-invalid',
        message: `${kind} requires a bounded valid expression in its declared scope and safe policy; no application project was emitted.`
      })
    }
    if (policy.enterGuard) {
      const parsed = expression(policy.enterGuard.conditionExpr, docNames)
      const fallback = policy.enterGuard.fallback
      const target =
        typeof fallback === 'string' &&
        fallback.length <= 2048 &&
        validateLowcodeNavigationTarget(fallback).ok &&
        !/[:*]/.test(lowcodeNavigationPathname(fallback))
          ? routes.find((route) =>
              lowcodeRouteMatches(route.route, lowcodeNavigationPathname(fallback))
            )
          : undefined
      if (!parsed || !target || target.pageId === page.pageId) fail('Enter guard')
      else {
        next.applicationEnterGuard = { ...parsed, fallback }
        edges.set(page.pageId, target.pageId)
      }
    }
    if (policy.leaveConfirm) {
      const parsed = expression(policy.leaveConfirm.dirtyExpr, new Set([...docNames, ...pageNames]))
      const message = policy.leaveConfirm.message
      if (!parsed || typeof message !== 'string' || !message.trim() || message.length > 1024)
        fail('Leave confirmation')
      else next.applicationLeaveConfirm = { ...parsed, message }
    }
    const reads = new Set(page.docStateReads)
    for (const name of [
      ...(next.applicationEnterGuard?.references ?? []),
      ...(next.applicationLeaveConfirm?.references ?? [])
    ])
      if (docNames.has(name) && !pageNames.has(name)) reads.add(name)
    next.docStateReads = [...reads]
    return next
  })
  for (const pageId of edges.keys()) {
    const visited = new Set<string>()
    let current: string | undefined = pageId
    while (current && edges.has(current)) {
      if (visited.has(current)) {
        warnings.push({
          code: 'application-page-guard-fallback-cycle',
          nodeId: pageId,
          message:
            'Enter guard fallback routes must terminate outside their guarded cycle; no application project was emitted.'
        })
        break
      }
      visited.add(current)
      current = edges.get(current)
    }
  }
  return {
    trees: enabled
      ? trees.map((page) => ({ ...page, applicationGuardsEnabled: true as const }))
      : trees,
    warnings
  }
}

export function applicationGuardTargetWarnings(
  pages: readonly IRTree[],
  target: string
): IRWarning[] {
  if (target === 'react' || target === 'vue') return []
  return pages
    .filter((page) => page.applicationEnterGuard || page.applicationLeaveConfirm)
    .map((page) => ({
      code: 'application-page-guards-unsupported',
      nodeId: page.pageId,
      message:
        'Application entry conditions and leave confirmation require a React or Vue web export.'
    }))
}

export function projectCompilerApplicationGuards(
  graph: SceneGraph,
  pages: readonly IRTree[],
  enabled: boolean,
  options: CompilerOptions
) {
  const result = enabled
    ? projectApplicationGuards(graph, pages)
    : { trees: [...pages], warnings: [] as IRWarning[] }
  if (
    result.trees.some((page) => page.applicationGuardsEnabled) &&
    options.packaging?.kind === 'microfrontend'
  )
    result.warnings.push({
      code: 'application-page-guards-microfrontend-unsupported',
      message:
        'Application navigation guards require standalone web routing; no microfrontend project was emitted.'
    })
  return result
}
