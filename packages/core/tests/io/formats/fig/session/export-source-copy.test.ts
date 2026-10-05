import { expect, test } from 'bun:test'
import { Buffer } from 'node:buffer'

import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { SceneGraph } from '@open-pencil/scene-graph'

import { importNodeChanges } from '#core/kiwi/fig/import'
import { cloneSceneGraphForFigExport } from '#core/kiwi/fig/parse/transfer'
import { snapshotReaderState } from '#core/kiwi/fig/session/document-state'

function motionMetadata() {
  const timelineGuid = { sessionID: 7, localID: 100 }
  const trackGuid = { sessionID: 7, localID: 103 }
  const metadata = {
    timelineAssignments: {
      entries: [
        {
          key: {
            assignedTimelineId: timelineGuid,
            containingTimelineId: { sessionID: 7, localID: 101 }
          },
          value: { offsetUs: 250_000n, disabled: true }
        }
      ]
    },
    styleIdsForAnimation: [
      {
        id: trackGuid,
        timelineDefId: timelineGuid,
        animationStyleId: { guid: { sessionID: 7, localID: 104 } },
        timelineOffset: 250_000n
      }
    ],
    transitionOverrides: {
      all: [
        {
          id: trackGuid,
          duration: 0.5,
          delay: 0.25,
          easing: {
            easingType: 'CUSTOM_CUBIC',
            easingValue: { bezierEasing: { p1x: 0.25, p1y: 0.125, p2x: 0.75, p2y: 0.875 } }
          },
          createdAtMs: 1024n,
          interactionIDs: [{ sessionID: 7, localID: 106 }],
          disabled: true
        }
      ]
    },
    opaqueBytes: new Uint8Array([0x47, 0x4c, 0x59, 0x50, 0x48])
  }
  return metadata
}

test('export copies opaque Motion metadata without changing shared GUIDs or the editing graph', () => {
  const metadata = motionMetadata()
  const trackGuid = metadata.styleIdsForAnimation[0].id
  const graph = new SceneGraph()
  const original = graph.getNode(graph.rootId)
  if (!original) throw new Error('Missing document node')
  original.source.format = 'fig'
  original.source.fig.rawNodeFields = metadata

  const copied = cloneSceneGraphForFigExport(graph).getNode(graph.rootId)
  if (!copied) throw new Error('Missing cloned document node')
  const fields = copied.source.fig.rawNodeFields as typeof metadata
  expect(fields).toEqual(metadata)
  expect(copied.source).not.toBe(original.source)
  expect(fields.transitionOverrides.all[0].id).toBe(fields.styleIdsForAnimation[0].id)
  expect(fields.styleIdsForAnimation[0].timelineDefId).toBe(
    fields.timelineAssignments.entries[0].key.assignedTimelineId
  )
  expect(fields.opaqueBytes).not.toBe(metadata.opaqueBytes)

  fields.transitionOverrides.all[0].id.localID = 999
  fields.opaqueBytes[0] = 0
  fields.timelineAssignments.entries[0].value.offsetUs = 0n
  expect(trackGuid.localID).toBe(103)
  expect(metadata.opaqueBytes[0]).toBe(0x47)
  expect(metadata.timelineAssignments.entries[0].value.offsetUs).toBe(250_000n)
})

test('record import and reader recovery preserve complete DOCUMENT and CANVAS Motion metadata', () => {
  const metadata = motionMetadata()
  const records: NodeChange[] = [
    { guid: { sessionID: 0, localID: 0 }, type: 'DOCUMENT', ...metadata },
    {
      guid: { sessionID: 0, localID: 1 },
      type: 'CANVAS',
      parentIndex: { guid: { sessionID: 0, localID: 0 }, position: 'a' },
      ...metadata
    }
  ]
  const graph = importNodeChanges(records, [])
  const root = graph.getNode(graph.rootId)
  if (!root) throw new Error('Missing imported document')
  const page = graph.getPages()[0]
  for (const node of [root, page]) {
    const fields = node.source.fig.rawNodeFields
    expect(fields.transitionOverrides).toEqual(metadata.transitionOverrides)
    expect(fields.styleIdsForAnimation).toEqual(metadata.styleIdsForAnimation)
    expect(fields.timelineAssignments).toEqual(metadata.timelineAssignments)
  }
  const state = snapshotReaderState(graph)
  if (!state || !('records' in state.input)) throw new Error('Missing record recovery input')
  expect(state.input.records).toEqual(records)
  expect(state.input.records).not.toBe(records)
})

test('export detaches Buffer-backed source bytes while retaining shared byte references', () => {
  const graph = new SceneGraph()
  const original = graph.getNode(graph.rootId)
  if (!original) throw new Error('Missing document node')
  const bytes = Buffer.from([0x47, 0x4c])
  original.source.fig.rawNodeFields = { bytes, repeatedBytes: bytes }
  const copied = cloneSceneGraphForFigExport(graph).getNode(graph.rootId)
  if (!copied) throw new Error('Missing cloned document node')
  const fields = copied.source.fig.rawNodeFields
  if (!(fields.bytes instanceof Uint8Array) || !(fields.repeatedBytes instanceof Uint8Array)) {
    throw new Error('Missing copied source bytes')
  }
  expect(fields.bytes).toBe(fields.repeatedBytes)
  fields.bytes[0] = 0
  expect(bytes[0]).toBe(0x47)
})
