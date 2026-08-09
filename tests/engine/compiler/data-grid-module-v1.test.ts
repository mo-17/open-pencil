import { describe, expect, test } from 'bun:test'

import {
  DATA_GRID_REACT_MODULE_ADAPTER,
  buildOpenPencilDataGridComponent
} from '#compiler/adapters/react/modules/data-grid'
import { DATA_GRID_COMPILER_MODULE_LOWERER } from '#compiler/modules/data-grid'

import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import { createDataGridModuleInstance } from '#core/plugins/data-grid'

const CONFIG = {
  data: {
    columns: [
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
      }
    ],
    rows: [
      { id: 'alpha', cells: ['<img src=x onerror=alert(1)>', 42] },
      { id: 'beta', cells: ['Beta', 37] }
    ]
  },
  initialSort: { columnId: 'score', direction: 'descending' },
  filters: [{ columnId: 'name', operator: 'contains', value: 'a' }],
  pageSize: 20,
  selectionMode: 'multiple',
  density: 'comfortable',
  showHeader: true,
  stickyHeader: true,
  striped: true,
  borderColor: '#D1D5DB',
  headerBackground: '#F3F4F6',
  textColor: '#111827',
  accentColor: '#2563EB',
  fontSize: 14
} as const

describe('advanced data grid compiler module v1', () => {
  test('deep-clones typed data, initial sort, and filters into the neutral payload', () => {
    const instance = createDataGridModuleInstance(CONFIG)
    const node = createDefaultNode(() => 'data-grid-1', 'FRAME')
    const lowered = DATA_GRID_COMPILER_MODULE_LOWERER.lower(instance, node)

    expect(lowered.ok).toBe(true)
    if (!lowered.ok) throw new Error(lowered.reason)
    expect(lowered.payload).toEqual(CONFIG)
    expect(lowered.payload.data).not.toBe(instance.config.data)

    const invalid = DATA_GRID_COMPILER_MODULE_LOWERER.lower(
      { ...instance, config: { ...instance.config, pageSize: 1 } },
      node
    )
    expect(invalid.ok).toBe(false)
  })

  test('emits semantic, dependency-free table controls without HTML interpretation', () => {
    const runtime = buildOpenPencilDataGridComponent()

    expect(() => new Bun.Transpiler({ loader: 'tsx' }).transformSync(runtime)).not.toThrow()
    expect(runtime).toContain('<table')
    expect(runtime).toContain('aria-sort={ariaSort}')
    expect(runtime).toContain('scope="col"')
    expect(runtime).toContain("data-visually-hidden={config.showHeader ? undefined : ''}")
    expect(runtime).toContain("'Selection'")
    expect(runtime).toContain('type="search"')
    expect(runtime).toContain('aria-label="Data grid pagination"')
    expect(runtime).toContain('useMemo')
    expect(runtime).toContain('useId')
    expect(runtime).toContain("const selectionName = 'openpencil-data-grid-selection-' + useId()")
    expect(runtime).toContain('const resetFingerprint = useMemo(')
    expect(runtime).toContain('JSON.stringify({')
    expect(runtime).toContain('}, [resetFingerprint])')
    expect(runtime).toContain('left.sourceIndex - right.sourceIndex')
    expect(runtime).toContain('selectAllRef.current.indeterminate = pageSelectionIsMixed')
    expect(runtime).toContain("aria-checked={pageSelectionIsMixed ? 'mixed' : allPageRowsSelected}")
    expect(runtime).toContain('Paste CSV (local session)')
    expect(runtime).toContain('Imported rows stay local to this running app')
    expect(runtime).toContain('locale-independent JSON number')
    expect(runtime).toContain('spreadsheetFormulaPattern')
    expect(runtime).toContain('formula-like text fields were neutralized')
    expect(runtime).toContain("records.join('\\r\\n') + '\\r\\n'")
    expect(runtime).toContain("source.startsWith('\\uFEFF')")
    expect(runtime).toContain("source.includes('\\0')")
    expect(runtime).not.toContain('navigator.clipboard')
    expect(runtime).not.toContain('showSaveFilePicker')
    expect(runtime).not.toContain('FileReader')
    expect(runtime).not.toContain('dangerouslySetInnerHTML')
    expect(runtime).not.toContain('.innerHTML')
    expect(runtime).not.toContain('eval(')
  })

  test('declares a collision-safe local React runtime identity without dependencies', () => {
    expect(DATA_GRID_REACT_MODULE_ADAPTER).toMatchObject({
      pluginId: 'open-pencil.data-grid',
      moduleType: 'data-grid',
      componentName: 'OpenPencilDataGrid',
      runtimePath: 'src/__openpencil_data_grid.tsx'
    })
    expect(DATA_GRID_REACT_MODULE_ADAPTER.dependencies).toBeUndefined()
  })
})
