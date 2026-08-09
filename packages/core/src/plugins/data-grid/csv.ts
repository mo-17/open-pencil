import type { DataGridCellV1, DataGridColumnV1, DataGridDataV1, DataGridRowV1 } from './index'

export interface DataGridCsvImportResult {
  data: DataGridDataV1
  rowCount: number
  columnCount: number
}

export interface DataGridCsvExportResult {
  text: string
  sanitizedFormulaFieldCount: number
}

export interface DataGridCsvContract {
  limits: Readonly<{
    bytes: number
    records: number
    fieldsPerRecord: number
    fields: number
    fieldText: number
  }>
  parseColumns(value: unknown): DataGridColumnV1[]
  parseData(value: unknown): DataGridDataV1
  parseCell(value: unknown, column: DataGridColumnV1, path: string): DataGridCellV1
}

const JSON_NUMBER_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/
const FORMULA_PREFIX_PATTERN = /^\s*[=+\-@]/u
const CSV_ENCODER = new TextEncoder()

function assertCsvByteLimit(value: string, path: string, contract: DataGridCsvContract): void {
  if (
    value.length > contract.limits.bytes ||
    CSV_ENCODER.encode(value).byteLength > contract.limits.bytes
  ) {
    throw new TypeError(`${path} must not exceed ${contract.limits.bytes} bytes`)
  }
}

function appendCsvFieldCharacter(
  field: string,
  character: string,
  contract: DataGridCsvContract
): string {
  const next = field + character
  if (next.length > contract.limits.fieldText) {
    throw new TypeError(
      `data grid CSV fields must not exceed ${contract.limits.fieldText} characters`
    )
  }
  return next
}

function consumeQuotedCsvCharacter(
  input: string,
  index: number,
  field: string,
  contract: DataGridCsvContract
): { field: string; index: number; closed: boolean } {
  const character = input[index]
  if (character === '"') {
    return input[index + 1] === '"'
      ? {
          field: appendCsvFieldCharacter(field, '"', contract),
          index: index + 1,
          closed: false
        }
      : { field, index, closed: true }
  }
  if (character === '\r') {
    if (input[index + 1] !== '\n') {
      throw new TypeError('data grid CSV contains a malformed CR line ending')
    }
    return {
      field: appendCsvFieldCharacter(field, '\r\n', contract),
      index: index + 1,
      closed: false
    }
  }
  return {
    field: appendCsvFieldCharacter(field, character, contract),
    index,
    closed: false
  }
}

function consumeCsvLineEnding(input: string, index: number): number {
  if (input[index] !== '\r') return index
  if (input[index + 1] !== '\n') {
    throw new TypeError('data grid CSV contains a malformed CR line ending')
  }
  return index + 1
}

function consumeUnquotedCsvCharacter(
  input: string,
  index: number,
  field: string,
  closedQuote: boolean,
  pushField: () => void,
  contract: DataGridCsvContract
): { field: string; quoted: boolean; closedQuote: boolean; recordEnded: boolean } {
  const character = input[index]
  if (closedQuote) {
    if (character === ',') {
      pushField()
      return { field: '', quoted: false, closedQuote: false, recordEnded: false }
    }
    if (character !== '\r' && character !== '\n') {
      throw new TypeError('data grid CSV contains characters after a closing quote')
    }
    return { field, quoted: false, closedQuote: true, recordEnded: true }
  }
  if (character === '"') {
    if (field.length > 0) {
      throw new TypeError('data grid CSV contains a quote in an unquoted field')
    }
    return { field, quoted: true, closedQuote: false, recordEnded: false }
  }
  if (character === ',') {
    pushField()
    return { field: '', quoted: false, closedQuote: false, recordEnded: false }
  }
  if (character !== '\r' && character !== '\n') {
    return {
      field: appendCsvFieldCharacter(field, character, contract),
      quoted: false,
      closedQuote: false,
      recordEnded: false
    }
  }
  return { field, quoted: false, closedQuote: false, recordEnded: true }
}

function parseCsvRecords(source: string, contract: DataGridCsvContract): string[][] {
  if (source.includes('\0')) throw new TypeError('data grid CSV must not contain NUL characters')
  assertCsvByteLimit(source, 'data grid CSV input', contract)
  const input = source.startsWith('\uFEFF') ? source.slice(1) : source
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  let closedQuote = false
  let endedWithRecordSeparator = false
  let fieldCount = 0

  const pushField = (): void => {
    record.push(field)
    field = ''
    fieldCount += 1
    if (record.length > contract.limits.fieldsPerRecord || fieldCount > contract.limits.fields) {
      throw new TypeError('data grid CSV exceeds the field limit')
    }
  }
  const pushRecord = (): void => {
    pushField()
    records.push(record)
    record = []
    if (records.length > contract.limits.records) {
      throw new TypeError(`data grid CSV must not exceed ${contract.limits.records} records`)
    }
  }

  for (let index = 0; index < input.length; index += 1) {
    endedWithRecordSeparator = false
    if (quoted) {
      const consumed = consumeQuotedCsvCharacter(input, index, field, contract)
      field = consumed.field
      index = consumed.index
      quoted = !consumed.closed
      closedQuote = consumed.closed
      continue
    }
    const consumed = consumeUnquotedCsvCharacter(
      input,
      index,
      field,
      closedQuote,
      pushField,
      contract
    )
    field = consumed.field
    quoted = consumed.quoted
    closedQuote = consumed.closedQuote
    if (!consumed.recordEnded) continue

    index = consumeCsvLineEnding(input, index)
    pushRecord()
    closedQuote = false
    endedWithRecordSeparator = true
  }
  if (quoted) throw new TypeError('data grid CSV contains an unterminated quoted field')
  if (!endedWithRecordSeparator || record.length > 0 || field.length > 0 || closedQuote)
    pushRecord()
  if (records.length === 0) throw new TypeError('data grid CSV must contain a header record')
  if (records[0]?.[0]?.startsWith('\uFEFF')) records[0][0] = records[0][0].slice(1)
  return records
}

function csvCell(
  value: string,
  column: DataGridColumnV1,
  path: string,
  contract: DataGridCsvContract
): DataGridCellV1 {
  if (column.type === 'text') return contract.parseCell(value, column, path)
  if (value === '') return null
  if (column.type === 'number') {
    if (!JSON_NUMBER_PATTERN.test(value)) {
      throw new TypeError(`${path} must be a locale-independent JSON number or empty`)
    }
    return contract.parseCell(Number(value), column, path)
  }
  if (column.type === 'boolean') {
    if (value !== 'true' && value !== 'false') {
      throw new TypeError(`${path} must be true, false, or empty`)
    }
    return contract.parseCell(value === 'true', column, path)
  }
  return contract.parseCell(value, column, path)
}

export function parseDataGridCsvWithContract(
  source: string,
  columns: readonly DataGridColumnV1[],
  contract: DataGridCsvContract
): DataGridCsvImportResult {
  const parsedColumns = contract.parseColumns(columns)
  const records = parseCsvRecords(source, contract)
  const header = records[0]
  if (header.length !== parsedColumns.length) {
    throw new TypeError(`data grid CSV header must contain exactly ${parsedColumns.length} columns`)
  }
  header.forEach((value, index) => {
    const column = parsedColumns[index]
    if (value !== column.label && value !== column.id) {
      throw new TypeError(
        `data grid CSV header[${index}] must equal column label ${column.label} or id ${column.id}`
      )
    }
  })
  const rows: DataGridRowV1[] = records.slice(1).map((values, rowIndex) => {
    if (values.length !== parsedColumns.length) {
      throw new TypeError(
        `data grid CSV row ${rowIndex + 1} must contain exactly ${parsedColumns.length} columns`
      )
    }
    return {
      id: `csv_row_${rowIndex + 1}`,
      cells: values.map((value, columnIndex) =>
        csvCell(
          value,
          parsedColumns[columnIndex],
          `data grid CSV row ${rowIndex + 1} column ${columnIndex + 1}`,
          contract
        )
      )
    }
  })
  const data = contract.parseData({ columns: parsedColumns, rows })
  return { data, rowCount: data.rows.length, columnCount: data.columns.length }
}

function formulaSafeCsvText(value: string): { text: string; sanitized: boolean } {
  return FORMULA_PREFIX_PATTERN.test(value)
    ? { text: `'${value}`, sanitized: true }
    : { text: value, sanitized: false }
}

function quoteCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

export function exportDataGridCsvWithContract(
  value: DataGridDataV1,
  contract: DataGridCsvContract
): DataGridCsvExportResult {
  const data = contract.parseData(value)
  let sanitizedFormulaFieldCount = 0
  const stringField = (text: string): string => {
    const safe = formulaSafeCsvText(text)
    if (safe.sanitized) sanitizedFormulaFieldCount += 1
    return quoteCsvField(safe.text)
  }
  const records = [
    data.columns.map((column) => stringField(column.label)).join(','),
    ...data.rows.map((row) =>
      row.cells
        .map((cell) => {
          if (cell === null) return ''
          if (typeof cell === 'string') return stringField(cell)
          return String(cell)
        })
        .join(',')
    )
  ]
  const text = `${records.join('\r\n')}\r\n`
  assertCsvByteLimit(text, 'data grid CSV output', contract)
  return { text, sanitizedFormulaFieldCount }
}
