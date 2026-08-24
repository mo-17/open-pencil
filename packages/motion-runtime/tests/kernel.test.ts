import { describe, expect, test } from 'bun:test'

import { sampleMotionEasing } from '@open-pencil/motion'

import { createManualMotionClock } from '../src/clock'
import {
  buildMotionRuntimeKernelSource,
  createMotionFrameLoop,
  motionRuntimeTrackProgress,
  sampleMotionRuntimeChannel,
  sampleMotionRuntimeEasing,
  type MotionKernelEasing,
  type MotionKernelTrack
} from '../src/kernel'

const track: MotionKernelTrack = {
  timing: {
    duration: 100,
    delay: 20,
    iterations: 1.5,
    direction: 'alternate',
    fill: 'both'
  },
  composition: {
    sampling: {
      easing: 'linear',
      keyframes: [
        { offset: 0, values: { x: 0, opacity: 0 } },
        { offset: 1, values: { x: 100, opacity: 1 } }
      ]
    }
  }
}

const RICH_EASINGS = [
  { type: 'power', mode: 'in', power: 1 },
  { type: 'power', mode: 'out', power: 4 },
  { type: 'power', mode: 'inOut', power: 2 },
  { type: 'sine', mode: 'in' },
  { type: 'sine', mode: 'out' },
  { type: 'sine', mode: 'inOut' },
  { type: 'expo', mode: 'in' },
  { type: 'expo', mode: 'out' },
  { type: 'expo', mode: 'inOut' },
  { type: 'circ', mode: 'in' },
  { type: 'circ', mode: 'out' },
  { type: 'circ', mode: 'inOut' },
  { type: 'back', mode: 'in', overshoot: 1.7 },
  { type: 'back', mode: 'out', overshoot: 2.4 },
  { type: 'back', mode: 'inOut', overshoot: 3 },
  { type: 'bounce', mode: 'in' },
  { type: 'bounce', mode: 'out' },
  { type: 'bounce', mode: 'inOut' },
  { type: 'elastic', mode: 'in', amplitude: 1, period: 0.3 },
  { type: 'elastic', mode: 'out', amplitude: 1.5, period: 0.5 },
  { type: 'elastic', mode: 'inOut', amplitude: 2, period: 0.8 }
] as const satisfies readonly MotionKernelEasing[]

describe('Motion runtime kernel', () => {
  test('emits the package-owned self-contained kernel used by generated projects', () => {
    const source = buildMotionRuntimeKernelSource()
    expect(source).toContain('/* Embedded from @open-pencil/motion-runtime/kernel. */')
    expect(source).toContain('const embeddedMotionKernel: EmbeddedMotionKernel')
    expect(source).toContain(
      'const createMotionFrameLoop = embeddedMotionKernel.createMotionFrameLoop'
    )
    expect(source).not.toContain("from '@open-pencil/motion-runtime")
    expect(source).not.toContain('document.')
    expect(source).not.toContain('window.')
    const helperOrder = [
      'const applyEaseMode:',
      'const bounceOut:',
      'const bounceIn:',
      'const elasticIn:',
      'const sampleRichEasing:',
      'const sampleMotionRuntimeEasing:'
    ].map((helper) => source.indexOf(helper))
    expect(helperOrder.every((index) => index >= 0)).toBe(true)
    expect(helperOrder).toEqual([...helperOrder].sort((left, right) => left - right))
  })

  test('samples easing, channels, fill, direction, and fractional iterations', () => {
    expect(sampleMotionRuntimeEasing({ type: 'steps', steps: 4, position: 'end' }, 0.49)).toBe(0.25)
    expect(sampleMotionRuntimeChannel(track, 'x', 0.25)).toBe(25)
    expect(sampleMotionRuntimeChannel(track, 'scaleX', 0.25)).toBe(1)
    expect(motionRuntimeTrackProgress(track, 0)).toEqual({
      contributes: true,
      progress: 0,
      completedIterations: 0
    })
    expect(motionRuntimeTrackProgress(track, 170)).toEqual({
      contributes: true,
      progress: 0.5,
      completedIterations: 1
    })
  })

  test('matches the native sampler for every rich easing family and mode', () => {
    for (const easing of RICH_EASINGS) {
      for (let index = 0; index <= 64; index++) {
        const progress = index / 64
        expect(sampleMotionRuntimeEasing(easing, progress)).toBe(
          sampleMotionEasing(easing, progress)
        )
      }
    }
  })

  test('shares one cancellation-safe frame loop with the public runtime', () => {
    const clock = createManualMotionClock()
    const timestamps: number[] = []
    const loop = createMotionFrameLoop({
      clock,
      onFrame(timestampMs) {
        timestamps.push(timestampMs)
        return timestamps.length < 2
      }
    })
    loop.request()
    loop.request()
    expect(clock.pendingFrameCount).toBe(1)
    clock.advanceBy(16)
    expect(clock.pendingFrameCount).toBe(1)
    clock.advanceBy(16)
    expect(timestamps).toEqual([16, 32])
    expect(loop.scheduled).toBe(false)
    loop.dispose()
    loop.request()
    expect(clock.pendingFrameCount).toBe(0)
  })
})
