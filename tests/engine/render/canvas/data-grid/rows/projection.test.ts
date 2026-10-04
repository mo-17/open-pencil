import { describe, expect, test } from 'bun:test'

import { dataGridCanvasData, dataGridTextNode } from '#core/canvas/modules/data-grid/text'
import { createDataGridModuleFrameOverrides, resolveDataGridModule } from '#core/plugins/data-grid'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function fixture(document = false) {
  const graph = makeSceneGraph('Bound grid Canvas')
  const pageId = firstPageId(graph)
  const declarations = [
    {
      id: 'rows',
      name: 'rows',
      type: 'array' as const,
      defaultValue: [{ id: 'bound', cells: ['Bound row', 9] }]
    }
  ]
  graph.updateNode(
    document ? graph.rootId : pageId,
    document ? { lowcodeDocumentState: declarations } : { state: declarations }
  )
  const node = graph.createNode('FRAME', pageId, {
    ...createDataGridModuleFrameOverrides({
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
            filterable: false
          }
        ],
        rows: [{ id: 'example', cells: ['Example row', 2] }]
      }
    }),
    bindings: {
      rows: document ? { kind: 'docState', docStateName: 'rows' } : { kind: 'ref', stateId: 'rows' }
    }
  })
  const resolved = resolveDataGridModule(node.interactiveProps?.module)
  if (!resolved?.ok) throw new Error('Grid fixture must resolve')
  return { graph, node, config: resolved.config, declarations, pageId }
}

describe('bound data grid Canvas initial data', () => {
  test.each([false, true])(
    'projects authored %s state without retaining static example rows',
    (document) => {
      const { graph, node, config } = fixture(document)
      const result = dataGridCanvasData(node, config, graph)
      expect(result.unavailable).toBe(false)
      expect(result.config.data.rows).toEqual([{ id: 'bound', cells: ['Bound row', 9] }])
      expect(dataGridTextNode(node, graph)?.text).toContain('Bound row')
      expect(dataGridTextNode(node, graph)?.text).not.toContain('Example row')
      expect(config.data.rows).toEqual([{ id: 'example', cells: ['Example row', 2] }])
    }
  )

  test('keeps explicit empty rows available and leaves unbound old config intact', () => {
    const { graph, node, config, pageId, declarations } = fixture()
    graph.updateNode(pageId, {
      state: declarations.map((state) => ({ ...state, defaultValue: [] }))
    })
    expect(dataGridCanvasData(node, config, graph)).toEqual({
      config: { ...config, data: { ...config.data, rows: [] } },
      unavailable: false
    })
    graph.updateNode(node.id, { bindings: {} })
    expect(dataGridCanvasData(node, config, graph)).toEqual({ config, unavailable: false })
  })

  test('shows unavailable for unresolved, computed, wrong cells and missing graph', () => {
    const { graph, node, config, pageId, declarations } = fixture()
    expect(dataGridCanvasData(node, config).unavailable).toBe(true)
    graph.updateNode(pageId, {
      state: declarations.map((state) => ({ ...state, computedExpr: '[]' }))
    })
    expect(dataGridTextNode(node, graph)?.text).toContain('Bound data grid rows are unavailable.')
    expect(dataGridTextNode(node, graph)?.text).not.toContain('Example row')
    graph.updateNode(pageId, {
      state: declarations.map((state) => ({
        ...state,
        defaultValue: [{ id: 'bad', cells: ['Bad', 'wrong'] }]
      }))
    })
    expect(dataGridCanvasData(node, config, graph).unavailable).toBe(true)
    graph.updateNode(node.id, { bindings: { rows: { kind: 'expr', expr: 'rows' } } })
    expect(dataGridCanvasData(node, config, graph).unavailable).toBe(true)
    graph.updateNode(node.id, { textLanguage: 'zh-CN' })
    expect(dataGridTextNode(node, graph)?.text).toContain('绑定的表格数据不可用。')
  })
})
