import type { IRTree } from '#compiler/ir/types'

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

const SLUG_NON_ALPHANUM = /[^a-z0-9]+/g
const SLUG_TRIM_DASH = /^-+|-+$/g

export function derivePagePaths(irs: readonly IRTree[]): PagePathInfo[] {
  const used = new Set<string>()
  const out: PagePathInfo[] = []
  for (let i = 0; i < irs.length; i++) {
    const ir = irs[i]
    let originalSlug: string
    if (i === 0) {
      originalSlug = 'index'
    } else {
      const raw = ir.pageName.toLowerCase().replace(SLUG_NON_ALPHANUM, '-').replace(SLUG_TRIM_DASH, '')
      originalSlug = raw === '' ? `page-${i}` : raw
    }
    let slug = originalSlug
    // Collision with an earlier slug (or with the reserved 'index' for non-first pages).
    if (used.has(slug) || (i > 0 && slug === 'index')) {
      slug = `${originalSlug}-${i}`
    }
    used.add(slug)
    // Phase 4 §16.1: a page may declare an explicit dynamic route pattern
    // (`/product/:id`); it overrides the slug-derived path. The slug / file /
    // component name still derive from the page name (the pattern only changes
    // the `<Route path>`).
    const route = ir.routePattern ?? (slug === 'index' ? '/' : `/${slug}`)
    out.push({
      ir,
      pageId: ir.pageId,
      slug,
      originalSlug,
      route,
      file: `${slug}.tsx`,
      component: componentNameFromSlug(slug)
    })
  }
  return out
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
