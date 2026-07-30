import { expect, mock, test } from 'bun:test'

import { createFlashActions } from '@/app/editor/flash'

function createFrameScheduler() {
  let nextId = 1
  const callbacks = new Map<number, FrameRequestCallback>()
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const id = nextId++
    callbacks.set(id, callback)
    return id
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = ((id: number) => {
    callbacks.delete(id)
  }) as typeof cancelAnimationFrame
  return {
    get pendingCount() {
      return callbacks.size
    },
    flush(timestampMs = 0) {
      const pending = [...callbacks.values()]
      callbacks.clear()
      for (const callback of pending) callback(timestampMs)
    },
    restore() {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame
    }
  }
}

test('flash animation requests overlay repaints and stops after expiry', () => {
  const scheduler = createFrameScheduler()
  try {
    let active = true
    const renderer = {
      get hasActiveFlashes() {
        return active
      },
      flashNode: mock(),
      aiMarkActive: mock(),
      aiMarkDone: mock(),
      aiFlashDone: mock(),
      aiClearAll: mock(() => {
        active = false
      })
    }
    const requestOverlayRepaint = mock()
    const editor: Parameters<typeof createFlashActions>[0] = {
      renderer,
      requestOverlayRepaint
    }
    const flash = createFlashActions(editor)

    flash.flashNodes(['node'])
    expect(renderer.flashNode).toHaveBeenCalledWith('node')
    expect(scheduler.pendingCount).toBe(1)

    scheduler.flush(0)
    expect(requestOverlayRepaint).toHaveBeenCalledTimes(1)
    active = false
    scheduler.flush()
    expect(requestOverlayRepaint).toHaveBeenCalledTimes(1)
    expect(scheduler.pendingCount).toBe(0)
  } finally {
    scheduler.restore()
  }
})

test('clearing AI flashes cancels the outstanding RAF and repaints once', () => {
  const scheduler = createFrameScheduler()
  try {
    let active = true
    const renderer = {
      get hasActiveFlashes() {
        return active
      },
      flashNode: mock(),
      aiMarkActive: mock(),
      aiMarkDone: mock(),
      aiFlashDone: mock(),
      aiClearAll: mock(() => {
        active = false
      })
    }
    const requestOverlayRepaint = mock()
    const editor: Parameters<typeof createFlashActions>[0] = { renderer, requestOverlayRepaint }
    const flash = createFlashActions(editor)

    flash.aiMarkActive(['node'])
    expect(scheduler.pendingCount).toBe(1)
    flash.aiClearAll()

    expect(renderer.aiClearAll).toHaveBeenCalledTimes(1)
    expect(requestOverlayRepaint).toHaveBeenCalledTimes(1)
    expect(scheduler.pendingCount).toBe(0)
  } finally {
    scheduler.restore()
  }
})

test('flash animation caps overlay repaints at about 30fps', () => {
  const scheduler = createFrameScheduler()
  try {
    const renderer = {
      hasActiveFlashes: true,
      flashNode: mock(),
      aiMarkActive: mock(),
      aiMarkDone: mock(),
      aiFlashDone: mock(),
      aiClearAll: mock()
    }
    const requestOverlayRepaint = mock()
    const flash = createFlashActions({ renderer, requestOverlayRepaint })

    flash.flashNodes(['node'])
    expect(requestOverlayRepaint).toHaveBeenCalledTimes(0)
    scheduler.flush(0)
    expect(requestOverlayRepaint).toHaveBeenCalledTimes(1)
    scheduler.flush(16)
    expect(requestOverlayRepaint).toHaveBeenCalledTimes(1)
    scheduler.flush(34)
    expect(requestOverlayRepaint).toHaveBeenCalledTimes(2)

    flash.dispose()
    expect(scheduler.pendingCount).toBe(0)
    expect(renderer.aiClearAll).toHaveBeenCalledTimes(1)
  } finally {
    scheduler.restore()
  }
})
