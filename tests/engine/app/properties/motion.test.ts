import { describe, expect, test } from 'bun:test'

import {
  createMotionPreset,
  createUserMotionPreset,
  createUserMotionPresetLibrary,
  instantiateUserMotionPreset,
  MOTION_LIMITS
} from '@open-pencil/scene-graph'

import { createEditorStore } from '@/app/editor/session'
import {
  applyMotionPreset,
  applyMotionSpec,
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

  test('applies spatial stagger in one undo step and keeps built-in provenance aligned', () => {
    const { ids, store } = createRectangles(3)

    expect(
      applyMotionPreset(store, [ids[2], ids[0], ids[1]], 'slide-up', 'Apply stagger', {
        stepMs: 80,
        direction: 'forward',
        rhythm: 'linear'
      })
    ).toBe(3)
    expect(
      ids.map((id) => selectedNode(store, id, 'rectangle').motion?.tracks[0]?.timing.delayMs)
    ).toEqual([0, 80, 160])
    expect(
      ids.map((id) => selectedNode(store, id, 'rectangle').motion?.preset?.parameters.delayMs)
    ).toEqual([0, 80, 160])
    expect(store.undo.undoLabel).toBe('Apply stagger')

    store.undo.undo()
    expect(ids.map((id) => selectedNode(store, id, 'rectangle').motion)).toEqual([
      undefined,
      undefined,
      undefined
    ])
    store.undo.redo()
    expect(
      ids.map((id) => selectedNode(store, id, 'rectangle').motion?.tracks[0]?.timing.delayMs)
    ).toEqual([0, 80, 160])

    expect(
      applyMotionPreset(store, ids, 'slide-up', 'Reverse stagger', {
        stepMs: 80,
        direction: 'reverse',
        rhythm: 'linear'
      })
    ).toBe(2)
    expect(
      ids.map((id) => selectedNode(store, id, 'rectangle').motion?.tracks[0]?.timing.delayMs)
    ).toEqual([160, 80, 0])
  })

  test('uses node ids as a locale-independent stagger tie-breaker', () => {
    const store = createEditorStore()
    const pageId = store.state.currentPageId
    store.graph.createNodeWithId('motion-b', 'RECTANGLE', pageId, {
      x: 40,
      y: 40,
      width: 20,
      height: 20
    })
    store.graph.createNodeWithId('motion-a', 'RECTANGLE', pageId, {
      x: 40,
      y: 40,
      width: 20,
      height: 20
    })

    expect(
      applyMotionPreset(store, ['motion-b', 'motion-a'], 'fade-in', 'Apply tied stagger', {
        stepMs: 25,
        direction: 'forward',
        rhythm: 'linear'
      })
    ).toBe(2)
    expect(selectedNode(store, 'motion-a', 'a').motion?.tracks[0]?.timing.delayMs).toBe(0)
    expect(selectedNode(store, 'motion-b', 'b').motion?.tracks[0]?.timing.delayMs).toBe(25)
  })

  test('prebuilds every staggered snapshot before mutation', () => {
    const { ids, store } = createRectangles(2)
    const motion = createMotionPreset('fade-in', { delayMs: MOTION_LIMITS.delayMs.max - 10 })

    expect(() =>
      applyMotionSpec(store, ids, motion, 'Invalid stagger', {
        stepMs: 20,
        direction: 'forward',
        rhythm: 'linear'
      })
    ).toThrow()
    expect(ids.map((id) => selectedNode(store, id, 'rectangle').motion)).toEqual([
      undefined,
      undefined
    ])
    expect(store.undo.canUndo).toBe(false)
  })

  test('applies personal preset snapshots deeply and detaches provenance after editing', () => {
    const { ids, store } = createRectangles(2)
    const personalMotion = createMotionPreset('slide-up')
    delete personalMotion.preset
    const library = createUserMotionPreset(createUserMotionPresetLibrary(), {
      id: 'user-card-enter',
      name: '卡片入场',
      category: 'entrance',
      motion: personalMotion
    })
    const snapshot = instantiateUserMotionPreset(library.presets[0])

    expect(applyMotionSpec(store, ids, snapshot, 'Apply personal preset')).toBe(2)
    const first = selectedNode(store, ids[0], 'first rectangle').motion
    const second = selectedNode(store, ids[1], 'second rectangle').motion
    expect(first?.preset).toEqual({ id: 'user-card-enter', version: 1, parameters: {} })
    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    expect(second?.tracks).not.toBe(first?.tracks)

    expect(setMotionTiming(store, [ids[0]], 'durationMs', 700, 'Edit personal motion')).toBe(1)
    expect(selectedNode(store, ids[0], 'first rectangle').motion?.preset).toBeUndefined()
    expect(selectedNode(store, ids[1], 'second rectangle').motion?.preset?.id).toBe(
      'user-card-enter'
    )
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

  test('records root instance motion overrides atomically across apply, clear, undo, and sync', () => {
    const store = createEditorStore()
    const component = store.graph.createNode('COMPONENT', store.state.currentPageId, {
      name: 'Animated component',
      motion: createMotionPreset('fade-in')
    })
    const instance = store.graph.createInstance(component.id, store.state.currentPageId)
    if (!instance) throw new Error('Expected component instance')

    expect(applyMotionPreset(store, [instance.id], 'slide-up', 'Apply motion preset')).toBe(1)
    let current = selectedNode(store, instance.id, 'instance')
    expect(current.motion?.preset?.id).toBe('slide-up')
    expect(current.overrides.motion).toEqual(current.motion)
    expect(current.overrides.motion).not.toBe(current.motion)

    store.graph.updateNode(component.id, { motion: createMotionPreset('bounce-in') })
    store.graph.syncInstances(component.id)
    current = selectedNode(store, instance.id, 'instance')
    expect(current.motion?.preset?.id).toBe('slide-up')

    store.undo.undo()
    current = selectedNode(store, instance.id, 'instance')
    expect(current.motion?.preset?.id).toBe('fade-in')
    expect(Object.hasOwn(current.overrides, 'motion')).toBe(false)

    store.undo.redo()
    current = selectedNode(store, instance.id, 'instance')
    expect(current.motion?.preset?.id).toBe('slide-up')
    expect(current.overrides.motion).toEqual(current.motion)

    expect(clearSelectedMotion(store, [instance.id], 'Clear motion')).toBe(1)
    current = selectedNode(store, instance.id, 'instance')
    expect(current.motion).toBeUndefined()
    expect(current.overrides.motion).toBeNull()
    store.graph.syncInstances(component.id)
    expect(selectedNode(store, instance.id, 'instance').motion).toBeUndefined()

    store.undo.undo()
    current = selectedNode(store, instance.id, 'instance')
    expect(current.motion?.preset?.id).toBe('slide-up')
    expect(current.overrides.motion).toEqual(current.motion)
  })
})
