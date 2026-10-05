import { expect, test } from 'bun:test'

import { remapFigmaNodeReferences } from '#fig/node-change/node-references'

import { figmaSchema } from '@open-pencil/kiwi/fig'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'

test('paint source GUIDs in strokes and nested override paints follow export identity', () => {
  const source = { sessionID: 0, localID: 4 }
  const target = { sessionID: 1, localID: 12 }
  const unresolved = { sessionID: 5, localID: 999 }
  const record = {
    type: 'RECTANGLE',
    strokePaints: [{ type: 'PATTERN', sourceNodeId: source }],
    symbolData: {
      symbolID: { sessionID: 5, localID: 1 },
      symbolOverrides: [{ strokePaints: [{ type: 'PATTERN', sourceNodeId: source }] }]
    },
    vectorData: {
      styleOverrideTable: [{ fillPaints: [{ type: 'PATTERN', sourceNodeId: source }] }]
    },
    opaqueData: { sourceNodeId: source, guid: source },
    textDecorationFillPaints: [{ type: 'PATTERN', sourceNodeId: unresolved }]
  } satisfies NodeChange & Record<string, unknown>
  remapFigmaNodeReferences(record, (guid, path) =>
    path === 'paint.sourceNodeId' && guid.localID === source.localID ? target : null
  )
  expect(record.strokePaints[0].sourceNodeId).toEqual(target)
  expect(record.symbolData.symbolOverrides[0].strokePaints[0].sourceNodeId).toEqual(target)
  expect(record.vectorData.styleOverrideTable[0].fillPaints[0].sourceNodeId).toEqual(target)
  expect(record.opaqueData).toEqual({ sourceNodeId: source, guid: source })
  expect(record.textDecorationFillPaints[0].sourceNodeId).toEqual(unresolved)
})

test('canvas background paints follow their source node GUID without changing paint metadata', () => {
  const source = { sessionID: 7, localID: 4 },
    target = { sessionID: 1, localID: 12 }
  const record = {
    type: 'CANVAS',
    backgroundPaints: [{ type: 'PATTERN', sourceNodeId: source, opacity: 0.75, scale: 2 }]
  } satisfies NodeChange
  remapFigmaNodeReferences(record, () => target)
  expect(record.backgroundPaints).toEqual([
    { type: 'PATTERN', sourceNodeId: target, opacity: 0.75, scale: 2 }
  ])
})

test('paint-shaped arrays inside unknown metadata stay opaque', () => {
  const source = { sessionID: 7, localID: 4 },
    target = { sessionID: 1, localID: 12 }
  const opaqueData = {
    fillPaints: [{ type: 'PATTERN', sourceNodeId: source }],
    nested: { strokePaints: [{ sourceNodeId: source }] }
  }
  const record = {
    type: 'RECTANGLE',
    fillPaints: [{ type: 'PATTERN', sourceNodeId: source }],
    opaqueData: structuredClone(opaqueData)
  } satisfies NodeChange & Record<string, unknown>
  remapFigmaNodeReferences(record, () => target)
  expect(record.fillPaints[0].sourceNodeId).toEqual(target)
  expect(record.opaqueData).toEqual(opaqueData)
})

test('embedded schema paint fields remap by type while an opaque payload with matching names stays unchanged', () => {
  const schema = structuredClone(figmaSchema),
    node = schema.definitions.find((definition) => definition.name === 'NodeChange'),
    paint = schema.definitions.find((definition) => definition.name === 'Paint')
  const fills = node?.fields.find((field) => field.name === 'fillPaints')
  if (!node || !paint || !fills) throw new Error('Missing paint schema definitions')
  schema.definitions.push(
    { ...paint, name: 'OpaquePaint', fields: structuredClone(paint.fields) },
    { ...node, name: 'OpaquePayload', fields: [{ ...fills, type: 'OpaquePaint' }] }
  )
  node.fields.push(
    { ...fills, name: 'futurePaint', value: 60000, type: 'Paint', isArray: false },
    { ...fills, name: 'opaquePaintMetadata', value: 60001, type: 'OpaquePayload', isArray: false }
  )
  const source = { sessionID: 7, localID: 4 },
    target = { sessionID: 1, localID: 12 }
  const record = {
    type: 'RECTANGLE',
    futurePaint: { type: 'PATTERN', sourceNodeId: source },
    opaquePaintMetadata: { fillPaints: [{ type: 'PATTERN', sourceNodeId: source }] }
  } satisfies NodeChange & Record<string, unknown>
  remapFigmaNodeReferences(record, () => target, schema)
  expect(record.futurePaint.sourceNodeId).toEqual(target)
  expect(record.opaquePaintMetadata.fillPaints[0].sourceNodeId).toEqual(source)
})

test('unresolved and wrongly typed paint sources are preserved without guessing a new target', () => {
  const unresolved = { sessionID: 7, localID: 404 },
    malformed = { sessionID: 7, localID: '404' }
  const record: Record<string, unknown> = {
    type: 'RECTANGLE',
    fillPaints: [
      { type: 'PATTERN', sourceNodeId: unresolved },
      { type: 'PATTERN', sourceNodeId: malformed },
      { type: 'PATTERN', sourceNodeId: null }
    ]
  }
  const before = structuredClone(record),
    visited: unknown[] = []
  remapFigmaNodeReferences(record, (guid) => {
    visited.push(guid)
    return null
  })
  expect(record).toEqual(before)
  expect(visited).toEqual([unresolved])
})
