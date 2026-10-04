import { describe, expect, test } from 'bun:test'

import { DATA_GRID_ROWS_RUNTIME } from '#compiler/adapters/data-grid/rows'

import {
  DATA_GRID_MODULE_DEFAULT_CONFIG,
  resolveDataGridRows,
  type DataGridColumnV1,
  type DataGridRowsResolution
} from '#core/plugins/data-grid'

const columns: DataGridColumnV1[] = [
  { ...DATA_GRID_MODULE_DEFAULT_CONFIG.data.columns[0], id: 'text', type: 'text' },
  { ...DATA_GRID_MODULE_DEFAULT_CONFIG.data.columns[0], id: 'number', type: 'number' },
  { ...DATA_GRID_MODULE_DEFAULT_CONFIG.data.columns[0], id: 'boolean', type: 'boolean' },
  { ...DATA_GRID_MODULE_DEFAULT_CONFIG.data.columns[0], id: 'date', type: 'date' }
]
const valid = [{ id: 'first', cells: ['<img src=x onerror=alert(1)>', 42, true, '2024-02-29'] }]
const source = new Bun.Transpiler({ loader: 'ts' }).transformSync(DATA_GRID_ROWS_RUNTIME)
const runtime = new Function(source + '\nreturn resolveBoundDataGridRows')() as (
  value: unknown,
  columns: readonly DataGridColumnV1[]
) => Pick<DataGridRowsResolution, 'ok' | 'rows'>

function both(value: unknown, configuredColumns = columns) {
  const core = resolveDataGridRows(value, configuredColumns)
  expect(runtime(value, configuredColumns)).toEqual({ ok: core.ok, rows: core.rows })
  return core
}

describe('bound data grid rows preserve core and generated validation parity', () => {
  test('clones typed data, preserves literal markup, and accepts explicit empty and null cells', () => {
    const parsed = both(valid)
    expect(parsed.ok).toBe(true)
    expect(parsed.rows).toEqual(valid)
    expect(parsed.rows).not.toBe(valid)
    expect(parsed.rows[0].cells).not.toBe(valid[0].cells)
    expect(both([])).toEqual({ ok: true, rows: [] })
    expect(both([{ id: 'nulls', cells: [null, null, null, null] }]).ok).toBe(true)
  })

  test.each([
    undefined,
    null,
    'rows',
    {},
    [null],
    [{ id: 'first', cells: [] }],
    [{ id: 'first', cells: ['text', '42', true, '2024-02-29'] }],
    [{ id: 'first', cells: ['text', Infinity, true, '2024-02-29'] }],
    [{ id: 'first', cells: ['text', 42, 'true', '2024-02-29'] }],
    [{ id: 'first', cells: ['text', 42, true, '2023-02-29'] }],
    [{ id: 'first', cells: ['text', 42, true, '2024-2-29'] }],
    [{ id: 'first', cells: ['text', 42, true, '2024-02-29'], extra: true }],
    [{ id: '1first', cells: ['text', 42, true, '2024-02-29'] }],
    [...valid, ...valid]
  ])('rejects invalid rows without retaining source content %#', (value) => {
    expect(both(value)).toEqual({
      ok: false,
      rows: [],
      reason: 'Bound data grid rows are unavailable.'
    })
  })

  test('rejects sparse, accessor and inherited rows without invoking getters', () => {
    let reads = 0
    const row = Object.defineProperty({ cells: valid[0].cells }, 'id', {
      enumerable: true,
      get() {
        reads += 1
        return 'first'
      }
    })
    const array: unknown[] = []
    Object.defineProperty(array, '0', {
      enumerable: true,
      get() {
        reads += 1
        return valid[0]
      }
    })
    const cells: unknown[] = ['text', 42, true]
    Object.defineProperty(cells, '3', {
      enumerable: true,
      get() {
        reads += 1
        return '2024-02-29'
      }
    })
    const inherited = Object.assign(Object.create({ hidden: true }) as object, valid[0])
    const sparse: unknown[] = []
    sparse.length = 1
    const exotic = [...valid]
    Object.setPrototypeOf(exotic, {})
    for (const value of [sparse, [row], array, [{ id: 'first', cells }], [inherited], exotic])
      expect(both(value).ok).toBe(false)
    expect(reads).toBe(0)
  })

  test('enforces row, cell, field text, aggregate text, id and UTF-8 byte budgets', () => {
    const textColumn = columns.slice(0, 1)
    const rows = (count: number, cell: string) =>
      Array.from({ length: count }, (_, index) => ({ id: 'row' + index, cells: [cell] }))
    expect(both(rows(201, ''), textColumn).ok).toBe(false)
    expect(both(rows(1, 'x'.repeat(2001)), textColumn).ok).toBe(false)
    expect(both(rows(21, 'x'.repeat(2000)), textColumn).ok).toBe(false)
    expect(both(rows(13, '😀'.repeat(1000)), textColumn).ok).toBe(false)
    expect(both([{ id: 'x'.repeat(65), cells: ['text'] }], textColumn).ok).toBe(false)
    const manyColumns = Array.from({ length: 16 }, (_, index) => ({
      ...columns[1],
      id: 'column' + index
    }))
    expect(
      both(
        Array.from({ length: 126 }, (_, index) => ({
          id: 'row' + index,
          cells: Array.from({ length: 16 }, () => 1)
        })),
        manyColumns
      ).ok
    ).toBe(false)
  })
})
