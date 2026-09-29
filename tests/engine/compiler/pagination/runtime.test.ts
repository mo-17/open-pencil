import { expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'

import {
  PAGINATION_CONFIG_SOURCE,
  PAGINATION_MATH_SOURCE
} from '#compiler/adapters/pagination/source'

import {
  PAGINATION_MODULE_DEFAULT_CONFIG,
  paginationLayout,
  type PaginationLayout,
  type PaginationModuleConfigV1
} from '@open-pencil/core/plugins'

interface RuntimeProjection extends PaginationLayout {
  invalid: boolean
  empty: boolean
  disabled: boolean
  clamped: boolean
}
interface Inputs {
  currentPage?: unknown
  currentPageBound?: boolean
  total?: unknown
  totalBound?: boolean
  pageSize?: unknown
  pageSizeBound?: boolean
}
interface Runtime {
  paginationLayout: typeof paginationLayout
  paginationProjection(
    config: PaginationModuleConfigV1,
    inputs: Inputs,
    local: number,
    width: number
  ): RuntimeProjection
  paginationStatus(layout: RuntimeProjection, zh: boolean): string
}
const source = new Bun.Transpiler({ loader: 'ts', target: 'browser' }).transformSync(
  PAGINATION_CONFIG_SOURCE + '\n' + PAGINATION_MATH_SOURCE
)
const math = runInNewContext(
  source + '\n({paginationLayout,paginationProjection,paginationStatus})'
) as Runtime

test('generated Pagination and Canvas share bounded geometry across empty, huge and narrow layouts', () => {
  for (const size of ['comfortable', 'compact'] as const)
    for (const total of [0, 1, 50, 100, 1000, 1_000_000_000])
      for (const width of [0, 80, 180, 320, 375, 440, 1000])
        for (const current of [1, 3, 5, 50, 1_000_000_000])
          for (const showFirstLast of [false, true]) {
            const config = { ...PAGINATION_MODULE_DEFAULT_CONFIG, size, total, showFirstLast }
            const layout = math.paginationLayout(width, config, current)
            expect(layout).toEqual(paginationLayout(width, config, current))
            expect(layout.cells.length).toBeLessThanOrEqual(11)
            expect(layout.width).toBeLessThanOrEqual(width)
          }
})
for (const key of ['currentPage', 'total', 'pageSize'] as const)
  test(`${key} invalid bound values stay unavailable without coercion or fallback`, () => {
    for (const value of [
      undefined,
      null,
      '10',
      true,
      {},
      [],
      Number.NaN,
      Infinity,
      -1,
      1.5,
      1_000_000_001
    ]) {
      const inputs = { [key]: value, [key + 'Bound']: true }
      const projected = math.paginationProjection(
        { ...PAGINATION_MODULE_DEFAULT_CONFIG },
        inputs,
        1,
        375
      )
      expect(projected.invalid).toBe(true)
      expect(projected.disabled).toBe(true)
      expect(
        projected.cells.filter((cell) => cell.page !== null).every((cell) => cell.disabled)
      ).toBe(true)
      expect(math.paginationStatus(projected, false)).toContain('unavailable')
    }
  })
test('total reduction clamps display without mutating business inputs and restores the requested page', () => {
  const config = { ...PAGINATION_MODULE_DEFAULT_CONFIG },
    inputs = { currentPage: 8, currentPageBound: true, total: 5, totalBound: true }
  expect(math.paginationProjection(config, inputs, 1, 375)).toMatchObject({
    page: 1,
    pageCount: 1,
    clamped: true,
    invalid: false
  })
  expect(inputs.currentPage).toBe(8)
  expect(math.paginationProjection(config, { ...inputs, total: 100 }, 1, 375)).toMatchObject({
    page: 8,
    pageCount: 10,
    clamped: false
  })
  expect(math.paginationProjection(config, { ...inputs, total: 0 }, 1, 375)).toMatchObject({
    page: 0,
    pageCount: 0,
    empty: true,
    invalid: false
  })
})
test('disabled config and zero or excessive page size cannot navigate', () => {
  expect(
    math
      .paginationProjection({ ...PAGINATION_MODULE_DEFAULT_CONFIG, disabled: true }, {}, 1, 375)
      .cells.every((cell) => cell.disabled)
  ).toBe(true)
  for (const pageSize of [0, 1001])
    expect(
      math.paginationProjection(
        { ...PAGINATION_MODULE_DEFAULT_CONFIG },
        { pageSize, pageSizeBound: true },
        1,
        375
      ).invalid
    ).toBe(true)
})
