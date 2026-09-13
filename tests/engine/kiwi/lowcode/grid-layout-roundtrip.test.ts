import { beforeAll, describe, expect, test } from 'bun:test'

import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { OPEN_PENCIL_PLUGIN_ID } from '@open-pencil/fig/node-change'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  LOWCODE_GRID_LAYOUT_KEY,
  serializeGridLayout,
  type GridLayoutOverride
} from '#core/kiwi/fig/node-change/grid-layout-plugin-data'
import { extractImportedLowcodeProps } from '#core/kiwi/fig/node-change/lowcode-plugin-data'

function fixture() {
  const graph = new SceneGraph()
  const grid = graph.createNode('FRAME', graph.getPages()[0].id, {
    name: 'Mixed grid',
    layoutMode: 'GRID',
    width: 600,
    height: 350,
    gridTemplateColumns: [
      { sizing: 'FIXED', value: 80 },
      { sizing: 'FR', value: 2 }
    ],
    gridTemplateRows: [
      { sizing: 'AUTO', value: 0 },
      { sizing: 'FIXED', value: 150 }
    ],
    gridColumnGap: 17,
    gridRowGap: 12,
    paddingTop: 11,
    paddingRight: 22,
    paddingBottom: 33,
    paddingLeft: 44,
    primaryAxisSizing: 'FILL',
    counterAxisSizing: 'HUG',
    clipsContent: true
  })
  graph.createNode('FRAME', grid.id, {
    name: 'Placed card',
    width: 60,
    height: 30,
    gridPosition: { column: 2, row: 1, columnSpan: 1, rowSpan: 2 }
  })
  return { graph, grid }
}

describe('Grid container .fig persistence', () => {
  beforeAll(initCodec)

  test('keeps native geometry, clipping and explicit child placement with Grid tracks, gaps and padding', async () => {
    const { graph, grid } = fixture()
    const bytes = await exportFigFile(graph)
    const imported = await parseFigFile(bytes.buffer)
    const restored = [...imported.getAllNodes()].find((node) => node.name === grid.name)
    if (!restored) throw new Error('Missing restored grid')
    for (const field of [
      'layoutMode',
      'gridTemplateColumns',
      'gridTemplateRows',
      'gridColumnGap',
      'gridRowGap',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'primaryAxisSizing',
      'counterAxisSizing',
      'width',
      'height',
      'clipsContent'
    ] as const)
      expect(restored?.[field]).toEqual(grid[field])
    expect(imported.getChildren(restored.id)[0]).toMatchObject({
      layoutPositioning: 'AUTO',
      gridPosition: { column: 2, row: 1, columnSpan: 1, rowSpan: 2 }
    })
  })

  test.each(['NONE', 'FREE', 'HORIZONTAL', 'VERTICAL'] as const)(
    'does not add Grid metadata to %s layout',
    (layoutMode) => {
      const { graph, grid } = fixture()
      graph.updateNode(grid.id, { layoutMode })
      expect(serializeGridLayout(grid)).toEqual([])
    }
  )

  test('saving an edited imported Grid updates its tracks and does not resurrect a removed Grid mode', async () => {
    const { graph } = fixture()
    let imported = await parseFigFile((await exportFigFile(graph)).buffer)
    const grid = [...imported.getAllNodes()].find((node) => node.name === 'Mixed grid')
    if (!grid) throw new Error('Missing imported grid')
    imported.updateNode(grid.id, { gridTemplateRows: [{ sizing: 'FIXED', value: 180 }] })
    imported = await parseFigFile((await exportFigFile(imported)).buffer)
    const edited = [...imported.getAllNodes()].find((node) => node.name === 'Mixed grid')
    if (!edited) throw new Error('Missing edited grid')
    expect(edited.gridTemplateRows).toEqual([{ sizing: 'FIXED', value: 180 }])
    imported.updateNode(edited.id, { layoutMode: 'NONE' })
    const final = await parseFigFile((await exportFigFile(imported)).buffer)
    expect([...final.getAllNodes()].find((node) => node.name === 'Mixed grid')?.layoutMode).toBe(
      'NONE'
    )
  })

  test.each([
    { version: 2 },
    { gridTemplateColumns: [{ sizing: ['FR'], value: 1 }] },
    { gridTemplateRows: [{ sizing: 'FIXED', value: -1 }] },
    { gridTemplateRows: [{ sizing: 'FIXED', value: 150, unknown: true }] },
    { gridTemplateRows: Array.from({ length: 4097 }, () => ({ sizing: 'AUTO', value: 0 })) },
    { gridRowGap: '12' },
    { paddingTop: null },
    { primaryAxisSizing: ['FIXED'] },
    { unknown: 'ignored' }
  ])('preserves unsupported Grid metadata inertly', (override) => {
    const { grid } = fixture()
    const original = JSON.parse(serializeGridLayout(grid)[0].value) as Omit<
      GridLayoutOverride,
      'layoutMode'
    > & { version: 1 }
    const value = JSON.stringify({ ...original, ...override })
    const extracted = extractImportedLowcodeProps({
      pluginData: [{ pluginID: OPEN_PENCIL_PLUGIN_ID, key: LOWCODE_GRID_LAYOUT_KEY, value }]
    })
    expect(extracted.props.layoutMode).toBeUndefined()
    expect(extracted.props.pluginData).toEqual([
      { pluginId: OPEN_PENCIL_PLUGIN_ID, key: LOWCODE_GRID_LAYOUT_KEY, value }
    ])
  })

  test('preserves malformed JSON inertly', () => {
    const value = '{'
    const extracted = extractImportedLowcodeProps({
      pluginData: [{ pluginID: OPEN_PENCIL_PLUGIN_ID, key: LOWCODE_GRID_LAYOUT_KEY, value }]
    })
    expect(extracted.props.layoutMode).toBeUndefined()
    expect(extracted.props.pluginData?.[0]?.value).toBe(value)
  })
})
