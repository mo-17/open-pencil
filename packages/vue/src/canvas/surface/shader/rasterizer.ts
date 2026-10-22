import type { createRendererFromJSON } from 'shaders/core'

import type { ShaderRasterizer } from '@open-pencil/core/editor'
import { shaderFrameEncoding } from '@open-pencil/scene-graph'

import { shaderContentPreset } from './content'

/** Whether this browser can draw shaders, which need WebGPU. */
export function canDrawShaders(): boolean {
  if (typeof navigator === 'undefined') return false
  // WebGPU is optional, though the DOM types declare it: shader paints keep their saved frame
  // without it.
  const gpu: unknown = Reflect.get(navigator, 'gpu')
  return gpu !== undefined && gpu !== null
}

/**
 * The drawn frame on `canvas`, encoded as its pixels call for. A WebGPU canvas has no pixels to
 * read, so the frame is copied to a 2D canvas first, and encoded from there.
 */
async function encodeFrame(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const copy = document.createElement('canvas')
  copy.width = canvas.width
  copy.height = canvas.height
  const context = copy.getContext('2d')
  if (!context) return null
  context.drawImage(canvas, 0, 0)
  const { data } = context.getImageData(0, 0, copy.width, copy.height)
  const { type, quality } = shaderFrameEncoding(data)
  return new Promise<Blob | null>((resolve) => {
    copy.toBlob(resolve, type, quality)
  })
}

async function validated<T>(
  renderer: ReturnType<typeof createRendererFromJSON>,
  work: () => Promise<T>
): Promise<T> {
  const device = renderer.getGPUContext().device
  device?.pushErrorScope('validation')
  let result: T
  try {
    result = await work()
  } catch (error) {
    await device?.popErrorScope()
    throw error
  }
  const error = await device?.popErrorScope()
  if (error) throw new Error(`Shader GPU validation: ${error.message}`)
  return result
}

async function drawStill(
  renderer: ReturnType<typeof createRendererFromJSON>,
  canvas: HTMLCanvasElement,
  valid: () => boolean,
  content: Awaited<ReturnType<typeof shaderContentPreset>> | null
) {
  // The first call prepares the library's pipelines; the second is the deterministic frame.
  await validated(renderer, () => renderer.renderFrame({ deltaSeconds: 0, waitForGpu: true }))
  if (!valid()) return null
  await content?.validate()
  await renderer.renderFrame({ deltaSeconds: 0, waitForGpu: false })
  // initialize/renderFrame may resolve normally after the GPU has become unavailable.
  if (renderer.getFailureReason() !== null || !valid()) return null
  const blob = await encodeFrame(canvas)
  if (!valid() || !blob) return null
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return valid() && bytes.length ? bytes : null
}

/**
 * Draws shader frames with the `shaders` library's preset renderer on a detached WebGPU canvas,
 * one at a time, and encodes each as `shaderFrameEncoding` picks from its pixels. The library is loaded on the first frame, so documents
 * without shaders never fetch it. Null where the browser has no WebGPU.
 */
export function createShaderRasterizer(): ShaderRasterizer | null {
  if (!canDrawShaders()) return null
  let destroyed = false
  // Read through a call: `destroy` may run while a frame is drawn.
  const isDestroyed = () => destroyed
  const active = new Set<() => void>()
  return {
    async render(preset, size, { signal, input } = {}) {
      const cancelled = () => isDestroyed() || Boolean(signal?.aborted)
      const { createRendererFromJSON } = await import('shaders/core')
      if (cancelled()) return null
      const canvas = document.createElement('canvas')
      // The renderer sizes its buffer at the device pixel ratio itself.
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(size.width / ratio))
      canvas.height = Math.max(1, Math.round(size.height / ratio))
      const content = input ? await shaderContentPreset(preset, input, signal) : null
      if (cancelled()) {
        content?.close()
        return null
      }
      const renderer = createRendererFromJSON(content?.preset ?? structuredClone(preset))
      let unavailable = false
      const cancel = () => {
        unavailable = true
        renderer.dispose()
      }
      const valid = () => !cancelled() && !unavailable && renderer.getFailureReason() === null
      active.add(cancel)
      signal?.addEventListener('abort', cancel, { once: true })
      renderer.setOnUnavailable(() => {
        unavailable = true
      })
      try {
        await renderer.initialize(canvas)
        if (!valid()) return null
        return await validated(renderer, () => drawStill(renderer, canvas, valid, content))
      } catch (error) {
        if (!signal?.aborted) console.warn('Could not rasterize a shader', error)
        return null
      } finally {
        active.delete(cancel)
        signal?.removeEventListener('abort', cancel)
        renderer.setOnUnavailable(null)
        renderer.dispose()
        content?.close()
      }
    },
    destroy() {
      destroyed = true
      for (const cancel of active) cancel()
    }
  }
}
