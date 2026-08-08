import type { CanvasKit, Surface } from 'canvaskit-wasm'
import { onMounted, onScopeDispose } from 'vue'
import type { Ref } from 'vue'

import {
  DEFAULT_CANVAS_PERFORMANCE_MODE,
  SkiaRenderer,
  normalizeCanvasPerformanceMode,
  type CanvasPerformanceMode
} from '@open-pencil/core/canvas'
import type { Editor } from '@open-pencil/core/editor'

import { makeGLSurface, sizeCanvas, type CanvasGLContext } from '#vue/canvas/surface/gl-surface'
import { useCanvasKitLoader } from '#vue/canvas/surface/kit-loader'
import { createCanvasRenderLoop } from '#vue/canvas/surface/render-loop'
import { useCanvasResizeObserver } from '#vue/canvas/surface/resize-observer'
import type { UseCanvasOptions } from '#vue/canvas/surface/types'

type SurfaceManagerState = {
  renderer: SkiaRenderer | null
  glContext: CanvasGLContext | null
  contextLost: boolean
}

const MAX_SURFACE_RECOVERY_ATTEMPTS = 4
const SURFACE_RECOVERY_BASE_DELAY_MS = 50

export function surfaceRecoveryDelayMs(attempt: number): number {
  return SURFACE_RECOVERY_BASE_DELAY_MS * 2 ** Math.min(Math.max(0, attempt), 3)
}

export function createCanvasSurfaceManager({
  editor,
  canvasRef,
  options,
  getCanvasKit,
  isDestroyed,
  shouldShowRulers,
  performanceMode: initialPerformanceMode = DEFAULT_CANVAS_PERFORMANCE_MODE,
  dependencies
}: {
  editor: Editor
  canvasRef: { value: HTMLCanvasElement | null }
  options: UseCanvasOptions | undefined
  getCanvasKit: () => CanvasKit | null
  isDestroyed: () => boolean
  shouldShowRulers: () => boolean
  performanceMode?: CanvasPerformanceMode
  dependencies?: {
    makeSurface?: typeof makeGLSurface
    makeRenderer?: (
      ck: CanvasKit,
      surface: Surface,
      gl: WebGL2RenderingContext | null
    ) => SkiaRenderer
  }
}) {
  const state: SurfaceManagerState = { renderer: null, glContext: null, contextLost: false }
  const createGLSurface = dependencies?.makeSurface ?? makeGLSurface
  const createRenderer =
    dependencies?.makeRenderer ??
    ((ck, surface, gl) => {
      return new SkiaRenderer(ck, surface, gl)
    })
  let sceneBackingRenderTimer: ReturnType<typeof setTimeout> | null = null
  let surfaceRecoveryTimer: ReturnType<typeof setTimeout> | null = null
  let surfaceRecoveryAttempts = 0
  let performanceMode = normalizeCanvasPerformanceMode(initialPerformanceMode)

  function clearSceneBackingRenderTimer() {
    if (sceneBackingRenderTimer === null) return
    clearTimeout(sceneBackingRenderTimer)
    sceneBackingRenderTimer = null
  }

  function clearSurfaceRecoveryTimer() {
    if (surfaceRecoveryTimer === null) return
    clearTimeout(surfaceRecoveryTimer)
    surfaceRecoveryTimer = null
  }

  function reportSurfaceFailure(
    canvas: HTMLCanvasElement,
    previousRenderer: SkiaRenderer | null,
    message: string,
    error?: unknown
  ): null {
    if (error === undefined) console.warn(message)
    else console.warn(message, error)
    canvas.dataset.surfaceError = 'webgl'
    previousRenderer?.recoverLastGoodFrame(options?.layer ?? 'full')
    return null
  }

  function makeReplacementSurface(
    ck: CanvasKit,
    canvas: HTMLCanvasElement,
    previousRenderer: SkiaRenderer | null
  ): Surface | null {
    try {
      // Reuse the live GrContext so the completed backing image remains valid until the
      // replacement presents its first frame. Context-loss recovery performs an explicit hard
      // reset below because GPU resources are invalid in that path anyway.
      const result = createGLSurface(ck, canvas, editor, options, state.glContext)
      state.glContext = result.glContext
      return (
        result.surface ??
        reportSurfaceFailure(canvas, previousRenderer, 'CanvasKit surface recreation failed')
      )
    } catch (error) {
      return reportSurfaceFailure(
        canvas,
        previousRenderer,
        'CanvasKit surface recreation failed',
        error
      )
    }
  }

  function makeReplacementRenderer(
    ck: CanvasKit,
    surface: Surface,
    canvas: HTMLCanvasElement,
    previousRenderer: SkiaRenderer | null
  ): SkiaRenderer | null {
    try {
      const renderer = createRenderer(ck, surface, canvas.getContext('webgl2') ?? null)
      renderer.setPerformanceMode(performanceMode)
      return renderer
    } catch (error) {
      surface.delete()
      return reportSurfaceFailure(
        canvas,
        previousRenderer,
        'CanvasKit renderer recreation failed',
        error
      )
    }
  }

  function registerReplacementRenderer(
    ck: CanvasKit,
    renderer: SkiaRenderer,
    canvas: HTMLCanvasElement,
    previousRenderer: SkiaRenderer | null
  ): boolean {
    try {
      editor.setCanvasKit(ck, renderer)
      return true
    } catch (error) {
      editor.removeCanvasRenderer(renderer)
      try {
        renderer.destroy()
      } catch (cleanupError) {
        console.warn('Failed CanvasKit renderer cleanup failed', cleanupError)
      }
      reportSurfaceFailure(
        canvas,
        previousRenderer,
        'CanvasKit renderer registration failed',
        error
      )
      return false
    }
  }

  function retirePreviousRenderer(previousRenderer: SkiaRenderer | null): void {
    if (!previousRenderer) return
    editor.removeCanvasRenderer(previousRenderer)
    try {
      previousRenderer.destroy()
    } catch (error) {
      console.warn('Previous CanvasKit renderer cleanup failed', error)
    }
  }

  function reloadRendererFonts(renderer: SkiaRenderer): void {
    if (isDestroyed()) return
    void renderer.loadFonts(renderNow).then(() => {
      if (!isDestroyed() && state.renderer === renderer) renderNow()
      return undefined
    })
  }

  function createSurface(
    canvas: HTMLCanvasElement,
    { reloadFonts = false }: { reloadFonts?: boolean } = {}
  ): boolean {
    const ck = getCanvasKit()
    if (!ck) return false

    const previousRenderer = state.renderer

    sizeCanvas(canvas, editor)
    const surface = makeReplacementSurface(ck, canvas, previousRenderer)
    if (!surface) return false
    const renderer = makeReplacementRenderer(ck, surface, canvas, previousRenderer)
    if (!renderer || !registerReplacementRenderer(ck, renderer, canvas, previousRenderer)) {
      return false
    }

    // Ownership is moved only after the replacement renderer is fully constructed and registered.
    // Present the handoff before destroying the old renderer, so even repeated first-frame
    // failures retain a visible scene rather than clearing the canvas.
    const transferredFrame = previousRenderer?.transferLastGoodFrameTo(renderer) ?? false
    if (transferredFrame) renderer.recoverLastGoodFrame(options?.layer ?? 'full')

    state.renderer = renderer
    retirePreviousRenderer(previousRenderer)
    canvas.dataset.ready = '1'
    delete canvas.dataset.surfaceError

    // When the surface is recreated after a resize fallback, destroyRenderer
    // has cleared the module-level fontProvider — the new renderer must reload.
    // On initial mount, kit-loader.init() handles loadFonts, so skip here.
    if (reloadFonts) reloadRendererFonts(renderer)
    return true
  }

  function scheduleSurfaceRecovery() {
    const canvas = canvasRef.value
    if (
      !canvas ||
      state.contextLost ||
      isDestroyed() ||
      surfaceRecoveryAttempts >= MAX_SURFACE_RECOVERY_ATTEMPTS ||
      surfaceRecoveryTimer !== null
    ) {
      return
    }
    const delay = surfaceRecoveryDelayMs(surfaceRecoveryAttempts)
    surfaceRecoveryTimer = setTimeout(() => {
      surfaceRecoveryTimer = null
      if (state.contextLost || isDestroyed()) return
      surfaceRecoveryAttempts++
      if (createSurface(canvas, { reloadFonts: true })) {
        renderLoop.markDirty()
      } else {
        scheduleSurfaceRecovery()
      }
    }, delay)
  }

  function renderNow(): boolean {
    if (editor.state.loading) {
      // kit-loader and font reloads can call renderNow directly, outside the guarded RAF loop.
      // Keep the frame dirty; the loading lease's repaint event will schedule it once usable.
      renderLoop.markDirty()
      return false
    }
    const renderer = state.renderer
    const canvas = canvasRef.value
    if (!canvas || isDestroyed() || state.contextLost) return false
    if (!renderer) {
      scheduleSurfaceRecovery()
      return false
    }
    try {
      renderer.renderFromEditorState(
        editor.state,
        editor.graph,
        editor.textEditor,
        canvas.clientWidth,
        canvas.clientHeight,
        shouldShowRulers(),
        options?.layer ?? 'full'
      )
      renderLoop.markRendered()
      clearSceneBackingRenderTimer()
      clearSurfaceRecoveryTimer()
      surfaceRecoveryAttempts = 0
      delete canvas.dataset.surfaceError
      if (options?.layer === 'scene' && renderer.sceneBackingNeedsCrispRender) {
        const delay = Math.max(0, renderer.sceneBackingPreviewUntil - performance.now())
        sceneBackingRenderTimer = setTimeout(() => renderLoop.markDirty(), delay)
      }
      return true
    } catch (error) {
      console.error('CanvasKit render failed; restoring the last completed frame', error)
      canvas.dataset.surfaceError = 'render'
      renderer.recoverLastGoodFrame(options?.layer ?? 'full')
      // A retained frame keeps the UI visible, but it does not prove the
      // current CanvasKit surface is healthy.
      scheduleSurfaceRecovery()
      return false
    }
  }

  const renderLoop = createCanvasRenderLoop(editor, renderNow, {
    layer: options?.layer,
    performanceMode,
    onActiveFrameSample: options?.onActiveFrameSample
  })

  function setPerformanceMode(mode: CanvasPerformanceMode) {
    const normalized = normalizeCanvasPerformanceMode(mode)
    if (normalized === performanceMode) return
    performanceMode = normalized
    clearSceneBackingRenderTimer()
    state.renderer?.setPerformanceMode(normalized)
    renderLoop.setPerformanceMode(normalized)
  }

  function resizeCanvas(canvas: HTMLCanvasElement) {
    const ck = getCanvasKit()
    if (!ck || !state.renderer) {
      if (!createSurface(canvas)) scheduleSurfaceRecovery()
      return
    }

    sizeCanvas(canvas, editor)

    const surface = makeReplacementSurface(ck, canvas, state.renderer)
    if (!surface) {
      console.warn('Falling back to full surface recreation after resize')
      if (!createSurface(canvas, { reloadFonts: true })) scheduleSurfaceRecovery()
      return
    }
    state.renderer.replaceSurface(surface)
    renderNow()
  }

  function handleContextLost(event: Event) {
    event.preventDefault()
    state.contextLost = true
    clearSceneBackingRenderTimer()
    clearSurfaceRecoveryTimer()
    renderLoop.suspend()
    const canvas = canvasRef.value
    if (canvas) canvas.dataset.surfaceError = 'context-lost'
  }

  function handleContextRestored() {
    const canvas = canvasRef.value
    if (!canvas || isDestroyed()) return
    // A restored WebGL context cannot safely reuse GPU images or surfaces from the lost context.
    // This is the sole hard-reset path; ordinary renderer/surface recovery keeps the last-good
    // frame alive through a same-context two-phase handoff.
    if (state.renderer) editor.removeCanvasRenderer(state.renderer)
    state.renderer?.destroy()
    state.renderer = null
    state.glContext?.delete()
    state.glContext = null
    state.contextLost = false
    surfaceRecoveryAttempts = 0
    if (!createSurface(canvas, { reloadFonts: true })) scheduleSurfaceRecovery()
    renderLoop.resume()
  }

  function destroy() {
    clearSceneBackingRenderTimer()
    clearSurfaceRecoveryTimer()
    renderLoop.pause()
    if (state.renderer) editor.removeCanvasRenderer(state.renderer)
    state.renderer?.destroy()
    state.glContext?.delete()
    state.renderer = null
    state.glContext = null
  }

  return {
    createSurface,
    resizeCanvas,
    renderNow,
    handleContextLost,
    handleContextRestored,
    destroy,
    setPerformanceMode,
    markDirty: renderLoop.markDirty,
    getRenderer: () => state.renderer
  }
}

export function useCanvasSurfaceLifecycle({
  canvasRef,
  surface,
  setCanvasKit,
  getCanvasKitValue,
  lifecycle,
  onReady
}: {
  canvasRef: Ref<HTMLCanvasElement | null>
  surface: ReturnType<typeof createCanvasSurfaceManager>
  setCanvasKit: (ck: CanvasKit | null) => void
  getCanvasKitValue: () => CanvasKit | null
  lifecycle: { destroyed: boolean }
  onReady?: () => void
}) {
  useCanvasKitLoader({
    canvasRef,
    lifecycle,
    setCanvasKit,
    createSurface: surface.createSurface,
    loadFonts: () => surface.getRenderer()?.loadFonts(surface.renderNow),
    renderNow: surface.renderNow,
    onReady
  })

  const { cancelResize } = useCanvasResizeObserver({
    canvasRef,
    getCanvasKitValue,
    resizeCanvas: surface.resizeCanvas
  })

  onMounted(() => {
    const canvas = canvasRef.value
    canvas?.addEventListener('webglcontextlost', surface.handleContextLost)
    canvas?.addEventListener('webglcontextrestored', surface.handleContextRestored)
  })

  onScopeDispose(() => {
    lifecycle.destroyed = true
    cancelResize()
    const canvas = canvasRef.value
    canvas?.removeEventListener('webglcontextlost', surface.handleContextLost)
    canvas?.removeEventListener('webglcontextrestored', surface.handleContextRestored)
    surface.destroy()
  })
}
