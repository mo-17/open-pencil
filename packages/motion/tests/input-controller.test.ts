import { describe, expect, test } from 'bun:test'

import {
  MOTION_INPUT_CONTROLLER_LIMITS,
  MotionInputController,
  mapMotionDriverInput,
  normalizeMotionStateInput,
  prepareMotionDriverTarget,
  prepareMotionSamplingPlan,
  samplePreparedMotionDriverTarget,
  samplePreparedMotionPlan,
  type MotionInputBatch,
  type MotionInputFrameScheduler
} from '@open-pencil/motion'
import type {
  MotionDriver,
  MotionDriverMapping,
  MotionDriverSource,
  MotionDriverSpecV1,
  MotionSpec
} from '@open-pencil/scene-graph'

class ManualFrameScheduler implements MotionInputFrameScheduler {
  readonly callbacks = new Map<number, () => void>()
  readonly cancelled: number[] = []
  #nextHandle = 0

  request(callback: () => void): number {
    const handle = ++this.#nextHandle
    this.callbacks.set(handle, callback)
    return handle
  }

  cancel(handle: unknown): void {
    const numeric = handle as number
    this.cancelled.push(numeric)
    this.callbacks.delete(numeric)
  }

  flush(): void {
    const callbacks = [...this.callbacks.values()]
    this.callbacks.clear()
    for (const callback of callbacks) callback()
  }
}

function motion(
  trigger: MotionSpec['tracks'][number]['trigger'] = 'mount',
  timing: Partial<MotionSpec['tracks'][number]['timing']> = {}
): MotionSpec {
  return {
    version: 3,
    reducedMotion: 'allow',
    tracks: [
      {
        id: 'move',
        trigger,
        keyframes: [
          { offset: 0, x: 0, opacity: 0 },
          { offset: 1, x: 100, opacity: 1 }
        ],
        timing: { durationMs: 400, easing: 'linear', fill: 'both', ...timing },
        composition: { mode: 'replace' }
      }
    ]
  }
}

function source(kind: MotionDriverSource['kind'] = 'scroll'): MotionDriverSource {
  switch (kind) {
    case 'scroll':
      return { kind, axis: 'y', metric: 'progress' }
    case 'pointer':
      return { kind, axis: 'x', space: 'viewport' }
    case 'drag':
      return { kind, handleNodeId: 'handle', axis: 'x', distance: 100 }
    case 'visibility':
      return { kind, sourceNodeId: 'source' }
    case 'pageState':
    case 'documentState':
      return { kind, stateId: 'enabled' }
    case 'variable':
      return { kind, variableId: 'progress' }
  }
}

function driver(
  id: string,
  targetNodeId = 'node',
  mapping: MotionDriverMapping = { inputMin: 0, inputMax: 1 },
  sourceKind: MotionDriverSource['kind'] = 'scroll'
): MotionDriver {
  return {
    id,
    source: source(sourceKind),
    target: { targetNodeId, trackId: 'move' },
    mapping
  }
}

function spec(...drivers: MotionDriver[]): MotionDriverSpecV1 {
  return { version: 1, drivers }
}

describe('Motion driver input mapping', () => {
  test('normalizes boolean and finite numeric state values', () => {
    expect(normalizeMotionStateInput(false)).toBe(0)
    expect(normalizeMotionStateInput(true)).toBe(1)
    expect(normalizeMotionStateInput(-0)).toBe(0)
    expect(normalizeMotionStateInput(12.5)).toBe(12.5)
    expect(() => normalizeMotionStateInput(Number.NaN)).toThrow('must be finite')
    expect(() => normalizeMotionStateInput(Number.POSITIVE_INFINITY)).toThrow('must be finite')
  })

  test('covers clamp, unclamped inactivity, reverse, and endpoint dead zones', () => {
    const range = { inputMin: 0, inputMax: 10 }
    expect(mapMotionDriverInput(-5, range)).toBe(0)
    expect(mapMotionDriverInput(15, range)).toBe(1)
    expect(mapMotionDriverInput(2.5, range)).toBe(0.25)
    expect(mapMotionDriverInput(-1, { ...range, clamp: false })).toBeUndefined()
    expect(mapMotionDriverInput(11, { ...range, clamp: false })).toBeUndefined()
    expect(mapMotionDriverInput(0, { ...range, clamp: false })).toBe(0)
    expect(mapMotionDriverInput(10, { ...range, clamp: false })).toBe(1)
    expect(mapMotionDriverInput(0, { ...range, reverse: true })).toBe(1)
    expect(mapMotionDriverInput(10, { ...range, reverse: true })).toBe(0)
    expect(mapMotionDriverInput(2.5, { ...range, reverse: true })).toBe(0.75)
    expect(mapMotionDriverInput(2, { ...range, deadZone: 0.2 })).toBe(0)
    expect(mapMotionDriverInput(8, { ...range, deadZone: 0.2 })).toBe(1)
    expect(mapMotionDriverInput(1, { ...range, deadZone: 0.2 })).toBe(0)
    expect(mapMotionDriverInput(9, { ...range, deadZone: 0.2 })).toBe(1)
    expect(mapMotionDriverInput(5, { ...range, deadZone: 0.2 })).toBeCloseTo(0.5)
    expect(mapMotionDriverInput(3, { ...range, deadZone: 0.2 })).toBeCloseTo(1 / 6)
    expect(mapMotionDriverInput(2, { ...range, reverse: true, deadZone: 0.2 })).toBe(1)
    expect(mapMotionDriverInput(8, { ...range, reverse: true, deadZone: 0.2 })).toBe(0)
  })

  test('rejects malformed runtime mappings even when TypeScript is bypassed', () => {
    expect(() => mapMotionDriverInput(0, { inputMin: 1, inputMax: 1 })).toThrow(
      'greater than inputMin'
    )
    expect(() => mapMotionDriverInput(0, { inputMin: 0, inputMax: 1, deadZone: 0.5 })).toThrow(
      'deadZone'
    )
  })
})

describe('prepared Motion driver target', () => {
  test('matches the reference sampler exactly at deterministic progress', () => {
    const authored = motion('hover')
    const preparation = prepareMotionDriverTarget(driver('scroll'), () => ({
      nodeId: 'resolved-node',
      motion: authored
    }))
    expect(preparation.success).toBe(true)
    if (!preparation.success) return

    const driven = samplePreparedMotionDriverTarget(preparation.target, 0.25)
    const reference = samplePreparedMotionPlan(
      prepareMotionSamplingPlan(authored, {
        selection: { mode: 'trackIds', trackIds: ['move'] }
      }),
      100
    )
    expect(driven.sample).toEqual(reference)
    expect(driven.progress).toBe(0.25)
    expect(driven.elapsedMs).toBe(100)
    expect(preparation.target.authoredTrigger).toBe('hover')
    expect(preparation.target.automaticTriggerSuppressed).toBe(true)
    expect(authored.tracks[0]?.trigger).toBe('hover')
    expect(() => samplePreparedMotionDriverTarget(preparation.target, -0.01)).toThrow('0..1')
  })

  test('reports unresolved, missing, disabled, and unsafe targets inertly', () => {
    const targetMissing = prepareMotionDriverTarget(driver('a'), () => undefined)
    const motionMissing = prepareMotionDriverTarget(driver('b'), () => ({ nodeId: 'node' }))
    const trackMissing = prepareMotionDriverTarget(driver('c'), () => ({
      nodeId: 'node',
      motion: { ...motion(), tracks: [] }
    }))
    const unsafe = prepareMotionDriverTarget(driver('d'), () => ({
      nodeId: 'node',
      motion: motion('mount', { iterations: 2 })
    }))
    const disabledMotion = motion()
    disabledMotion.reducedMotion = 'disable'
    const disabled = prepareMotionDriverTarget(
      driver('e'),
      () => ({ nodeId: 'node', motion: disabledMotion }),
      { prefersReducedMotion: true }
    )
    expect(!targetMissing.success && targetMissing.issue.code).toBe('target-missing')
    expect(!motionMissing.success && motionMissing.issue.code).toBe('motion-missing')
    expect(!trackMissing.success && trackMissing.issue.code).toBe('track-missing')
    expect(!unsafe.success && unsafe.issue.code).toBe('track-not-drivable')
    expect(!disabled.success && disabled.issue.code).toBe('track-disabled')
  })
})

describe('MotionInputController', () => {
  test('coalesces latest values into one deterministic frame and supports explicit flush', () => {
    const scheduler = new ManualFrameScheduler()
    const batches: MotionInputBatch[] = []
    const controller = new MotionInputController({
      scheduler,
      onUpdate: (batch) => batches.push(batch)
    })
    const authored = motion()
    controller.register('page', spec(driver('first'), driver('second', 'node-2')), (nodeId) => ({
      nodeId,
      motion: authored
    }))

    expect(controller.setInput('second', 0.75)).toBe(true)
    expect(controller.setInput('first', 0.1)).toBe(true)
    expect(controller.setInput('first', 0.25)).toBe(true)
    expect(scheduler.callbacks.size).toBe(1)
    const flushed = controller.flush()
    expect(scheduler.callbacks.size).toBe(0)
    expect(scheduler.cancelled).toHaveLength(1)
    expect(flushed.outputs.map(({ driverId }) => driverId)).toEqual(['first', 'second'])
    expect(flushed.outputs[0]?.active && flushed.outputs[0].sample.visual.x).toBe(25)
    expect(flushed.outputs[1]?.active && flushed.outputs[1].sample.visual.x).toBe(75)
    expect(batches).toEqual([flushed])
    scheduler.flush()
    expect(batches).toHaveLength(1)
  })

  test('isolates scopes and requires a scoped key for ambiguous driver ids', () => {
    const scheduler = new ManualFrameScheduler()
    const controller = new MotionInputController({ scheduler })
    const authored = motion('press')
    controller.register('page-a', spec(driver('progress', 'node-a')), (nodeId) => ({
      nodeId,
      motion: authored
    }))
    controller.register('page-b', spec(driver('progress', 'node-b')), (nodeId) => ({
      nodeId,
      motion: authored
    }))

    expect(() => controller.setInput('progress', 0.5)).toThrow('ambiguous')
    expect(controller.setInput({ scopeId: 'page-a', driverId: 'progress' }, 0.25)).toBe(true)
    expect(controller.setInput({ scopeId: 'page-b', driverId: 'progress' }, 0.75)).toBe(true)
    const batch = controller.flush()
    expect(batch.outputs.map(({ scopeId }) => scopeId)).toEqual(['page-a', 'page-b'])
    expect(controller.getScopeState('page-a')?.outputs).toHaveLength(1)
    expect(controller.getScopeState('page-b')?.outputs).toHaveLength(1)
    expect(controller.isAutomaticTriggerSuppressed('page-a', 'node-a', 'move')).toBe(true)
    expect(controller.isAutomaticTriggerSuppressed('page-a', 'node-b', 'move')).toBe(false)
    const cleanup = controller.disposeScope('page-a')
    expect(cleanup?.clearTargets.map(({ targetNodeId }) => targetNodeId)).toEqual(['node-a'])
    expect(controller.disposeScope('page-a')).toBeUndefined()
    expect(controller.setInput('progress', 0.5)).toBe(true)
  })

  test('emits inactive output outside an unclamped range and normalizes state booleans', () => {
    const controller = new MotionInputController({ scheduler: new ManualFrameScheduler() })
    controller.register(
      'state',
      spec(
        driver('page-enabled', 'page-node', { inputMin: 0, inputMax: 1 }, 'pageState'),
        driver('free-scroll', 'scroll-node', { inputMin: 0, inputMax: 100, clamp: false }, 'scroll')
      ),
      (nodeId) => ({ nodeId, motion: motion() })
    )
    controller.setInput('page-enabled', true)
    controller.setInput('free-scroll', 101)
    const batch = controller.flush()
    const state = batch.outputs[0]
    const outside = batch.outputs[1]
    expect(state?.active && state.progress).toBe(1)
    expect(state?.input).toBe(1)
    expect(outside).toMatchObject({ active: false, reason: 'out-of-range', input: 101 })
  })

  test('uses the prepared reduced-motion plan for accessible sampling', () => {
    const authored = motion()
    authored.reducedMotion = 'reduce'
    const controller = new MotionInputController({
      scheduler: new ManualFrameScheduler(),
      prefersReducedMotion: true
    })
    controller.register('page', spec(driver('progress')), (nodeId) => ({
      nodeId,
      motion: authored
    }))
    controller.setInput('progress', 0.5)
    const output = controller.flush().outputs[0]
    expect(output?.active).toBe(true)
    if (!output?.active) return
    expect(output.elapsedMs).toBe(60)
    expect(output.sample.visual.x).toBe(0)
    expect(output.sample.visual.opacity).toBe(0.5)
  })

  test('replacement and disposal clear pending work without stale-handle effects', () => {
    const scheduler = new ManualFrameScheduler()
    const batches: MotionInputBatch[] = []
    const controller = new MotionInputController({
      scheduler,
      onUpdate: (batch) => batches.push(batch)
    })
    const first = controller.register('page', spec(driver('old')), (nodeId) => ({
      nodeId,
      motion: motion()
    }))
    controller.setInput('old', 0.25)
    controller.flush()
    controller.setInput('old', 0.5)
    const replacement = controller.register('page', spec(driver('new')), (nodeId) => ({
      nodeId,
      motion: motion()
    }))
    expect(scheduler.callbacks.size).toBe(0)
    expect(replacement.replacedClearTargets.map(({ targetNodeId }) => targetNodeId)).toEqual([
      'node'
    ])
    expect(first.dispose()).toBeUndefined()
    expect(controller.setInput('old', 0.5)).toBe(false)
    expect(controller.setInput('new', 0.5)).toBe(true)
    controller.flush()
    const cleanups = controller.dispose()
    expect(cleanups).toHaveLength(1)
    expect(cleanups[0]?.clearTargets.map(({ targetNodeId }) => targetNodeId)).toEqual(['node'])
    expect(controller.dispose()).toEqual([])
    scheduler.flush()
    expect(batches).toHaveLength(2)
    expect(replacement.dispose()).toBeUndefined()
    expect(() => controller.setInput('new', 0.5)).toThrow('disposed')
  })

  test('keeps invalid targets inert and enforces bounded scope resources', () => {
    const controller = new MotionInputController({ scheduler: new ManualFrameScheduler() })
    const invalid = controller.register('invalid', spec(driver('missing')), () => undefined)
    expect(invalid.driverIds).toEqual([])
    expect(invalid.issues.map(({ code }) => code)).toEqual(['target-missing'])
    expect(controller.setInput('missing', 0.5)).toBe(false)
    expect(controller.getScopeState('invalid')?.automaticTriggerSuppressions).toEqual([])
    invalid.dispose()

    for (let index = 0; index < MOTION_INPUT_CONTROLLER_LIMITS.maxScopes; index++) {
      controller.register(`scope-${index}`, spec(driver(`driver-${index}`)), (nodeId) => ({
        nodeId,
        motion: motion()
      }))
    }
    expect(() =>
      controller.register('overflow', spec(driver('overflow')), (nodeId) => ({
        nodeId,
        motion: motion()
      }))
    ).toThrow('scope limit')
    expect(() => controller.register('', spec(driver('bad')), () => undefined)).toThrow('scopeId')
  })
})
