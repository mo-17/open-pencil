import { describe, expect, test } from 'bun:test'

import { createMotionPreset, MOTION_LIMITS } from '@open-pencil/scene-graph'

import { createEditorStore } from '@/app/editor/session'
import {
  applyMotionPreset,
  clearSelectedMotion,
  MOTION_MIXED,
  readMotionSelection,
  setMotionPresetParameter,
  setMotionTiming,
  setMotionTrigger
} from '@/app/properties/motion'

import { expectDefined } from '#tests/helpers/assert'

function createRectangles(count: number) {
  const store = createEditorStore()
  const ids = Array.from(
    { length: count },
    (_, index) =>
      store.graph.createNode('RECTANGLE', store.state.currentPageId, {
        x: index * 120,
        y: 0,
        width: 100,
        height: 100
      }).id
  )
  return { ids, store }
}

function selectedNode(
  store: ReturnType<typeof createEditorStore>,
  id: string | undefined,
  label: string
) {
  return expectDefined(store.graph.getNode(expectDefined(id, `${label} id`)), label)
}

describe('motion property model', () => {
  test('reads single and mixed selection values', () => {
    const { ids, store } = createRectangles(2)
    const first = selectedNode(store, ids[0], 'first rectangle')
    const second = selectedNode(store, ids[1], 'second rectangle')
    store.graph.updateNode(first.id, { motion: createMotionPreset('fade-in') })
    store.graph.updateNode(second.id, { motion: createMotionPreset('hover-lift') })

    const single = readMotionSelection([first])
    expect(single).toMatchObject({
      count: 1,
      hasMotion: true,
      allHaveMotion: true,
      presetId: 'fade-in',
      trigger: 'mount',
      durationMs: 400,
      delayMs: 0,
      reducedMotion: 'reduce'
    })

    const mixed = readMotionSelection([first, second])
    expect(mixed.presetId).toBe(MOTION_MIXED)
    expect(mixed.mixed).toBe(true)
    expect(mixed.trigger).toBe(MOTION_MIXED)
    expect(mixed.durationMs).toBe(MOTION_MIXED)
    expect(mixed.allHaveMotion).toBe(true)

    store.graph.clearNodeFields(second.id, ['motion'])
    const partial = readMotionSelection([first, second])
    expect(partial.hasMotion).toBe(true)
    expect(partial.allHaveMotion).toBe(false)
    expect(partial.presetId).toBe(MOTION_MIXED)
  })

  test('applies and clears a multi-selection in one undo step', () => {
    const { ids, store } = createRectangles(2)

    expect(applyMotionPreset(store, ids, 'slide-up', 'Apply motion preset')).toBe(2)
    const firstMotion = selectedNode(store, ids[0], 'first rectangle').motion
    const secondMotion = selectedNode(store, ids[1], 'second rectangle').motion
    expect(firstMotion?.preset?.id).toBe('slide-up')
    expect(secondMotion?.preset?.id).toBe('slide-up')
    expect(firstMotion).not.toBe(secondMotion)
    expect(store.undo.undoLabel).toBe('Apply motion preset')

    store.undo.undo()
    for (const id of ids) expect(selectedNode(store, id, 'rectangle').motion).toBeUndefined()

    store.undo.redo()
    for (const id of ids) {
      expect(selectedNode(store, id, 'rectangle').motion?.preset?.id).toBe('slide-up')
    }

    expect(clearSelectedMotion(store, ids, 'Clear motion')).toBe(2)
    for (const id of ids) {
      const node = selectedNode(store, id, 'rectangle')
      expect(node.motion).toBeUndefined()
      expect(Object.hasOwn(node, 'motion')).toBe(false)
    }

    store.undo.undo()
    for (const id of ids) {
      expect(selectedNode(store, id, 'rectangle').motion?.preset?.id).toBe('slide-up')
    }
  })

  test('updates preset controls without discarding trigger or reduced-motion policy', () => {
    const { ids, store } = createRectangles(1)
    applyMotionPreset(store, ids, 'slide-up', 'Apply motion preset')
    setMotionTrigger(store, ids, 'click', 'Update motion')
    setMotionTiming(store, ids, 'durationMs', 720, 'Update motion')
    setMotionPresetParameter(store, ids, 'distance', 48, 'Update motion')

    const motion = expectDefined(
      selectedNode(store, ids[0], 'rectangle').motion,
      'rectangle motion'
    )
    expect(motion.preset?.parameters).toMatchObject({ durationMs: 720, distance: 48 })
    expect(motion.tracks[0]?.trigger).toBe('click')
    expect(motion.tracks[0]?.timing.durationMs).toBe(720)
    expect(motion.tracks[0]?.keyframes[0]?.y).toBe(48)
    expect(motion.reducedMotion).toBe('reduce')
  })

  test('treats stale preset provenance as custom and preserves its tracks', () => {
    const { ids, store } = createRectangles(1)
    const custom = createMotionPreset('slide-up')
    custom.tracks[0].keyframes = [
      { offset: 0, rotate: -20 },
      { offset: 1, rotate: 20 }
    ]
    custom.tracks[0].timing.durationMs = 999
    store.graph.updateNode(ids[0], { motion: custom })

    expect(readMotionSelection([selectedNode(store, ids[0], 'rectangle')]).presetId).toBe('custom')
    expect(setMotionPresetParameter(store, ids, 'distance', 48, 'Update motion')).toBe(0)
    expect(selectedNode(store, ids[0], 'rectangle').motion).toEqual(custom)
  })

  test('validates all selected updates before mutating any node', () => {
    const { ids, store } = createRectangles(2)
    applyMotionPreset(store, ids, 'fade-in', 'Apply motion preset')
    const before = ids.map((id) => structuredClone(selectedNode(store, id, 'rectangle').motion))

    expect(() =>
      setMotionTiming(store, ids, 'durationMs', MOTION_LIMITS.durationMs.max + 1, 'Update motion')
    ).toThrow()
    expect(ids.map((id) => selectedNode(store, id, 'rectangle').motion)).toEqual(before)
  })
})
