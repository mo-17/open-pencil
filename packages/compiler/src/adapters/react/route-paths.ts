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
    const route = slug === 'index' ? '/' : `/${slug}`
    out.push({
      ir,
      slug,
      originalSlug,
      route,
      file: `${slug}.tsx`,
      component: componentNameFromSlug(slug)
    })
  }
  return out
}

function componentNameFromSlug(slug: string): string {
  const pascal = slug
    .split('-')
    .map((part) => (part.length === 0 ? '' : part[0].toUpperCase() + part.slice(1)))
    .join('')
  return `Page${pascal}`
}
