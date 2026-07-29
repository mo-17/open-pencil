import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  addMotionSceneCue,
  addMotionSceneMarker,
  addMotionSceneSequence,
  autoKeyframeMotionSceneCues,
  collectMotionSceneAvailableTracks,
  createMotionSceneSpec,
  motionSceneCueTrackOffsetAtTime,
  removeMotionSceneCues,
  removeMotionSceneMarker,
  scaleMotionSceneCues,
  snapMotionSceneTime,
  translateMotionSceneCues,
  updateMotionSceneCue,
  updateMotionSceneCues,
  updateMotionSceneWithUndo
} from '@/app/properties/motion/scene-timeline'

describe('Motion scene timeline authoring', () => {
  test('lists unused tracks from descendants only in stable tree order', () => {
    const graph = new SceneGraph()
    const page = graph.addPage('Page')
    const frame = graph.createNode('FRAME', page.id, { name: 'Hero' })
    const title = graph.createNode('TEXT', frame.id, { name: 'Title' })
    const outside = graph.createNode('TEXT', page.id, { name: 'Outside' })
    const motion = {
      version: 3 as const,
      tracks: [
        {
          id: 'enter',
          name: 'Enter',
          trigger: 'pageEnter' as const,
          keyframes: [
            { offset: 0, opacity: 0 },
            { offset: 1, opacity: 1 }
          ],
          timing: { durationMs: 400 }
        }
      ]
    }
    graph.updateNode(title.id, { motion })
    graph.updateNode(outside.id, { motion })
    const used = addMotionSceneCue(createMotionSceneSpec(), 'sequence-1', {
      targetNodeId: title.id,
      trackId: 'enter',
      startMs: 0
    }).scene

    expect(collectMotionSceneAvailableTracks(graph, frame.id, used, 'sequence-1')).toEqual([])
    expect(
      collectMotionSceneAvailableTracks(graph, page.id, createMotionSceneSpec(), 'sequence-1').map(
        ({ targetName, trackName, durationMs }) => ({ targetName, trackName, durationMs })
      )
    ).toEqual([
      { targetName: 'Title', trackName: 'Enter', durationMs: 400 },
      { targetName: 'Outside', trackName: 'Enter', durationMs: 400 }
    ])
  })

  test('creates stable sequence, cue, and marker ids without mutating prior snapshots', () => {
    const initial = createMotionSceneSpec('pageScene')
    const extra = addMotionSceneSequence(initial, 'pageExit')
    const first = addMotionSceneCue(extra.scene, 'sequence-1', {
      targetNodeId: '0:10',
      trackId: 'enter',
      startMs: 123
    })
    const second = addMotionSceneCue(first.scene, 'sequence-1', {
      targetNodeId: '0:11',
      trackId: 'fade',
      startMs: 240,
      timeScale: 2
    })
    const marker = addMotionSceneMarker(second.scene, 'sequence-1', 200, 'Content')

    expect(extra.sequenceId).toBe('sequence-2')
    expect(first.cueId).toBe('cue-1')
    expect(second.cueId).toBe('cue-2')
    expect(marker.markerId).toBe('marker-1')
    expect(initial.sequences).toHaveLength(1)
    expect(first.scene.sequences[0]?.cues).toHaveLength(1)
    expect(marker.scene.sequences[0]?.markers).toEqual([
      { id: 'marker-1', timeMs: 200, label: 'Content' }
    ])
  })

  test('rejects duplicate target-track cues and edits bounded cue fields strictly', () => {
    const first = addMotionSceneCue(createMotionSceneSpec(), 'sequence-1', {
      targetNodeId: 'node',
      trackId: 'enter',
      startMs: 0
    })
    expect(() =>
      addMotionSceneCue(first.scene, 'sequence-1', {
        targetNodeId: 'node',
        trackId: 'enter',
        startMs: 100
      })
    ).toThrow('already in the sequence')

    const updated = updateMotionSceneCue(first.scene, 'sequence-1', first.cueId, {
      startMs: -20,
      timeScale: 0.5,
      enabled: false
    })
    expect(updated.sequences[0]?.cues[0]).toMatchObject({
      startMs: 0,
      timeScale: 0.5,
      enabled: false
    })
  })

  test('translates selected cues as a group and snaps their shared anchor', () => {
    const first = addMotionSceneCue(createMotionSceneSpec(), 'sequence-1', {
      targetNodeId: 'a',
      trackId: 'enter',
      startMs: 110
    })
    const second = addMotionSceneCue(first.scene, 'sequence-1', {
      targetNodeId: 'b',
      trackId: 'enter',
      startMs: 210
    })
    const marked = addMotionSceneMarker(second.scene, 'sequence-1', 300, 'Beat').scene
    const translated = translateMotionSceneCues(
      marked,
      'sequence-1',
      new Set([first.cueId, second.cueId]),
      184,
      { gridMs: 100, thresholdMs: 20 }
    )

    expect(translated.sequences[0]?.cues.map(({ startMs }) => startMs)).toEqual([300, 400])
    expect(snapMotionSceneTime(marked, 'sequence-1', 287, 100, 15)).toBe(300)
  })

  test('does not snap a translated group back to one of its previous cue positions', () => {
    const first = addMotionSceneCue(createMotionSceneSpec(), 'sequence-1', {
      targetNodeId: 'a',
      trackId: 'enter',
      startMs: 100
    })
    const second = addMotionSceneCue(first.scene, 'sequence-1', {
      targetNodeId: 'b',
      trackId: 'enter',
      startMs: 200
    })
    const translated = translateMotionSceneCues(
      second.scene,
      'sequence-1',
      new Set([first.cueId, second.cueId]),
      10,
      { gridMs: 0, thresholdMs: 20 }
    )

    expect(translated.sequences[0]?.cues.map(({ startMs }) => startMs)).toEqual([110, 210])
  })

  test('updates cues targeting multiple nodes in one validated scene snapshot', () => {
    const first = addMotionSceneCue(createMotionSceneSpec(), 'sequence-1', {
      targetNodeId: 'a',
      trackId: 'enter',
      startMs: 100
    })
    const second = addMotionSceneCue(first.scene, 'sequence-1', {
      targetNodeId: 'b',
      trackId: 'enter',
      startMs: 300
    })
    const updated = updateMotionSceneCues(
      second.scene,
      'sequence-1',
      new Set([first.cueId, second.cueId]),
      { timeScale: 1.5, enabled: false }
    )

    expect(updated.sequences[0]?.cues).toEqual([
      expect.objectContaining({ targetNodeId: 'a', timeScale: 1.5, enabled: false }),
      expect.objectContaining({ targetNodeId: 'b', timeScale: 1.5, enabled: false })
    ])
    expect(second.scene.sequences[0]?.cues[0]?.timeScale).toBeUndefined()
  })

  test('commits a multi-target scene snapshot as exactly one undo step', () => {
    const editor = createEditor()
    const page = editor.graph.getPages()[0]
    const first = addMotionSceneCue(createMotionSceneSpec(), 'sequence-1', {
      targetNodeId: 'node-a',
      trackId: 'enter',
      startMs: 100
    })
    const second = addMotionSceneCue(first.scene, 'sequence-1', {
      targetNodeId: 'node-b',
      trackId: 'exit',
      startMs: 300
    })

    expect(updateMotionSceneWithUndo(editor, page.id, second.scene, 'Update scene')).toBe(true)
    expect(editor.graph.getNode(page.id)?.motionScene?.sequences[0]?.cues).toHaveLength(2)
    expect(editor.undo.undoLabel).toBe('Update scene')
    expect(editor.undo.undo()).toBe('Update scene')
    expect(editor.graph.getNode(page.id)?.motionScene).toBeUndefined()
    expect(editor.undo.undo()).toBeNull()
  })

  test('maps scene time through cue start and time scale for Auto Keyframe', () => {
    const track = {
      id: 'move',
      trigger: 'pageEnter' as const,
      keyframes: [
        { offset: 0, x: 0 },
        { offset: 1, x: 100 }
      ],
      timing: { durationMs: 200, delayMs: 20 }
    }
    const cue = {
      id: 'cue',
      targetNodeId: 'node',
      trackId: 'move',
      startMs: 100,
      timeScale: 2
    }

    expect(motionSceneCueTrackOffsetAtTime(cue, track, 50)).toBe(0)
    expect(motionSceneCueTrackOffsetAtTime(cue, track, 160)).toBe(0.5)
    expect(motionSceneCueTrackOffsetAtTime(cue, track, 500)).toBe(1)
  })

  test('Auto Keyframes multiple cue targets atomically at the shared scene playhead', () => {
    const editor = createEditor()
    const page = editor.graph.getPages()[0]
    const motion = {
      version: 3 as const,
      tracks: [
        {
          id: 'move',
          trigger: 'pageEnter' as const,
          keyframes: [
            { offset: 0, x: 0 },
            { offset: 1, x: 100 }
          ],
          timing: { durationMs: 200 }
        }
      ]
    }
    const firstNode = editor.graph.createNode('RECTANGLE', page.id, { motion })
    const secondNode = editor.graph.createNode('RECTANGLE', page.id, { motion })
    const first = addMotionSceneCue(createMotionSceneSpec(), 'sequence-1', {
      targetNodeId: firstNode.id,
      trackId: 'move',
      startMs: 100,
      timeScale: 2
    })
    const second = addMotionSceneCue(first.scene, 'sequence-1', {
      targetNodeId: secondNode.id,
      trackId: 'move',
      startMs: 100,
      timeScale: 0.5
    })

    expect(
      autoKeyframeMotionSceneCues(
        editor,
        {
          scene: second.scene,
          sequenceId: 'sequence-1',
          cueIds: new Set([first.cueId, second.cueId]),
          sceneTimeMs: 200,
          channel: 'y',
          value: 42
        },
        'Auto keyframe scene'
      )
    ).toBe(2)
    expect(editor.graph.getNode(firstNode.id)?.motion?.tracks[0]?.keyframes).toContainEqual(
      expect.objectContaining({ offset: 1, y: 42 })
    )
    expect(editor.graph.getNode(secondNode.id)?.motion?.tracks[0]?.keyframes).toContainEqual(
      expect.objectContaining({ offset: 0.25, y: 42 })
    )
    expect(editor.undo.undoLabel).toBe('Auto keyframe scene')
    expect(editor.undo.undo()).toBe('Auto keyframe scene')
    expect(editor.graph.getNode(firstNode.id)?.motion?.tracks[0]?.keyframes).toHaveLength(2)
    expect(editor.graph.getNode(secondNode.id)?.motion?.tracks[0]?.keyframes).toHaveLength(2)
    expect(editor.undo.undo()).toBeNull()
  })

  test('scales selected cue time around an explicit anchor and preserves unselected cues', () => {
    const first = addMotionSceneCue(createMotionSceneSpec(), 'sequence-1', {
      targetNodeId: 'a',
      trackId: 'enter',
      startMs: 100
    })
    const second = addMotionSceneCue(first.scene, 'sequence-1', {
      targetNodeId: 'b',
      trackId: 'enter',
      startMs: 300
    })
    const third = addMotionSceneCue(second.scene, 'sequence-1', {
      targetNodeId: 'c',
      trackId: 'enter',
      startMs: 500
    })
    const scaled = scaleMotionSceneCues(
      third.scene,
      'sequence-1',
      new Set([first.cueId, second.cueId]),
      0.5,
      100
    )

    expect(scaled.sequences[0]?.cues.map(({ startMs }) => startMs)).toEqual([100, 200, 500])
  })

  test('removes selected cues and the final marker without leaving empty optional fields', () => {
    const cue = addMotionSceneCue(createMotionSceneSpec(), 'sequence-1', {
      targetNodeId: 'a',
      trackId: 'enter',
      startMs: 0
    })
    const marker = addMotionSceneMarker(cue.scene, 'sequence-1', 0)
    const withoutCue = removeMotionSceneCues(marker.scene, 'sequence-1', new Set([cue.cueId]))
    const empty = removeMotionSceneMarker(withoutCue, 'sequence-1', marker.markerId)

    expect(empty.sequences[0]?.cues).toEqual([])
    expect(empty.sequences[0]?.markers).toBeUndefined()
  })
})
