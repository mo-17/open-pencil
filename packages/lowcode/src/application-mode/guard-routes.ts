import type { LowcodeApplicationEnterGuardV1 } from '@open-pencil/scene-graph'

import { lowcodeNavigationPathname, lowcodeRouteMatches } from '../routes'

export interface LowcodeApplicationGuardRoute {
  pageId: string
  route: string
  enterGuard?: LowcodeApplicationEnterGuardV1
}

export type LowcodeApplicationGuardRouteValidation =
  | { ok: true }
  | { ok: false; pageId: string; reason: string }

/** Validate against the complete active route set before any guarded page is emitted. */
export function validateLowcodeApplicationGuardRoutes(
  pages: readonly LowcodeApplicationGuardRoute[]
): LowcodeApplicationGuardRouteValidation {
  const fallbacks = new Map<string, string>()
  for (const page of pages) {
    if (!page.enterGuard) continue
    const pathname = lowcodeNavigationPathname(page.enterGuard.fallback)
    const matches = pages.filter((candidate) => lowcodeRouteMatches(candidate.route, pathname))
    if (matches.length !== 1)
      return {
        ok: false,
        pageId: page.pageId,
        reason: 'Entry fallback must resolve to exactly one active application page.'
      }
    const target = matches[0]
    if (target.pageId === page.pageId)
      return {
        ok: false,
        pageId: page.pageId,
        reason: 'Entry fallback cannot resolve to the guarded page itself.'
      }
    fallbacks.set(page.pageId, target.pageId)
  }
  for (const pageId of fallbacks.keys()) {
    const seen = new Set<string>()
    let current: string | undefined = pageId
    while (current !== undefined) {
      if (seen.has(current))
        return {
          ok: false,
          pageId,
          reason: 'Entry fallback routes cannot form a static cycle.'
        }
      seen.add(current)
      current = fallbacks.get(current)
    }
  }
  return { ok: true }
}
