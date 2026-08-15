import {
  auditLowcodeNavigation,
  deriveLowcodePageRoutes,
  inspectLowcodeRouteParameters,
  lowcodeRouteCollisionKey,
  type NavigationRouteEntry
} from '@open-pencil/lowcode'

import { defineTool } from '#core/tools/schema'

type ReadResult<T> = { ok: true; data: T } | { ok: false; error: string }

export const readPageRoute = defineTool({
  name: 'read_page_route',
  description:
    'Read one page route exactly as the compiler resolves it. Returns the authored route pattern when present, the effective route, derived slug, dynamic parameters, fallback validation error, and any pages with the same exact/dynamic route shape.',
  params: {
    page_id: { type: 'string', description: 'CANVAS page node id', required: true }
  },
  execute: (
    figma,
    { page_id }
  ): ReadResult<NavigationRouteEntry & { collisionPageIds: string[] }> => {
    const pages = figma.graph.getPages()
    const pageIndex = pages.findIndex((page) => page.id === page_id)
    if (pageIndex === -1) return { ok: false, error: `Page "${page_id}" not found` }
    const routes = deriveLowcodePageRoutes(
      pages.map((page) => ({
        pageId: page.id,
        pageName: page.name,
        routePattern: page.lowcodeRoutePattern
      }))
    )
    const info = routes[pageIndex]
    const collisionKey = lowcodeRouteCollisionKey(info.route)
    return {
      ok: true,
      data: {
        ...info,
        ...(pages[pageIndex].lowcodeRoutePattern !== undefined
          ? { authoredRoutePattern: pages[pageIndex].lowcodeRoutePattern }
          : {}),
        parameters: inspectLowcodeRouteParameters(info.route).parameters,
        collisionPageIds: routes
          .filter(
            (candidate) =>
              candidate.pageId !== info.pageId &&
              lowcodeRouteCollisionKey(candidate.route) === collisionKey
          )
          .map((candidate) => candidate.pageId)
      }
    }
  }
})

export const auditNavigation = defineTool({
  name: 'audit_navigation',
  description:
    'Audit the compiler-effective route manifest and reachable navigate actions in one call. Reports navigate edges with source node/event/action paths; missing or ambiguous targets; exact/dynamic route collisions; missing, extra, or invalid dynamic params; missing/cyclic called workflows; and BUTTON nodes with no configured events. The full route manifest is always returned. Scope can be the document, current page, or a page_id.',
  params: {
    scope: {
      type: 'string',
      description: 'Source controls to audit',
      enum: ['document', 'current_page', 'page'],
      default: 'document'
    },
    page_id: {
      type: 'string',
      description: 'CANVAS page id; required when scope is page'
    },
    include_workflows: {
      type: 'boolean',
      description: 'Expand reachable callWorkflow actions (default true)',
      default: true
    }
  },
  execute: (figma, args): ReadResult<ReturnType<typeof auditLowcodeNavigation>> => {
    const scope = args.scope ?? 'document'
    if (!['document', 'current_page', 'page'].includes(scope)) {
      return { ok: false, error: `Unknown navigation audit scope "${scope}"` }
    }
    let pageId: string | undefined
    if (scope === 'current_page') pageId = figma.currentPage.id
    if (scope === 'page') {
      if (!args.page_id) return { ok: false, error: 'page_id is required when scope is "page"' }
      pageId = args.page_id
    }
    if (pageId !== undefined && !figma.graph.getPages().some((page) => page.id === pageId)) {
      return { ok: false, error: `Page "${pageId}" not found` }
    }
    return {
      ok: true,
      data: auditLowcodeNavigation(figma.graph, {
        ...(pageId !== undefined ? { pageId } : {}),
        includeWorkflows: args.include_workflows !== false
      })
    }
  }
})
