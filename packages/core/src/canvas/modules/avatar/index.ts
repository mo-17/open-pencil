import type { Canvas } from 'canvaskit-wasm'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import {
  configureModulePreviewPaint,
  renderResolvedModulePreview
} from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { parseColor } from '#core/color'
import {
  avatarSupportsImageBytes,
  AVATAR_MODULE_TYPE,
  AVATAR_PLUGIN_ID,
  resolveAvatarModule
} from '#core/plugins/avatar'

import { avatarPreviewGeometry } from './geometry'
import { avatarTextNode } from './text'

export function avatarOwnsFills(node: SceneNode): boolean {
  return node.type === 'FRAME' && resolveAvatarModule(node.interactiveProps?.module)?.ok === true
}
function drawFallback(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  color: string,
  x: number,
  y: number,
  size: number
): void {
  const label = avatarTextNode(node)
  if (!label || !renderer.fontProvider || !renderer.fontsLoaded) return
  const readiness = renderer.nodeFontReadiness(label)
  if (readiness !== 'ready' && readiness !== 'substituted') return
  const rgba = parseColor(color)
  const paragraph = renderer.buildParagraph(
    label,
    renderer.color4f(rgba.r, rgba.g, rgba.b, rgba.a),
    { halfLeading: true }
  )
  try {
    paragraph.draw(canvas, x, y + (size - paragraph.getHeight()) / 2)
  } finally {
    paragraph.delete()
  }
}
export function renderAvatarModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph?: SceneGraph
): boolean {
  return renderResolvedModulePreview(node, resolveAvatarModule, ({ config, width, height }) => {
    const { size, x, y, radius, border } = avatarPreviewGeometry(width, height, config)
    if (size <= 0) return
    canvas.save()
    try {
      canvas.translate(x, y)
      const bounds = renderer.ck.RRectXY(renderer.ck.LTRBRect(0, 0, size, size), radius, radius)
      canvas.clipRRect(bounds, renderer.ck.ClipOp.Intersect, true)
      configureModulePreviewPaint(renderer, config.backgroundColor)
      canvas.drawRRect(bounds, renderer.fillPaint)
      const fill = node.fills.find(
        (candidate) => candidate.visible && candidate.type === 'IMAGE' && candidate.opacity > 0
      )
      const projected = { ...node, width: size, height: size }
      let imageDrawn = false
      const bytes = fill?.imageHash ? graph?.images.get(fill.imageHash) : undefined
      if (fill && graph && bytes && avatarSupportsImageBytes(bytes)) {
        configureModulePreviewPaint(renderer, '#FFFFFF')
        imageDrawn = renderer.applyImageFill(
          {
            ...fill,
            imageScaleMode: config.imageFit === 'contain' ? 'FIT' : 'FILL',
            imageTransform: undefined
          },
          projected,
          graph
        )
        if (imageDrawn) {
          renderer.fillPaint.setAlphaf(fill.opacity)
          canvas.drawRRect(bounds, renderer.fillPaint)
        }
      }
      if (!imageDrawn) drawFallback(renderer, canvas, node, config.textColor, 0, 0, size)
      if (border > 0) {
        configureModulePreviewPaint(renderer, config.borderColor)
        renderer.fillPaint.setStyle(renderer.ck.PaintStyle.Stroke)
        renderer.fillPaint.setStrokeWidth(border)
        const edge = renderer.ck.RRectXY(
          renderer.ck.LTRBRect(border / 2, border / 2, size - border / 2, size - border / 2),
          Math.max(0, radius - border / 2),
          Math.max(0, radius - border / 2)
        )
        canvas.drawRRect(edge, renderer.fillPaint)
      }
    } finally {
      renderer.fillPaint.setStyle(renderer.ck.PaintStyle.Fill)
      renderer.fillPaint.setShader(null)
      renderer.fillPaint.setAlphaf(1)
      canvas.restore()
    }
  })
}
export const AVATAR_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: AVATAR_PLUGIN_ID,
  moduleType: AVATAR_MODULE_TYPE,
  render: renderAvatarModulePreview
})
