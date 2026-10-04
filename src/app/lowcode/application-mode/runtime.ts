import {
  deriveLowcodePageRoutes,
  lowcodeNavigationPathname,
  lowcodeRouteMatches,
  resolveLowcodeApplicationPages,
  validateLowcodeApplicationStartRoute,
  validateLowcodeNavigationTarget
} from '@open-pencil/lowcode'
import type { SceneGraph } from '@open-pencil/scene-graph'

/** Match the compiler's page selection and order without collecting layout IR. */
export function applicationPreviewRoutes(graph: SceneGraph) {
  const scope = resolveLowcodeApplicationPages(graph)
  return deriveLowcodePageRoutes(
    scope.pages.flatMap(({ pageId }) => {
      const page = graph.getNode(pageId)
      return page ? [{ pageId, pageName: page.name, routePattern: page.lowcodeRoutePattern }] : []
    })
  )
}

/** Choose a concrete route to restore after replacing the preview frame. */
export function applicationPreviewNavigationRoute(
  graph: SceneGraph,
  currentPageId: string,
  lastRuntimeRoute?: string
): string | undefined {
  const scope = resolveLowcodeApplicationPages(graph)
  if (scope.mode === 'invalid' || scope.warnings.length > 0) return undefined
  const routes = applicationPreviewRoutes(graph)
  const current = routes.find((route) => route.pageId === currentPageId)
  const pathname = lastRuntimeRoute ? lowcodeNavigationPathname(lastRuntimeRoute) : undefined
  // Keep the concrete location on recompilation; page selection still changes the destination.
  const remembered =
    scope.mode === 'application' &&
    lastRuntimeRoute &&
    pathname &&
    validateLowcodeNavigationTarget(lastRuntimeRoute).ok &&
    !/[:*]/.test(pathname) &&
    routes.some((route) => lowcodeRouteMatches(route.route, pathname))
      ? lastRuntimeRoute
      : undefined
  if (remembered && current && pathname && lowcodeRouteMatches(current.route, pathname))
    return remembered
  if (current && !/[:*]/.test(current.route) && validateLowcodeNavigationTarget(current.route).ok)
    return current.route
  return remembered
}

/** A new frame starts on the current concrete route or the configured static homepage. */
export function applicationPreviewInitialRoute(
  graph: SceneGraph,
  currentPageId: string,
  lastRuntimeRoute?: string
): string | undefined {
  const scope = resolveLowcodeApplicationPages(graph)
  if (scope.mode !== 'application' || scope.warnings.length > 0) return undefined
  const remembered = applicationPreviewNavigationRoute(graph, currentPageId, lastRuntimeRoute)
  if (remembered) return remembered
  const start = applicationPreviewRoutes(graph).at(0)?.route
  return start && validateLowcodeApplicationStartRoute(start).ok ? start : undefined
}

/** Seed each new frame before the router mounts, avoiding a competing homepage redirect. */
export function applicationPreviewFrameURL(source: string, route?: string): string {
  if (!route) return source
  if (source.startsWith('blob:')) return `${source.split('#')[0]}#${route}`
  const url = new URL(source)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return source
  return new URL(route, url.origin).href
}

/** Application navigation requires one snapshot containing all application pages. */
export function flutterPreviewPageIds(graph: SceneGraph, currentPageId?: string): string[] {
  const scope = resolveLowcodeApplicationPages(graph)
  if (scope.mode === 'legacy' && currentPageId) return [currentPageId]
  // Keep invalid configurations in the request so the compiler can report them.
  return graph.getPages().map((page) => page.id)
}

export function flutterPreviewScopeKey(graph: SceneGraph, currentPageId?: string): string {
  return resolveLowcodeApplicationPages(graph).mode === 'legacy'
    ? (currentPageId ?? '')
    : 'application'
}
