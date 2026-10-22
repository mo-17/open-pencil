import type { ShaderComponent, ShaderPreset } from '@open-pencil/scene-graph'

/** Connect captured pixels through 4.0.4's ImageTexture and its public load notification. */
export async function shaderContentPreset(
  preset: ShaderPreset,
  bytes: Uint8Array,
  signal?: AbortSignal
) {
  const { getNaturalSize, onNaturalSizeChange } = await import('shaders/core')
  signal?.throwIfAborted()
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
  let finish: () => void = () => {
    /* Installed synchronously. */
  }
  let fail: () => void = () => {
    /* Installed synchronously. */
  }
  const loaded = new Promise<void>((resolve, reject) => {
    finish = resolve
    fail = () => reject(new DOMException('Shader content loading cancelled', 'AbortError'))
  })
  const timeout = setTimeout(fail, 5_000)
  void loaded.catch(() => undefined)
  // Install before the first frame composes the media source. The library publishes natural
  // size immediately before uploading; the promise continuation runs after that upload.
  const stop = onNaturalSizeChange(() => {
    if (getNaturalSize(url)) finish()
  })
  signal?.addEventListener('abort', fail, { once: true })
  const source: ShaderComponent = { type: 'ImageTexture', props: { url, objectFit: 'fill' } }
  const component = preset.components.reduce<ShaderComponent>(
    (child, effect) => ({
      ...structuredClone(effect),
      children: [child, ...structuredClone(effect.children ?? [])]
    }),
    source
  )
  return {
    preset: { ...preset, components: [component] },
    validate: () => loaded,
    close() {
      clearTimeout(timeout)
      stop()
      signal?.removeEventListener('abort', fail)
      URL.revokeObjectURL(url)
    }
  }
}
