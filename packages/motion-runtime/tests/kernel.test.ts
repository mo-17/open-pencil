import { describe, expect, test } from 'bun:test'

import { createManualMotionClock } from '../src/clock'
import {
  buildMotionRuntimeKernelSource,
  createMotionFrameLoop,
  motionRuntimeTrackProgress,
  sampleMotionRuntimeChannel,
  sampleMotionRuntimeEasing,
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
