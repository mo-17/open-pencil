import type { Editor } from '@open-pencil/core/editor'
import { contentShader } from '@open-pencil/scene-graph'

import { shaderFrames } from '#vue/canvas/surface/shader/frames'
import { createShaderRasterizer } from '#vue/canvas/surface/shader/rasterizer'

/** Observe real frames synchronously while the WebGPU canvas still owns its current buffer. */
export function observeContentPlayback(
  editor: Editor,
  id: string,
  exportImage: () => Promise<Uint8Array | null>
) {
  const node = editor.graph.getNode(id)
  const image = node && contentShader(editor.graph, node)?.shader.image
  if (!node || !image) throw new Error('Content observation needs a saved Shader layer')
  const saved = Array.from(editor.graph.images.get(image) ?? [])
  editor.setShaderRasterizer(null)
  const copy = document.createElement('canvas')
  const context = copy.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Frame observation needs Canvas 2D')
  const stats = { frames: 0, restored: 0, distinct: 0, green: 0, width: 0, height: 0, png: '' }
  const seen = new Set<string>()
  const stop = shaderFrames(editor).listen(image, (frame) => {
    if (!frame) {
      stats.restored++
      return
    }
    if (!(frame instanceof HTMLCanvasElement)) throw new Error('Expected a real player canvas')
    copy.width = frame.width
    copy.height = frame.height
    context.clearRect(0, 0, copy.width, copy.height)
    context.drawImage(frame, 0, 0)
    const pixels = context.getImageData(0, 0, copy.width, copy.height).data
    let green = 0
    for (let i = 0; i < pixels.length; i += 4)
      if ((pixels[i + 1] ?? 0) > 180 && (pixels[i] ?? 255) < 80 && (pixels[i + 2] ?? 255) < 80)
        green++
    stats.frames++
    stats.green = green
    stats.width = copy.width
    stats.height = copy.height
    stats.png = copy.toDataURL('image/png')
    if (seen.size < 8) seen.add(stats.png)
    stats.distinct = seen.size
  })
  return {
    stats,
    unchanged: () =>
      JSON.stringify(saved) === JSON.stringify(Array.from(editor.graph.images.get(image) ?? [])),
    play: () => editor.startPlay(),
    pause: () => editor.stopPlay(),
    green() {
      for (const child of editor.graph.getChildren(id))
        editor.graph.updateNode(child.id, {
          fills: [{ type: 'SOLID', color: { r: 0, g: 1, b: 0, a: 1 }, visible: true, opacity: 1 }]
        })
    },
    resize() {
      editor.graph.updateNode(id, { width: 192, rotation: 30 })
    },
    async exportFrame() {
      const bytes = await exportImage()
      if (!bytes) throw new Error('Saved fallback export missing')
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]))
      try {
        const target = document.createElement('canvas')
        target.width = bitmap.width
        target.height = bitmap.height
        const context = target.getContext('2d')
        if (!context) throw new Error('Saved export observation needs Canvas 2D')
        context.drawImage(bitmap, 0, 0)
        const pixels = context.getImageData(0, 0, target.width, target.height).data
        let colored = 0
        let green = 0
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] > 0) colored++
          if (pixels[i + 1] > 180 && pixels[i] < 80 && pixels[i + 2] < 80) green++
        }
        return { colored, green }
      } finally {
        bitmap.close()
      }
    },
    close() {
      editor.stopPlay()
      stop()
      editor.setShaderRasterizer(createShaderRasterizer())
    }
  }
}
