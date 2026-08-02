/**
 * Compiler-compatible lowcode page route derivation.
 *
 * This module intentionally has no SceneGraph or compiler IR dependency. The
 * compiler, editor preview, and MCP route audit all feed the same small page
 * descriptor into it so slug fallback and collision behaviour cannot drift.
 */

import type { ValidationResult } from './validate'

export interface LowcodeRoutePage {
  pageId: string
  pageName: string
  routePattern?: string
}

export interface LowcodePageRouteInfo {
  pageId: string
  pageName: string
  /** URL-safe identifier used for generated filenames. */
  slug: string
  /** Slug before the deterministic collision suffix is applied. */
  originalSlug: string
  /** Effective browser route used by the compiler. */
  route: string
  routeSource: 'explicit' | 'derived'
  /** Present when an authored pattern is ignored and slug fallback is used. */
  routePatternError?: string
}

export interface LowcodeRouteParameter {
  name: string
  optional: boolean
}

const SLUG_NON_ALPHANUM = /[^a-z0-9]+/g
const SLUG_TRIM_DASH = /^-+|-+$/g
const ROUTE_PARAM = /^:([A-Za-z_][A-Za-z0-9_]*)(\?)?$/

/** Keep this validation deliberately aligned with the compiler's historical
 * contract: a page pattern is accepted when it is non-empty and starts with
 * `/`. More detailed parameter diagnostics are exposed by
 * `inspectLowcodeRouteParameters` without silently changing emitted routes. */
export function validateLowcodeRoutePattern(pattern: string): ValidationResult {
  if (pattern === '') return { ok: false, reason: 'route pattern is required' }
  if (!pattern.startsWith('/')) {
    return { ok: false, reason: 'route pattern must start with "/"' }
  }
  return { ok: true }
}

/** Derive exactly the slug and effective-route fields consumed by the React
 * compiler. Invalid explicit patterns fall back to the derived route and carry
 * a diagnostic for route-management and audit consumers. */
export function deriveLowcodePageRoutes(
  pages: readonly LowcodeRoutePage[]
): LowcodePageRouteInfo[] {
  const used = new Set<string>()
  return pages.map((page, index) => {
    const originalSlug = index === 0 ? 'index' : slugFromPageName(page.pageName, index)
    let slug = originalSlug
    if (used.has(slug) || (index > 0 && slug === 'index')) {
      let suffix = index
      do {
        slug = `${originalSlug}-${suffix}`
        suffix++
      } while (used.has(slug))
    }
    used.add(slug)

    const derivedRoute = slug === 'index' ? '/' : `/${slug}`
    if (page.routePattern === undefined || page.routePattern === '') {
      return {
        pageId: page.pageId,
        pageName: page.pageName,
        slug,
        originalSlug,
        route: derivedRoute,
        routeSource: 'derived' as const
      }
    }

    const validation = validateLowcodeRoutePattern(page.routePattern)
    if (!validation.ok) {
      return {
        pageId: page.pageId,
        pageName: page.pageName,
        slug,
        originalSlug,
        route: derivedRoute,
        routeSource: 'derived' as const,
        routePatternError: validation.reason ?? 'invalid route pattern'
      }
    }

    return {
      pageId: page.pageId,
      pageName: page.pageName,
      slug,
      originalSlug,
      route: page.routePattern,
      routeSource: 'explicit' as const
    }
  })
}

/** Inspect `:param` path segments without restricting React Router's static or
 * splat syntax. Malformed colon segments and duplicate parameter names are
 * returned as diagnostics for `audit_navigation`. */
export function inspectLowcodeRouteParameters(route: string): {
  parameters: LowcodeRouteParameter[]
  issues: string[]
} {
  const parameters: LowcodeRouteParameter[] = []
  const issues: string[] = []
  const seen = new Set<string>()
  for (const segment of pathSegments(route)) {
    if (!segment.startsWith(':')) continue
    const match = ROUTE_PARAM.exec(segment)
    if (!match) {
      issues.push(`malformed route parameter segment "${segment}"`)
      continue
    }
    const name = match[1]
    if (seen.has(name)) issues.push(`duplicate route parameter "${name}"`)
    else seen.add(name)
    parameters.push({ name, optional: match[2] === '?' })
  }
  return { parameters, issues }
}

/** Match a concrete navigation pathname against a page route. Exact pattern
 * strings (including `:id`) also match, which lets an authored navigate action
 * target a dynamic pattern and supply `params` for `generatePath`. */
export function lowcodeRouteMatches(route: string, target: string): boolean {
  if (route === target) return true
  const routeSegments = pathSegments(route)
  const targetSegments = pathSegments(target)
  return matchSegments(routeSegments, targetSegments, 0, 0)
}

/** Canonical key used to detect route declarations that match the same shape,
 * e.g. `/product/:id` and `/product/:slug`. */
export function lowcodeRouteCollisionKey(route: string): string {
  return pathSegments(route)
    .map((segment) => {
      const match = ROUTE_PARAM.exec(segment)
      if (match) return match[2] === '?' ? ':?' : ':'
      return segment === '*' ? '*' : segment
    })
    .join('/')
}

function optionalParamMarker(path: string, index: number): boolean {
  const segmentStart = path.lastIndexOf('/', index)
  const segment = path.slice(segmentStart + 1, index)
  const isLastCharacter = index === path.length - 1
  return ROUTE_PARAM.test(`${segment}?`) && (isLastCharacter || path[index + 1] === '/')
}

/** Remove query/hash suffixes before resolving a navigation action to a page.
 * A `?` that marks an optional dynamic segment (for example `:id?`) remains
 * part of the route pattern instead of being mistaken for a query delimiter. */
export function lowcodeNavigationPathname(to: string): string {
  for (let index = 0; index < to.length; index++) {
    if (to[index] === '#') return to.slice(0, index)
    if (to[index] === '?' && !optionalParamMarker(to, index)) return to.slice(0, index)
  }
  return to
}

function slugFromPageName(pageName: string, index: number): string {
  const raw = pageName.toLowerCase().replace(SLUG_NON_ALPHANUM, '-').replace(SLUG_TRIM_DASH, '')
  return raw === '' ? `page-${index}` : raw
}

function pathSegments(path: string): string[] {
  if (path === '/') return []
  return path.replace(/^\/+|\/+$/g, '').split('/')
}

function matchSegments(
  pattern: readonly string[],
  target: readonly string[],
  patternIndex: number,
  targetIndex: number
): boolean {
  if (patternIndex >= pattern.length) return targetIndex >= target.length
  const segment = pattern[patternIndex]
  if (segment === '*') return true
  const param = ROUTE_PARAM.exec(segment)
  if (param) {
    if (targetIndex < target.length) {
      if (matchSegments(pattern, target, patternIndex + 1, targetIndex + 1)) return true
    }
    return param[2] === '?' ? matchSegments(pattern, target, patternIndex + 1, targetIndex) : false
  }
  if (targetIndex >= target.length || segment !== target[targetIndex]) return false
  return matchSegments(pattern, target, patternIndex + 1, targetIndex + 1)
}
