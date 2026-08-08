import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(
  resolve(import.meta.dir, '../../../../src/components/properties/Lowcode/TableContentEditor.vue'),
  'utf8'
)

describe('Table module property editor', () => {
  test('edits structured headers and cells without interpreting cell content as HTML', () => {
    expect(source).toContain('columns: [...value.columns]')
    expect(source).toContain('rows: value.rows.map((row) => [...row])')
    expect(source).toContain('@input="updateColumn(columnIndex, $event)"')
    expect(source).toContain('@input="updateCell(rowIndex, columnIndex, $event)"')
    expect(source).not.toContain('v-html')
  })

  test('hard-caps columns, rows, per-cell text, and total text through shared limits', () => {
    expect(source).toContain('draft.value.columns.length >= TABLE_MODULE_LIMITS.columns')
    expect(source).toContain('draft.value.rows.length >= TABLE_MODULE_LIMITS.rows')
    expect(source).toContain('draft.value.columns.length <= 1')
    expect(source).toContain(':maxlength="TABLE_MODULE_LIMITS.cellText"')
    expect(source).toContain('textLength.value > TABLE_MODULE_LIMITS.totalText')
  })

  test('commits deep-cloned structured values on blur or the explicit shortcut', () => {
    expect(source).toContain("emit('commit', cloneTable(draft.value))")
    expect(source).toContain('@blur="commit"')
    expect(source).toContain('@keydown="commitShortcut"')
    expect(source).toContain('event.metaKey && !event.ctrlKey')
    expect(source).toContain('() => modelValue')
  })
})
