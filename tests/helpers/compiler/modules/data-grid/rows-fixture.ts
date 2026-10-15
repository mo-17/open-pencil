import { compile, withDefaults } from '@open-pencil/compiler'
import { createDataGridModuleFrameOverrides } from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

export function dataGridRowsFixture(target: 'react' | 'vue', document = false) {
  const graph = makeSceneGraph('Bound data grid')
  const pageId = firstPageId(graph)
  const initialRows = Array.from({ length: 12 }, (_, index) => ({
    id: 'row' + index,
    cells: ['Item ' + index, 12 - index]
  }))
  const datasets = {
    initialRows,
    equalRows: initialRows,
    replacementRows: [{ id: 'replacement', cells: ['Replacement', 5] }],
    emptyRows: [],
    invalidRows: [{ id: 'bad', cells: ['Bad row', 'wrong type'] }]
  }
  const gridState = {
    id: 'gridRows',
    name: 'gridRows',
    type: 'array' as const,
    defaultValue: initialRows
  }
  const declarations = [
    ...(document ? [] : [gridState]),
    { id: 'revision', name: 'revision', type: 'number' as const, defaultValue: 0 },
    ...Object.entries(datasets).map(([name, defaultValue]) => ({
      id: name,
      name,
      type: 'array' as const,
      defaultValue
    }))
  ]
  graph.updateNode(pageId, { state: declarations })
  if (document) graph.updateNode(graph.rootId, { lowcodeDocumentState: [gridState] })
  const action = (name: string, valueExpr: string) =>
    document && name === 'gridRows'
      ? { id: name + ':' + valueExpr, kind: 'setVariable' as const, targetName: name, valueExpr }
      : { id: name + ':' + valueExpr, kind: 'setState' as const, targetStateId: name, valueExpr }
  const controls = [
    ['Rerender host', 'revision', 'revision + 1'],
    ['Equal rows', 'gridRows', 'equalRows'],
    ['Replace rows', 'gridRows', 'replacementRows'],
    ['Empty rows', 'gridRows', 'emptyRows'],
    ['Invalid rows', 'gridRows', 'invalidRows'],
    ['Restore rows', 'gridRows', 'initialRows']
  ]
  controls.forEach(([label, name, valueExpr], index) => {
    graph.createNode('BUTTON', pageId, {
      name: label,
      x: 20 + (index % 3) * 180,
      y: 20 + Math.floor(index / 3) * 52,
      width: 160,
      height: 44,
      interactiveProps: { text: label },
      events: { onClick: [action(name, valueExpr)] }
    })
  })
  graph.createNode('TEXT', pageId, {
    x: 20,
    y: 130,
    width: 600,
    height: 32,
    bindings: { text: { kind: 'expr', expr: '"Host revision: " + revision' } }
  })
  graph.createNode('FRAME', pageId, {
    ...createDataGridModuleFrameOverrides({
      data: {
        columns: [
          {
            id: 'name',
            label: 'Name',
            type: 'text',
            align: 'start',
            width: 300,
            sortable: true,
            filterable: true
          },
          {
            id: 'score',
            label: 'Score',
            type: 'number',
            align: 'end',
            width: 140,
            sortable: true,
            filterable: false
          }
        ],
        rows: [{ id: 'sample', cells: ['Authored example', 0] }]
      },
      pageSize: 10,
      showCsvTools: true
    }),
    x: 20,
    y: 180,
    width: 600,
    height: 640,
    bindings: {
      rows: document
        ? { kind: 'docState', docStateName: 'gridRows' }
        : { kind: 'ref', stateId: 'gridRows' }
    }
  })
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
}
