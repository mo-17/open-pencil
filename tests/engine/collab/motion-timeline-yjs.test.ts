import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import {
  cloneMotionSpec,
  ensureMotionTimelineIds,
  validateMotionSpec,
  type MotionSpec
} from '@open-pencil/scene-graph'

import {
  clearMotionSpecYMap,
  compactMotionTimelineYMap,
  createMotionTimelineUndoManager,
  MOTION_TIMELINE_CRDT_LIMITS,
  MOTION_TIMELINE_CHECKPOINT_ORIGIN,
  MOTION_TIMELINE_LOCAL_ORIGIN,
  readMotionSpecFromYMap,
  syncMotionSpecToYMap
} from '@/app/collab/motion-timeline-yjs'

import { advancedMotionSpec } from '#tests/helpers/motion-v3-advanced'

function source(): MotionSpec {
  return {
    version: 3,
    tracks: [
      {
        id: 'enter',
        name: 'Enter',
        trigger: 'mount',
        keyframes: [
          { offset: 0, opacity: 0 },
          { offset: 0.5, opacity: 0.5 },
          { offset: 1, opacity: 1 }
        ],
        timing: { durationMs: 400, easing: 'ease-out' }
      },
      {
        id: 'hover',
        trigger: 'hover',
        keyframes: [
          { offset: 0, scaleX: 1, scaleY: 1 },
          { offset: 1, scaleX: 1.05, scaleY: 1.05 }
        ],
        timing: { durationMs: 160 }
      }
    ]
  }
}

function converge(left: Y.Doc, right: Y.Doc): void {
  Y.applyUpdate(left, Y.encodeStateAsUpdate(right))
  Y.applyUpdate(right, Y.encodeStateAsUpdate(left))
}

function timeline(doc: Y.Doc): Y.Map<unknown> {
  const root = doc.getMap<Y.Map<unknown>>('motionTimelines')
  let value = root.get('node')
  if (!(value instanceof Y.Map)) {
    value = new Y.Map<unknown>()
    root.set('node', value)
  }
  return value
}

function storedTrack(id: string, order: number, keyframeCount = 2): Y.Map<unknown> {
  const track = new Y.Map<unknown>()
  track.set('id', id)
  track.set('order', order)
  track.set('trigger', 'mount')
  const timing = new Y.Map<unknown>()
  timing.set('durationMs', 300)
  track.set('timing', timing)
  const keyframes = new Y.Map<Y.Map<unknown>>()
  for (let index = 0; index < keyframeCount; index++) {
    const frame = new Y.Map<unknown>()
    const frameId = `${id}-frame-${index}`
    frame.set('id', frameId)
    frame.set('order', index)
    frame.set('offset', keyframeCount === 1 ? 0 : index / (keyframeCount - 1))
    frame.set('opacity', keyframeCount === 1 ? 0 : index / (keyframeCount - 1))
    keyframes.set(frameId, frame)
  }
  track.set('keyframes', keyframes)
  return track
}

describe('Motion collaborative timeline CRDT', () => {
  test('deterministically migrates old v3 ids without changing v1/v2', () => {
    const first = ensureMotionTimelineIds(source())
    const second = ensureMotionTimelineIds(source())
    expect(first).toEqual(second)
    expect(first.tracks.flatMap(({ keyframes }) => keyframes).every(({ id }) => Boolean(id))).toBe(
      true
    )
    const cloned = cloneMotionSpec(first)
    expect(cloned.tracks.map(({ keyframes }) => keyframes.map(({ id }) => id))).toEqual(
      first.tracks.map(({ keyframes }) => keyframes.map(({ id }) => id))
    )
    expect(cloned.tracks[0].keyframes[0]).not.toBe(first.tracks[0].keyframes[0])

    const v2 = cloneMotionSpec(source())
    v2.version = 2
    for (const track of v2.tracks) delete track.name
    const migratedV2 = ensureMotionTimelineIds(v2)
    expect(migratedV2.tracks.flatMap(({ keyframes }) => keyframes).every(({ id }) => !id)).toBe(
      true
    )

    const duplicate = cloneMotionSpec(first)
    duplicate.tracks[0].keyframes[1].id = duplicate.tracks[0].keyframes[0].id
    expect(validateMotionSpec(duplicate).success).toBe(false)
  })

  test('merges concurrent track and keyframe fields without whole-motion LWW', () => {
    const left = new Y.Doc()
    const right = new Y.Doc()
    const initial = ensureMotionTimelineIds(source())
    left.transact(() => syncMotionSpecToYMap(initial, timeline(left)))
    converge(left, right)

    const leftEdit = cloneMotionSpec(initial)
    leftEdit.tracks[0].name = 'Renamed on left'
    for (const frame of leftEdit.tracks[0].keyframes) frame.x = frame.offset * 20
    left.transact(() => syncMotionSpecToYMap(leftEdit, timeline(left)))

    const rightEdit = cloneMotionSpec(initial)
    rightEdit.tracks[0].timing.durationMs = 720
    for (const frame of rightEdit.tracks[0].keyframes) frame.y = frame.offset * 10
    right.transact(() => syncMotionSpecToYMap(rightEdit, timeline(right)))

    converge(left, right)
    const leftResult = readMotionSpecFromYMap('node', timeline(left))
    const rightResult = readMotionSpecFromYMap('node', timeline(right))
    expect(leftResult.motion).toEqual(rightResult.motion)
    expect(leftResult.motion?.tracks[0].name).toBe('Renamed on left')
    expect(leftResult.motion?.tracks[0].timing.durationMs).toBe(720)
    expect(leftResult.motion?.tracks[0].keyframes.map(({ x }) => x)).toEqual([0, 10, 20])
    expect(leftResult.motion?.tracks[0].keyframes.map(({ y }) => y)).toEqual([0, 5, 10])
  })

  test('preserves and independently merges every structured keyframe channel', () => {
    const left = new Y.Doc()
    const right = new Y.Doc()
    const initial = ensureMotionTimelineIds(advancedMotionSpec())
    left.transact(() => syncMotionSpecToYMap(initial, timeline(left)))
    converge(left, right)

    const leftEdit = cloneMotionSpec(initial)
    const leftPaint = leftEdit.tracks[0].keyframes[0].paints?.[0]
    if (!leftPaint) throw new Error('Expected an indexed paint target')
    leftPaint.opacity = 0.33
    left.transact(() => syncMotionSpecToYMap(leftEdit, timeline(left)))

    const rightEdit = cloneMotionSpec(initial)
    const rightMorphPoint = rightEdit.tracks[0].keyframes[0].vectorMorph?.points[0]
    if (!rightMorphPoint) throw new Error('Expected a vector morph point')
    rightMorphPoint.x = 42
    right.transact(() => syncMotionSpecToYMap(rightEdit, timeline(right)))

    converge(left, right)
    const expected = cloneMotionSpec(initial)
    const expectedPaint = expected.tracks[0].keyframes[0].paints?.[0]
    const expectedPoint = expected.tracks[0].keyframes[0].vectorMorph?.points[0]
    if (!expectedPaint || !expectedPoint) throw new Error('Expected structured fixture values')
    expectedPaint.opacity = 0.33
    expectedPoint.x = 42

    const leftResult = readMotionSpecFromYMap('node', timeline(left))
    const rightResult = readMotionSpecFromYMap('node', timeline(right))
    expect(leftResult.conflicts).toEqual([])
    expect(rightResult.conflicts).toEqual([])
    expect(leftResult.motion).toEqual(expected)
    expect(rightResult.motion).toEqual(expected)
  })

  test('delete tombstone wins over a concurrent keyframe move and converges', () => {
    const left = new Y.Doc()
    const right = new Y.Doc()
    const initial = ensureMotionTimelineIds(source())
    left.transact(() => syncMotionSpecToYMap(initial, timeline(left)))
    converge(left, right)

    const removed = cloneMotionSpec(initial)
    removed.tracks[0].keyframes.splice(1, 1)
    left.transact(() => syncMotionSpecToYMap(removed, timeline(left)))

    const moved = cloneMotionSpec(initial)
    moved.tracks[0].keyframes[1].offset = 0.7
    right.transact(() => syncMotionSpecToYMap(moved, timeline(right)))

    converge(left, right)
    const leftMotion = readMotionSpecFromYMap('node', timeline(left)).motion
    const rightMotion = readMotionSpecFromYMap('node', timeline(right)).motion
    expect(leftMotion).toEqual(rightMotion)
    expect(leftMotion?.tracks[0].keyframes).toHaveLength(2)
    expect(leftMotion?.tracks[0].keyframes.map(({ offset }) => offset)).toEqual([0, 1])
  })

  test('local Motion undo and redo do not capture untracked remote origins', () => {
    const doc = new Y.Doc()
    const root = doc.getMap<Y.Map<unknown>>('motionTimelines')
    const target = timeline(doc)
    doc.transact(() => syncMotionSpecToYMap(source(), target))
    const undo = createMotionTimelineUndoManager(root)

    const changed = ensureMotionTimelineIds(source())
    changed.tracks[0].name = 'Undo me'
    doc.transact(() => syncMotionSpecToYMap(changed, target), MOTION_TIMELINE_LOCAL_ORIGIN)
    expect(readMotionSpecFromYMap('node', target).motion?.tracks[0].name).toBe('Undo me')
    undo.undo()
    expect(readMotionSpecFromYMap('node', target).motion?.tracks[0].name).toBe('Enter')
    undo.redo()
    expect(readMotionSpecFromYMap('node', target).motion?.tracks[0].name).toBe('Undo me')
    undo.destroy()
  })

  test('security checkpoints are not captured by the local Motion undo manager', () => {
    const doc = new Y.Doc()
    const root = doc.getMap<Y.Map<unknown>>('motionTimelines')
    const target = timeline(doc)
    doc.transact(() => syncMotionSpecToYMap(source(), target))
    const undo = createMotionTimelineUndoManager(root)
    const enter = (target.get('tracks') as Y.Map<Y.Map<unknown>>).get('enter') as Y.Map<unknown>
    doc.transact(() => enter.set('unknownExecutableField', { source: 'alert(1)' }), 'remote')
    doc.transact(() => compactMotionTimelineYMap(target), MOTION_TIMELINE_CHECKPOINT_ORIGIN)

    expect(enter.has('unknownExecutableField')).toBe(false)
    expect(undo.canUndo()).toBe(false)
    undo.destroy()
  })

  test('offline edits reconnect deterministically and clear uses causal tombstones', () => {
    const left = new Y.Doc()
    const right = new Y.Doc()
    const initial = ensureMotionTimelineIds(source())
    left.transact(() => syncMotionSpecToYMap(initial, timeline(left)))
    converge(left, right)

    left.transact(() => clearMotionSpecYMap(timeline(left)))
    const stale = cloneMotionSpec(initial)
    stale.tracks[0].timing.durationMs = 999
    right.transact(() => syncMotionSpecToYMap(stale, timeline(right)))
    converge(left, right)

    expect(readMotionSpecFromYMap('node', timeline(left)).motion).toBeUndefined()
    expect(readMotionSpecFromYMap('node', timeline(right)).motion).toBeUndefined()
  })

  test('bounds and explicitly compacts accumulated tombstones', () => {
    const doc = new Y.Doc()
    const target = timeline(doc)
    target.set('version', 3)
    const tracks = new Y.Map<Y.Map<unknown>>()
    target.set('tracks', tracks)
    for (let index = 0; index < MOTION_TIMELINE_CRDT_LIMITS.maxStoredTracksPerNode + 5; index++) {
      const track = new Y.Map<unknown>()
      track.set('deleted', true)
      const keyframes = new Y.Map<Y.Map<unknown>>()
      for (
        let frame = 0;
        frame < MOTION_TIMELINE_CRDT_LIMITS.maxStoredKeyframesPerTrack + 3;
        frame++
      ) {
        const keyframe = new Y.Map<unknown>()
        keyframe.set('deleted', true)
        keyframes.set(`frame-${frame}`, keyframe)
      }
      track.set('keyframes', keyframes)
      tracks.set(`track-${index}`, track)
    }

    const result = compactMotionTimelineYMap(target)
    expect(result.tracksRemoved).toBe(5)
    expect(result.keyframesRemoved).toBeGreaterThan(0)
    expect(tracks.size).toBe(MOTION_TIMELINE_CRDT_LIMITS.maxStoredTracksPerNode)
    for (const track of tracks.values()) {
      expect((track.get('keyframes') as Y.Map<unknown>).size).toBeLessThanOrEqual(
        MOTION_TIMELINE_CRDT_LIMITS.maxStoredKeyframesPerTrack
      )
    }
  })

  test('deterministically hard-bounds over-cap live tracks and keyframes', () => {
    const doc = new Y.Doc()
    const target = timeline(doc)
    target.set('version', 3)
    const tracks = new Y.Map<Y.Map<unknown>>()
    target.set('tracks', tracks)
    for (let index = 0; index < MOTION_TIMELINE_CRDT_LIMITS.maxStoredTracksPerNode + 5; index++) {
      const count = index === 0 ? MOTION_TIMELINE_CRDT_LIMITS.maxStoredKeyframesPerTrack + 3 : 2
      tracks.set(`track-${index}`, storedTrack(`track-${index}`, index, count))
    }

    const result = compactMotionTimelineYMap(target)
    expect(result.liveTracksRemoved).toBe(5)
    expect(result.liveKeyframesRemoved).toBe(3)
    expect(tracks.size).toBe(MOTION_TIMELINE_CRDT_LIMITS.maxStoredTracksPerNode)
    expect(tracks.has('track-0')).toBe(true)
    expect(tracks.has(`track-${MOTION_TIMELINE_CRDT_LIMITS.maxStoredTracksPerNode}`)).toBe(false)
    const firstFrames = tracks.get('track-0')?.get('keyframes') as Y.Map<unknown>
    expect(firstFrames.size).toBe(MOTION_TIMELINE_CRDT_LIMITS.maxStoredKeyframesPerTrack)
    expect(firstFrames.has('track-0-frame-0')).toBe(true)
    expect(
      firstFrames.has(`track-0-frame-${MOTION_TIMELINE_CRDT_LIMITS.maxStoredKeyframesPerTrack}`)
    ).toBe(false)

    const decoded = readMotionSpecFromYMap('node', target)
    expect(decoded.motion?.tracks.length).toBeLessThanOrEqual(8)
    expect(decoded.conflicts.some(({ code }) => code === 'resource-limit')).toBe(true)
  })

  test('fails closed before cloning deep payloads and checkpoints unknown or over-budget fields', () => {
    const doc = new Y.Doc()
    const target = timeline(doc)
    syncMotionSpecToYMap(source(), target)
    const tracks = target.get('tracks') as Y.Map<Y.Map<unknown>>
    const enter = tracks.get('enter') as Y.Map<unknown>
    const frames = enter.get('keyframes') as Y.Map<Y.Map<unknown>>
    const firstFrame = [...frames.values()][0]

    let deep: Record<string, unknown> = { value: 1 }
    for (let index = 0; index < MOTION_TIMELINE_CRDT_LIMITS.maxValueDepth + 2; index++) {
      deep = { next: deep }
    }
    firstFrame.set('paints', deep)
    enter.set('unknownExecutableField', { source: 'alert(1)' })
    enter.set(
      'path',
      Array.from({ length: MOTION_TIMELINE_CRDT_LIMITS.maxArrayEntries + 1 }, () => 0)
    )

    const before = readMotionSpecFromYMap('node', target)
    expect(before.conflicts.some(({ code }) => code === 'resource-limit')).toBe(true)
    expect(before.conflicts.some(({ code }) => code === 'invalid-track')).toBe(true)

    const result = compactMotionTimelineYMap(target)
    expect(result.schemaFieldsRemoved).toBeGreaterThanOrEqual(1)
    expect(result.resourceFieldsRemoved).toBeGreaterThanOrEqual(2)
    expect(enter.has('unknownExecutableField')).toBe(false)
    expect(enter.has('path')).toBe(false)
    expect(firstFrame.has('paints')).toBe(false)
    expect(readMotionSpecFromYMap('node', target).motion?.tracks).toHaveLength(2)
  })

  test('enforces an aggregate node byte budget without materializing an oversized value tree', () => {
    const doc = new Y.Doc()
    const target = timeline(doc)
    target.set('version', 3)
    const tracks = new Y.Map<Y.Map<unknown>>()
    target.set('tracks', tracks)
    const track = storedTrack('payload', 0, 40)
    tracks.set('payload', track)
    const frames = track.get('keyframes') as Y.Map<Y.Map<unknown>>
    const payload = 'x'.repeat(MOTION_TIMELINE_CRDT_LIMITS.maxStringCodeUnits - 1)
    for (const frame of frames.values()) frame.set('easing', payload)

    const result = compactMotionTimelineYMap(target)
    const retainedPayloads = [...frames.values()].filter((frame) => frame.has('easing')).length
    expect(result.resourceFieldsRemoved).toBeGreaterThan(0)
    expect(retainedPayloads).toBeLessThan(40)
    expect(frames.size).toBe(40)
  })
})
