import type { CanvasKit } from 'canvaskit-wasm'
import { watch, type Ref } from 'vue'

import {
  normalizeCanvasPerformanceMode,
  type CanvasPerformanceMode
} from '@open-pencil/core/canvas'
import type { Editor } from '@open-pencil/core/editor'

import {
  createCanvasSurfaceManager,
  useCanvasSurfaceLifecycle
} from '#vue/canvas/surface/lifecycle'
import { createCanvasHitTests, createRulerVisibility } from '#vue/canvas/surface/overlays'
import type { UseCanvasOptions } from '#vue/canvas/surface/types'

export type { CanvasActiveFrameSample, UseCanvasOptions } from '#vue/canvas/surface/types'

function readPerformanceMode(options: UseCanvasOptions | undefined): CanvasPerformanceMode {
  const source = options?.performanceMode
  return normalizeCanvasPerformanceMode(typeof source === 'function' ? source() : source)
}

/**
 * Connects an OpenPencil editor to a real canvas element using CanvasKit.
 *
 * This composable owns renderer creation, surface recreation on resize,
 * render scheduling, and renderer-backed hit testing helpers used by higher-
 * level canvas interaction code.
 */
export function useCanvas(
  canvasRef: Ref<HTMLCanvasElement | null>,
  editor: Editor,
  options?: UseCanvasOptions
) {
  let ck: CanvasKit | null = null
  const lifecycle: { destroyed: boolean } = { destroyed: false }
  const isDestroyed = () => lifecycle.destroyed
  const shouldShowRulers = createRulerVisibility(options)
  const initialPerformanceMode = readPerformanceMode(options)

  const surface = createCanvasSurfaceManager({
    editor,
    canvasRef,
    options,
    getCanvasKit: () => ck,
    isDestroyed,
    shouldShowRulers,
    performanceMode: initialPerformanceMode
  })

  watch(
    () => readPerformanceMode(options),
    (mode) => surface.setPerformanceMode(mode),
    { flush: 'sync' }
  )

  useCanvasSurfaceLifecycle({
    canvasRef,
    surface,
    lifecycle,
    getCanvasKitValue: () => ck,
    setCanvasKit: (value) => {
      ck = value
    },
    onReady: options?.onReady
  })

  const { hitTestSectionTitle, hitTestComponentLabel, hitTestFrameTitle } = createCanvasHitTests(
    editor,
    surface.getRenderer
  )

  return {
    render: surface.markDirty,
    renderNow: surface.renderNow,
    hitTestSectionTitle,
    hitTestComponentLabel,
    hitTestFrameTitle
  }
}
