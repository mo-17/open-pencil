import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { configureControlPaint } from '#core/canvas/control-content'
import {
  configureModulePreviewPaint,
  renderResolvedModulePreview,
  withModulePreviewRectClip,
  withModulePreviewSurface
} from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { withTextParagraph } from '#core/canvas/text'
import { parseColor } from '#core/color'
import {
  ACCORDION_MODULE_TYPE,
  ACCORDION_PLUGIN_ID,
  resolveAccordionModule
} from '#core/plugins/accordion'

import { accordionLabelNode } from './text'

interface AccordionTextBox {
  text: string
  top: number
  width: number
  fontSize: number
  color: string
  heading: boolean
}

function drawText(
  renderer: SkiaRenderer,
  canvas: Canvas,
  host: SceneNode,
  box: AccordionTextBox
): number | null {
  if (!box.text || box.width <= 0) return 0
  if (!renderer.fontProvider || !renderer.fontsLoaded) return null
  const label = accordionLabelNode(host, box.text, box.width, box.fontSize, box.heading)
  const readiness = renderer.nodeFontReadiness(label)
  if (readiness !== 'ready' && readiness !== 'substituted') return null
  const color = parseColor(box.color)
  return withTextParagraph(
    renderer,
    label,
    renderer.color4f(color.r, color.g, color.b, color.a),
    { halfLeading: true },
    (paragraph) =>
      withModulePreviewRectClip(
        renderer,
        canvas,
        { x: 16, y: box.top, width: box.width, height: Math.max(0, host.height - box.top) },
        () => {
          canvas.drawParagraph(paragraph, 16, box.top)
          return paragraph.getHeight()
        }
      )
  )
}

function drawIndicator(
  renderer: SkiaRenderer,
  canvas: Canvas,
  width: number,
  centerY: number,
  open: boolean,
  color: string
) {
  const centerX = width - 24
  configureControlPaint(renderer, color, 1, 1.5)
  canvas.drawLine(centerX - 4, centerY, centerX + 4, centerY, renderer.auxStroke)
  if (!open) canvas.drawLine(centerX, centerY - 4, centerX, centerY + 4, renderer.auxStroke)
}

/** Paint the authored initial expansion with shaped multiline text, without changing frame height. */
export function renderAccordionModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolveAccordionModule, (frame) => {
    const { width, height, config } = frame
    const openIds = new Set(config.initialOpenIds)
    withModulePreviewSurface(renderer, canvas, frame, config.backgroundColor, () => {
      let top = 0
      for (const item of config.items) {
        if (top >= height) break
        const isOpen = openIds.has(item.id)
        const headerTextHeight = drawText(renderer, canvas, node, {
          text: item.title,
          top: top + 12,
          width: Math.max(0, width - 60),
          fontSize: config.fontSize,
          color: config.textColor,
          heading: true
        })
        if (headerTextHeight === null) return
        const headerHeight = Math.max(44, headerTextHeight + 24)
        if (width >= 48)
          drawIndicator(renderer, canvas, width, top + headerHeight / 2, isOpen, config.accentColor)
        top += headerHeight
        if (isOpen && top < height) {
          const bodyHeight = drawText(renderer, canvas, node, {
            text: item.content,
            top,
            width: Math.max(0, width - 32),
            fontSize: config.fontSize,
            color: config.textColor,
            heading: false
          })
          if (bodyHeight === null) return
          top += bodyHeight + 16
        }
        if (config.showDividers && top < height) {
          configureModulePreviewPaint(renderer, config.accentColor)
          renderer.fillPaint.setAlphaf(0x44 / 0xff)
          canvas.drawRect(renderer.ck.LTRBRect(0, top, width, top + 1), renderer.fillPaint)
          top += 1
        }
      }
    })
  })
}

export const ACCORDION_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: ACCORDION_PLUGIN_ID,
  moduleType: ACCORDION_MODULE_TYPE,
  render: renderAccordionModulePreview
})
