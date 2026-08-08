import { describe, expect, test } from 'bun:test'

import type { Editor, EditorEvents } from '@open-pencil/core/editor'
import { SceneGraph } from '@open-pencil/scene-graph'

import { createCanvasRenderLoop } from '#vue/canvas/surface/render-loop'

import { generatedEffect } from '#tests/helpers/generated-effect'

type EditorEventName = keyof EditorEvents

type TestEditor = Pick<
  Editor,
  | 'state'
  | 'graph'
  | 'onEditorEvent'
  | 'isMotionPreviewActive'
  | 'updateMotionPreviewFrame'
  | 'stopMotionPreview'
>

function createFrameScheduler() {
  let nextId = 1
  const callbacks = new Map<number, FrameRequestCallback>()
  const timers = new Map<number, { callback: () => void; delay: number }>()
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout

  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const id = nextId++
    callbacks.set(id, callback)
    return id
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = ((id: number) => {
    callbacks.delete(id)
  }) as typeof cancelAnimationFrame
  globalThis.setTimeout = ((callback: () => void, delay = 0) => {
    const id = nextId++
    timers.set(id, { callback, delay: Number(delay) })
    return id
  }) as typeof setTimeout
  globalThis.clearTimeout = ((id: number) => {
    timers.delete(id)
  }) as typeof clearTimeout

  return {
    get pendingCount() {
      return callbacks.size
    },
    get timerCount() {
      return timers.size
    },
    get nextTimerDelay() {
      return timers.values().next().value?.delay as number | undefined
    },
    flush(timestampMs = 0) {
      const pending = [...callbacks]
      callbacks.clear()
      for (const [, callback] of pending) callback(timestampMs)
    },
    flushTimers() {
      const pending = [...timers.values()]
      timers.clear()
      for (const { callback } of pending) callback()
    },
    restore() {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
    }
  }
}

function createReducedMotionQuery(initial = false) {
  let matches = initial
  type ChangeListener = (this: MediaQueryList, event: MediaQueryListEvent) => unknown
  const listeners = new Set<ChangeListener>()
  const listenerObjects = new Set<EventListenerObject>()
  const originalMatchMedia = globalThis.matchMedia
  const query: MediaQueryList = {
    get matches() {
      return matches
    },
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addListener(listener) {
      if (listener) listeners.add(listener)
    },
    removeListener(listener) {
      if (listener) listeners.delete(listener)
    },
    addEventListener(type, listener) {
      if (type !== 'change') return
      if (typeof listener === 'function') listeners.add(listener)
      else listenerObjects.add(listener)
    },
    removeEventListener(type, listener) {
      if (type !== 'change') return
      if (typeof listener === 'function') listeners.delete(listener)
      else listenerObjects.delete(listener)
    },
    dispatchEvent(event) {
      const change = event as MediaQueryListEvent
      for (const listener of listeners) listener.call(query, change)
      for (const listener of listenerObjects) listener.handleEvent(change)
      query.onchange?.(change)
      return true
    }
  }
  globalThis.matchMedia = () => query
  return {
    get listenerCount() {
      return listeners.size + listenerObjects.size
    },
    set(next: boolean) {
      matches = next
      const event = Object.assign(new Event('change'), {
        matches,
        media: query.media
      }) as MediaQueryListEvent
      query.dispatchEvent(event)
    },
    restore() {
      globalThis.matchMedia = originalMatchMedia
    }
  }
}

function createEditor() {
  const handlers = new Map<EditorEventName, Set<(...args: never[]) => void>>()
  let motionActive = false
  let motionResults: boolean[] = []
  const motionTimestamps: number[] = []
  let motionStops = 0
  const graph = new SceneGraph()
  const currentPageId = graph.getPages()[0].id
  const editor: TestEditor = {
    graph,
    state: {
      loading: false,
      renderVersion: 0,
      sceneVersion: 0,
      selectedIds: new Set<string>(),
      currentPageId
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
    graph,
    emit(event: EditorEventName) {
      if (event === 'render:requested') {
        editor.state.renderVersion++
        editor.state.sceneVersion++
      } else if (event === 'repaint:requested') {
        editor.state.renderVersion++
      }
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
      emit('overlay:requested')
      emit('selection:changed')
      emit('viewport:changed')

      expect(scheduler.pendingCount).toBe(1)
      scheduler.flush()
      expect(renders).toBe(1)
    } finally {
      scheduler.restore()
    }
  })

  test('sleeps while loading and resumes on the completion render request', () => {
    const scheduler = createFrameScheduler()
    try {
      const { editor, emit } = createEditor()
      let renders = 0
      createCanvasRenderLoop(editor, () => {
        renders++
      })

      editor.state.loading = true
      emit('render:requested')
      expect(scheduler.pendingCount).toBe(0)
      scheduler.flush()
      expect(renders).toBe(0)
      expect(scheduler.pendingCount).toBe(0)

      editor.state.loading = false
      emit('render:requested')
      scheduler.flush()
      expect(renders).toBe(1)
      expect(scheduler.pendingCount).toBe(0)
    } finally {
      scheduler.restore()
    }
  })

  test('scene layers render on repaint but ignore selection and overlay-only events', () => {
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
      emit('overlay:requested')
      expect(scheduler.pendingCount).toBe(0)

      emit('repaint:requested')
      expect(scheduler.pendingCount).toBe(1)
      scheduler.flush()
      expect(renders).toBe(1)
    } finally {
      scheduler.restore()
    }
  })

  test('overlay layers render on repaint, overlay-only, and selection events', () => {
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
      emit('overlay:requested')
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

  test('reports active scene timing without counting idle or overlay-only frames', () => {
    const scheduler = createFrameScheduler()
    try {
      const { editor, emit } = createEditor()
      const sceneSamples: Array<{ timestampMs: number; frameIntervalMs?: number }> = []
      const overlaySamples: Array<{ timestampMs: number }> = []
      const sceneLoop = createCanvasRenderLoop(editor, () => true, {
        layer: 'scene',
        onActiveFrameSample: (sample) => sceneSamples.push(sample)
      })
      createCanvasRenderLoop(editor, () => true, {
        layer: 'overlays',
        onActiveFrameSample: (sample) => overlaySamples.push(sample)
      })

      emit('viewport:changed')
      scheduler.flush(16)
      expect(sceneSamples).toHaveLength(1)
      expect(sceneSamples[0]?.timestampMs).toBe(16)
      expect(sceneSamples[0]?.frameIntervalMs).toBeUndefined()
      expect(overlaySamples).toEqual([])

      // A lifecycle-driven redraw remains observable but is not an interaction sample.
      sceneLoop.markDirty()
      scheduler.flush(1_000)
      expect(sceneSamples).toHaveLength(1)

      emit('render:requested')
      scheduler.flush(1_016)
      emit('render:requested')
      scheduler.flush(1_032)
      expect(sceneSamples.at(-2)?.frameIntervalMs).toBeUndefined()
      expect(sceneSamples.at(-1)?.frameIntervalMs).toBe(16)
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

  test('only visible generated effects on the current page keep scheduling frames', () => {
    const scheduler = createFrameScheduler()
    const media = createReducedMotionQuery()
    try {
      const harness = createEditor()
      const otherPage = harness.graph.addPage('Hidden page')
      harness.graph.createNode('RECTANGLE', otherPage.id, {
        width: 100,
        height: 100,
        generatedEffect: generatedEffect()
      })
      const hiddenParent = harness.graph.createNode('FRAME', harness.editor.state.currentPageId, {
        visible: false,
        width: 100,
        height: 100
      })
      harness.graph.createNode('RECTANGLE', hiddenParent.id, {
        width: 100,
        height: 100,
        generatedEffect: generatedEffect()
      })
      let renders = 0
      const loop = createCanvasRenderLoop(harness.editor, () => renders++)

      harness.emit('repaint:requested')
      scheduler.flush()
      expect(renders).toBe(1)
      expect(scheduler.pendingCount).toBe(0)

      const visible = harness.graph.createNode('RECTANGLE', harness.editor.state.currentPageId, {
        width: 100,
        height: 100,
        generatedEffect: generatedEffect()
      })
      harness.emit('render:requested')
      scheduler.flush()
      expect(renders).toBe(2)
      expect(scheduler.pendingCount).toBe(0)
      expect(scheduler.timerCount).toBe(1)

      harness.graph.updateNode(visible.id, { width: 0 })
      harness.emit('render:requested')
      scheduler.flush()
      expect(renders).toBe(3)
      expect(scheduler.pendingCount).toBe(0)
      expect(scheduler.timerCount).toBe(0)

      loop.pause()
    } finally {
      media.restore()
      scheduler.restore()
    }
  })

  test('renders smooth generated effects near 30fps independently of phase frequency', () => {
    const scheduler = createFrameScheduler()
    const media = createReducedMotionQuery()
    try {
      const harness = createEditor()
      harness.graph.createNode('RECTANGLE', harness.editor.state.currentPageId, {
        width: 100,
        height: 100,
        generatedEffect: generatedEffect('shimmer')
      })
      const getNode = harness.graph.getNode.bind(harness.graph)
      let graphReads = 0
      harness.graph.getNode = ((id: string) => {
        graphReads++
        return getNode(id)
      }) as SceneGraph['getNode']
      let renders = 0
      const loop = createCanvasRenderLoop(harness.editor, () => renders++)

      harness.emit('render:requested')
      scheduler.flush(0)
      expect(renders).toBe(1)
      expect(scheduler.pendingCount).toBe(0)
      expect(scheduler.timerCount).toBe(1)
      expect(scheduler.nextTimerDelay).toBeCloseTo(1000 / 30)
      const firstFrameGraphReads = graphReads

      scheduler.flushTimers()
      expect(scheduler.pendingCount).toBe(1)
      scheduler.flush(34)
      expect(renders).toBe(2)
      expect(scheduler.timerCount).toBe(1)
      expect(graphReads).toBe(firstFrameGraphReads)

      harness.emit('render:requested')
      scheduler.flush(68)
      expect(graphReads).toBeGreaterThan(firstFrameGraphReads)

      loop.pause()
    } finally {
      media.restore()
      scheduler.restore()
    }
  })

  test('resource-saving mode limits smooth generated effects to 15fps', () => {
    const scheduler = createFrameScheduler()
    const media = createReducedMotionQuery()
    try {
      const harness = createEditor()
      harness.graph.createNode('RECTANGLE', harness.editor.state.currentPageId, {
        width: 100,
        height: 100,
        generatedEffect: generatedEffect('shimmer')
      })
      const samples: Array<{ frameIntervalMs?: number }> = []
      const loop = createCanvasRenderLoop(harness.editor, () => true, {
        performanceMode: 'resource-saving',
        onActiveFrameSample: (sample) => samples.push(sample)
      })

      harness.emit('render:requested')
      scheduler.flush(0)
      expect(scheduler.pendingCount).toBe(0)
      expect(scheduler.timerCount).toBe(1)
      expect(scheduler.nextTimerDelay).toBeCloseTo(1000 / 15)

      scheduler.flushTimers()
      scheduler.flush(1000 / 15)
      expect(samples).toHaveLength(2)
      expect(samples.every((sample) => sample.frameIntervalMs === undefined)).toBe(true)

      loop.pause()
    } finally {
      media.restore()
      scheduler.restore()
    }
  })

  test('hot mode changes clear the previous effect timer and apply the new cadence immediately', () => {
    const scheduler = createFrameScheduler()
    const media = createReducedMotionQuery()
    try {
      const harness = createEditor()
      harness.graph.createNode('RECTANGLE', harness.editor.state.currentPageId, {
        width: 100,
        height: 100,
        generatedEffect: generatedEffect('shimmer')
      })
      let renders = 0
      const loop = createCanvasRenderLoop(harness.editor, () => renders++)

      harness.emit('render:requested')
      scheduler.flush(0)
      expect(renders).toBe(1)
      expect(scheduler.nextTimerDelay).toBeCloseTo(1000 / 30)

      loop.setPerformanceMode('resource-saving')
      expect(scheduler.timerCount).toBe(0)
      expect(scheduler.pendingCount).toBe(1)
      scheduler.flush(16)
      expect(renders).toBe(2)
      expect(scheduler.nextTimerDelay).toBeCloseTo(1000 / 15)

      loop.setPerformanceMode('smooth')
      expect(scheduler.timerCount).toBe(0)
      scheduler.flush(32)
      expect(renders).toBe(3)
      expect(scheduler.timerCount).toBe(0)
      expect(scheduler.pendingCount).toBe(1)
      scheduler.flush(48)
      expect(renders).toBe(4)
      expect(scheduler.pendingCount).toBe(1)

      loop.setPerformanceMode('balanced')
      scheduler.flush(64)
      expect(renders).toBe(5)
      expect(scheduler.pendingCount).toBe(0)
      expect(scheduler.nextTimerDelay).toBeCloseTo(1000 / 30)

      loop.pause()
    } finally {
      media.restore()
      scheduler.restore()
    }
  })

  test('smooth mode keeps noise discrete and caps its independent redraw timer at 60fps', () => {
    const scheduler = createFrameScheduler()
    const media = createReducedMotionQuery()
    try {
      const harness = createEditor()
      const effect = generatedEffect('noise')
      effect.uniforms.time.frequencyHz = 12
      effect.uniforms.time.scale = 8
      harness.graph.createNode('RECTANGLE', harness.editor.state.currentPageId, {
        width: 100,
        height: 100,
        generatedEffect: effect
      })
      const loop = createCanvasRenderLoop(harness.editor, () => true, {
        performanceMode: 'smooth'
      })

      harness.emit('render:requested')
      scheduler.flush(0)
      expect(scheduler.pendingCount).toBe(0)
      expect(scheduler.timerCount).toBe(1)
      expect(scheduler.nextTimerDelay).toBeCloseTo(1000 / 60)

      loop.pause()
    } finally {
      media.restore()
      scheduler.restore()
    }
  })

  test('uses authored temporal frequency only as the cadence for discrete noise', () => {
    const scheduler = createFrameScheduler()
    const media = createReducedMotionQuery()
    try {
      const harness = createEditor()
      harness.graph.createNode('RECTANGLE', harness.editor.state.currentPageId, {
        width: 100,
        height: 100,
        generatedEffect: generatedEffect('noise')
      })
      const loop = createCanvasRenderLoop(harness.editor, () => true)

      harness.emit('render:requested')
      scheduler.flush(0)
      expect(scheduler.nextTimerDelay).toBeCloseTo(1000 / 6)

      loop.pause()
    } finally {
      media.restore()
      scheduler.restore()
    }
  })

  test('retries transient render failures without leaving the loop permanently dirty', () => {
    const scheduler = createFrameScheduler()
    try {
      const { editor, emit } = createEditor()
      let attempts = 0
      createCanvasRenderLoop(editor, () => {
        attempts++
        return attempts >= 3
      })

      emit('render:requested')
      scheduler.flush(0)
      expect(attempts).toBe(1)
      expect(scheduler.pendingCount).toBe(1)

      scheduler.flush(16)
      expect(attempts).toBe(2)
      expect(scheduler.pendingCount).toBe(1)

      scheduler.flush(32)
      expect(attempts).toBe(3)
      expect(scheduler.pendingCount).toBe(0)
    } finally {
      scheduler.restore()
    }
  })

  test('does not reset the retry budget merely because another event arrives', () => {
    const scheduler = createFrameScheduler()
    try {
      const { editor, emit } = createEditor()
      let attempts = 0
      let succeed = false
      createCanvasRenderLoop(editor, () => {
        attempts++
        return succeed
      })

      emit('render:requested')
      scheduler.flush(0)
      scheduler.flush(16)
      scheduler.flush(32)
      expect(attempts).toBe(3)
      expect(scheduler.pendingCount).toBe(0)

      emit('repaint:requested')
      scheduler.flush(48)
      expect(attempts).toBe(4)
      expect(scheduler.pendingCount).toBe(0)

      succeed = true
      emit('repaint:requested')
      scheduler.flush(64)
      expect(attempts).toBe(5)

      succeed = false
      emit('repaint:requested')
      scheduler.flush(80)
      expect(scheduler.pendingCount).toBe(1)
    } finally {
      scheduler.restore()
    }
  })

  test('isolates shared RAF callbacks when one surface throws before rendering', () => {
    const scheduler = createFrameScheduler()
    const originalConsoleError = console.error
    console.error = () => undefined
    try {
      const harness = createEditor()
      let checks = 0
      harness.editor.isMotionPreviewActive = () => {
        checks++
        if (checks === 1) throw new Error('broken surface')
        return false
      }
      let healthyRenders = 0
      createCanvasRenderLoop(harness.editor, () => true, { layer: 'scene' })
      createCanvasRenderLoop(harness.editor, () => {
        healthyRenders++
      })

      harness.emit('render:requested')
      scheduler.flush(0)
      expect(healthyRenders).toBe(1)
    } finally {
      console.error = originalConsoleError
      scheduler.restore()
    }
  })

  test('reduced-motion changes repaint a static frame, resume animation, and clean up', () => {
    const scheduler = createFrameScheduler()
    const media = createReducedMotionQuery()
    try {
      const harness = createEditor()
      harness.graph.createNode('RECTANGLE', harness.editor.state.currentPageId, {
        width: 100,
        height: 100,
        generatedEffect: generatedEffect()
      })
      let renders = 0
      const loop = createCanvasRenderLoop(harness.editor, () => renders++)
      expect(media.listenerCount).toBe(1)

      harness.emit('repaint:requested')
      scheduler.flush()
      expect(renders).toBe(1)
      expect(scheduler.timerCount).toBe(1)

      media.set(true)
      scheduler.flush()
      expect(renders).toBe(2)
      expect(scheduler.pendingCount).toBe(0)
      expect(scheduler.timerCount).toBe(0)

      media.set(false)
      expect(scheduler.pendingCount).toBe(1)
      scheduler.flush()
      expect(renders).toBe(3)
      expect(scheduler.timerCount).toBe(1)

      loop.pause()
      expect(scheduler.pendingCount).toBe(0)
      expect(scheduler.timerCount).toBe(0)
      expect(media.listenerCount).toBe(0)
      media.set(true)
      expect(scheduler.pendingCount).toBe(0)
    } finally {
      media.restore()
      scheduler.restore()
    }
  })
})
