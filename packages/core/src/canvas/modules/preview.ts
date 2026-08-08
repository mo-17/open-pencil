import type { SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import { parseColor } from '#core/color'

export interface ModulePreviewFrame {
  node: SceneNode
  width: number
  height: number
  empty: boolean
}

export function modulePreviewFrame(node: SceneNode): ModulePreviewFrame | null {
  if (node.type !== 'FRAME') return null
  const width = Math.max(0, node.width)
  const height = Math.max(0, node.height)
  return { node, width, height, empty: width === 0 || height === 0 }
}

export function configureModulePreviewPaint(renderer: SkiaRenderer, cssColor: string): void {
  const color = parseColor(cssColor)
  renderer.fillPaint.setShader(null)
  renderer.fillPaint.setColor(renderer.color4f(color.r, color.g, color.b, color.a))
  renderer.fillPaint.setAlphaf(1)
  renderer.fillPaint.setBlendMode(renderer.ck.BlendMode.SrcOver)
}
