import { afterEach, expect, mock, test } from 'bun:test'

import type { CanvasKit, Surface } from 'canvaskit-wasm'

import type { CanvasPerformanceMode } from '#core/canvas'
import type { SkiaRenderer } from '#core/canvas/renderer'
import type { Editor } from '#core/editor'
import { createCanvasSurfaceManager, surfaceRecoveryDelayMs } from '#vue/canvas/surface/lifecycle'

const originalWindow = globalThis.window

afterEach(() => {
  if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window')
  else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
})

test('surface recovery uses bounded exponential backoff delays', () => {
  expect([0, 1, 2, 3, 4, 8].map(surfaceRecoveryDelayMs)).toEqual([50, 100, 200, 400, 400, 400])
})

type FakeRenderer = SkiaRenderer & {
  hasLastGoodFrame: boolean
}

function installWindow() {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { devicePixelRatio: 1 }
  })
}

function createCanvas() {
  const canvas: Partial<HTMLCanvasElement> = {
    width: 0,
    height: 0,
    clientWidth: 640,
    clientHeight: 480,
    dataset: {} as DOMStringMap,
    getContext: mock(() => null)
  }
  return canvas as HTMLCanvasElement
}

function createEditor(events: string[]) {
  const editor: Partial<Editor> = {
    graph: { documentColorSpace: 'srgb' },
    state: {},
    textEditor: null,
    onEditorEvent: mock(() => () => undefined),
    setCanvasKit: mock(() => events.push('register')),
    removeCanvasRenderer: mock(() => events.push('remove')),
    setViewportSize: mock()
  }
  return editor as Editor
}

function createRenderer(name: string, events: string[]): FakeRenderer {
  const renderer: Partial<FakeRenderer> & { hasLastGoodFrame: boolean } = {
    hasLastGoodFrame: false,
    performanceMode: 'balanced',
    sceneBackingNeedsCrispRender: false,
    sceneBackingPreviewUntil: 0,
    setPerformanceMode: mock((mode: CanvasPerformanceMode) => {
      if (renderer.performanceMode === mode) return false
      renderer.performanceMode = mode
      return true
    }),
    transferLastGoodFrameTo: mock((target: FakeRenderer) => {
      events.push(`transfer:${name}`)
      if (!renderer.hasLastGoodFrame) return false
      renderer.hasLastGoodFrame = false
      target.hasLastGoodFrame = true
      return true
    }),
    recoverLastGoodFrame: mock(() => {
      events.push(`recover:${name}`)
      return renderer.hasLastGoodFrame
    }),
    destroy: mock(() => events.push(`destroy:${name}`)),
    loadFonts: mock(async () => undefined),
    renderFromEditorState: mock()
  }
  return renderer as FakeRenderer
}

function createSurface() {
  const surface: Partial<Surface> = { delete: mock() }
  return surface as Surface
}

test('renderer recreation presents the transferred last-good frame before destroying its owner', () => {
  installWindow()
  const events: string[] = []
  const canvas = createCanvas()
  const editor = createEditor(events)
  const renderers = [createRenderer('old', events), createRenderer('next', events)]
  const glContext = { delete: mock() }
  const manager = createCanvasSurfaceManager({
    editor,
    canvasRef: { value: canvas },
    options: { layer: 'scene' },
    getCanvasKit: () => ({}) as CanvasKit,
    isDestroyed: () => false,
    shouldShowRulers: () => false,
    dependencies: {
      makeSurface: mock(() => {
        events.push('make-surface')
        return { surface: createSurface(), glContext }
      }),
      makeRenderer: mock(() => renderers.shift() as FakeRenderer)
    }
  })

  expect(manager.createSurface(canvas)).toBe(true)
  const oldRenderer = manager.getRenderer() as FakeRenderer
  oldRenderer.hasLastGoodFrame = true
  events.length = 0

  expect(manager.createSurface(canvas)).toBe(true)
  expect(events).toEqual([
    'make-surface',
    'register',
    'transfer:old',
    'recover:next',
    'remove',
    'destroy:old'
  ])
  expect((manager.getRenderer() as FakeRenderer).hasLastGoodFrame).toBe(true)
  expect(oldRenderer.destroy).toHaveBeenCalledTimes(1)

  manager.destroy()
})

test('failed surface recreation keeps the old renderer and re-presents its frame', () => {
  installWindow()
  const events: string[] = []
  const canvas = createCanvas()
  const editor = createEditor(events)
  const oldRenderer = createRenderer('old', events)
  const glContext = { delete: mock() }
  let failRecreation = false
  const manager = createCanvasSurfaceManager({
    editor,
    canvasRef: { value: canvas },
    options: { layer: 'scene' },
    getCanvasKit: () => ({}) as CanvasKit,
    isDestroyed: () => false,
    shouldShowRulers: () => false,
    dependencies: {
      makeSurface: mock(() => ({
        surface: failRecreation ? null : createSurface(),
        glContext
      })),
      makeRenderer: mock(() => oldRenderer)
    }
  })

  expect(manager.createSurface(canvas)).toBe(true)
  oldRenderer.hasLastGoodFrame = true
  failRecreation = true

  expect(manager.createSurface(canvas)).toBe(false)
  expect(manager.getRenderer()).toBe(oldRenderer)
  expect(oldRenderer.recoverLastGoodFrame).toHaveBeenCalledTimes(1)
  expect(oldRenderer.destroy).not.toHaveBeenCalled()

  manager.destroy()
})

test('direct renders wait until the editor loading lease is released', () => {
  installWindow()
  const events: string[] = []
  const canvas = createCanvas()
  const editor = createEditor(events)
  editor.state.loading = true
  const renderer = createRenderer('loading', events)
  const manager = createCanvasSurfaceManager({
    editor,
    canvasRef: { value: canvas },
    options: { layer: 'scene' },
    getCanvasKit: () => ({}) as CanvasKit,
    isDestroyed: () => false,
    shouldShowRulers: () => false,
    dependencies: {
      makeSurface: mock(() => ({ surface: createSurface(), glContext: null })),
      makeRenderer: mock(() => renderer)
    }
  })

  expect(manager.createSurface(canvas)).toBe(true)
  expect(manager.renderNow()).toBe(false)
  expect(renderer.renderFromEditorState).not.toHaveBeenCalled()

  editor.state.loading = false
  expect(manager.renderNow()).toBe(true)
  expect(renderer.renderFromEditorState).toHaveBeenCalledTimes(1)

  manager.destroy()
})

test('performance mode changes update the live renderer without recreating its surface', () => {
  installWindow()
  const events: string[] = []
  const canvas = createCanvas()
  const editor = createEditor(events)
  editor.state.loading = true
  const renderer = createRenderer('performance', events)
  const makeSurface = mock(() => ({ surface: createSurface(), glContext: null }))
  const makeRenderer = mock(() => renderer)
  const manager = createCanvasSurfaceManager({
    editor,
    canvasRef: { value: canvas },
    options: { layer: 'scene' },
    performanceMode: 'balanced',
    getCanvasKit: () => ({}) as CanvasKit,
    isDestroyed: () => false,
    shouldShowRulers: () => false,
    dependencies: { makeSurface, makeRenderer }
  })

  expect(manager.createSurface(canvas)).toBe(true)
  expect(renderer.setPerformanceMode).toHaveBeenLastCalledWith('balanced')

  manager.setPerformanceMode('smooth')
  expect(renderer.setPerformanceMode).toHaveBeenLastCalledWith('smooth')
  expect(renderer.performanceMode).toBe('smooth')
  expect(makeSurface).toHaveBeenCalledTimes(1)
  expect(makeRenderer).toHaveBeenCalledTimes(1)

  manager.destroy()
})
