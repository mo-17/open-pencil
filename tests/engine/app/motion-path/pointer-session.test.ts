import { describe, expect, test } from 'bun:test'

import type { MotionSpec } from '@open-pencil/scene-graph'

import { createEditorStore } from '@/app/editor/session'
import {
  resolveMotionPathEdit,
  startMotionPathEditing,
  stopMotionPathEditing,
  syncMotionPathEditingKeyframe,
  updateMotionPathHandleWithUndo
} from '@/app/motion-path/editing'
import {
  MotionPathPointerSession,
  type MotionPathPointerCaptureTarget
} from '@/app/motion-path/pointer-session'

class PointerTarget implements MotionPathPointerCaptureTarget {
  readonly captured = new Set<number>()
  readonly released: number[] = []

  setPointerCapture(pointerId: number): void {
    this.captured.add(pointerId)
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.captured.has(pointerId)
  }

  releasePointerCapture(pointerId: number): void {
    this.captured.delete(pointerId)
    this.released.push(pointerId)
  }
}

const PATH_MOTION: MotionSpec = {
  version: 3,
  tracks: [
    {
      id: 'move',
      trigger: 'mount',
      keyframes: [
        { id: 'start', offset: 0, pathProgress: 0 },
        { id: 'end', offset: 1, pathProgress: 1 }
      ],
      timing: { durationMs: 200, easing: 'linear' },
      path: {
        version: 2,
        start: { x: 0, y: 0 },
        segments: [
          {
            control1: { x: 30, y: 0 },
            control2: { x: 70, y: 0 },
            end: { x: 100, y: 0 }
          }
        ]
      }
    }
  ]
}

describe('Motion path pointer transaction', () => {
  test('releases pointer capture on commit, cancel, lost capture, and dispose', () => {
    const target = new PointerTarget()
    const events: string[] = []
    const session = new MotionPathPointerSession({
      begin: () => events.push('begin'),
      update: () => events.push('update'),
      commit: () => events.push('commit'),
      rollback: () => events.push('rollback')
    })

    session.start(target, 7, { kind: 'start' })
    expect(session.update(7, 10, 20)).toBe(true)
    expect(session.finish(7)).toBe(true)
    expect(target.released).toEqual([7])
    expect(events).toEqual(['begin', 'update', 'commit'])

    session.start(target, 8, { kind: 'end', segmentIndex: 0 })
    expect(session.lostPointerCapture(8)).toBe(true)
    expect(events.at(-1)).toBe('rollback')

    session.start(target, 9, { kind: 'control1', segmentIndex: 0 })
    session.dispose()
    expect(target.released).toEqual([7, 8, 9])
    expect(session.active).toBe(false)
  })

  test('commits live path updates as one undo and never mutates static geometry', () => {
    const store = createEditorStore()
    const node = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      x: 42,
      y: 31,
      width: 80,
      height: 60,
      rotation: 17,
      motion: PATH_MOTION
    })
    store.select([node.id])
    expect(startMotionPathEditing(store, node.id, 'move', 0)).toBe(true)
    store.undo.clear()

    store.undo.beginBatch('Update motion')
    expect(
      updateMotionPathHandleWithUndo(
        store,
        { kind: 'control1', segmentIndex: 0 },
        { x: 45, y: 20 },
        'Update motion'
      )
    ).toBe(true)
    expect(
      updateMotionPathHandleWithUndo(
        store,
        { kind: 'control1', segmentIndex: 0 },
        { x: 55, y: 30 },
        'Update motion'
      )
    ).toBe(true)
    store.undo.commitBatch()

    const updated = store.graph.getNode(node.id)
    expect(updated).toMatchObject({ x: 42, y: 31, rotation: 17, width: 80, height: 60 })
    expect(updated?.motion?.tracks[0]?.path).toMatchObject({
      version: 2,
      segments: [{ control1: { x: 55, y: 30 } }]
    })
    expect(store.undo.undo()).toBe('Update motion')
    expect(store.graph.getNode(node.id)?.motion).toEqual(PATH_MOTION)
    expect(store.undo.redo()).toBe('Update motion')
    expect(store.graph.getNode(node.id)?.motion?.tracks[0]?.path).toMatchObject({
      segments: [{ control1: { x: 55, y: 30 } }]
    })

    store.graph.deleteNode(node.id)
    expect(resolveMotionPathEdit(store)).toBeUndefined()
    stopMotionPathEditing(store)
    expect(store.state.motionPathEdit).toBeNull()
  })

  test('binds editing to the selected track and keyframe and clears invalid targets', () => {
    const store = createEditorStore()
    const node = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      width: 80,
      height: 60,
      motion: PATH_MOTION
    })

    expect(startMotionPathEditing(store, node.id, 'move', 0)).toBe(true)
    expect(store.state.motionPathEdit).toMatchObject({
      nodeId: node.id,
      trackId: 'move',
      keyframeIndex: 0,
      keyframeId: 'start'
    })

    syncMotionPathEditingKeyframe(store, node.id, 'move', 1)
    expect(store.state.motionPathEdit).toMatchObject({
      trackId: 'move',
      keyframeIndex: 1,
      keyframeId: 'end'
    })

    syncMotionPathEditingKeyframe(store, node.id, 'missing', 0)
    expect(store.state.motionPathEdit).toBeNull()
  })
})
