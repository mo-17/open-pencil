import { describe, expect, mock, test } from 'bun:test'

import {
  createCursorBroadcastQueue,
  type CursorBroadcastScheduler
} from '@/app/collab/cursor-broadcast'

function createScheduler() {
  let now = 0
  let nextHandle = 1
  const frames = new Map<number, FrameRequestCallback>()
  const delays = new Map<number, { callback: () => void; dueAt: number }>()
  const scheduler: CursorBroadcastScheduler = {
    now: () => now,
    requestFrame: (callback) => {
      const handle = nextHandle++
      frames.set(handle, callback)
      return handle
    },
    cancelFrame: (handle) => frames.delete(handle),
    setDelay: (callback, delayMs) => {
      const handle = nextHandle++
      delays.set(handle, { callback, dueAt: now + delayMs })
      return handle as ReturnType<typeof setTimeout>
    },
    clearDelay: (handle) => delays.delete(handle as number)
  }

  return {
    scheduler,
    get pendingFrames() {
      return frames.size
    },
    get pendingDelays() {
      return delays.size
    },
    advance(ms: number) {
      now += ms
      const ready = [...delays.entries()].filter(([, delay]) => delay.dueAt <= now)
      for (const [handle, delay] of ready) {
        delays.delete(handle)
        delay.callback()
      }
    },
    flushFrame() {
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback(now)
    }
  }
}

describe('cursor broadcast queue', () => {
  test('coalesces samples to the latest coordinate on the next frame', () => {
    const clock = createScheduler()
    const emit = mock((_value: { x: number }) => undefined)
    const queue = createCursorBroadcastQueue(emit, clock.scheduler)

    queue.push({ x: 1 }, 30)
    queue.push({ x: 2 }, 30)
    queue.push({ x: 3 }, 30)

    expect(clock.pendingFrames).toBe(1)
    clock.flushFrame()
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenLastCalledWith({ x: 3 })
  })

  test('honors 15/30/60fps caps and keeps a trailing sample', () => {
    for (const fpsCap of [15, 30, 60]) {
      const clock = createScheduler()
      const values: number[] = []
      const queue = createCursorBroadcastQueue(
        (value: number) => values.push(value),
        clock.scheduler
      )

      queue.push(1, fpsCap)
      clock.flushFrame()
      queue.push(2, fpsCap)
      clock.advance(1000 / fpsCap - 1)
      expect(clock.pendingFrames).toBe(0)
      expect(values).toEqual([1])
      clock.advance(1)
      expect(clock.pendingFrames).toBe(1)
      clock.flushFrame()
      expect(values).toEqual([1, 2])
    }
  })

  test('flush publishes synchronously and cancels scheduled work', () => {
    const clock = createScheduler()
    const values: number[] = []
    const queue = createCursorBroadcastQueue((value: number) => values.push(value), clock.scheduler)

    queue.push(1, 30)
    clock.flushFrame()
    queue.push(2, 30)
    expect(clock.pendingDelays).toBe(1)

    queue.flush()

    expect(values).toEqual([1, 2])
    expect(clock.pendingFrames).toBe(0)
    expect(clock.pendingDelays).toBe(0)
  })

  test('clear drops a pending sample and resets the next session cadence', () => {
    const clock = createScheduler()
    const values: number[] = []
    const queue = createCursorBroadcastQueue((value: number) => values.push(value), clock.scheduler)

    queue.push(1, 15)
    queue.clear()
    expect(clock.pendingFrames).toBe(0)

    queue.push(2, 15)
    clock.flushFrame()
    expect(values).toEqual([2])
  })
})
