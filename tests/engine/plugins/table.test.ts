import { describe, expect, test } from 'bun:test'

import {
  BUILTIN_PLUGIN_REGISTRY,
  TABLE_MODULE_LIMITS,
  createTableModuleInstance,
  resolveTableModule
} from '@open-pencil/core/plugins'

function sparseArray<T>(length: number): T[] {
  const value: T[] = []
  value.length = length
  return value
}

describe('built-in table plugin', () => {
  test('registers a structured three-column, three-row default', () => {
    const definition = BUILTIN_PLUGIN_REGISTRY.getModule('open-pencil.table', 'table')
    const instance = createTableModuleInstance()
    const resolved = resolveTableModule(instance)

    expect(definition?.name).toBe('Table')
    expect(definition?.defaultSize).toEqual({ width: 720, height: 360 })
    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('expected table module to resolve')
    expect(resolved.config.table.columns).toHaveLength(3)
    expect(resolved.config.table.rows).toHaveLength(3)
    expect(resolved.config.table.rows.every((row) => row.length === 3)).toBe(true)
  })

  test('accepts empty row sets and returns defensive structured copies', () => {
    const table = { columns: ['Key', 'Value'], rows: [] as string[][] }
    const instance = createTableModuleInstance({ table, showHeader: false, striped: false })
    table.columns[0] = 'Changed'
    const resolved = resolveTableModule(instance)

    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('expected table module to resolve')
    expect(resolved.config.table).toEqual({ columns: ['Key', 'Value'], rows: [] })
  })

  test('rejects invalid dimensions and inconsistent row widths', () => {
    expect(() => createTableModuleInstance({ table: { columns: [], rows: [] } })).toThrow(
      `1 to ${TABLE_MODULE_LIMITS.columns}`
    )
    expect(() =>
      createTableModuleInstance({
        table: {
          columns: Array.from(
            { length: TABLE_MODULE_LIMITS.columns + 1 },
            (_, index) => `${index}`
          ),
          rows: []
        }
      })
    ).toThrow(`1 to ${TABLE_MODULE_LIMITS.columns}`)
    expect(() =>
      createTableModuleInstance({
        table: {
          columns: ['A'],
          rows: Array.from({ length: TABLE_MODULE_LIMITS.rows + 1 }, () => ['value'])
        }
      })
    ).toThrow(`at most ${TABLE_MODULE_LIMITS.rows}`)
    expect(() =>
      createTableModuleInstance({ table: { columns: ['A', 'B'], rows: [['only one']] } })
    ).toThrow('exactly 2 cells')
  })

  test('rejects sparse columns, rows, and cells instead of serializing holes as null', () => {
    expect(() =>
      createTableModuleInstance({ table: { columns: sparseArray<string>(1), rows: [] } })
    ).toThrow('columns[0] must be a string')
    expect(() =>
      createTableModuleInstance({ table: { columns: ['A'], rows: sparseArray<string[]>(1) } })
    ).toThrow('rows[0] must contain exactly 1 cells')
    expect(() =>
      createTableModuleInstance({ table: { columns: ['A'], rows: [sparseArray<string>(1)] } })
    ).toThrow('rows[0][0] must be a string')
  })

  test('bounds cell and aggregate text and validates presentation fields', () => {
    expect(() =>
      createTableModuleInstance({
        table: { columns: ['A'], rows: [['x'.repeat(TABLE_MODULE_LIMITS.cellText + 1)]] }
      })
    ).toThrow(`at most ${TABLE_MODULE_LIMITS.cellText}`)

    const largeCell = 'x'.repeat(TABLE_MODULE_LIMITS.cellText)
    expect(() =>
      createTableModuleInstance({
        table: {
          columns: Array.from({ length: TABLE_MODULE_LIMITS.columns }, () => largeCell),
          rows: Array.from({ length: 4 }, () =>
            Array.from({ length: TABLE_MODULE_LIMITS.columns }, () => largeCell)
          )
        }
      })
    ).toThrow(`not exceed ${TABLE_MODULE_LIMITS.totalText}`)

    expect(() => createTableModuleInstance({ borderColor: 'red' })).toThrow('#RRGGBB')
    expect(() =>
      createTableModuleInstance({ fontSize: TABLE_MODULE_LIMITS.fontSizeMax + 1 })
    ).toThrow('fontSize must be between')
    expect(() =>
      createTableModuleInstance({ table: { columns: ['A'], rows: [], extra: true } })
    ).toThrow('exactly columns and rows')
  })
})
