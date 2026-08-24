import { describe, expect, test } from 'bun:test'

import { sampleMotionSpec } from '@open-pencil/motion'
import {
  createMotionPreset,
  MOTION_LIMITS,
  parseMotionSpec,
  type MotionSpec
} from '@open-pencil/scene-graph'

import { setActiveEditorStore } from '@/app/editor/active-store'
import { createEditorStore } from '@/app/editor/session'
import { updateNodeMotionWithUndo } from '@/app/properties/motion'
import {
  createMotionEasing,
  motionEasingKind,
  motionEasingKindsForVersion
} from '@/app/properties/motion/easing'
import {
  addMotionKeyframe,
  addMotionTrack,
  duplicateMotionKeyframe,
  duplicateMotionTrack,
  motionKeyframeTime,
  motionKeyframeTimes,
  motionOffsetAtTime,
  motionTimelineDuration,
  removeMotionKeyframe,
  removeMotionTrack,
  renameMotionTrack,
  reorderMotionTrack,
  setMotionKeyframeChannel,
  setMotionKeyframeEasing,
  setMotionKeyframeOffset,
  setMotionTrackComposition,
  setMotionTrackExit,
  setMotionTrackName,
  setMotionTrackTiming,
  setMotionTrackTrigger
} from '@/app/properties/motion/timeline'
import { useMotionTimelineEditor } from '@/app/properties/use-motion-timeline-editor'

describe('motion timeline property model', () => {
  test('creates every versioned easing with valid bounded defaults', () => {
    expect(motionEasingKindsForVersion(1)).toEqual([
      'linear',
      'ease',
      'ease-in',
      'ease-out',
      'ease-in-out',
      'cubicBezier'
    ])
    expect(motionEasingKindsForVersion(2)).toEqual([
      'linear',
      'ease',
      'ease-in',
      'ease-out',
      'ease-in-out',
      'cubicBezier',
      'power',
      'sine',
      'expo',
      'circ',
      'back',
      'bounce',
      'elastic',
      'hold',
      'steps',
      'spring',
      'inertia'
    ])
    expect(motionEasingKindsForVersion(3)).toEqual(motionEasingKindsForVersion(2))

    for (const kind of motionEasingKindsForVersion(2)) {
      const easing = createMotionEasing(kind)
      const parsed = parseMotionSpec({
        version: 2,
        tracks: [
          {
            id: 'easing-track',
            trigger: 'mount',
            keyframes: [{ offset: 0 }, { offset: 1 }],
            timing: { durationMs: 400, easing }
          }
        ]
      })
      expect(parsed.tracks[0]?.timing.easing).toEqual(easing)
      expect(motionEasingKind(easing)).toBe(kind)
    }

    expect(createMotionEasing('back')).toEqual({
      type: 'back',
      mode: 'out',
      overshoot: 1.70158
    })
    expect(createMotionEasing('elastic')).toEqual({
      type: 'elastic',
      mode: 'out',
      amplitude: 1,
      period: 0.3
    })
  })

  test('adds, edits, and removes bounded tracks while clearing preset provenance', () => {
    const preset = createMotionPreset('fade-in')
    const withTrack = addMotionTrack(preset, {
      trigger: 'click',
      durationMs: 720,
      delayMs: 80
    })

    expect(withTrack.preset).toBeUndefined()
    expect(withTrack.tracks).toHaveLength(2)
    expect(withTrack.tracks[1]).toMatchObject({
      id: 'track-1',
      trigger: 'click',
      timing: { durationMs: 720, delayMs: 80 }
    })

    const edited = setMotionTrackExit(
      setMotionTrackTiming(setMotionTrackTrigger(withTrack, 'track-1', 'hover'), 'track-1', {
        durationMs: 900,
        easing: { type: 'cubicBezier', x1: 0.2, y1: -0.5, x2: 0.8, y2: 1.5 },
        iterations: 'infinite',
        direction: 'alternate',
        fill: 'both'
      }),
      'track-1',
      'reverse'
    )
    expect(edited.tracks[1]).toMatchObject({
      trigger: 'hover',
      timing: {
        durationMs: 900,
        iterations: 'infinite',
        direction: 'alternate',
        fill: 'both'
      },
      exit: 'reverse'
    })

    expect(removeMotionTrack(edited, 'track-1').tracks).toHaveLength(1)
    expect(() => removeMotionTrack(preset, preset.tracks[0]?.id ?? '')).toThrow(RangeError)
  })

  test('renames, duplicates, and reorders tracks without sharing authored values', () => {
    const preset = createMotionPreset('fade-in')
    const sourceId = preset.tracks[0]?.id ?? ''
    const renamed = renameMotionTrack(preset, sourceId, 'intro')
    expect(renamed.preset).toBeUndefined()
    expect(renamed.tracks[0]?.id).toBe('intro')
    expect(() => renameMotionTrack(renamed, 'intro', 'bad id')).toThrow()

    const duplicated = duplicateMotionTrack(renamed, 'intro')
    expect(duplicated.trackId).toBe('track-1')
    expect(duplicated.spec.tracks.map((track) => track.id)).toEqual(['intro', 'track-1'])
    expect(duplicated.spec.tracks[1]?.keyframes).toEqual(duplicated.spec.tracks[0]?.keyframes)
    expect(duplicated.spec.tracks[1]?.keyframes).not.toBe(duplicated.spec.tracks[0]?.keyframes)
    expect(() => renameMotionTrack(duplicated.spec, 'intro', 'track-1')).toThrow(RangeError)

    const reordered = reorderMotionTrack(duplicated.spec, 'track-1', 0)
    expect(reordered.tracks.map((track) => track.id)).toEqual(['track-1', 'intro'])
    expect(reorderMotionTrack(reordered, 'track-1', -10)).toBe(reordered)
  })

  test('authors v3 track labels and bounded composition without weakening advanced channels', () => {
    const v3 = parseMotionSpec({
      version: 3,
      tracks: [
        {
          id: 'entrance',
          trigger: 'mount',
          keyframes: [
            { offset: 0, x: 0 },
            { offset: 1, x: 100 }
          ],
          timing: { durationMs: 400 }
        }
      ]
    })
    const named = setMotionTrackName(v3, 'entrance', 'Hero entrance')
    const composed = setMotionTrackComposition(named, 'entrance', {
      mode: 'add',
      weight: 0.4,
      priority: 12
    })
    expect(composed.tracks[0]).toMatchObject({
      name: 'Hero entrance',
      composition: { mode: 'add', weight: 0.4, priority: 12 }
    })
    expect(setMotionTrackName(composed, 'entrance', ' ').tracks[0]?.name).toBeUndefined()
    expect(() => setMotionTrackComposition(createMotionPreset('fade-in'), 'fade-in', {})).toThrow(
      'MotionSpec v3'
    )

    const advanced = parseMotionSpec({
      version: 3,
      tracks: [
        {
          id: 'size',
          trigger: 'mount',
          keyframes: [
            { offset: 0, width: 100 },
            { offset: 1, width: 200 }
          ],
          timing: { durationMs: 400 }
        }
      ]
    })
    expect(() => setMotionTrackComposition(advanced, 'size', { mode: 'add' })).toThrow()
  })

  test('auto keyframe inserts an interpolated frame at the playhead before changing a channel', () => {
    const store = createEditorStore()
    setActiveEditorStore(store)
    const authored: MotionSpec = {
      version: 1,
      tracks: [
        {
          id: 'move',
          trigger: 'mount',
          keyframes: [
            { offset: 0, x: 0 },
            { offset: 1, x: 100 }
          ],
          timing: { durationMs: 100, easing: 'linear', fill: 'both' }
        }
      ]
    }
    const node = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      motion: authored
    })
    const timeline = useMotionTimelineEditor(
      () => node.id,
      () => {
        void store.state.sceneVersion
        return store.graph.getNode(node.id)?.motion ?? authored
      }
    )
    store.undo.clear()

    timeline.updatePlayhead(50)
    timeline.toggleAutoKeyframe(true)
    timeline.updateChannel('x', 64)

    expect(timeline.autoKeyframeEnabled.value).toBe(true)
    expect(timeline.selectedKeyframeIndex.value).toBe(1)
    expect(store.graph.getNode(node.id)?.motion?.tracks[0]?.keyframes).toEqual([
      { offset: 0, x: 0, easing: 'linear' },
      { offset: 0.5, x: 64, easing: 'linear' },
      { offset: 1, x: 100 }
    ])
    expect(store.undo.undo()).toBe('Update motion')
    expect(store.graph.getNode(node.id)?.motion?.tracks[0]?.keyframes).toEqual(
      authored.tracks[0]?.keyframes
    )
  })

  test('adds sorted keyframes, edits channels, and protects timeline endpoints', () => {
    const preset = createMotionPreset('slide-up')
    const trackId = preset.tracks[0]?.id ?? ''
    const track = preset.tracks[0]
    if (!track) throw new Error('Expected slide-up track')
    const sampleTimes = [0.1, 0.25, 0.5, 0.75, 0.9].map(
      (offset) => (track.timing.delayMs ?? 0) + offset * track.timing.durationMs
    )
    const beforeInsertion = sampleTimes.map(
      (time) => sampleMotionSpec(preset, time, { trigger: track.trigger }).visual.y
    )
    const inserted = addMotionKeyframe(preset, trackId, 0.75)

    expect(inserted.index).toBe(1)
    expect(inserted.spec.tracks[0]?.keyframes.map((frame) => frame.offset)).toEqual([0, 0.75, 1])
    expect(inserted.spec.tracks[0]?.keyframes[1]?.y).toBeCloseTo(beforeInsertion[3] ?? 0)
    for (const [index, time] of sampleTimes.entries()) {
      const afterInsertion = sampleMotionSpec(inserted.spec, time, {
        trigger: track.trigger
      }).visual.y
      expect(afterInsertion).toBeCloseTo(beforeInsertion[index] ?? 0, 5)
    }

    const moved = setMotionKeyframeOffset(inserted.spec, trackId, inserted.index, 0.25)
    const withX = setMotionKeyframeChannel(moved, trackId, inserted.index, 'x', 42)
    expect(withX.tracks[0]?.keyframes[1]).toMatchObject({ offset: 0.25, x: 42 })

    const withoutX = setMotionKeyframeChannel(withX, trackId, inserted.index, 'x', undefined)
    expect(withoutX.tracks[0]?.keyframes[1]?.x).toBeUndefined()
    expect(
      removeMotionKeyframe(withoutX, trackId, inserted.index).tracks[0]?.keyframes
    ).toHaveLength(2)
    expect(() => removeMotionKeyframe(withoutX, trackId, 0)).toThrow(RangeError)
    expect(() => setMotionKeyframeOffset(withoutX, trackId, 0, 0.5)).toThrow(RangeError)
  })

  test('duplicates a keyframe into a visible gap and edits its segment easing', () => {
    const preset = createMotionPreset('fade-in')
    const trackId = preset.tracks[0]?.id ?? ''
    const duplicated = duplicateMotionKeyframe(preset, trackId, 0)

    expect(duplicated.index).toBe(1)
    expect(duplicated.spec.tracks[0]?.keyframes).toEqual([
      { offset: 0, opacity: 0 },
      { offset: 0.5, opacity: 0 },
      { offset: 1, opacity: 1 }
    ])

    const withEasing = setMotionKeyframeEasing(duplicated.spec, trackId, duplicated.index, {
      type: 'cubicBezier',
      x1: 0.2,
      y1: -0.4,
      x2: 0.8,
      y2: 1.4
    })
    expect(withEasing.tracks[0]?.keyframes[1]?.easing).toEqual({
      type: 'cubicBezier',
      x1: 0.2,
      y1: -0.4,
      x2: 0.8,
      y2: 1.4
    })
    expect(
      setMotionKeyframeEasing(withEasing, trackId, duplicated.index, undefined).tracks[0]
        ?.keyframes[1]?.easing
    ).toBeUndefined()
  })

  test('maps aligned track markers and playhead time', () => {
    let spec = createMotionPreset('fade-in')
    const firstTrack = spec.tracks[0]
    if (!firstTrack) throw new Error('Expected preset track')
    spec = setMotionTrackTiming(spec, firstTrack.id, {
      durationMs: 400,
      delayMs: 100,
      iterations: 2,
      direction: 'alternate'
    })
    spec = addMotionTrack(spec, { trigger: 'click', durationMs: 1_000, delayMs: 200 })

    const alignedTrack = spec.tracks[0]
    const delayedTrack = spec.tracks[1]
    const finalKeyframe = alignedTrack?.keyframes[1]
    if (!alignedTrack || !delayedTrack || !finalKeyframe) {
      throw new Error('Expected aligned timeline tracks and keyframes')
    }

    expect(motionTimelineDuration(spec)).toBe(1_200)
    expect(motionKeyframeTime(alignedTrack, finalKeyframe)).toBe(500)
    expect(motionOffsetAtTime(delayedTrack, 700)).toBe(0.5)
    expect(motionOffsetAtTime(delayedTrack, 0)).toBe(0)
    expect(motionOffsetAtTime(alignedTrack, 500)).toBe(1)
    expect(motionOffsetAtTime(alignedTrack, 700)).toBe(0.5)
    expect(motionOffsetAtTime(alignedTrack, 900)).toBe(0)
    expect(motionKeyframeTimes(alignedTrack, alignedTrack.keyframes[0])).toEqual([100, 900])
    expect(motionKeyframeTimes(alignedTrack, finalKeyframe)).toEqual([500, 500])
  })

  test('uses one authoring cycle for infinite tracks and respects reverse direction', () => {
    let spec = createMotionPreset('fade-in')
    const track = spec.tracks[0]
    if (!track) throw new Error('Expected preset track')
    spec = setMotionTrackTiming(spec, track.id, {
      durationMs: 600,
      delayMs: 50,
      iterations: 'infinite',
      direction: 'reverse'
    })
    const infiniteTrack = spec.tracks[0]
    if (!infiniteTrack) throw new Error('Expected infinite track')

    expect(motionTimelineDuration(spec)).toBe(650)
    expect(motionOffsetAtTime(infiniteTrack, 50)).toBe(1)
    expect(motionOffsetAtTime(infiniteTrack, 350)).toBe(0.5)
    expect(motionOffsetAtTime(infiniteTrack, 650)).toBe(0)
    expect(motionKeyframeTimes(infiniteTrack, infiniteTrack.keyframes[0])).toEqual([650])
    expect(motionKeyframeTimes(infiniteTrack, infiniteTrack.keyframes[1])).toEqual([50])
  })

  test('timeline keyframe selection and end dragging hold the final authoring value', () => {
    const store = createEditorStore()
    setActiveEditorStore(store)
    const motion: MotionSpec = {
      version: 1,
      tracks: [
        {
          id: 'authoring-track',
          trigger: 'mount',
          keyframes: [
            { offset: 0, x: 10 },
            { offset: 1, x: 80 }
          ],
          timing: { durationMs: 300, easing: 'linear', fill: 'none' }
        }
      ]
    }
    const track = motion.tracks[0]
    if (!track) throw new Error('Expected slide-up track')
    const finalKeyframe = track.keyframes.at(-1)
    if (!finalKeyframe) throw new Error('Expected final keyframe')
    const node = store.graph.createNode('RECTANGLE', store.state.currentPageId, { motion })
    const editor = useMotionTimelineEditor(
      () => node.id,
      () => store.graph.getNode(node.id)?.motion ?? motion
    )

    editor.selectKeyframe(track, track.keyframes.length - 1)
    expect(editor.playheadMs.value).toBe(motionKeyframeTime(track, finalKeyframe))
    expect(store.state.motionPreview?.visuals.get(node.id)?.x).toBe(80)

    editor.updatePlayhead(editor.timelineDuration.value)
    expect(store.state.motionPreview?.visuals.get(node.id)?.x).toBe(80)
    expect(store.state.motionPreview?.finished).toBe(true)
  })

  test('coalesces one keyframe pointer drag into one undo entry', () => {
    const store = createEditorStore()
    setActiveEditorStore(store)
    const motion: MotionSpec = {
      version: 1,
      tracks: [
        {
          id: 'drag-track',
          trigger: 'mount',
          keyframes: [
            { offset: 0, x: 0 },
            { offset: 0.5, x: 50 },
            { offset: 1, x: 100 }
          ],
          timing: { durationMs: 300, easing: 'linear', fill: 'both' }
        }
      ]
    }
    const node = store.graph.createNode('RECTANGLE', store.state.currentPageId, { motion })
    const editor = useMotionTimelineEditor(
      () => node.id,
      () => {
        void store.state.sceneVersion
        return store.graph.getNode(node.id)?.motion ?? motion
      }
    )
    store.undo.clear()

    editor.dragKeyframe('drag-track', 1, 120, 'pointer-drag-1')
    editor.dragKeyframe('drag-track', 1, 180, 'pointer-drag-1')
    expect(store.graph.getNode(node.id)?.motion?.tracks[0]?.keyframes[1]?.offset).toBe(0.6)
    expect(store.undo.undoLabel).toBe('Update motion')

    store.undo.undo()
    expect(store.graph.getNode(node.id)?.motion?.tracks[0]?.keyframes[1]?.offset).toBe(0.5)
    expect(store.undo.undo()).toBeNull()
  })

  test('blocks unsupported advanced channels without trapping authored cleanup', () => {
    const store = createEditorStore()
    setActiveEditorStore(store)
    const motion: MotionSpec = parseMotionSpec({
      version: 2,
      tracks: [
        {
          id: 'advanced',
          trigger: 'mount',
          keyframes: [{ offset: 0 }, { offset: 1 }],
          timing: { durationMs: 300 }
        }
      ]
    })
    const node = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      fills: [],
      strokes: [],
      layoutMode: 'NONE',
      motion
    })
    const editor = useMotionTimelineEditor(
      () => node.id,
      () => {
        void store.state.sceneVersion
        return store.graph.getNode(node.id)?.motion ?? motion
      }
    )

    editor.toggleAdvancedColor('fillColor', true)
    editor.toggleAdvancedColor('strokeColor', true)
    editor.toggleAdvancedNumeric('strokeWidth', true)
    editor.toggleAdvancedNumeric('trimStart', true)
    editor.toggleAdvancedNumeric('gap', true)
    let frames = store.graph.getNode(node.id)?.motion?.tracks[0]?.keyframes
    expect(frames?.every((frame) => frame.fillColor === undefined)).toBe(true)
    expect(frames?.every((frame) => frame.strokeColor === undefined)).toBe(true)
    expect(frames?.every((frame) => frame.strokeWidth === undefined)).toBe(true)
    expect(frames?.every((frame) => frame.trimStart === undefined)).toBe(true)
    expect(frames?.every((frame) => frame.gap === undefined)).toBe(true)

    editor.toggleAdvancedNumeric('blur', true)
    expect(
      store.graph.getNode(node.id)?.motion?.tracks[0]?.keyframes.every((frame) => frame.blur === 0)
    ).toBe(true)

    store.graph.updateNode(node.id, {
      fills: [
        {
          type: 'SOLID',
          color: { r: 0.2, g: 0.4, b: 0.6, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })
    editor.toggleAdvancedColor('fillColor', true)
    frames = store.graph.getNode(node.id)?.motion?.tracks[0]?.keyframes
    expect(frames?.every((frame) => frame.fillColor?.b === 0.6)).toBe(true)

    store.graph.updateNode(node.id, { fills: [] })
    editor.toggleAdvancedColor('fillColor', false)
    expect(
      store.graph
        .getNode(node.id)
        ?.motion?.tracks[0]?.keyframes.every((frame) => frame.fillColor === undefined)
    ).toBe(true)
  })

  test('keeps imported unsupported corner-radius channels removable', () => {
    const store = createEditorStore()
    setActiveEditorStore(store)
    const vectorMotion: MotionSpec = {
      version: 2,
      tracks: [
        {
          id: 'imported-vector',
          trigger: 'mount',
          keyframes: [
            { offset: 0, cornerRadius: 4 },
            { offset: 1, cornerRadius: 12 }
          ],
          timing: { durationMs: 300 }
        }
      ]
    }
    const vector = store.graph.createNode('VECTOR', store.state.currentPageId, {
      motion: vectorMotion
    })
    const vectorEditor = useMotionTimelineEditor(
      () => vector.id,
      () => store.graph.getNode(vector.id)?.motion ?? vectorMotion
    )

    vectorEditor.updateAdvancedNumeric('cornerRadius', 24)
    expect(
      store.graph
        .getNode(vector.id)
        ?.motion?.tracks[0]?.keyframes.map((frame) => frame.cornerRadius)
    ).toEqual([4, 12])

    vectorEditor.toggleAdvancedNumeric('cornerRadius', false)
    expect(
      store.graph
        .getNode(vector.id)
        ?.motion?.tracks[0]?.keyframes.every((frame) => frame.cornerRadius === undefined)
    ).toBe(true)
    vectorEditor.toggleAdvancedNumeric('cornerRadius', true)
    expect(
      store.graph
        .getNode(vector.id)
        ?.motion?.tracks[0]?.keyframes.every((frame) => frame.cornerRadius === undefined)
    ).toBe(true)
  })

  test('blocks timeline authoring and preview until a Boolean has resolved final geometry', () => {
    const store = createEditorStore()
    setActiveEditorStore(store)
    const motion = createMotionPreset('fade-in')
    const boolean = store.graph.createNode('BOOLEAN_OPERATION', store.state.currentPageId, {
      motion
    })
    const editor = useMotionTimelineEditor(
      () => boolean.id,
      () => {
        void store.state.sceneVersion
        return store.graph.getNode(boolean.id)?.motion ?? motion
      }
    )
    store.undo.clear()

    editor.updateChannel('opacity', 0.25)
    editor.createTrack()
    editor.previewSelectedTrack()
    expect(store.graph.getNode(boolean.id)?.motion).toEqual(motion)
    expect(store.state.motionPreview).toBeNull()
    expect(store.undo.canUndo).toBe(false)

    store.graph.updateNode(boolean.id, {
      fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: new Uint8Array([0]) }]
    })
    editor.updateChannel('opacity', 0.25)
    expect(store.graph.getNode(boolean.id)?.motion?.tracks[0]?.keyframes[0]?.opacity).toBe(0.25)
    editor.previewSelectedTrack()
    expect(store.state.motionPreview).not.toBeNull()
  })

  test('commits one validated node update with undo', () => {
    const store = createEditorStore()
    const node = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      motion: createMotionPreset('fade-in')
    })
    const motion = node.motion
    const track = motion?.tracks[0]
    if (!motion || !track) throw new Error('Expected authored node motion')
    const next = setMotionTrackTiming(motion, track.id, {
      durationMs: 640
    })

    expect(updateNodeMotionWithUndo(store, node.id, next, 'Edit motion timeline')).toBe(true)
    expect(store.graph.getNode(node.id)?.motion?.tracks[0]?.timing.durationMs).toBe(640)
    expect(store.undo.undoLabel).toBe('Edit motion timeline')
    store.undo.undo()
    expect(store.graph.getNode(node.id)?.motion?.tracks[0]?.timing.durationMs).toBe(400)
  })

  test('commits timeline edits as root instance overrides in the same undo entry', () => {
    const store = createEditorStore()
    const component = store.graph.createNode('COMPONENT', store.state.currentPageId, {
      motion: createMotionPreset('fade-in')
    })
    const instance = store.graph.createInstance(component.id, store.state.currentPageId)
    if (!instance?.motion) throw new Error('Expected animated instance')
    const track = instance.motion.tracks[0]
    if (!track) throw new Error('Expected instance track')
    const next = setMotionTrackTiming(instance.motion, track.id, { durationMs: 720 })

    expect(updateNodeMotionWithUndo(store, instance.id, next, 'Edit motion timeline')).toBe(true)
    let current = store.graph.getNode(instance.id)
    expect(current?.motion?.tracks[0]?.timing.durationMs).toBe(720)
    expect(current?.overrides.motion).toEqual(current?.motion)

    store.graph.updateNode(component.id, { motion: createMotionPreset('bounce-in') })
    store.graph.syncInstances(component.id)
    current = store.graph.getNode(instance.id)
    expect(current?.motion?.tracks[0]?.timing.durationMs).toBe(720)

    store.undo.undo()
    current = store.graph.getNode(instance.id)
    expect(current?.motion?.preset?.id).toBe('fade-in')
    expect(Object.hasOwn(current?.overrides ?? {}, 'motion')).toBe(false)
  })

  test('enforces the shared track and keyframe budgets before mutation', () => {
    let spec = createMotionPreset('fade-in')
    while (spec.tracks.length < MOTION_LIMITS.maxTracks) spec = addMotionTrack(spec)
    expect(() => addMotionTrack(spec)).toThrow(RangeError)

    const firstTrack = spec.tracks[0]
    if (!firstTrack) throw new Error('Expected at least one motion track')
    const trackId = firstTrack.id
    let offset = 0.01
    while (spec.tracks.reduce((sum, track) => sum + track.keyframes.length, 0) < 32) {
      spec = addMotionKeyframe(spec, trackId, offset).spec
      offset += 0.01
    }
    expect(() => addMotionKeyframe(spec, trackId, 0.9)).toThrow(RangeError)
  })
})
