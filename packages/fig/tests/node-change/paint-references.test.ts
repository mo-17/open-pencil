import { expect, test } from 'bun:test'

import { remapFigmaNodeReferences } from '#fig/node-change/node-references'

import type { NodeChange } from '@open-pencil/kiwi/fig/codec'

test('paint source GUIDs in strokes and nested override paints follow export identity', () => {
  const source = { sessionID: 0, localID: 4 }
  const target = { sessionID: 1, localID: 12 }
  const unresolved = { sessionID: 5, localID: 999 }
  const record = {
    type: 'RECTANGLE',
    strokePaints: [{ type: 'PATTERN', sourceNodeId: source }],
    symbolOverrides: [{ strokePaints: [{ type: 'PATTERN', sourceNodeId: source }] }],
    styleOverrides: [{ fillPaints: [{ type: 'PATTERN', sourceNodeId: source }] }],
    opaqueData: { sourceNodeId: source, guid: source },
    textDecorationFillPaints: [{ type: 'PATTERN', sourceNodeId: unresolved }]
  } satisfies NodeChange & Record<string, unknown>
  remapFigmaNodeReferences(record, (guid, path) =>
    path === 'paint.sourceNodeId' && guid.localID === source.localID ? target : null
  )
  expect(record.strokePaints[0].sourceNodeId).toEqual(target)
  expect(record.symbolOverrides[0].strokePaints[0].sourceNodeId).toEqual(target)
  expect(record.styleOverrides[0].fillPaints[0].sourceNodeId).toEqual(target)
  expect(record.opaqueData).toEqual({ sourceNodeId: source, guid: source })
  expect(record.textDecorationFillPaints[0].sourceNodeId).toEqual(unresolved)
})
