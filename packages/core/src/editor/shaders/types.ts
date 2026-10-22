import type { ShaderPreset } from '@open-pencil/scene-graph'
import type { Size } from '@open-pencil/scene-graph/primitives'

/** Isolated, encoded input pixels for a live host; never a saved output frame. */
export interface ShaderContentFrame {
  image: string
  key: string
  bytes: Uint8Array
}

/** Ephemeral host state; never written to the document or undo history. */
export interface ShaderFrameStatus {
  phase: 'queued' | 'rendering' | 'ready' | 'saved' | 'missing' | 'unsupported'
  reason?: 'unavailable' | 'failed' | 'timeout' | 'stale'
  hasSavedFrame: boolean
  canRetry: boolean
}

/**
 * Draws a shader's still frame. Core has no GPU or DOM, so the canvas that has them supplies
 * one; without it, or where it cannot draw, a shader paint keeps the frame it was saved with.
 */
export interface ShaderRasterizer {
  /**
   * `preset`'s first frame at `size` pixels, encoded as `shaderFrameEncoding` picks, or null
   * when it cannot draw here.
   */
  render(
    preset: ShaderPreset,
    size: Size,
    options?: { signal?: AbortSignal; input?: Uint8Array }
  ): Promise<Uint8Array | null>
  destroy?(): void
}
