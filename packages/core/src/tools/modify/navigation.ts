import type { SceneNode } from '@open-pencil/scene-graph'

import type { FigmaAPI } from '#core/figma-api'
import {
  deriveLowcodePageRoutes,
  inspectLowcodeRouteParameters,
  lowcodeRouteCollisionKey,
  validateLowcodeRoutePattern
} from '#core/lowcode-validation'
import { defineTool, type ToolCtx } from '#core/tools/schema'

type ModifyResult<T> = { ok: true; data: T } | { ok: false; error: string }

export const updatePageRoute = defineTool({
  name: 'update_page_route',
  mutates: true,
  description:
    'Set or clear a CANVAS page lowcodeRoutePattern. Explicit patterns must start with "/" and may include dynamic segments such as "/product/:id". Set clear=true to restore the compiler-derived route. Returns both previous and current effective routes plus route-shape collisions; the mutation is one undo entry when editor context is available.',
  params: {
    page_id: { type: 'string', description: 'CANVAS page node id', required: true },
    route_pattern: {
      type: 'string',
      description: 'Explicit route pattern, e.g. /about or /product/:id'
    },
    clear: {
      type: 'boolean',
      description: 'Clear the explicit pattern and restore the derived route',
      default: false
    }
  },
  execute: (figma, args, ctx): ModifyResult<Record<string, unknown>> => {
    const pages = figma.graph.getPages()
    const page = pages.find((candidate) => candidate.id === args.page_id)
    if (!page) return { ok: false, error: `Page "${args.page_id}" not found` }
    if (args.clear === true && args.route_pattern !== undefined) {
      return { ok: false, error: 'Pass either route_pattern or clear=true, not both' }
    }
    if (args.clear !== true && args.route_pattern === undefined) {
      return { ok: false, error: 'route_pattern is required unless clear=true' }
    }
    if (args.route_pattern !== undefined) {
      const validation = validateLowcodeRoutePattern(args.route_pattern)
      if (!validation.ok) return { ok: false, error: validation.reason ?? 'invalid route pattern' }
    }

    const previousPattern = page.lowcodeRoutePattern
    const previous = routeForPage(pages, page.id)
    applyRoutePattern(figma, page.id, previousPattern, args.route_pattern, args.clear === true, ctx)
    const currentPages = figma.graph.getPages()
    const current = routeForPage(currentPages, page.id)
    const collisionKey = lowcodeRouteCollisionKey(current.route)
    const collisionPageIds = deriveRoutes(currentPages)
      .filter(
        (candidate) =>
          candidate.pageId !== current.pageId &&
          lowcodeRouteCollisionKey(candidate.route) === collisionKey
      )
      .map((candidate) => candidate.pageId)
    return {
      ok: true,
      data: {
        pageId: page.id,
        pageName: page.name,
        previous: {
          authoredRoutePattern: previousPattern ?? null,
          effectiveRoute: previous.route
        },
        current: {
          authoredRoutePattern: args.clear === true ? null : args.route_pattern,
          effectiveRoute: current.route,
          routeSource: current.routeSource,
          parameters: inspectLowcodeRouteParameters(current.route).parameters
        },
        collisionPageIds
      }
    }
  }
})

function deriveRoutes(pages: readonly SceneNode[]) {
  return deriveLowcodePageRoutes(
    pages.map((page) => ({
      pageId: page.id,
      pageName: page.name,
      routePattern: page.lowcodeRoutePattern
    }))
  )
}

function routeForPage(pages: readonly SceneNode[], pageId: string) {
  const route = deriveRoutes(pages).find((candidate) => candidate.pageId === pageId)
  if (!route) throw new Error(`Page "${pageId}" not found while deriving routes`)
  return route
}

function applyRoutePattern(
  figma: FigmaAPI,
  pageId: string,
  previousPattern: string | undefined,
  nextPattern: string | undefined,
  clear: boolean,
  ctx: ToolCtx | undefined
): void {
  const graph = ctx?.editor?.graph ?? figma.graph
  const applyForward = (): void => {
    if (clear) graph.clearNodeFields(pageId, ['lowcodeRoutePattern'])
    else graph.updateNode(pageId, { lowcodeRoutePattern: nextPattern })
  }
  const applyInverse = (): void => {
    if (previousPattern === undefined) graph.clearNodeFields(pageId, ['lowcodeRoutePattern'])
    else graph.updateNode(pageId, { lowcodeRoutePattern: previousPattern })
  }
  applyForward()
  ctx?.editor?.undo.push({
    label: clear ? 'AI: clear page route' : 'AI: update page route',
    forward: applyForward,
    inverse: applyInverse
  })
}
