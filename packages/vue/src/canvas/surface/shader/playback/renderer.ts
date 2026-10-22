import type { createRendererFromJSON } from 'shaders/core'

import type { Editor } from '@open-pencil/core/editor'
import type { ShaderPreset } from '@open-pencil/scene-graph'

import { shaderContentPreset } from '#vue/canvas/surface/shader/content'

import type { PlaybackSource } from './sources'

export type ContentPresetFactory = typeof shaderContentPreset

export type PlayerRenderer = Partial<
  Pick<ReturnType<typeof createRendererFromJSON>, 'getGPUContext'>
> &
  Pick<
    ReturnType<typeof createRendererFromJSON>,
    'initialize' | 'renderFrame' | 'getFailureReason' | 'setOnUnavailable' | 'dispose'
  >

async function drawPrepared(renderer: PlayerRenderer) {
  const device = renderer.getGPUContext?.().device
  device?.pushErrorScope('validation')
  try {
    await renderer.renderFrame({ deltaSeconds: 0, waitForGpu: true })
  } catch (error) {
    await device?.popErrorScope()
    throw error
  }
  const error = await device?.popErrorScope()
  if (error) throw new Error(`Shader playback validation: ${error.message}`)
  if (renderer.getFailureReason() !== null) throw new Error('Shader renderer became unavailable')
}

/** Input URLs, subscriptions and renderers belong to one player, including late initializers. */
export function playerResources(options: {
  source: PlaybackSource
  image: string
  canvas: HTMLCanvasElement
  signal: AbortSignal
  capture: Editor['captureShaderContent']
  create: (preset: ShaderPreset) => Promise<PlayerRenderer>
  unavailable: () => void
  texture?: ContentPresetFactory
}) {
  const { source, image, canvas, signal } = options
  let renderer: PlayerRenderer | null = null
  let content: Awaited<ReturnType<typeof shaderContentPreset>> | null = null
  function close() {
    renderer?.setOnUnavailable(null)
    renderer?.dispose()
    renderer = null
    content?.close()
    content = null
  }
  const ready = (async () => {
    try {
      if (source.input) {
        const input = await options.capture(source.input.id, signal)
        signal.throwIfAborted()
        if (!input || input.image !== image || input.key !== source.input.key)
          throw new Error('Shader content capture was superseded or unavailable')
        content = await (options.texture ?? shaderContentPreset)(source.preset, input.bytes, signal)
      }
      signal.throwIfAborted()
      renderer = await options.create(content?.preset ?? source.preset)
      signal.throwIfAborted()
      renderer.setOnUnavailable(options.unavailable)
      await renderer.initialize(canvas)
      signal.throwIfAborted()
      if (renderer.getFailureReason() !== null) throw new Error('Shader renderer is unavailable')
      await drawPrepared(renderer)
      if (content) {
        await content.validate()
        signal.throwIfAborted()
        await drawPrepared(renderer)
      }
      signal.throwIfAborted()
      return renderer
    } catch (error) {
      close()
      throw error
    } finally {
      signal.removeEventListener('abort', close)
    }
  })()
  signal.addEventListener('abort', close, { once: true })
  return { ready, close }
}
