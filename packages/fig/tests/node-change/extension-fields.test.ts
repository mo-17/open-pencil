import { expect, test } from 'bun:test'

import { createFigRecordSession } from '#fig/document/materialize'
import { nodeChangeToProps } from '#fig/node-change/convert'

import type { NodeChange } from '@open-pencil/kiwi/fig/codec'

test('retains newer fields on authored nodes without adding known structural raw fallbacks', () => {
  const record = {
    type: 'RECTANGLE',
    name: 'Extension owner',
    guid: { sessionID: 1, localID: 2 },
    size: { x: 40, y: 20 },
    cornerRadius: 5,
    futurePayload: { label: 'keep', dataBlob: 0, nested: [{ value: 42 }] }
  } satisfies NodeChange & Record<string, unknown>
  const before = structuredClone(record)
  const blobs = [new Uint8Array([7, 8, 9])]
  const props = nodeChangeToProps(record, blobs)
  expect(props.source?.fig.rawNodeFields.futurePayload).toEqual({
    label: 'keep',
    dataBlob: { __openPencilFigmaBlob: new Uint8Array([7, 8, 9]) },
    nested: [{ value: 42 }]
  })
  for (const field of ['guid', 'type', 'name', 'size', 'cornerRadius']) {
    expect(props.source?.fig.rawNodeFields).not.toHaveProperty(field)
  }
  blobs[0][0] = 99
  expect(props.source?.fig.rawNodeFields.futurePayload).toMatchObject({
    dataBlob: { __openPencilFigmaBlob: new Uint8Array([7, 8, 9]) }
  })
  expect(record).toEqual(before)
})

test('synthetic occurrences do not acquire authored extension metadata', () => {
  const record = {
    type: 'RECTANGLE',
    futurePayload: { label: 'authored only' }
  } satisfies NodeChange & Record<string, unknown>
  expect(nodeChangeToProps(record, [], 'occurrence').source?.fig.rawNodeFields).toEqual({})
})

test('document, page shells and lazily loaded authored layers retain detached extensions', () => {
  const document = { sessionID: 1, localID: 0 }
  const page = { sessionID: 1, localID: 1 }
  const payload = { dataBlob: 0, label: 'extension' }
  const changes = [
    { guid: document, type: 'DOCUMENT', futurePayload: payload },
    {
      guid: page,
      type: 'CANVAS',
      parentIndex: { guid: document, position: '!' },
      futurePayload: payload
    },
    {
      guid: { sessionID: 1, localID: 2 },
      type: 'RECTANGLE',
      parentIndex: { guid: page, position: '!' },
      futurePayload: payload
    }
  ] satisfies Array<NodeChange & Record<string, unknown>>
  const before = structuredClone(changes)
  const session = createFigRecordSession(changes, [new Uint8Array([7, 8, 9])])
  expect(session.graph.nodes.size).toBe(2)
  session.loadPage('1:1')
  expect(session.graph.nodes.size).toBe(3)
  for (const node of session.graph.getAllNodes()) {
    expect(node.source.fig.rawNodeFields.futurePayload).toEqual({
      dataBlob: { __openPencilFigmaBlob: new Uint8Array([7, 8, 9]) },
      label: 'extension'
    })
  }
  expect(changes).toEqual(before)
})
