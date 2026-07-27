import { describe, expect, test } from 'bun:test'

import type { Editor, EditorEvents } from '@open-pencil/core/editor'

import { createCanvasRenderLoop } from '#vue/canvas/surface/render-loop'

type EditorEventName = keyof EditorEvents

type TestEditor = Pick<
  Editor,
  | 'state'
  | 'onEditorEvent'
  | 'isMotionPreviewActive'
  | 'updateMotionPreviewFrame'
  | 'stopMotionPreview'
>

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
      const pending = [...callbacks]
      callbacks.clear()
      for (const [, callback] of pending) callback(timestampMs)
    },
    restore() {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame
    }
  }
}

function createEditor() {
  const handlers = new Map<EditorEventName, Set<(...args: never[]) => void>>()
  let motionActive = false
  let motionResults: boolean[] = []
  const motionTimestamps: number[] = []
  let motionStops = 0
  const editor: TestEditor = {
    state: {
      loading: false,
      renderVersion: 0,
      selectedIds: new Set<string>()
    } as Editor['state'],
    onEditorEvent(event, handler) {
      const listeners = handlers.get(event) ?? new Set()
      listeners.add(handler as (...args: never[]) => void)
      handlers.set(event, listeners)
      return () => listeners.delete(handler as (...args: never[]) => void)
    },
    isMotionPreviewActive() {
      return motionActive
    },
    updateMotionPreviewFrame(timestampMs) {
      motionTimestamps.push(timestampMs)
      return motionResults.shift() ?? true
    },
    stopMotionPreview() {
      motionActive = false
      motionStops++
      for (const handler of handlers.get('repaint:requested') ?? []) handler()
    }
  }

  return {
    editor: editor as Editor,
    emit(event: EditorEventName) {
      for (const handler of handlers.get(event) ?? []) handler()
    },
    startMotion(results: boolean[]) {
      motionActive = true
      motionResults = [...results]
    },
    motionTimestamps,
    get motionStops() {
      return motionStops
    }
  }
}

describe('canvas render loop', () => {
  test('waits for editor events before scheduling renders', () => {
    const scheduler = createFrameScheduler()
    try {
      const { editor, emit } = createEditor()
      let renders = 0
      createCanvasRenderLoop(editor, () => {
        renders++
      })

      expect(scheduler.pendingCount).toBe(0)
      emit('repaint:requested')
      expect(scheduler.pendingCount).toBe(1)
      scheduler.flush()
      expect(renders).toBe(1)
      expect(scheduler.pendingCount).toBe(0)
    } finally {
      scheduler.restore()
    }
  })

  test('coalesces multiple editor events into one animation frame', () => {
    const scheduler = createFrameScheduler()
    try {
      const { editor, emit } = createEditor()
      let renders = 0
      createCanvasRenderLoop(editor, () => {
        renders++
      })

      emit('render:requested')
      emit('repaint:requested')
      emit('selection:changed')
      emit('viewport:changed')

      expect(scheduler.pendingCount).toBe(1)
      scheduler.flush()
      expect(renders).toBe(1)
    } finally {
      scheduler.restore()
    }
  })

  test('scene layers render on repaint but ignore selection events', () => {
    const scheduler = createFrameScheduler()
    try {
      const { editor, emit } = createEditor()
      let renders = 0
      createCanvasRenderLoop(
        editor,
        () => {
          renders++
        },
        { layer: 'scene' }
      )

      emit('selection:changed')
      expect(scheduler.pendingCount).toBe(0)

      emit('repaint:requested')
      expect(scheduler.pendingCount).toBe(1)
      scheduler.flush()
      expect(renders).toBe(1)
    } finally {
      scheduler.restore()
    }
  })

  test('overlay layers render on repaint and selection events', () => {
    const scheduler = createFrameScheduler()
    try {
      const { editor, emit } = createEditor()
      let renders = 0
      createCanvasRenderLoop(
        editor,
        () => {
          renders++
        },
        { layer: 'overlays' }
      )

      emit('repaint:requested')
      emit('selection:changed')
      expect(scheduler.pendingCount).toBe(1)
      scheduler.flush()
      expect(renders).toBe(1)
    } finally {
      scheduler.restore()
    }
  })

  test('coalesces multiple canvas surfaces into one animation frame', () => {
    const scheduler = createFrameScheduler()
    try {
      const { editor, emit } = createEditor()
      let sceneRenders = 0
      let overlayRenders = 0
      createCanvasRenderLoop(
        editor,
        () => {
          sceneRenders++
        },
        { layer: 'scene' }
      )
      createCanvasRenderLoop(
        editor,
        () => {
          overlayRenders++
        },
        { layer: 'overlays' }
      )

      emit('viewport:changed')
      expect(scheduler.pendingCount).toBe(1)
      scheduler.flush()
      expect(sceneRenders).toBe(1)
      expect(overlayRenders).toBe(1)
    } finally {
      scheduler.restore()
    }
  })

  test('cancels pending renders when paused', () => {
    const scheduler = createFrameScheduler()
    try {
      const { editor, emit } = createEditor()
      let renders = 0
      const loop = createCanvasRenderLoop(editor, () => {
        renders++
      })

      emit('render:requested')
      expect(scheduler.pendingCount).toBe(1)
      loop.pause()
      expect(scheduler.pendingCount).toBe(0)

      emit('render:requested')
      scheduler.flush()
      expect(renders).toBe(0)
    } finally {
      scheduler.restore()
    }
  })

  test('renders every active motion frame and clears finite playback after its final frame', () => {
    const scheduler = createFrameScheduler()
    try {
      const harness = createEditor()
      let renders = 0
      createCanvasRenderLoop(harness.editor, () => renders++)
      harness.startMotion([true, false])

      harness.emit('repaint:requested')
      scheduler.flush(1_000)
      expect(renders).toBe(1)
      expect(scheduler.pendingCount).toBe(1)

      scheduler.flush(1_016)
      expect(renders).toBe(2)
      expect(harness.motionStops).toBe(1)
      expect(harness.motionTimestamps).toEqual([1_000, 1_016])

      // stopMotionPreview requests one authored-state repaint after the final sampled frame.
      expect(scheduler.pendingCount).toBe(1)
      scheduler.flush(1_032)
      expect(renders).toBe(3)
      expect(scheduler.pendingCount).toBe(0)
    } finally {
      scheduler.restore()
    }
  })

  test('keeps overlay-only surfaces from advancing shared motion state', () => {
    const scheduler = createFrameScheduler()
    try {
      const harness = createEditor()
      let renders = 0
      createCanvasRenderLoop(harness.editor, () => renders++, { layer: 'overlays' })
      harness.startMotion([true])

      harness.emit('repaint:requested')
      scheduler.flush(500)

      expect(renders).toBe(1)
      expect(harness.motionTimestamps).toEqual([])
      expect(scheduler.pendingCount).toBe(0)
    } finally {
      scheduler.restore()
    }
  })
})
