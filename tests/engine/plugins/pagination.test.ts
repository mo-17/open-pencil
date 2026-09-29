import { expect, test } from 'bun:test'

import {
  PAGINATION_MODULE_DEFAULT_CONFIG,
  createPaginationModuleFrameOverrides,
  createPaginationModuleInstance,
  resolvePaginationModule,
  paginationItems,
  paginationPageCount,
  clampPaginationPage,
  paginationLayout
} from '#core/plugins/pagination'

test('Pagination validates bounded exact authored data without evaluating accessors', () => {
  const instance = createPaginationModuleInstance()
  expect(resolvePaginationModule(instance)?.ok).toBe(true)
  expect(resolvePaginationModule({ ...instance, configVersion: 2 })?.ok).toBe(false)
  expect(resolvePaginationModule({ ...instance, pluginId: 'other.plugin' })).toBeNull()
  for (const config of [
    { total: -1 },
    { total: 1_000_000_001 },
    { total: 1.5 },
    { total: '12' },
    { pageSize: 0 },
    { pageSize: 1001 },
    { initialPage: 0 },
    { initialPage: Infinity },
    { fontSize: 9 },
    { borderRadius: 25 },
    { size: 'wide' },
    { disabled: 0 },
    { label: '' },
    { label: ' ' },
    { label: 'x'.repeat(121) },
    { textColor: 'url(https://example.com)' },
    { backgroundColor: '#fff' },
    { onPageChange: 'execute()' },
    { endpoint: 'https://example.com' }
  ])
    expect(() => createPaginationModuleInstance(config)).toThrow()
  let reads = 0
  const config = Object.defineProperty({}, 'total', {
    enumerable: true,
    get() {
      reads++
      return 10
    }
  })
  expect(() => createPaginationModuleInstance(config)).toThrow()
  expect(reads).toBe(0)
  const first = createPaginationModuleInstance(),
    second = createPaginationModuleInstance()
  first.config.total = 999
  expect(second.config).toEqual(PAGINATION_MODULE_DEFAULT_CONFIG)
  expect(createPaginationModuleFrameOverrides().fills).toEqual([])
})

test('Pagination projects empty collections and total reductions without mutating authored state', () => {
  expect(paginationPageCount(0, 10)).toBe(0)
  expect(paginationPageCount(21, 10)).toBe(3)
  expect(clampPaginationPage(50, 3)).toBe(3)
  expect(clampPaginationPage(-1, 3)).toBe(1)
  expect(clampPaginationPage(Number.NaN, 3)).toBe(1)
  expect(clampPaginationPage(1, 0)).toBe(0)
  const config = { ...PAGINATION_MODULE_DEFAULT_CONFIG, total: 0, initialPage: 99 }
  const layout = paginationLayout(320, config)
  expect(layout.page).toBe(0)
  expect(layout.pageCount).toBe(0)
  expect(layout.cells.every((cell) => cell.disabled)).toBe(true)
  expect(layout.cells.find((cell) => cell.kind === 'summary')?.text).toBe('0 / 0')
  expect(config.initialPage).toBe(99)
})

test('Pagination ellipsis remains constant bounded for a billion pages', () => {
  expect(paginationItems(5, 10)).toEqual([1, 'ellipsis-start', 4, 5, 6, 'ellipsis-end', 10])
  expect(paginationItems(1, 10)).toEqual([1, 2, 3, 4, 5, 'ellipsis-end', 10])
  expect(paginationItems(10, 10)).toEqual([1, 'ellipsis-start', 6, 7, 8, 9, 10])
  expect(paginationItems(1, 0)).toEqual([])
  for (const total of [1, 5, 7, 8, 10, 1000, 1_000_000_000]) {
    for (const requested of [1, 2, 3, 4, 5, Math.floor(total / 2), total - 2, total - 1, total]) {
      for (const compact of [false, true]) {
        const page = clampPaginationPage(requested, total)
        const items = paginationItems(page, total, compact)
        expect(items.length).toBeLessThanOrEqual(compact ? 5 : 7)
        const pages = items.filter((item): item is number => typeof item === 'number')
        expect(pages).toContain(page)
        expect(pages).toEqual([...new Set(pages)].sort((a, b) => a - b))
        expect(pages[0]).toBe(1)
        expect(pages.at(-1)).toBe(total)
      }
    }
  }
})

test('Pagination fits actual container widths including large page numbers and disabled boundaries', () => {
  for (const width of [0, 4, 24, 80, 180, 320, 420, 1200]) {
    for (const total of [0, 100, 1_000_000_000]) {
      const config = {
        ...PAGINATION_MODULE_DEFAULT_CONFIG,
        total,
        pageSize: 1,
        initialPage: 500_000_000,
        showFirstLast: true,
        fontSize: 24
      }
      const layout = paginationLayout(width, config)
      expect(layout.width).toBeLessThanOrEqual(width + 0.001)
      for (const cell of layout.cells) {
        expect(cell.x).toBeGreaterThanOrEqual(0)
        expect(cell.width).toBeGreaterThanOrEqual(0)
        expect(cell.x + cell.width).toBeLessThanOrEqual(width + 0.001)
      }
      expect(layout.cells.length).toBeLessThanOrEqual(11)
    }
  }
  const initial = paginationLayout(420, { ...PAGINATION_MODULE_DEFAULT_CONFIG })
  expect(initial.cells.find((cell) => cell.kind === 'previous')?.disabled).toBe(true)
  expect(initial.cells.find((cell) => cell.kind === 'next')?.disabled).toBe(false)
  const disabled = paginationLayout(420, { ...PAGINATION_MODULE_DEFAULT_CONFIG, disabled: true })
  expect(disabled.cells.every((cell) => cell.disabled)).toBe(true)
})

test('narrow large-page summaries preserve complete numbers and usable navigation targets', () => {
  for (const size of ['comfortable', 'compact'] as const) {
    for (const width of [180, 200, 210]) {
      const layout = paginationLayout(width, {
        ...PAGINATION_MODULE_DEFAULT_CONFIG,
        total: 1_000_000_000,
        pageSize: 1,
        initialPage: 100_000_000,
        showFirstLast: true,
        fontSize: 24,
        size
      })
      const summary = layout.cells.find((cell) => cell.kind === 'summary')
      expect(summary?.text).toBe('100000000\n/ 1000000000')
      for (const cell of layout.cells.filter((cell) => cell.page !== null))
        expect(cell.width).toBeGreaterThanOrEqual(24)
      expect(layout.buttonSize).toBe(size === 'compact' ? 36 : 44)
      expect(layout.fontSize).toBeGreaterThanOrEqual(10)
      expect(layout.fontSize * 3).toBeLessThanOrEqual(layout.buttonSize)
      expect(layout.width).toBeLessThanOrEqual(width)
    }
  }
})
