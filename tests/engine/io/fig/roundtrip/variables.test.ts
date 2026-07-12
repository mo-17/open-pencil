import { describe, expect, setDefaultTimeout, test } from 'bun:test'

import {
  exportFigFile,
  FigmaAPI,
  importNodeChanges,
  initCodec,
  parseFigFile,
  SceneGraph,
  type Color,
  type NodeChange
} from '@open-pencil/core'
import { parseFigBuffer } from '@open-pencil/kiwi/fig/parse'

import {
  kiwiVariableFieldToBindingField,
  variableBindingFieldToKiwi
} from '#core/kiwi/fig/node-change/convert'

import { expectDefined } from '#tests/helpers/assert'
import { parseFixture } from '#tests/helpers/fig-fixtures'
import { runsHeavyTests } from '#tests/helpers/test-utils'

import { canvas, doc, node } from '../import/legacy/helpers'

setDefaultTimeout(60_000)

function decodeExport(bytes: Uint8Array) {
  return parseFigBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

describe('variable roundtrip', () => {
  test('gradient stop variable field mapping is explicit and export-safe by default', () => {
    expect(kiwiVariableFieldToBindingField('FILL_PAINT_2_GRADIENT_STOP_3_COLOR')).toBe(
      'fills/2/gradientStops/3/color'
    )
    expect(variableBindingFieldToKiwi('fills/2/gradientStops/3/color')).toBeUndefined()
    expect(
      variableBindingFieldToKiwi('fills/2/gradientStops/3/color', { includeGradientStops: true })
    ).toBe('FILL_PAINT_2_GRADIENT_STOP_3_COLOR')
  })

  test('variables and collections survive export → re-import', async () => {
    await initCodec()

    const graph = new SceneGraph()
    const col = graph.createCollection('Design Tokens')
    graph.createVariable('color/primary', 'COLOR', col.id, { r: 0.23, g: 0.51, b: 0.96, a: 1 })
    graph.createVariable('spacing/base', 'FLOAT', col.id, 8)
    graph.createVariable('visible', 'BOOLEAN', col.id, true)
    graph.createVariable('label', 'STRING', col.id, 'Hello')

    const exported = await exportFigFile(graph)
    const reimported = await parseFigFile(exported.buffer as ArrayBuffer)

    expect(reimported.variables.size).toBe(4)
    expect(reimported.variableCollections.size).toBe(1)

    const reimportedCol = [...reimported.variableCollections.values()][0]
    expect(reimportedCol.name).toBe('Design Tokens')
    expect(reimportedCol.variableIds).toHaveLength(4)

    const vars = [...reimported.variables.values()]
    const colorVar = vars.find((v) => v.name === 'color/primary')
    expect(colorVar).toBeDefined()
    expect(expectDefined(colorVar, 'colorVar').type).toBe('COLOR')
    const colorVal = Object.values(colorVar.valuesByMode)[0] as Color
    expect(colorVal.r).toBeCloseTo(0.23, 1)

    const floatVar = vars.find((v) => v.name === 'spacing/base')
    expect(floatVar).toBeDefined()
    expect(expectDefined(floatVar, 'floatVar').type).toBe('FLOAT')
    expect(Object.values(floatVar.valuesByMode)[0]).toBe(8)

    const boolVar = vars.find((v) => v.name === 'visible')
    expect(boolVar).toBeDefined()
    expect(expectDefined(boolVar, 'boolVar').type).toBe('BOOLEAN')
    expect(Object.values(boolVar.valuesByMode)[0]).toBe(true)

    const strVar = vars.find((v) => v.name === 'label')
    expect(strVar).toBeDefined()
    expect(expectDefined(strVar, 'strVar').type).toBe('STRING')
    expect(Object.values(strVar.valuesByMode)[0]).toBe('Hello')
  })

  test('variable bindings survive export → re-import', async () => {
    await initCodec()

    const graph = new SceneGraph()
    const col = graph.createCollection('Tokens')
    const floatVar = graph.createVariable('radius', 'FLOAT', col.id, 12)
    const fillVar = graph.createVariable('surface', 'COLOR', col.id, { r: 1, g: 1, b: 1, a: 1 })
    const strokeVar = graph.createVariable('border', 'COLOR', col.id, {
      r: 0.1,
      g: 0.2,
      b: 0.3,
      a: 1
    })

    const page = graph.getPages()[0]
    const rect = graph.createNode('RECTANGLE', page.id, {
      name: 'Bound Rect',
      width: 100,
      height: 100,
      cornerRadius: 12,
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 1, b: 1, a: 1 },
          opacity: 1,
          visible: true,
          blendMode: 'NORMAL'
        }
      ],
      strokes: [
        {
          color: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
          weight: 1,
          opacity: 1,
          visible: true,
          align: 'INSIDE',
          cap: 'NONE',
          join: 'MITER',
          dashPattern: []
        }
      ]
    })
    graph.bindVariable(rect.id, 'cornerRadius', floatVar.id)
    graph.bindVariable(rect.id, 'fills/0/color', fillVar.id)
    graph.bindVariable(rect.id, 'strokes/0/color', strokeVar.id)

    const exported = await exportFigFile(graph)
    const reimported = await parseFigFile(exported.buffer as ArrayBuffer)

    const reimportedRect = [...reimported.getAllNodes()].find((n) => n.name === 'Bound Rect')
    expect(reimportedRect).toBeDefined()
    expect(Object.keys(expectDefined(reimportedRect, 'reimportedRect').boundVariables)).toContain(
      'cornerRadius'
    )
    expect(Object.keys(reimportedRect.boundVariables)).toContain('fills/0/color')
    expect(Object.keys(reimportedRect.boundVariables)).toContain('strokes/0/color')
  })

  test('gradient stop variable bindings survive export → re-import', async () => {
    await initCodec()

    const graph = new SceneGraph()
    const col = graph.createCollection('Gradient Tokens')
    const startVar = graph.createVariable('gradient/start', 'COLOR', col.id, {
      r: 1,
      g: 0,
      b: 0,
      a: 1
    })
    const endVar = graph.createVariable('gradient/end', 'COLOR', col.id, {
      r: 0,
      g: 0,
      b: 1,
      a: 1
    })

    const page = graph.getPages()[0]
    const rect = graph.createNode('RECTANGLE', page.id, {
      name: 'Bound Gradient',
      width: 100,
      height: 100,
      fills: [
        {
          type: 'GRADIENT_LINEAR',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          gradientStops: [
            { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
            { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 }
          ],
          gradientTransform: { m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 }
        }
      ]
    })
    graph.bindVariable(rect.id, 'fills/0/gradientStops/0/color', startVar.id)
    graph.bindVariable(rect.id, 'fills/0/gradientStops/1/color', endVar.id)

    const exported = await exportFigFile(graph)
    const reimported = await parseFigFile(exported.buffer as ArrayBuffer)

    const reimportedRect = [...reimported.getAllNodes()].find((n) => n.name === 'Bound Gradient')
    expect(reimportedRect).toBeDefined()
    const bindings = expectDefined(reimportedRect, 'reimportedRect').boundVariables
    expect(Object.keys(bindings)).toContain('fills/0/gradientStops/0/color')
    expect(Object.keys(bindings)).toContain('fills/0/gradientStops/1/color')
  })

  test('imports gradient stop bindings from variableConsumptionMap entries', () => {
    const graph = importNodeChanges([
      doc(),
      canvas(),
      {
        ...node('VARIABLE_SET', 20, 1),
        name: 'Gradient Tokens',
        variableSetModes: [{ id: { sessionID: 10, localID: 1 }, name: 'Default' }]
      } as NodeChange,
      {
        ...node('VARIABLE', 21, 1),
        name: 'Stop Blue',
        variableSetID: { guid: { sessionID: 1, localID: 20 } },
        variableResolvedType: 'COLOR',
        variableDataValues: {
          entries: [
            {
              modeID: { sessionID: 10, localID: 1 },
              variableData: {
                dataType: 'COLOR',
                resolvedDataType: 'COLOR',
                value: { colorValue: { r: 0, g: 0, b: 1, a: 1 } }
              }
            }
          ]
        }
      } as NodeChange,
      node('RECTANGLE', 30, 1, {
        name: 'Variable map gradient',
        fillPaints: [
          {
            type: 'GRADIENT_LINEAR',
            stops: [
              { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
              { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 }
            ],
            transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 0, m12: 0.5 },
            visible: true,
            opacity: 1
          }
        ],
        variableConsumptionMap: {
          entries: [
            {
              variableField: 'FILL_PAINT_0_GRADIENT_STOP_1_COLOR',
              variableData: {
                dataType: 'ALIAS',
                resolvedDataType: 'COLOR',
                value: { alias: { guid: { sessionID: 1, localID: 21 } } }
              }
            }
          ]
        }
      })
    ])

    const rect = expectDefined(
      [...graph.getAllNodes()].find((n) => n.name === 'Variable map gradient'),
      'imported variable map gradient'
    )
    expect(rect.boundVariables['fills/0/gradientStops/1/color']).toBe('1:21')
  })

  test('exports gradient stop bindings through stopsVar without invalid variableConsumptionMap fields', async () => {
    await initCodec()

    const graph = new SceneGraph()
    const col = graph.createCollection('Gradient Tokens')
    const startVar = graph.createVariable('gradient/start', 'COLOR', col.id, {
      r: 1,
      g: 0,
      b: 0,
      a: 1
    })
    const page = graph.getPages()[0]
    const rect = graph.createNode('RECTANGLE', page.id, {
      name: 'Variable map export gradient',
      width: 100,
      height: 100,
      fills: [
        {
          type: 'GRADIENT_LINEAR',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          gradientStops: [
            { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
            { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 }
          ],
          gradientTransform: { m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 }
        }
      ]
    })
    graph.bindVariable(rect.id, 'fills/0/gradientStops/0/color', startVar.id)

    const decoded = decodeExport(await exportFigFile(graph))
    const exportedRect = expectDefined(
      decoded.nodeChanges.find((nodeChange) => nodeChange.name === rect.name),
      'exported variable map gradient'
    )
    const entry = exportedRect.variableConsumptionMap?.entries?.find(
      (item) => item.variableField === 'FILL_PAINT_0_GRADIENT_STOP_0_COLOR'
    )

    expect(entry).toBeUndefined()
    expect(exportedRect.fillPaints?.[0]?.stopsVar?.[0]?.colorVar?.value?.alias?.guid).toBeDefined()
  })

  test.if(runsHeavyTests)(
    'material3.fig variables survive round-trip',
    async () => {
      const original = await parseFixture('material3.fig')

      const exported = await exportFigFile(original)
      const reimported = await parseFigFile(exported.buffer as ArrayBuffer)

      expect(reimported.variables.size).toBe(original.variables.size)
      expect(reimported.variableCollections.size).toBeGreaterThanOrEqual(
        [...original.variableCollections.values()].filter((c) => c.variableIds.length > 0).length
      )
    },
    120_000
  )

  test('pluginID casing is consistent across full codec pipeline', async () => {
    await initCodec()

    // Create a graph with multiple nodes having pluginData entries
    const graph = new SceneGraph()
    const api = new FigmaAPI(graph)
    const frame = api.createFrame()
    frame.name = 'PluginID Test'
    frame.setPluginData('key1', 'value1')
    frame.setPluginData('key2', 'value2')

    const rect = api.createRectangle()
    rect.name = 'Plugin Rect'
    rect.setPluginData('testKey', 'testValue')

    // Round-trip through the codec
    const exported = await exportFigFile(graph)
    const reimported = await parseFigFile(exported.buffer as ArrayBuffer)

    // Find all nodes with pluginData
    let nodesWithPluginData = 0
    let totalEntries = 0
    for (const node of reimported.getAllNodes()) {
      if (node.pluginData && node.pluginData.length > 0) {
        nodesWithPluginData++
        for (const entry of node.pluginData) {
          totalEntries++
          // Every entry MUST use pluginId (lowercase d, matching SceneGraph type)
          expect(entry).toHaveProperty('pluginId')
          expect(typeof entry.pluginId).toBe('string')
          expect(entry.pluginId.length).toBeGreaterThan(0)
        }
      }
      // Also check pluginRelaunchData entries
      if (node.pluginRelaunchData && node.pluginRelaunchData.length > 0) {
        for (const entry of node.pluginRelaunchData) {
          expect(entry).toHaveProperty('pluginId')
          expect(typeof entry.pluginId).toBe('string')
        }
      }
    }

    // Should have at least 2 nodes with plugin data (frame + rect)
    expect(nodesWithPluginData).toBeGreaterThanOrEqual(2)
    expect(totalEntries).toBeGreaterThanOrEqual(3)
  })
})
