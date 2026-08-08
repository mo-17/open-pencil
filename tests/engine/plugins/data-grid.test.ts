import { describe, expect, test } from 'bun:test'

import {
  DATA_GRID_MODULE_LIMITS,
  createDataGridModuleInstance,
  resolveDataGridModule,
  type DataGridColumnV1
} from '#core/plugins/data-grid'

const COLUMNS: DataGridColumnV1[] = [
  {
    id: 'name',
    label: 'Name',
    type: 'text',
    align: 'start',
    width: 200,
    sortable: true,
    filterable: true
  },
  {
    id: 'score',
    label: 'Score',
    type: 'number',
    align: 'end',
    width: 100,
    sortable: true,
    filterable: true
  },
  {
    id: 'active',
    label: 'Active',
    type: 'boolean',
    align: 'center',
    width: 90,
    sortable: false,
    filterable: true
  }
]

describe('built-in advanced data grid plugin', () => {
  test('accepts typed rows and returns defensive data, sort, and filter copies', () => {
    const data = {
      columns: COLUMNS,
      rows: [{ id: 'alpha', cells: ['Alpha', 42, true] }]
    }
    const instance = createDataGridModuleInstance({
      data,
      initialSort: { columnId: 'score', direction: 'descending' },
      filters: [{ columnId: 'name', operator: 'contains', value: 'ph' }]
    })
    data.rows[0].cells[0] = 'Changed'
    const resolved = resolveDataGridModule(instance)

    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('expected data grid module to resolve')
    expect(resolved.config.data.rows[0].cells).toEqual(['Alpha', 42, true])
    expect(resolved.config.initialSort).toEqual({ columnId: 'score', direction: 'descending' })
    expect(resolved.config.filters).toEqual([
      { columnId: 'name', operator: 'contains', value: 'ph' }
    ])
  })

  test('rejects duplicate identities, inconsistent rows, sparse cells, and type mismatches', () => {
    expect(() =>
      createDataGridModuleInstance({
        data: { columns: [COLUMNS[0], { ...COLUMNS[0] }], rows: [] }
      })
    ).toThrow('must be unique')
    expect(() =>
      createDataGridModuleInstance({
        data: { columns: COLUMNS, rows: [{ id: 'row', cells: ['only one'] }] }
      })
    ).toThrow('exactly 3 cells')
    const sparse: unknown[] = []
    sparse.length = 3
    expect(() =>
      createDataGridModuleInstance({
        data: { columns: COLUMNS, rows: [{ id: 'row', cells: sparse }] }
      })
    ).toThrow('must be present')
    expect(() =>
      createDataGridModuleInstance({
        data: { columns: COLUMNS, rows: [{ id: 'row', cells: ['Alpha', '42', true] }] }
      })
    ).toThrow('finite number')
  })

  test('validates referential integrity and operator compatibility for sort and filters', () => {
    const data = { columns: COLUMNS, rows: [] }
    expect(() =>
      createDataGridModuleInstance({
        data,
        initialSort: { columnId: 'missing', direction: 'ascending' }
      })
    ).toThrow('existing column')
    expect(() =>
      createDataGridModuleInstance({
        data,
        initialSort: { columnId: 'active', direction: 'ascending' }
      })
    ).toThrow('must be sortable')
    expect(() =>
      createDataGridModuleInstance({
        data,
        filters: [{ columnId: 'active', operator: 'contains', value: true }]
      })
    ).toThrow('invalid for boolean')
    expect(() =>
      createDataGridModuleInstance({
        data,
        filters: [
          { columnId: 'name', operator: 'equals', value: 'A' },
          { columnId: 'name', operator: 'contains', value: 'B' }
        ]
      })
    ).toThrow('at most once')
  })

  test('enforces column, cell, text, page, presentation, and byte budgets', () => {
    expect(() =>
      createDataGridModuleInstance({
        data: {
          columns: Array.from({ length: DATA_GRID_MODULE_LIMITS.columns + 1 }, (_, index) => ({
            ...COLUMNS[0],
            id: `column_${index}`
          })),
          rows: []
        }
      })
    ).toThrow(`1 to ${DATA_GRID_MODULE_LIMITS.columns}`)
    expect(() => createDataGridModuleInstance({ pageSize: 1 })).toThrow('pageSize must be between')
    expect(() => createDataGridModuleInstance({ density: 'tiny' })).toThrow(
      'compact or comfortable'
    )
    expect(() => createDataGridModuleInstance({ borderColor: 'red' })).toThrow('#RRGGBB')
    expect(() =>
      createDataGridModuleInstance({
        data: {
          columns: COLUMNS,
          rows: Array.from({ length: 20 }, (_, index) => ({
            id: `row_${index}`,
            cells: ['x'.repeat(DATA_GRID_MODULE_LIMITS.cellText), index, true]
          }))
        }
      })
    ).toThrow('text must not exceed')
    expect(() =>
      createDataGridModuleInstance({
        data: {
          columns: COLUMNS,
          rows: Array.from({ length: 12 }, (_, index) => ({
            id: `wide_${index}`,
            cells: ['界'.repeat(1_500), index, true]
          }))
        }
      })
    ).toThrow('encoded bytes')
  })
})
