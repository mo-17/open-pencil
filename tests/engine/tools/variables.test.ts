import { describe, expect, test } from 'bun:test'

import type { ToolResult } from '#tests/helpers/tools'
import { getTool, setupToolTest } from '#tests/helpers/tools'

function createGradientRect() {
  const { figma, graph } = setupToolTest()
  const collection = graph.createCollection('Theme')
  const start = graph.createVariable('gradient/start', 'COLOR', collection.id, {
    r: 1,
    g: 0,
    b: 0,
    a: 1
  })
  const scalar = graph.createVariable('opacity', 'FLOAT', collection.id, 0.5)
  const page = graph.getPages()[0]
  const rect = graph.createNode('RECTANGLE', page.id, {
    name: 'Gradient',
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
        ]
      }
    ]
  })
  return { figma, graph, rect, start, scalar }
}

describe('variable tools', () => {
  test('bind_variable supports gradient stop color paths', () => {
    const { figma, graph, rect, start } = createGradientRect()

    const result = getTool('bind_variable').execute(figma, {
      node_id: rect.id,
      field: 'fills/0/gradientStops/0/color',
      variable_id: start.id
    }) as ToolResult

    expect(result.error).toBeUndefined()
    expect(result).toEqual({
      node_id: rect.id,
      field: 'fills/0/gradientStops/0/color',
      variable_id: start.id
    })
    expect(graph.getNode(rect.id)?.boundVariables['fills/0/gradientStops/0/color']).toBe(start.id)
  })

  test('bind_variable reports gradient stop validation errors', () => {
    const { figma, graph, rect, scalar } = createGradientRect()

    const result = getTool('bind_variable').execute(figma, {
      node_id: rect.id,
      field: 'fills/0/gradientStops/0/color',
      variable_id: scalar.id
    }) as ToolResult

    expect(result.error).toContain('Cannot bind FLOAT variable to color field')
    expect(graph.getNode(rect.id)?.boundVariables['fills/0/gradientStops/0/color']).toBeUndefined()
  })

  test('unbind_variable removes gradient stop color paths', () => {
    const { figma, graph, rect, start } = createGradientRect()
    graph.bindVariable(rect.id, 'fills/0/gradientStops/1/color', start.id)

    const result = getTool('unbind_variable').execute(figma, {
      node_id: rect.id,
      field: 'fills/0/gradientStops/1/color'
    }) as ToolResult

    expect(result.error).toBeUndefined()
    expect(result).toEqual({
      unbound: true,
      node_id: rect.id,
      field: 'fills/0/gradientStops/1/color'
    })
    expect(graph.getNode(rect.id)?.boundVariables['fills/0/gradientStops/1/color']).toBeUndefined()
  })
})
