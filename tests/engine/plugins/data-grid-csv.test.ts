import { describe, expect, test } from 'bun:test'

import {
  DATA_GRID_CSV_LIMITS,
  exportDataGridCsv,
  parseDataGridCsv,
  type DataGridColumnV1,
  type DataGridDataV1
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
  },
  {
    id: 'date',
    label: 'Date',
    type: 'date',
    align: 'start',
    width: 140,
    sortable: true,
    filterable: true
  }
]

describe('advanced data grid CSV helpers', () => {
  test('parses BOM, RFC4180 quoting, escaped quotes, typed cells, and LF paste text', () => {
    const result = parseDataGridCsv(
      '\uFEFF"Name",Score,Active,Date\n"Alpha, ""A""",42.5,true,2026-08-09\nBeta,,,',
      COLUMNS
    )

    expect(result).toEqual({
      rowCount: 2,
      columnCount: 4,
      data: {
        columns: COLUMNS,
        rows: [
          { id: 'csv_row_1', cells: ['Alpha, "A"', 42.5, true, '2026-08-09'] },
          { id: 'csv_row_2', cells: ['Beta', null, null, null] }
        ]
      }
    })
    expect(result.data.columns).not.toBe(COLUMNS)
  })

  test('rejects malformed records, unsafe controls, extra columns, and locale-dependent types', () => {
    expect(() =>
      parseDataGridCsv('Name,Score,Active,Date\rAlpha,1,true,2026-08-09', COLUMNS)
    ).toThrow('malformed CR')
    expect(() =>
      parseDataGridCsv('Name,Score,Active,Date\nA\0,1,true,2026-08-09', COLUMNS)
    ).toThrow('NUL')
    expect(() =>
      parseDataGridCsv('Name,Score,Active,Date\nA,1,true,2026-08-09,extra', COLUMNS)
    ).toThrow('exactly 4 columns')
    expect(() =>
      parseDataGridCsv('Name,Score,Active,Date\nA,"1,5",true,2026-08-09', COLUMNS)
    ).toThrow('locale-independent JSON number')
    expect(() => parseDataGridCsv('Name,Score,Active,Date\nA,1,TRUE,2026-08-09', COLUMNS)).toThrow(
      'true, false, or empty'
    )
    expect(() => parseDataGridCsv('Name,Score,Active,Date\nA,1,true,09/08/2026', COLUMNS)).toThrow(
      'canonical YYYY-MM-DD'
    )
    expect(() => parseDataGridCsv('Name,Score,Active,Date\n"unterminated', COLUMNS)).toThrow(
      'unterminated quoted field'
    )
  })

  test('exports CRLF RFC4180 text and neutralizes spreadsheet formulas only in string fields', () => {
    const columns: DataGridColumnV1[] = COLUMNS.map((column) => ({ ...column }))
    columns[0].label = '=Display name'
    const data: DataGridDataV1 = {
      columns,
      rows: [
        {
          id: 'formula',
          cells: ['\u00A0 +SUM(A1:A2)', -42, true, '2026-08-09']
        },
        {
          id: 'quoted',
          cells: ['Hello, "world"\nnext', 0, false, null]
        }
      ]
    }

    const result = exportDataGridCsv(data)

    expect(result.sanitizedFormulaFieldCount).toBe(2)
    expect(result.text).toBe(
      '\'=Display name,Score,Active,Date\r\n\'\u00A0 +SUM(A1:A2),-42,true,2026-08-09\r\n"Hello, ""world""\nnext",0,false,\r\n'
    )
  })

  test('enforces byte, record, and field budgets before returning data', () => {
    expect(() => parseDataGridCsv('x'.repeat(DATA_GRID_CSV_LIMITS.bytes + 1), COLUMNS)).toThrow(
      'must not exceed'
    )
    const header = COLUMNS.map((column) => column.label).join(',')
    const row = 'A,1,true,2026-08-09'
    const tooManyRows = [header, ...Array.from({ length: 201 }, () => row)].join('\n')
    expect(() => parseDataGridCsv(tooManyRows, COLUMNS)).toThrow('records')
    expect(() =>
      parseDataGridCsv(
        `${header}\n${'x'.repeat(DATA_GRID_CSV_LIMITS.fieldText + 1)},1,true,2026-08-09`,
        COLUMNS
      )
    ).toThrow('fields must not exceed')
  })
})
