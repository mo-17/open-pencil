import { beforeAll, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'
import { uint8ArrayToArrayBuffer } from '#core-tests/helpers/fig/fixtures'
import { deflateSync } from 'fflate'

import { exportFigFile, parseFigFile } from '@open-pencil/core'
import { parseFigBuffer } from '@open-pencil/fig'
import { guidToString } from '@open-pencil/fig/node-change'
import { figmaSchema } from '@open-pencil/kiwi/fig'
import { initCodec, type NodeChange } from '@open-pencil/kiwi/fig/codec'
import { encodeBinarySchema } from '@open-pencil/kiwi/schema-runtime'
import { SceneGraph, type Fill } from '@open-pencil/scene-graph'
import type { GUID } from '@open-pencil/scene-graph/primitives'

beforeAll(initCodec)

function pattern(sourceNodeId: string): Fill {
  return {
    type: 'PATTERN',
    sourceNodeId,
    color: { r: 0.2, g: 0.3, b: 0.4, a: 1 },
    opacity: 0.75,
    visible: true,
    scale: 1.5,
    patternTileType: 'RECTANGULAR',
    patternSpacing: { x: 0.25, y: 0.4 },
    horizontalAlignment: 'CENTER',
    verticalAlignment: 'CENTER'
  }
}

function findRecord(changes: readonly NodeChange[], name: string) {
  return expectDefined(
    changes.find((change) => change.name === name),
    name
  )
}

async function decode(graph: SceneGraph) {
  const bytes = await exportFigFile(graph)
  return { bytes, changes: parseFigBuffer(uint8ArrayToArrayBuffer(bytes)).nodeChanges }
}

test('encoded canvas background source follows a reassigned reserved GUID and preserves its metadata', async () => {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  page.source.id = '41:1'
  page.source.format = 'fig'
  const target = graph.createNode('RECTANGLE', page.id, { name: 'Background source' })
  target.source.id = '0:0'
  target.source.format = 'fig'
  page.source.fig.rawNodeFields.backgroundPaints = [
    {
      type: 'PATTERN',
      sourceNodeId: { sessionID: 0, localID: 0 },
      opacity: 0.75,
      patternTileType: 'RECTANGULAR',
      patternSpacing: { x: 0.25, y: 0.4 }
    }
  ]
  const before = structuredClone([...graph.nodes]),
    result = await decode(graph),
    targetRecord = findRecord(result.changes, target.name),
    pageRecord = findRecord(result.changes, page.name)
  expect(guidToString(expectDefined(targetRecord.guid))).not.toBe('0:0')
  expect(pageRecord.backgroundPaints?.[0]).toMatchObject({
    sourceNodeId: targetRecord.guid,
    opacity: 0.75,
    patternTileType: 'RECTANGULAR'
  })
  expect([...graph.nodes]).toEqual(before)
  const reopened = await parseFigFile(uint8ArrayToArrayBuffer(result.bytes)),
    second = await decode(reopened)
  expect(findRecord(second.changes, page.name).backgroundPaints?.[0]?.sourceNodeId).toEqual(
    findRecord(second.changes, target.name).guid
  )
})

test('an encoded embedded-schema paint remaps while a GUID-shaped opaque payload survives two local writes', async () => {
  const schema = structuredClone(figmaSchema),
    node = expectDefined(schema.definitions.find((definition) => definition.name === 'NodeChange')),
    paint = expectDefined(schema.definitions.find((definition) => definition.name === 'Paint')),
    fills = expectDefined(node.fields.find((field) => field.name === 'fillPaints'))
  schema.definitions.push(
    { ...paint, name: 'OpaquePaint', fields: structuredClone(paint.fields) },
    { ...node, name: 'OpaquePayload', fields: [{ ...fills, type: 'OpaquePaint' }] }
  )
  node.fields.push(
    { ...fills, name: 'futurePaint', value: 60000, type: 'Paint', isArray: false },
    { ...fills, name: 'opaquePaintMetadata', value: 60001, type: 'OpaquePayload', isArray: false }
  )
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.figSchemaDeflated = deflateSync(encodeBinarySchema(schema))
  const target = graph.createNode('RECTANGLE', page.id, { name: 'Embedded source' }),
    owner = graph.createNode('RECTANGLE', page.id, { name: 'Embedded owner' }),
    originalGUID: GUID = { sessionID: 0, localID: 0 }
  target.source.id = '0:0'
  target.source.format = owner.source.format = 'fig'
  owner.source.id = '42:2'
  owner.source.fig.rawNodeFields.futurePaint = { type: 'PATTERN', sourceNodeId: originalGUID }
  owner.source.fig.rawNodeFields.opaquePaintMetadata = {
    fillPaints: [{ type: 'PATTERN', sourceNodeId: originalGUID }]
  }
  owner.pluginData = [{ pluginId: 'guid-fixture', key: 'binding', value: 'preserve-42:2' }]
  const before = structuredClone([...graph.nodes])
  for (let cycle = 0, current = graph; cycle < 2; cycle++) {
    const result = await decode(current),
      targetRecord = findRecord(result.changes, target.name),
      ownerRecord = findRecord(result.changes, owner.name) as NodeChange & {
        futurePaint?: { sourceNodeId?: GUID }
        opaquePaintMetadata?: { fillPaints?: Array<{ sourceNodeId?: GUID }> }
      }
    expect(ownerRecord.futurePaint?.sourceNodeId).toEqual(targetRecord.guid)
    expect(ownerRecord.opaquePaintMetadata?.fillPaints?.[0]?.sourceNodeId).toEqual(originalGUID)
    expect(ownerRecord.pluginData).toContainEqual({
      pluginID: 'guid-fixture',
      key: 'binding',
      value: 'preserve-42:2'
    })
    current = await parseFigFile(uint8ArrayToArrayBuffer(result.bytes))
  }
  expect([...graph.nodes]).toEqual(before)
})

test('same local ID in distinct native sessions stays distinct through export and reimport', async () => {
  const graph = new SceneGraph(),
    page = graph.getPages()[0],
    first = graph.createNode('RECTANGLE', page.id, { name: 'Session A' }),
    second = graph.createNode('RECTANGLE', page.id, { name: 'Session B' })
  first.source.id = '43:44'
  second.source.id = '44:44'
  first.source.format = second.source.format = 'fig'
  const owner = graph.createNode('RECTANGLE', page.id, {
    name: 'Session owner',
    fills: [pattern(second.id), pattern(first.id)]
  })
  const before = structuredClone([...graph.nodes]),
    result = await decode(graph),
    record = findRecord(result.changes, owner.name)
  expect(record.fillPaints?.map((paint) => paint.sourceNodeId)).toEqual([
    findRecord(result.changes, second.name).guid,
    findRecord(result.changes, first.name).guid
  ])
  const reopened = await parseFigFile(uint8ArrayToArrayBuffer(result.bytes)),
    reopenedOwner = expectDefined(
      Array.from(reopened.getAllNodes()).find((node) => node.name === owner.name)
    )
  expect(
    reopenedOwner.fills.map((paint) => reopened.getNode(paint.sourceNodeId ?? '')?.name)
  ).toEqual([second.name, first.name])
  expect([...graph.nodes]).toEqual(before)
})

test('copied subtree paints follow copied sources while external sources and original paints stay intact', async () => {
  const graph = new SceneGraph(),
    page = graph.getPages()[0],
    external = graph.createNode('RECTANGLE', page.id, { name: 'External tile' }),
    root = graph.createNode('FRAME', page.id, { name: 'Original group' }),
    tile = graph.createNode('RECTANGLE', root.id, { name: 'Internal tile' }),
    owner = graph.createNode('RECTANGLE', root.id, {
      name: 'Pattern owner',
      fills: [pattern(tile.id), pattern(external.id)],
      strokes: [
        {
          ...pattern(tile.id),
          weight: 2,
          align: 'INSIDE',
          cap: 'NONE',
          join: 'MITER',
          dashPattern: [4, 2]
        }
      ]
    }),
    originalPaints = structuredClone({ fills: owner.fills, strokes: owner.strokes }),
    copy = expectDefined(graph.cloneTree(root.id, page.id, { name: 'Copied group' })),
    copiedTile = expectDefined(graph.getChildren(copy.id).find((node) => node.name === tile.name)),
    copiedOwner = expectDefined(graph.getChildren(copy.id).find((node) => node.name === owner.name))
  expect(copiedOwner.fills.map((paint) => paint.sourceNodeId)).toEqual([copiedTile.id, external.id])
  expect(copiedOwner.strokes[0].sourceNodeId).toBe(copiedTile.id)
  graph.updateNode(copiedOwner.id, { name: 'Copied owner' })
  graph.updateNode(copiedTile.id, { name: 'Copied tile' })
  graph.reorderChild(copy.id, page.id, 0)
  expect(graph.getChildren(page.id)[0].id).toBe(copy.id)
  const beforeExport = structuredClone([...graph.nodes]),
    result = await decode(graph),
    record = findRecord(result.changes, copiedOwner.name)
  expect(record.fillPaints?.map((paint) => paint.sourceNodeId)).toEqual([
    findRecord(result.changes, copiedTile.name).guid,
    findRecord(result.changes, external.name).guid
  ])
  expect(record.strokePaints?.[0]?.sourceNodeId).toEqual(
    findRecord(result.changes, copiedTile.name).guid
  )
  const reopened = await parseFigFile(uint8ArrayToArrayBuffer(result.bytes)),
    reopenedOwner = expectDefined(
      Array.from(reopened.getAllNodes()).find((node) => node.name === copiedOwner.name)
    )
  expect(
    reopenedOwner.fills.map((paint) => reopened.getNode(paint.sourceNodeId ?? '')?.name)
  ).toEqual([copiedTile.name, external.name])
  expect({ fills: owner.fills, strokes: owner.strokes }).toEqual(originalPaints)
  expect([...graph.nodes]).toEqual(beforeExport)
})

test('a dangling paint GUID survives local encoding without binding to unrelated nodes', async () => {
  const graph = new SceneGraph(),
    page = graph.getPages()[0],
    owner = graph.createNode('RECTANGLE', page.id, {
      name: 'Unresolved owner',
      fills: [pattern('45:404')]
    }),
    before = structuredClone([...graph.nodes]),
    result = await decode(graph)
  expect(findRecord(result.changes, owner.name).fillPaints?.[0]?.sourceNodeId).toEqual({
    sessionID: 45,
    localID: 404
  })
  expect(
    result.changes.some((change) => change.guid && guidToString(change.guid) === '45:404')
  ).toBe(false)
  const reopened = await parseFigFile(uint8ArrayToArrayBuffer(result.bytes)),
    reopenedOwner = expectDefined(
      Array.from(reopened.getAllNodes()).find((node) => node.name === owner.name)
    )
  expect(reopenedOwner.fills[0].sourceNodeId).toBe('45:404')
  expect(reopened.getNode('45:404')).toBeUndefined()
  expect([...graph.nodes]).toEqual(before)
})
