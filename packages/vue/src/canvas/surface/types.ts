import type { CanvasPerformanceMode } from '@open-pencil/core/canvas'
import type { EditorState } from '@open-pencil/core/editor'

/**
 * Options for {@link useCanvas}.
 */
export type CanvasRenderLayer = 'full' | 'scene' | 'overlays'

export type CanvasPerformanceModeSource =
  | CanvasPerformanceMode
  | (() => CanvasPerformanceMode | undefined)

export interface CanvasActiveFrameSample {
  /** requestAnimationFrame timestamp for the active render. */
  timestampMs: number
  /** Synchronous scene render and flush duration. */
  renderDurationMs: number
  /** Interval from the previous active frame; omitted after idle gaps. */
  frameIntervalMs?: number
}

export interface UseCanvasOptions {
  /**
   * Selects which render layer this canvas owns.
   */
  layer?: CanvasRenderLayer
  /**
   * Forces ruler visibility on or off for this canvas.
   *
   * When omitted, the composable falls back to viewport and URL-param logic.
   */
  showRulers?: boolean
  /**
   * Keeps the drawing buffer after presenting frames.
   *
   * Useful for screenshot or pixel-readback workflows, but may increase memory
   * usage depending on the browser and GPU backend.
   */
  preserveDrawingBuffer?: boolean
  /**
   * Selects the canvas resource/animation policy. A getter is observed at runtime,
   * so changing an application preference does not require recreating the surface.
   */
  performanceMode?: CanvasPerformanceModeSource
  /**
   * Receives lightweight timing samples only for active scene frames. Static/idle frames and
   * overlay-only surfaces are excluded so application-level adaptive policies do not mistake an
   * idle gap for a dropped frame.
   */
  onActiveFrameSample?: (sample: CanvasActiveFrameSample) => void
  /**
   * Called once the rendering surface is ready.
   */
  onReady?: () => void
  /**
   * Supplies the view state rendered by this canvas. Defaults to `editor.state`.
   *
   * Multiple canvas surfaces can use independent view state while sharing one
   * document graph, history, and editor event bus.
   */
  getRenderState?: () => EditorState
  /**
   * Receives this canvas surface's CSS viewport size after creation and resize.
   */
  onViewportResize?: (width: number, height: number) => void
}
