import { DATA_GRID_MODULE_LIMITS } from '@open-pencil/core/plugins'

/** Portable checked-data reader shared by both generated web targets. */
export const DATA_GRID_ROWS_RUNTIME = `const DATA_GRID_ROWS_LIMITS = ${JSON.stringify(DATA_GRID_MODULE_LIMITS)}

/** Bound rows are untrusted data. Read own data descriptors and clone accepted cells. */
function resolveBoundDataGridRows(
  value: unknown,
  columns: readonly OpenPencilDataGridColumn[]
): { ok: boolean; rows: readonly OpenPencilDataGridRow[] } {
  try {
    const limits = DATA_GRID_ROWS_LIMITS
    if (!Array.isArray(value) || value.length > limits.rows || !dataGridPlainDenseArray(value)) throw new TypeError('rows')
    if (value.length * columns.length > limits.cells) throw new TypeError('cells')
    let text = columns.reduce((total, column) => total + column.label.length, 0)
    const ids = new Set<string>()
    const rows = Array.from({ length: value.length }, (_, rowIndex) => {
      const source = dataGridOwnData(value, String(rowIndex))
      if (!source || typeof source !== 'object' || Array.isArray(source)) throw new TypeError('row')
      const prototype = Object.getPrototypeOf(source)
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError('row prototype')
      const keys = Reflect.ownKeys(source)
      if (keys.length !== 2 || !keys.includes('id') || !keys.includes('cells')) throw new TypeError('row keys')
      const id = dataGridOwnData(source, 'id')
      const cells = dataGridOwnData(source, 'cells')
      if (typeof id !== 'string' || id.length > limits.id || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(id) || ids.has(id)) throw new TypeError('row id')
      ids.add(id)
      if (!Array.isArray(cells) || cells.length !== columns.length || !dataGridPlainDenseArray(cells)) throw new TypeError('row cells')
      const accepted = columns.map((column, columnIndex): OpenPencilDataGridCell => {
        const cell = dataGridOwnData(cells, String(columnIndex))
        if (cell === null) return null
        if (column.type === 'text' && typeof cell === 'string' && cell.length <= limits.cellText) {
          text += cell.length
          return cell
        }
        if (column.type === 'number' && typeof cell === 'number' && Number.isFinite(cell)) return cell
        if (column.type === 'boolean' && typeof cell === 'boolean') return cell
        if (column.type === 'date' && typeof cell === 'string' && dataGridCanonicalDate(cell)) {
          text += cell.length
          return cell
        }
        throw new TypeError('cell type')
      })
      return { id, cells: accepted }
    })
    if (text > limits.totalText) throw new TypeError('text budget')
    const source = JSON.stringify({ columns, rows })
    if (source.length > limits.configBytes || new TextEncoder().encode(source).byteLength > limits.configBytes) throw new TypeError('data byte budget')
    return { ok: true, rows }
  } catch {
    return { ok: false, rows: [] }
  }
}

function dataGridOwnData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('own data required')
  return descriptor.value
}

function dataGridCanonicalDate(value: string): boolean {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00.000Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function dataGridPlainDenseArray(value: unknown[]): boolean {
  const prototype = Object.getPrototypeOf(value)
  return (prototype === Array.prototype || prototype === null) && Reflect.ownKeys(value).length === value.length + 1
}
`
