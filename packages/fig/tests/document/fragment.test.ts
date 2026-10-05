import { expect, test } from 'bun:test'

import { normalizeFigFragment } from '#fig/document/fragment'

import { materializeDocument, materializeFigFragment } from '@open-pencil/fig'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'

const guid = (localID: number) => ({ sessionID: 0, localID })
test('fragment containers avoid existing IDs and retain source input', () => {
  const input: NodeChange[] = [
    { guid: guid(0), type: 'FRAME', name: 'Pasted', parentIndex: { guid: guid(99), position: '!' } }
  ]
  const before = structuredClone(input)
  const normalized = normalizeFigFragment(input)
  const graph = materializeDocument(normalized).graph
  expect(graph.getChildren(graph.getPages()[0].id).map((node) => node.name)).toEqual(['Pasted'])
  expect(new Set(normalized.map((node) => JSON.stringify(node.guid))).size).toBe(3)
  expect(input).toEqual(before)
})

test('empty missing instances detach only under explicit fragment policy', () => {
  const input: NodeChange[] = [
    {
      guid: guid(2),
      type: 'INSTANCE',
      name: 'Missing',
      symbolData: { symbolID: guid(99) },
      size: { x: 120, y: 40 }
    }
  ]
  expect(() => normalizeFigFragment(input)).toThrow('Missing fragment component')
  const nodes = normalizeFigFragment(input, { missingComponent: 'detach-empty' })
  const detached = nodes.find((node) => node.name === 'Missing')
  expect(detached?.type).toBe('FRAME')
  expect(detached?.size).toEqual({ x: 120, y: 40 })
  expect(detached?.symbolData).toBeUndefined()
  expect(() =>
    normalizeFigFragment(
      [...input, { guid: guid(3), type: 'TEXT', parentIndex: { guid: guid(2), position: '!' } }],
      { missingComponent: 'detach-empty' }
    )
  ).toThrow('Missing fragment component')
})

test('fragment interpretation retains hidden component dependencies without selecting them', () => {
  const source: NodeChange[] = [
    { guid: guid(0), type: 'DOCUMENT' },
    { guid: guid(1), type: 'CANVAS', parentIndex: { guid: guid(0), position: '!' } },
    {
      guid: guid(2),
      type: 'CANVAS',
      internalOnly: true,
      parentIndex: { guid: guid(0), position: '"' }
    },
    {
      guid: guid(3),
      type: 'SYMBOL',
      name: 'Definition',
      parentIndex: { guid: guid(2), position: '!' }
    },
    {
      guid: guid(4),
      type: 'RECTANGLE',
      name: 'Child',
      parentIndex: { guid: guid(3), position: '!' },
      size: { x: 20, y: 10 }
    },
    {
      guid: guid(5),
      type: 'INSTANCE',
      name: 'Pasted',
      parentIndex: { guid: guid(1), position: '!' },
      symbolData: { symbolID: guid(3) }
    }
  ]
  const { graph, rootIds, dependencyPageIds } = materializeFigFragment(source)
  expect(rootIds).toHaveLength(1)
  expect(dependencyPageIds).toHaveLength(1)
  const root = graph.getNode(rootIds[0])
  expect(root?.type).toBe('INSTANCE')
  expect(graph.getNode(root?.componentId ?? '')?.type).toBe('COMPONENT')
  expect(graph.getChildren(rootIds[0]).map((node) => node.name)).toEqual(['Child'])
  expect(graph.getChildren(dependencyPageIds[0]).map((node) => node.name)).toEqual(['Definition'])
})

test('fragment interpretation does not silently accept missing override dependencies', () => {
  const source: NodeChange[] = [
    {
      guid: guid(2),
      type: 'INSTANCE',
      symbolData: {
        symbolID: guid(99),
        symbolOverrides: [{ guidPath: { guids: [guid(100)] }, visible: false }]
      }
    } as NodeChange
  ]
  expect(() => materializeFigFragment(source, [], { missingComponent: 'detach-empty' })).toThrow(
    'Missing fragment component'
  )
})

test('synthetic containers never satisfy a missing component reference', () => {
  const source: NodeChange[] = [
    { guid: guid(2), type: 'INSTANCE', symbolData: { symbolID: guid(0) } }
  ]
  expect(() => materializeFigFragment(source)).toThrow('Missing fragment component 0:0')
})

test('fragment normalization rejects ambiguous source identity', () => {
  expect(() =>
    normalizeFigFragment([
      { guid: guid(1), type: 'FRAME' },
      { guid: guid(1), type: 'FRAME' }
    ])
  ).toThrow('Duplicate')
})

test('inert historical assignments are reported and retain their raw source record', () => {
  const source: NodeChange[] = [
    { guid: guid(3), type: 'SYMBOL', name: 'Definition' },
    {
      guid: guid(4),
      type: 'INSTANCE',
      name: 'Pasted',
      symbolData: {
        symbolID: guid(3),
        symbolOverrides: [
          {
            guidPath: { guids: [guid(3)] },
            componentPropAssignments: [{ defID: guid(90), value: { boolValue: false } }]
          }
        ]
      }
    }
  ]
  const before = structuredClone(source)
  const result = materializeFigFragment(source)
  const root = result.rootIds
    .map((id) => result.graph.getNode(id))
    .find((node) => node?.name === 'Pasted')
  if (!root) throw new Error('Missing pasted instance')
  const expectedOverrides = source[1].symbolData?.symbolOverrides
  if (!expectedOverrides) throw new Error('Missing source overrides')
  expect(root.componentPropertyAssignments).toEqual({})
  expect(root.source.fig.symbolOverrides).toEqual(expectedOverrides)
  expect(result.retiredPropertyAssignments).toEqual([
    { nodeId: root.id, sourceId: '0:4', propertyId: '0:90', value: 'false' }
  ])
  expect(source).toEqual(before)
})

test('an assignment used by a live field remains a transfer error when its definition is missing', async () => {
  const source: NodeChange[] = [
    { guid: guid(3), type: 'SYMBOL', name: 'Definition' },
    {
      guid: guid(5),
      type: 'RECTANGLE',
      parentIndex: { guid: guid(3), position: '!' },
      componentPropRefs: [{ defID: guid(90), componentPropNodeField: 'VISIBLE' }]
    },
    {
      guid: guid(4),
      type: 'INSTANCE',
      name: 'Pasted',
      symbolData: {
        symbolID: guid(3),
        symbolOverrides: [
          {
            guidPath: { guids: [guid(3)] },
            componentPropAssignments: [{ defID: guid(90), value: { boolValue: false } }]
          }
        ]
      }
    }
  ]
  const result = materializeFigFragment(source)
  expect(result.retiredPropertyAssignments).toEqual([])
  const { SceneGraph, prepareGraphTransfer } = await import('@open-pencil/scene-graph')
  const target = new SceneGraph()
  expect(() =>
    prepareGraphTransfer({
      source: result.graph,
      rootIds: result.rootIds,
      dependencyPageIds: result.dependencyPageIds,
      target,
      parentId: target.getPages()[0].id
    })
  ).toThrow('Missing property transfer mapping')
})
