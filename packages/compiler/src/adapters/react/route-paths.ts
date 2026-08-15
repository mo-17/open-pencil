import type { IRTree } from '#compiler/ir/types'

import { deriveLowcodePageRoutes } from '@open-pencil/lowcode'

/**
 * Per-page routing metadata derived from a list of page IRs. Pure helper —
 * no side effects, no scene-graph access. Locked decision §11.3 #3:
 *
 *   - First page → slug 'index', route '/'.
 *   - Others   → slugify `pageName` (lowercase, `[^a-z0-9]+` → '-', trim '-').
 *   - Empty / non-ASCII names → fallback `page-${index}`.
 *   - Collisions (incl. 'index') → append `-${index}`.
 *
 * The collision suffix uses the position index, not a running counter, so the
 * output is order-stable regardless of how many earlier duplicates appeared.
 */
export interface PagePathInfo {
  /** Source page IR. */
  ir: IRTree
  /** SceneNode id of the page. Lifted from `ir.pageId` so editor-side
   *  consumers (e.g. Phase 2 §7 preview iframe bridge) can pageId↔slug
   *  round-trip without reaching into the IR. */
  pageId: string
  /** URL-safe identifier (no leading slash). 'index' for the first page. */
  slug: string
  /** Slug derived from `pageName` before any collision suffix. */
  originalSlug: string
  /** Browser route path. First page → '/'; others → '/<slug>'. */
  route: string
  /** Filename under `src/pages/`. e.g. 'index.tsx', 'about.tsx'. */
  file: string
  /** Default-exported function component identifier, e.g. 'PageAbout'. */
  component: string
}

export function derivePagePaths(irs: readonly IRTree[]): PagePathInfo[] {
  const routes = deriveLowcodePageRoutes(
    irs.map((ir) => ({
      pageId: ir.pageId,
      pageName: ir.pageName,
      routePattern: ir.routePattern
    }))
  )
  return routes.map(({ pageId, slug, originalSlug, route }, index) => ({
    ir: irs[index],
    pageId,
    slug,
    originalSlug,
    route,
    file: `${slug}.tsx`,
    component: componentNameFromSlug(slug)
  }))
}

/**
 * Look up the `PagePathInfo` for a given scene-graph page id. Returns
 * `undefined` when the page is not in the derived list (e.g. the editor
 * holds a stale id after a page was deleted). Phase 2 §7 — used by the
 * preview iframe bridge to map editor `currentPageId` to a route slug.
 */
export function findPageInfoByPageId(
  infos: readonly PagePathInfo[],
  pageId: string
): PagePathInfo | undefined {
  return infos.find((info) => info.pageId === pageId)
}

function componentNameFromSlug(slug: string): string {
  const pascal = slug
    .split('-')
    .map((part) => (part.length === 0 ? '' : part[0].toUpperCase() + part.slice(1)))
    .join('')
  return `Page${pascal}`
}
