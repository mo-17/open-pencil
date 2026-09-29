import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { configureControlPaint } from '#core/canvas/control-content'
import { moduleMultilineLabelNode } from '#core/canvas/modules/label'
import { renderResolvedModulePreview, withModulePreviewSurface } from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { withTextParagraph } from '#core/canvas/text'
import { parseColor } from '#core/color'
import {
  ALERT_CLOSE_PATH,
  ALERT_ICON_PATHS,
  ALERT_MODULE_TYPE,
  ALERT_PLUGIN_ID,
  alertAppearance,
  resolveAlertModule,
  type AlertModuleConfigV1
} from '#core/plugins/alert'

function drawIcon(
  renderer: SkiaRenderer,
  canvas: Canvas,
  pathSource: string,
  x: number,
  y: number,
  color: string
) {
  const path = renderer.ck.Path.MakeFromSVGString(pathSource)
  if (!path) return
  canvas.save()
  try {
    canvas.translate(x, y)
    canvas.scale(20 / 24, 20 / 24)
    configureControlPaint(renderer, color, 1, 1.8)
    canvas.drawPath(path, renderer.auxStroke)
  } finally {
    canvas.restore()
    path.delete()
  }
}

interface AlertTextBox {
  text: string
  heading: boolean
  x: number
  y: number
  width: number
  color: string
}

function drawText(
  renderer: SkiaRenderer,
  canvas: Canvas,
  host: SceneNode,
  fontSize: number,
  box: AlertTextBox
): number {
  if (!box.text || box.width <= 0 || !renderer.fontProvider || !renderer.fontsLoaded) return 0
  const label = moduleMultilineLabelNode(host, box.text, {
    width: box.width,
    fontSize,
    fontWeight: box.heading ? 600 : 400,
    lineHeight: fontSize * 1.5
  })
  const readiness = renderer.nodeFontReadiness(label)
  if (readiness !== 'ready' && readiness !== 'substituted') return 0
  const color = parseColor(box.color)
  return withTextParagraph(
    renderer,
    label,
    renderer.color4f(color.r, color.g, color.b, color.a),
    { halfLeading: true },
    (paragraph) => {
      canvas.drawParagraph(paragraph, box.x, box.y)
      return paragraph.getHeight()
    }
  )
}

/** Same 16px inset, 20px icon, 28px close target and wrapping text column as the web output. */
export function alertContentGeometry(
  width: number,
  config: Pick<AlertModuleConfigV1, 'showIcon' | 'closable'>
) {
  const x = 16 + (config.showIcon ? 32 : 0)
  return { x, width: Math.max(0, width - x - 16 - (config.closable ? 40 : 0)), closeX: width - 40 }
}

export function renderAlertModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolveAlertModule, (frame) => {
    const { config, width, height } = frame
    const appearance = alertAppearance(config)
    const geometry = alertContentGeometry(width, config)
    const rounded = {
      ...frame,
      node: { ...node, cornerRadius: config.borderRadius, independentCorners: false }
    }
    withModulePreviewSurface(renderer, canvas, rounded, appearance.background, () => {
      configureControlPaint(renderer, appearance.border, 1, 1)
      canvas.drawRRect(
        renderer.ck.RRectXY(
          renderer.ck.LTRBRect(0.5, 0.5, width - 0.5, height - 0.5),
          config.borderRadius,
          config.borderRadius
        ),
        renderer.auxStroke
      )
      if (config.showIcon)
        drawIcon(renderer, canvas, ALERT_ICON_PATHS[config.tone], 16, 16, appearance.foreground)
      if (config.closable)
        drawIcon(renderer, canvas, ALERT_CLOSE_PATH, geometry.closeX, 16, appearance.foreground)
      const box = { x: geometry.x, y: 16, width: geometry.width, color: appearance.foreground }
      const titleHeight = drawText(renderer, canvas, node, config.fontSize, {
        ...box,
        text: config.title,
        heading: true
      })
      drawText(renderer, canvas, node, config.fontSize, {
        ...box,
        y: 16 + titleHeight + (config.title && config.description ? 4 : 0),
        text: config.description,
        heading: false
      })
    })
  })
}

export const ALERT_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: ALERT_PLUGIN_ID,
  moduleType: ALERT_MODULE_TYPE,
  render: renderAlertModulePreview
})
