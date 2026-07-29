import { describe, expect, test } from 'bun:test'

import type { MotionSpec } from '@open-pencil/scene-graph'

import { createManualMotionClock, createMotionRuntime } from '../src'

const motion: MotionSpec = {
  version: 1,
  tracks: [
    {
      id: 'move',
      trigger: 'mount',
      keyframes: [
        { offset: 0, x: 0, opacity: 0 },
        { offset: 1, x: 100, opacity: 1 }
      ],
      timing: { durationMs: 100, easing: 'linear', fill: 'both' }
    }
  ]
}

describe('MotionRuntime', () => {
  test('plays, pauses, resumes, reverses, and finishes on a deterministic clock', () => {
    const clock = createManualMotionClock()
    const frames: Array<{ elapsedMs: number; x: number }> = []
    let finishes = 0
    const runtime = createMotionRuntime({ clock })
    const handle = runtime.register({
      id: 'hero',
      motion,
      apply: (frame) => frames.push({ elapsedMs: frame.elapsedMs, x: frame.sample.visual.x }),
      onFinish: () => finishes++
    })

    handle.play()
    expect(clock.pendingFrameCount).toBe(1)
    clock.advanceBy(40)
    expect(frames.at(-1)).toEqual({ elapsedMs: 40, x: 40 })

    handle.pause()
    expect(clock.pendingFrameCount).toBe(0)
    clock.advanceBy(50)
    expect(frames.at(-1)?.elapsedMs).toBe(40)

    handle.resume()
    clock.advanceBy(60)
    expect(handle.getState()).toMatchObject({ status: 'finished', elapsedMs: 100 })
    expect(finishes).toBe(1)

    handle.play({ playbackRate: -1 })
    clock.advanceBy(25)
    expect(frames.at(-1)).toEqual({ elapsedMs: 75, x: 75 })
    clock.advanceBy(75)
    expect(handle.getState()).toMatchObject({ status: 'finished', elapsedMs: 0 })
    expect(finishes).toBe(2)
  })

  test('shares one frame request and preserves registration order', () => {
    const clock = createManualMotionClock()
    const order: string[] = []
    const runtime = createMotionRuntime({ clock })
    const first = runtime.register({
      id: 'first',
      motion,
      apply: ({ elapsedMs }) => {
        if (elapsedMs > 0) order.push('first')
      }
    })
    const second = runtime.register({
      id: 'second',
      motion,
      apply: ({ elapsedMs }) => {
        if (elapsedMs > 0) order.push('second')
      }
    })

    first.play()
    second.play()
    expect(clock.pendingFrameCount).toBe(1)
    clock.advanceBy(16)
    expect(order).toEqual(['first', 'second'])
    runtime.dispose()
    expect(clock.pendingFrameCount).toBe(0)
  })

  test('updates prepared plans, supports fixed-time seek, and cleans up exactly once', () => {
    const clock = createManualMotionClock()
    const samples: number[] = []
    let clears = 0
    const runtime = createMotionRuntime({ clock })
    const handle = runtime.register({
      id: 'card',
      motion,
      apply: ({ sample }) => samples.push(sample.visual.x),
      clear: () => clears++
    })

    expect(handle.seek(25).sample.visual.x).toBe(25)
    handle.update({
      ...motion,
      tracks: [
        {
          ...motion.tracks[0],
          keyframes: [
            { offset: 0, x: 0 },
            { offset: 1, x: 200 }
          ]
        }
      ]
    })
    expect(handle.seek(25).sample.visual.x).toBe(50)
    handle.dispose()
    handle.dispose()
    expect(clears).toBe(1)
    expect(() => handle.getState()).toThrow('disposed')
    runtime.dispose()
    expect(samples).toEqual([25, 50])
  })

  test('finishes every binding and frame cleanup before reporting clear failures', () => {
    const clock = createManualMotionClock()
    const clears: string[] = []
    const reported: string[] = []
    const runtime = createMotionRuntime({
      clock,
      onError: (error, id) => reported.push(`${id}:${String(error)}`)
    })
    const firstError = new Error('first clear failed')
    const secondError = new Error('second clear failed')
    const handles = [
      runtime.register({
        id: 'first',
        motion,
        apply: () => undefined,
        clear: () => {
          clears.push('first')
          throw firstError
        }
      }),
      runtime.register({
        id: 'middle',
        motion,
        apply: () => undefined,
        clear: () => clears.push('middle')
      }),
      runtime.register({
        id: 'last',
        motion,
        apply: () => undefined,
        clear: () => {
          clears.push('last')
          throw secondError
        }
      })
    ]
    for (const handle of handles) handle.play()
    expect(clock.pendingFrameCount).toBe(1)

    let failure: unknown
    try {
      runtime.dispose()
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toEqual([firstError, secondError])
    expect(clears).toEqual(['first', 'middle', 'last'])
    expect(reported).toEqual(['first:Error: first clear failed', 'last:Error: second clear failed'])
    expect(clock.pendingFrameCount).toBe(0)
    for (const handle of handles) expect(() => handle.getState()).toThrow('disposed')
    expect(() => runtime.register({ id: 'after-dispose', motion, apply: () => undefined })).toThrow(
      'disposed'
    )
    expect(() => runtime.dispose()).not.toThrow()
  })

  test('finishes single-binding disposal and frame cancellation before rethrowing clear failure', () => {
    const clock = createManualMotionClock()
    const runtime = createMotionRuntime({ clock })
    const clearError = new Error('clear failed')
    const handle = runtime.register({
      id: 'throwing',
      motion,
      apply: () => undefined,
      clear: () => {
        throw clearError
      }
    })
    handle.play()
    expect(clock.pendingFrameCount).toBe(1)

    expect(() => handle.dispose()).toThrow(clearError)
    expect(clock.pendingFrameCount).toBe(0)
    expect(() => handle.getState()).toThrow('disposed')

    const live = runtime.register({ id: 'still-live', motion, apply: () => undefined })
    expect(live.getState().status).toBe('idle')
    runtime.dispose()
  })

  test('bounds ids, playback rate, registrations, and malformed specs', () => {
    const runtime = createMotionRuntime({ clock: createManualMotionClock() })
    expect(() => runtime.register({ id: '', motion, apply: () => undefined })).toThrow(
      'bounded string'
    )
    expect(() =>
      runtime.register({ id: 'bad-rate', motion, playbackRate: 0, apply: () => undefined })
    ).toThrow('playbackRate')
    expect(() =>
      runtime.register({
        id: 'bad-spec',
        motion: { version: 1, tracks: [] } as MotionSpec,
        apply: () => undefined
      })
    ).toThrow()
  })

  test('routes apply errors without leaking scheduled frames', () => {
    const clock = createManualMotionClock()
    const errors: string[] = []
    const runtime = createMotionRuntime({
      clock,
      onError: (error, id) => errors.push(`${id}:${String(error)}`)
    })
    const handle = runtime.register({
      id: 'broken',
      motion,
      apply: () => {
        throw new Error('paint failed')
      }
    })
    handle.play()
    expect(errors[0]).toContain('broken:Error: paint failed')
    expect(handle.getState().status).toBe('idle')
    expect(clock.pendingFrameCount).toBe(0)
  })

  test('keeps reduce opacity-only and disables playback through the shared prepared plan', () => {
    const sample = (policy: 'reduce' | 'disable' | 'allow') => {
      const runtime = createMotionRuntime({
        clock: createManualMotionClock(),
        prefersReducedMotion: true
      })
      let visual: { x: number; opacity: number } | undefined
      let hasTracks: boolean | undefined
      const handle = runtime.register({
        id: policy,
        motion: { ...motion, reducedMotion: policy },
        apply: ({ sample: frame }) => {
          visual = frame.visual
          hasTracks = frame.hasTracks
        }
      })
      handle.seek(50)
      runtime.dispose()
      return { visual, hasTracks }
    }

    expect(sample('reduce')).toEqual({
      visual: { ...motionIdentity(), opacity: 0.5 },
      hasTracks: true
    })
    expect(sample('disable')).toEqual({ visual: motionIdentity(), hasTracks: false })
    expect(sample('allow')).toEqual({
      visual: { ...motionIdentity(), x: 50, opacity: 0.5 },
      hasTracks: true
    })
  })

  test('rebuilds reduced-motion plans without losing finite progress or playback state', () => {
    const clock = createManualMotionClock()
    const runtime = createMotionRuntime({ clock })
    const mixedDurationMotion: MotionSpec = {
      version: 1,
      tracks: [
        {
          id: 'move',
          trigger: 'mount',
          keyframes: [
            { offset: 0, x: 0 },
            { offset: 1, x: 200 }
          ],
          timing: { durationMs: 200, easing: 'linear', fill: 'both' }
        },
        {
          id: 'fade',
          trigger: 'mount',
          keyframes: [
            { offset: 0, opacity: 0 },
            { offset: 1, opacity: 1 }
          ],
          timing: { durationMs: 100, easing: 'linear', fill: 'both' }
        }
      ]
    }
    const rendered = new Map<string, { elapsedMs: number; x: number; opacity: number }>()
    const registration = (id: string) =>
      runtime.register({
        id,
        motion: mixedDurationMotion,
        apply: ({ elapsedMs, sample }) =>
          rendered.set(id, {
            elapsedMs,
            x: sample.visual.x,
            opacity: sample.visual.opacity
          })
      })
    const running = registration('running')
    const paused = registration('paused')
    const idle = registration('idle')
    const finished = registration('finished')

    running.play()
    paused.play()
    clock.advanceBy(50)
    paused.pause()
    paused.setPlaybackRate(2)
    idle.seek(50)
    finished.seek(200)
    finished.play()
    clock.flush()
    expect(finished.getState().status).toBe('finished')
    expect(clock.pendingFrameCount).toBe(1)

    runtime.setPrefersReducedMotion(true)
    expect(runtime.prefersReducedMotion).toBe(true)
    expect(running.getState()).toMatchObject({ status: 'running', elapsedMs: 25, durationMs: 100 })
    expect(paused.getState()).toMatchObject({
      status: 'paused',
      elapsedMs: 25,
      durationMs: 100,
      playbackRate: 2
    })
    expect(idle.getState()).toMatchObject({ status: 'idle', elapsedMs: 25, durationMs: 100 })
    expect(finished.getState()).toMatchObject({
      status: 'finished',
      elapsedMs: 100,
      durationMs: 100
    })
    expect(rendered.get('running')).toEqual({ elapsedMs: 25, x: 0, opacity: 0.25 })
    expect(rendered.get('idle')).toEqual({ elapsedMs: 25, x: 0, opacity: 0.25 })
    expect(clock.pendingFrameCount).toBe(1)

    runtime.setPrefersReducedMotion(false)
    expect(runtime.prefersReducedMotion).toBe(false)
    expect(running.getState()).toMatchObject({ status: 'running', elapsedMs: 50, durationMs: 200 })
    expect(paused.getState()).toMatchObject({ status: 'paused', elapsedMs: 50, durationMs: 200 })
    expect(idle.getState()).toMatchObject({ status: 'idle', elapsedMs: 50, durationMs: 200 })
    expect(finished.getState()).toMatchObject({
      status: 'finished',
      elapsedMs: 200,
      durationMs: 200
    })
    expect(rendered.get('running')).toEqual({ elapsedMs: 50, x: 50, opacity: 0.5 })
    expect(clock.pendingFrameCount).toBe(1)
    runtime.dispose()
  })

  test('does not reapply an idle binding after clear when reduced-motion changes', () => {
    const runtime = createMotionRuntime({ clock: createManualMotionClock() })
    const applied: number[] = []
    let clears = 0
    const handle = runtime.register({
      id: 'idle-clear',
      motion,
      apply: ({ elapsedMs }) => applied.push(elapsedMs),
      clear: () => clears++
    })

    runtime.setPrefersReducedMotion(true)
    expect(applied).toEqual([])
    handle.seek(50)
    expect(applied).toEqual([50])
    runtime.setPrefersReducedMotion(false)
    expect(applied).toEqual([50, 50])
    handle.stop()
    expect(clears).toBe(1)
    runtime.setPrefersReducedMotion(true)
    expect(applied).toEqual([50, 50])
    runtime.dispose()
  })

  test('retains the last logical position through disabled and infinite plans', () => {
    const clock = createManualMotionClock()
    const runtime = createMotionRuntime({ clock })
    const disabledMotion: MotionSpec = {
      version: 1,
      reducedMotion: 'disable',
      tracks: motion.tracks.map((track) => ({
        ...track,
        keyframes: track.keyframes.map((keyframe) => ({ ...keyframe })),
        timing: { ...track.timing }
      }))
    }
    const disabled = runtime.register({
      id: 'disabled',
      motion: disabledMotion,
      apply: () => undefined
    })
    const disabledRunning = runtime.register({
      id: 'disabled-running',
      motion: disabledMotion,
      apply: () => undefined
    })
    disabledMotion.tracks[0].timing.durationMs = 900
    disabled.seek(40)
    disabledRunning.play({ fromMs: 30 })
    runtime.setPrefersReducedMotion(true)
    expect(disabled.getState()).toMatchObject({ status: 'idle', elapsedMs: 0, durationMs: 0 })
    expect(disabledRunning.getState()).toMatchObject({
      status: 'running',
      elapsedMs: 0,
      durationMs: 0
    })
    expect(clock.pendingFrameCount).toBe(1)
    runtime.setPrefersReducedMotion(false)
    expect(disabled.getState()).toMatchObject({ status: 'idle', elapsedMs: 40, durationMs: 100 })
    expect(disabledRunning.getState()).toMatchObject({
      status: 'running',
      elapsedMs: 30,
      durationMs: 100
    })
    expect(clock.pendingFrameCount).toBe(1)

    const infiniteMotion: MotionSpec = {
      version: 1,
      tracks: [
        {
          id: 'loop',
          trigger: 'mount',
          keyframes: [
            { offset: 0, x: 0 },
            { offset: 1, x: 100 }
          ],
          timing: { durationMs: 100, iterations: 'infinite', easing: 'linear' }
        },
        {
          id: 'fade',
          trigger: 'mount',
          keyframes: [
            { offset: 0, opacity: 0 },
            { offset: 1, opacity: 1 }
          ],
          timing: { durationMs: 100, easing: 'linear', fill: 'both' }
        }
      ]
    }
    const infinite = runtime.register({
      id: 'infinite',
      motion: infiniteMotion,
      apply: () => undefined
    })
    infinite.seek(65)
    expect(infinite.getState().durationMs).toBe(Number.POSITIVE_INFINITY)
    runtime.setPrefersReducedMotion(true)
    expect(infinite.getState()).toMatchObject({ elapsedMs: 65, durationMs: 100 })
    runtime.setPrefersReducedMotion(false)
    expect(infinite.getState()).toMatchObject({
      elapsedMs: 65,
      durationMs: Number.POSITIVE_INFINITY
    })
    runtime.dispose()
  })
})

function motionIdentity(): {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotate: number
  opacity: number
} {
  return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1 }
}
