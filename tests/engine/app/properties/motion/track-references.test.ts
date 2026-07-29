import { describe, expect, test } from 'bun:test'

import { createMotionPreset, type ActionDef } from '@open-pencil/scene-graph'

import { createEditorStore } from '@/app/editor/session'
import { renameMotionTrackWithReferences } from '@/app/properties/motion'
import { renameMotionTrack } from '@/app/properties/motion/timeline'

import { expectDefined } from '#tests/helpers/assert'

interface ActionTreeRecord {
  kind?: unknown
  trackId?: unknown
  [key: string]: unknown
}

function isActionTreeRecord(value: unknown): value is ActionTreeRecord {
  return value !== null && typeof value === 'object'
}

function referencedTrackIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(referencedTrackIds)
  if (!isActionTreeRecord(value)) return []
  const own =
    (value.kind === 'playMotion' ||
      value.kind === 'stopMotion' ||
      value.kind === 'toggleMotion' ||
      value.kind === 'awaitMotion') &&
    typeof value.trackId === 'string'
      ? [value.trackId]
      : []
  return [...own, ...Object.values(value).flatMap(referencedTrackIds)]
}

describe('Motion timeline track references', () => {
  test('renames nested event and workflow references atomically with the track', () => {
    const store = createEditorStore()
    const pageId = store.state.currentPageId
    const target = store.graph.createNode('RECTANGLE', pageId, {
      motion: createMotionPreset('fade-in')
    })
    const other = store.graph.createNode('RECTANGLE', pageId, {
      motion: createMotionPreset('fade-in')
    })
    const actions: ActionDef[] = [
      {
        id: 'condition',
        kind: 'condition',
        condExpr: 'true',
        consequent: [
          { id: 'play', kind: 'playMotion', targetNodeId: target.id, trackId: 'fade-in' },
          {
            id: 'api',
            kind: 'apiCall',
            method: 'GET',
            url: '/motion',
            targetName: 'response',
            onSuccess: [
              { id: 'toggle', kind: 'toggleMotion', targetNodeId: target.id, trackId: 'fade-in' }
            ],
            onError: [
              { id: 'other', kind: 'stopMotion', targetNodeId: other.id, trackId: 'fade-in' }
            ]
          }
        ],
        alternate: [
          { id: 'wait', kind: 'awaitMotion', targetNodeId: target.id, trackId: 'fade-in' }
        ]
      }
    ]
    const controller = store.graph.createNode('BUTTON', pageId, {
      events: { onClick: actions },
      lowcodeWorkflows: [
        {
          id: 'stop-motion',
          name: 'Stop motion',
          actions: [{ id: 'stop', kind: 'stopMotion', targetNodeId: target.id, trackId: 'fade-in' }]
        }
      ]
    })

    const next = renameMotionTrack(
      expectDefined(target.motion, 'target motion'),
      'fade-in',
      'intro'
    )
    expect(
      renameMotionTrackWithReferences(
        store,
        target.id,
        next,
        'fade-in',
        'intro',
        'Rename motion track'
      )
    ).toBe(true)

    expect(store.graph.getNode(target.id)?.motion?.tracks[0]?.id).toBe('intro')
    expect(referencedTrackIds(store.graph.getNode(controller.id)?.events)).toEqual([
      'intro',
      'intro',
      'fade-in',
      'intro'
    ])
    expect(referencedTrackIds(store.graph.getNode(controller.id)?.lowcodeWorkflows)).toEqual([
      'intro'
    ])
    expect(store.undo.undoLabel).toBe('Rename motion track')

    store.undo.undo()
    expect(store.graph.getNode(target.id)?.motion?.tracks[0]?.id).toBe('fade-in')
    expect(referencedTrackIds(store.graph.getNode(controller.id)?.events)).toEqual([
      'fade-in',
      'fade-in',
      'fade-in',
      'fade-in'
    ])

    store.undo.redo()
    expect(store.graph.getNode(target.id)?.motion?.tracks[0]?.id).toBe('intro')
    expect(referencedTrackIds(store.graph.getNode(controller.id)?.lowcodeWorkflows)).toEqual([
      'intro'
    ])
  })
})
