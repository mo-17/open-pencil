export const DATA_GRID_CSV_RUNTIME = `const CSV_MAX_BYTES = 192 * 1024
const CSV_MAX_RECORDS = 201
const CSV_MAX_FIELDS = 2016
const CSV_MAX_FIELDS_PER_RECORD = 16
const CSV_MAX_FIELD_TEXT = 2000
const CSV_MAX_TOTAL_TEXT = 40000
const csvEncoder = new TextEncoder()
const jsonNumberPattern = /^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/
const isoDatePattern = /^\\d{4}-\\d{2}-\\d{2}$/
const spreadsheetFormulaPattern = /^\\s*[=+\\-@]/u

function readCsvRecords(source: string): string[][] {
  if (source.includes('\\0')) throw new TypeError('CSV must not contain NUL characters')
  if (source.length > CSV_MAX_BYTES || csvEncoder.encode(source).byteLength > CSV_MAX_BYTES) {
    throw new TypeError('CSV must not exceed ' + CSV_MAX_BYTES + ' bytes')
  }
  const text = source.startsWith('\\uFEFF') ? source.slice(1) : source
  const output: string[][] = []
  let currentRecord: string[] = []
  let currentField = ''
  let insideQuote = false
  let afterQuote = false
  let endedOnLineBreak = false
  let totalFields = 0

  const addCharacter = (character: string) => {
    currentField += character
    if (currentField.length > CSV_MAX_FIELD_TEXT) {
      throw new TypeError('CSV fields must not exceed ' + CSV_MAX_FIELD_TEXT + ' characters')
    }
  }
  const finishField = () => {
    currentRecord.push(currentField)
    currentField = ''
    totalFields += 1
    if (currentRecord.length > CSV_MAX_FIELDS_PER_RECORD || totalFields > CSV_MAX_FIELDS) {
      throw new TypeError('CSV exceeds the field limit')
    }
  }
  const finishRecord = () => {
    finishField()
    output.push(currentRecord)
    currentRecord = []
    if (output.length > CSV_MAX_RECORDS) {
      throw new TypeError('CSV must not exceed ' + CSV_MAX_RECORDS + ' records')
    }
  }

  for (let offset = 0; offset < text.length; offset += 1) {
    const character = text[offset]
    endedOnLineBreak = false
    if (insideQuote) {
      if (character === '"') {
        if (text[offset + 1] === '"') {
          addCharacter('"')
          offset += 1
        } else {
          insideQuote = false
          afterQuote = true
        }
      } else if (character === '\\r') {
        if (text[offset + 1] !== '\\n') throw new TypeError('CSV contains a malformed CR')
        addCharacter('\\r\\n')
        offset += 1
      } else {
        addCharacter(character)
      }
      continue
    }

    if (afterQuote) {
      if (character === ',') {
        finishField()
        afterQuote = false
        continue
      }
      if (character !== '\\r' && character !== '\\n') {
        throw new TypeError('CSV contains characters after a closing quote')
      }
    } else if (character === '"') {
      if (currentField.length > 0) throw new TypeError('CSV contains a quote in an unquoted field')
      insideQuote = true
      continue
    } else if (character === ',') {
      finishField()
      continue
    } else if (character !== '\\r' && character !== '\\n') {
      addCharacter(character)
      continue
    }

    if (character === '\\r') {
      if (text[offset + 1] !== '\\n') throw new TypeError('CSV contains a malformed CR')
      offset += 1
    }
    finishRecord()
    afterQuote = false
    endedOnLineBreak = true
  }

  if (insideQuote) throw new TypeError('CSV contains an unterminated quoted field')
  if (!endedOnLineBreak || currentRecord.length > 0 || currentField.length > 0 || afterQuote) {
    finishRecord()
  }
  if (output[0]?.[0]?.startsWith('\\uFEFF')) output[0][0] = output[0][0].slice(1)
  return output
}

function isIsoDate(value: string): boolean {
  if (!isoDatePattern.test(value)) return false
  const parsed = new Date(value + 'T00:00:00.000Z')
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function parseCsvCell(
  source: string,
  column: OpenPencilDataGridColumn,
  location: string
): OpenPencilDataGridCell {
  if (column.type === 'text') return source
  if (source === '') return null
  if (column.type === 'number') {
    if (!jsonNumberPattern.test(source)) {
      throw new TypeError(location + ' must be a locale-independent JSON number or empty')
    }
    const number = Number(source)
    if (!Number.isFinite(number)) throw new TypeError(location + ' must be a finite number')
    return number
  }
  if (column.type === 'boolean') {
    if (source !== 'true' && source !== 'false') {
      throw new TypeError(location + ' must be true, false, or empty')
    }
    return source === 'true'
  }
  if (!isIsoDate(source)) throw new TypeError(location + ' must be a canonical YYYY-MM-DD date')
  return source
}

function importCsvRows(
  source: string,
  columns: readonly OpenPencilDataGridColumn[]
): OpenPencilDataGridRow[] {
  const records = readCsvRecords(source)
  const header = records[0]
  if (header.length !== columns.length) {
    throw new TypeError('CSV header must contain exactly ' + columns.length + ' columns')
  }
  header.forEach((value, index) => {
    const column = columns[index]
    if (value !== column.label && value !== column.id) {
      throw new TypeError('CSV header ' + (index + 1) + ' must match ' + column.label + ' or ' + column.id)
    }
  })

  let totalText = columns.reduce((total, column) => total + column.label.length, 0)
  const rows = records.slice(1).map((record, rowIndex) => {
    if (record.length !== columns.length) {
      throw new TypeError('CSV row ' + (rowIndex + 1) + ' must contain exactly ' + columns.length + ' columns')
    }
    const cells = record.map((sourceCell, columnIndex) => {
      const cell = parseCsvCell(
        sourceCell,
        columns[columnIndex],
        'CSV row ' + (rowIndex + 1) + ' column ' + (columnIndex + 1)
      )
      if (typeof cell === 'string') totalText += cell.length
      return cell
    })
    return { id: 'csv_row_' + (rowIndex + 1), cells }
  })
  if (totalText > CSV_MAX_TOTAL_TEXT) {
    throw new TypeError('CSV text must not exceed ' + CSV_MAX_TOTAL_TEXT + ' characters')
  }
  return rows
}

function quoteCsvValue(value: string): string {
  return /[",\\r\\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value
}

function safeCsvText(value: string): { value: string; sanitized: boolean } {
  return spreadsheetFormulaPattern.test(value)
    ? { value: "'" + value, sanitized: true }
    : { value, sanitized: false }
}

function exportCsvRows(
  columns: readonly OpenPencilDataGridColumn[],
  rows: readonly OpenPencilDataGridRow[]
): { text: string; sanitizedCount: number } {
  if (columns.length < 1 || columns.length > CSV_MAX_FIELDS_PER_RECORD) {
    throw new TypeError('CSV export has an unsupported column count')
  }
  if (
    rows.length > CSV_MAX_RECORDS - 1 ||
    rows.length * columns.length > CSV_MAX_FIELDS - columns.length
  ) {
    throw new TypeError('CSV export exceeds the row or cell limit')
  }
  let totalText = 0
  for (const column of columns) {
    if (column.label.length > CSV_MAX_FIELD_TEXT) {
      throw new TypeError('CSV fields must not exceed ' + CSV_MAX_FIELD_TEXT + ' characters')
    }
    totalText += column.label.length
  }
  for (const row of rows) {
    if (row.cells.length !== columns.length) {
      throw new TypeError('CSV rows must contain exactly ' + columns.length + ' cells')
    }
    for (const cell of row.cells) {
      if (typeof cell !== 'string') continue
      if (cell.length > CSV_MAX_FIELD_TEXT) {
        throw new TypeError('CSV fields must not exceed ' + CSV_MAX_FIELD_TEXT + ' characters')
      }
      totalText += cell.length
      if (totalText > CSV_MAX_TOTAL_TEXT) {
        throw new TypeError('CSV text must not exceed ' + CSV_MAX_TOTAL_TEXT + ' characters')
      }
    }
  }
  let sanitizedCount = 0
  const stringField = (value: string) => {
    const safe = safeCsvText(value)
    if (safe.sanitized) sanitizedCount += 1
    return quoteCsvValue(safe.value)
  }
  const records = [
    columns.map((column) => stringField(column.label)).join(','),
    ...rows.map((row) =>
      row.cells
        .map((cell) => {
          if (cell === null) return ''
          return typeof cell === 'string' ? stringField(cell) : String(cell)
        })
        .join(',')
    )
  ]
  const text = records.join('\\r\\n') + '\\r\\n'
  if (text.length > CSV_MAX_BYTES || csvEncoder.encode(text).byteLength > CSV_MAX_BYTES) {
    throw new TypeError('CSV output must not exceed ' + CSV_MAX_BYTES + ' bytes')
  }
  return { text, sanitizedCount }
}
`
