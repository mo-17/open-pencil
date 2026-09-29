import type { PaginationModuleConfigV1 } from '#core/plugins/pagination'

import { clampPaginationPage, paginationItems, paginationPageCount } from './pages'
import type { PaginationItem } from './pages'

export const PAGINATION_LAYOUT = Object.freeze({
  comfortable: 44,
  compact: 36,
  gap: 4,
  digitWidth: 0.65,
  horizontalPadding: 16
})
export type PaginationCellKind =
  | 'page'
  | 'ellipsis'
  | 'first'
  | 'previous'
  | 'next'
  | 'last'
  | 'summary'
export interface PaginationCell {
  key: string
  kind: PaginationCellKind
  text: string
  page: number | null
  active: boolean
  disabled: boolean
  x: number
  width: number
}
export interface PaginationLayout {
  mode: 'full' | 'compact' | 'summary'
  page: number
  pageCount: number
  buttonSize: number
  gap: number
  fontSize: number
  width: number
  cells: PaginationCell[]
}

/** Standalone deterministic projection, also emitted into both generated web targets. */
export function paginationLayout(
  width: number,
  config: PaginationModuleConfigV1,
  requestedPage = config.initialPage
): PaginationLayout {
  const available = Math.max(0, Number.isFinite(width) ? width : 0)
  const pageCount = paginationPageCount(config.total, config.pageSize)
  const page = clampPaginationPage(requestedPage, pageCount)
  const buttonSize = PAGINATION_LAYOUT[config.size]
  const gap = Math.min(PAGINATION_LAYOUT.gap, available / 4)
  let fontSize = config.fontSize
  const cells: PaginationCell[] = []
  const textWidth = (text: string) =>
    Math.max(
      buttonSize,
      Math.ceil(
        text.length * fontSize * PAGINATION_LAYOUT.digitWidth + PAGINATION_LAYOUT.horizontalPadding
      )
    )
  const navCount = config.showFirstLast ? 4 : 2
  const measure = (items: PaginationItem[]) =>
    items.reduce<number>(
      (sum, item) => sum + textWidth(typeof item === 'number' ? String(item) : '…'),
      0
    ) +
    navCount * buttonSize +
    Math.max(0, items.length + navCount - 1) * gap
  let mode: PaginationLayout['mode'] = config.size === 'compact' ? 'compact' : 'full'
  let items = paginationItems(page, pageCount, mode === 'compact')
  if (measure(items) > available) {
    mode = 'compact'
    items = paginationItems(page, pageCount, true)
  }
  if (pageCount === 0 || measure(items) > available) mode = 'summary'
  let firstLast = config.showFirstLast
  let summaryWidth = 0
  let navigationWidth: number = buttonSize
  let summaryText = `${page} / ${pageCount}`
  if (mode === 'summary') {
    const minimumText =
      summaryText.length * 10 * PAGINATION_LAYOUT.digitWidth + PAGINATION_LAYOUT.horizontalPadding
    if (firstLast && available < buttonSize * 4 + gap * 4 + minimumText) firstLast = false
    const navigation = firstLast ? 4 : 2
    if (available < minimumText + navigation * (24 + gap)) summaryText = `${page}\n/ ${pageCount}`
    const longestLine = Math.max(...summaryText.split('\n').map((line) => line.length))
    const minimumSummary =
      longestLine * 10 * PAGINATION_LAYOUT.digitWidth + PAGINATION_LAYOUT.horizontalPadding
    const reservedText = Math.min(
      minimumSummary,
      Math.max(0, available - navigation * (Math.min(24, available / (navigation + 1)) + gap))
    )
    navigationWidth = Math.min(
      buttonSize,
      Math.max(0, (available - reservedText - gap * navigation) / navigation)
    )
    summaryWidth = Math.max(0, available - navigation * (navigationWidth + gap))
    fontSize = Math.min(
      fontSize,
      buttonSize / (summaryText.includes('\n') ? 3 : 1.5),
      Math.max(
        10,
        (summaryWidth - PAGINATION_LAYOUT.horizontalPadding) /
          (longestLine * PAGINATION_LAYOUT.digitWidth)
      )
    )
  }
  const append = (
    kind: PaginationCellKind,
    text: string,
    target: number | null,
    cellWidth: number,
    key: string = kind
  ) => {
    const boundary =
      kind === 'previous' || kind === 'first'
        ? page <= 1
        : (kind === 'next' || kind === 'last') && page >= pageCount
    cells.push({
      key,
      kind,
      text,
      page: target,
      active: kind === 'page' && target === page,
      disabled:
        config.disabled || pageCount === 0 || boundary || (kind === 'page' && target === page),
      x: 0,
      width: cellWidth
    })
  }
  if (firstLast) append('first', '', 1, navigationWidth)
  append('previous', '', Math.max(1, page - 1), navigationWidth)
  if (mode === 'summary') append('summary', summaryText, null, summaryWidth)
  else
    for (const item of items) {
      if (typeof item === 'number')
        append('page', String(item), item, textWidth(String(item)), `page-${item}`)
      else append('ellipsis', '…', null, buttonSize, item)
    }
  append('next', '', Math.min(pageCount, page + 1), navigationWidth)
  if (firstLast) append('last', '', pageCount, navigationWidth)
  let x = 0
  for (const cell of cells) {
    cell.x = x
    x += cell.width + gap
  }
  return { mode, page, pageCount, buttonSize, gap, fontSize, width: Math.max(0, x - gap), cells }
}
