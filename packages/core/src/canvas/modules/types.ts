import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'

export interface ModuleCanvasAdapter {
  pluginId: string
  moduleType: string
  render: (renderer: SkiaRenderer, canvas: Canvas, node: SceneNode) => boolean
}
