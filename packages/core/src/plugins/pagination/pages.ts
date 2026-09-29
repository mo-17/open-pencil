export type PaginationItem = number | 'ellipsis-start' | 'ellipsis-end'

/** Empty collections have no page; the authored initial page stays unchanged. */
export function paginationPageCount(total: number, pageSize: number): number {
  return Math.max(0, Math.ceil(total / pageSize))
}

/** Projection only: reducing the total never silently rewrites an authored/bound page. */
export function clampPaginationPage(page: number, pageCount: number): number {
  return pageCount === 0
    ? 0
    : Math.max(1, Math.min(pageCount, Math.floor(Number.isFinite(page) ? page : 1)))
}

/** Work and output are constant-bounded, independent of total pages. */
export function paginationItems(
  page: number,
  pageCount: number,
  compact = false
): PaginationItem[] {
  const current = clampPaginationPage(page, pageCount)
  const limit = compact ? 5 : 7
  if (pageCount <= limit) return Array.from({ length: pageCount }, (_, index) => index + 1)
  const edge = compact ? 3 : 5
  if (current <= edge - 1 || (compact && current === 3)) {
    return [...Array.from({ length: edge }, (_, index) => index + 1), 'ellipsis-end', pageCount]
  }
  if (current >= pageCount - edge + 2 || (compact && current === pageCount - 2)) {
    return [
      1,
      'ellipsis-start',
      ...Array.from({ length: edge }, (_, index) => pageCount - edge + 1 + index)
    ]
  }
  return compact
    ? [1, 'ellipsis-start', current, 'ellipsis-end', pageCount]
    : [1, 'ellipsis-start', current - 1, current, current + 1, 'ellipsis-end', pageCount]
}
