import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const editorSource = readFileSync(
  resolve(import.meta.dir, '../../../../src/components/properties/Lowcode/DataGridCsvEditor.vue'),
  'utf8'
)
const panelSource = readFileSync(
  resolve(import.meta.dir, '../../../../src/components/properties/Lowcode/ModulePropsPanel.vue'),
  'utf8'
)
const specializedFieldSource = readFileSync(
  resolve(
    import.meta.dir,
    '../../../../src/components/properties/Lowcode/ModuleSpecializedFieldEditor.vue'
  ),
  'utf8'
)
const controllerSource = readFileSync(
  resolve(
    import.meta.dir,
    '../../../../src/components/properties/Lowcode/module-props-panel-controller.ts'
  ),
  'utf8'
)

describe('Advanced Data Grid CSV property editor', () => {
  test('delegates validation and formula-safe export to bounded core helpers', () => {
    expect(editorSource).toContain('parseDataGridCsv(importSource.value, modelValue.columns)')
    expect(editorSource).toContain('exportDataGridCsv(modelValue)')
    expect(editorSource).toContain(':maxlength="DATA_GRID_CSV_LIMITS.bytes"')
    expect(editorSource).toContain('formula-like text fields were neutralized')
  })

  test('requires pasted/manual text and never requests file or clipboard permissions', () => {
    expect(editorSource).toContain('Paste CSV')
    expect(editorSource).toContain('Copy this text manually')
    expect(editorSource).toContain('readonly')
    expect(editorSource).not.toContain('navigator.clipboard')
    expect(editorSource).not.toContain('showOpenFilePicker')
    expect(editorSource).not.toContain('showSaveFilePicker')
    expect(editorSource).not.toContain('FileReader')
  })

  test('commits through the existing validated module config and undo path', () => {
    expect(editorSource).toContain("emit('commit', result.data)")
    expect(specializedFieldSource).toContain("kind === 'data-grid-data'")
    expect(specializedFieldSource).toContain('@commit="emit(\'commit\', $event)"')
    expect(panelSource).toContain('@commit="commitField(field, $event)"')
    expect(controllerSource).toContain(
      'const nextInstance = moduleDefinition.createInstance(nextConfig)'
    )
    expect(controllerSource).toContain('editor.updateNodeWithUndo(')
  })
})
