import { describe, expect, test } from 'bun:test'

import { importClipboardNodes } from '@open-pencil/core/clipboard'
import { OPEN_PENCIL_PLUGIN_ID } from '@open-pencil/fig/node-change'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'

import {
  LOWCODE_EVENTS_KEY,
  LOWCODE_MOTION_DRIVERS_KEY,
  LOWCODE_MOTION_SCENE_KEY,
  LOWCODE_PROTOTYPE_KEY,
  LOWCODE_TRANSITION_KEY
} from '#core/kiwi/fig/node-change/lowcode-plugin-data'

import { getNodeOrThrow } from '#tests/helpers/assert'
import { createClipboardGraph } from '#tests/helpers/clipboard'

const parent = (sessionID: number, localID: number, position = '!') => ({
  guid: { sessionID, localID },
  position
})

const transform = (x = 0, y = 0) => ({
  m00: 1,
  m01: 0,
  m02: x,
  m10: 0,
  m11: 1,
  m12: y
})

function entry(key: string, value: unknown) {
  return { pluginID: OPEN_PENCIL_PLUGIN_ID, key, value: JSON.stringify(value) }
}

describe('importClipboardNodes: Motion reference remapping', () => {
  // eslint-disable-next-line complexity -- The compact Kiwi fixture covers every reference family.
  test('remaps every included reference and preserves external targets and source metadata', () => {
    const { graph, pageId } = createClipboardGraph()
    const nodeChanges = [
      { guid: { sessionID: 0, localID: 0 }, type: 'DOCUMENT', name: 'Doc' },
      {
        guid: { sessionID: 0, localID: 1 },
        parentIndex: parent(0, 0),
        type: 'CANVAS',
        name: 'Page'
      },
      {
        guid: { sessionID: 1, localID: 10 },
        parentIndex: parent(0, 1),
        type: 'FRAME',
        name: 'Motion owner',
        size: { x: 320, y: 240 },
        transform: transform(),
        pluginData: [
          entry(LOWCODE_EVENTS_KEY, {
            onClick: [
              {
                id: 'branch',
                kind: 'condition',
                condExpr: 'true',
                consequent: [
                  {
                    id: 'play-internal',
                    kind: 'playMotion',
                    targetNodeId: '1:11',
                    trackId: 'entrance'
                  }
                ],
                alternate: [
                  {
                    id: 'play-external',
                    kind: 'playMotion',
                    targetNodeId: '99:90',
                    trackId: 'external'
                  }
                ]
              }
            ]
          }),
          entry(LOWCODE_MOTION_SCENE_KEY, {
            version: 1,
            id: 'clipboard-scene',
            sequences: [
              {
                id: 'intro',
                trigger: 'manual',
                cues: [
                  { id: 'inside', targetNodeId: '1:11', trackId: 'entrance', startMs: 0 },
                  { id: 'outside', targetNodeId: '99:91', trackId: 'external', startMs: 80 }
                ]
              }
            ]
          }),
          entry(LOWCODE_MOTION_DRIVERS_KEY, {
            version: 1,
            drivers: [
              {
                id: 'scroll-internal',
                source: {
                  kind: 'scroll',
                  sourceNodeId: '1:12',
                  axis: 'y',
                  metric: 'progress'
                },
                target: { targetNodeId: '1:11', trackId: 'entrance' },
                mapping: { inputMin: 0, inputMax: 1 }
              },
              {
                id: 'drag-owner',
                source: { kind: 'drag', handleNodeId: '99:92', axis: 'x', distance: 100 },
                target: { targetNodeId: '1:10', trackId: 'owner-track' },
                mapping: { inputMin: 0, inputMax: 100 }
              }
            ]
          }),
          entry(LOWCODE_PROTOTYPE_KEY, {
            version: 1,
            connections: [
              {
                id: 'navigate-internal',
                trigger: { kind: 'click' },
                action: { kind: 'navigate', targetNodeId: '1:13' },
                transition: { kind: 'instant' }
              },
              {
                id: 'overlay-external',
                trigger: { kind: 'afterDelay', delayMs: 10 },
                action: {
                  kind: 'openOverlay',
                  targetNodeId: '99:93',
                  placement: 'center'
                },
                transition: { kind: 'instant' }
              }
            ]
          })
        ]
      },
      {
        guid: { sessionID: 1, localID: 11 },
        parentIndex: parent(1, 10),
        type: 'RECTANGLE',
        name: 'Target',
        size: { x: 80, y: 40 },
        transform: transform(10, 10),
        pluginData: [entry(LOWCODE_TRANSITION_KEY, 'shared-target')]
      },
      {
        guid: { sessionID: 1, localID: 12 },
        parentIndex: parent(1, 10, '"'),
        type: 'FRAME',
        name: 'Scroll source',
        size: { x: 100, y: 100 },
        transform: transform(100, 10)
      },
      {
        guid: { sessionID: 1, localID: 13 },
        parentIndex: parent(1, 10, '#'),
        type: 'FRAME',
        name: 'Destination',
        size: { x: 100, y: 100 },
        transform: transform(200, 10)
      }
    ] as NodeChange[]

    const [ownerId] = importClipboardNodes(nodeChanges, graph, pageId)
    const owner = getNodeOrThrow(graph, ownerId)
    const target = graph.getChildren(owner.id).find((node) => node.name === 'Target')
    const source = graph.getChildren(owner.id).find((node) => node.name === 'Scroll source')
    const destination = graph.getChildren(owner.id).find((node) => node.name === 'Destination')

    expect(target).toBeDefined()
    expect(source).toBeDefined()
    expect(destination).toBeDefined()
    expect(owner.motionScene?.sequences[0]?.cues.map((cue) => cue.targetNodeId)).toEqual([
      target?.id,
      '99:91'
    ])
    expect(owner.motionDrivers?.drivers[0]?.source).toMatchObject({ sourceNodeId: source?.id })
    expect(owner.motionDrivers?.drivers[0]?.target.targetNodeId).toBe(target?.id)
    expect(owner.motionDrivers?.drivers[1]?.source).toMatchObject({ handleNodeId: '99:92' })
    expect(owner.motionDrivers?.drivers[1]?.target.targetNodeId).toBe(owner.id)
    expect(owner.prototype?.connections[0]?.action).toEqual({
      kind: 'navigate',
      targetNodeId: destination?.id
    })
    expect(owner.prototype?.connections[1]?.action).toMatchObject({
      kind: 'openOverlay',
      targetNodeId: '99:93'
    })
    const branch = owner.events?.onClick?.[0]
    expect(branch?.kind).toBe('condition')
    if (branch?.kind !== 'condition') throw new Error('Expected condition action')
    expect(branch.consequent[0]).toMatchObject({ targetNodeId: target?.id })
    expect(branch.alternate?.[0]).toMatchObject({ targetNodeId: '99:90' })
    expect(target?.transitionKey).toBe('shared-target')
    expect(owner.source.editedFields).toEqual([])
    expect(target?.source.editedFields).toEqual([])
  })
})
