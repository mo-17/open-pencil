import type { Canvas } from 'canvaskit-wasm'

import { isIsoDate } from '@open-pencil/lowcode'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { configureControlPaint } from '#core/canvas/control-content'
import * as preview from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import { readModuleInitialValue, moduleControlState } from '#core/canvas/modules/value-controls'
import type { SkiaRenderer } from '#core/canvas/renderer'
import * as dateRange from '#core/plugins/date-range'

import { drawDateRangeText, type DateRangeTextRun } from './paragraph'
import { dateRangeNodeLanguage } from './text'

function border(
  renderer: SkiaRenderer,
  canvas: Canvas,
  rect: Rect,
  radius: number,
  color: string,
  opacity: number
) {
  configureControlPaint(renderer, color, opacity, 1)
  canvas.drawRRect(
    renderer.ck.RRectXY(
      renderer.ck.LTRBRect(
        rect.x + 0.5,
        rect.y + 0.5,
        rect.x + rect.width - 0.5,
        rect.y + rect.height - 0.5
      ),
      radius,
      radius
    ),
    renderer.auxStroke
  )
}
function calendar(renderer: SkiaRenderer, canvas: Canvas, x: number, y: number) {
  const path = renderer.ck.Path.MakeFromSVGString('M3 4H13V14H3Z M3 7H13 M6 2V5 M10 2V5')
  if (!path) return
  canvas.save()
  try {
    canvas.translate(x, y)
    canvas.drawPath(path, renderer.auxStroke)
  } finally {
    canvas.restore()
    path.delete()
  }
}
export function renderDateRangeModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph?: SceneGraph
): boolean {
  return preview.renderResolvedModulePreview(node, dateRange.resolveDateRangeModule, (frame) => {
    const { width, height } = frame
    const start = readModuleInitialValue(graph, node, 'value', 'string')
    const end = readModuleInitialValue(graph, node, 'endValue', 'string')
    const date = (value: unknown) =>
      typeof value === 'string' && (value === '' || isIsoDate(value)) ? value : '—'
    const config = {
      ...frame.config,
      ...moduleControlState(node, frame.config),
      initialStart: start.bound ? date(start.value) : frame.config.initialStart,
      initialEnd: end.bound ? date(end.value) : frame.config.initialEnd
    }
    const invalid = [config.initialStart, config.initialEnd].some(
      (value) =>
        value === '—' ||
        (value !== '' &&
          ((config.min !== '' && value < config.min) || (config.max !== '' && value > config.max)))
    )
    const layout = dateRange.dateRangeGeometry(width, config.fontSize)
    const constants = dateRange.DATE_RANGE_LAYOUT
    const opacity = 1
    const populated = !!(config.initialStart || config.initialEnd)
    const clearOpacity = config.disabled || config.readOnly || !populated ? 0.45 : 1
    const copy =
      dateRange.DATE_RANGE_MESSAGES[dateRange.dateRangeLocale(dateRangeNodeLanguage(node))]
    const draw = (run: DateRangeTextRun, alpha = opacity) =>
      drawDateRangeText(renderer, canvas, node, run, config.textColor, alpha)
    preview.withModulePreviewOpacity(renderer, canvas, config.disabled ? 0.5 : 1, () =>
      preview.withModulePreviewRectClip(renderer, canvas, { x: 0, y: 0, width, height }, () => {
        preview.configureModulePreviewPaint(renderer, config.backgroundColor)
        canvas.drawRect(renderer.ck.LTRBRect(0, 0, width, height), renderer.fillPaint)
        draw({
          text: config.label,
          x: constants.inset,
          y: constants.inset,
          width: Math.max(0, width - constants.inset * 2),
          height: layout.line,
          fontSize: config.fontSize,
          weight: 600
        })
        const fields = [
          {
            caption: config.startLabel || copy.start,
            value: config.initialStart,
            x: constants.inset,
            y: layout.fieldTop
          },
          {
            caption: config.endLabel || copy.end,
            value: config.initialEnd,
            x: layout.secondLeft,
            y: layout.secondTop
          }
        ]
        for (const field of fields) {
          if (layout.fieldWidth <= 0) continue
          draw({
            text: field.caption,
            x: field.x,
            y: field.y,
            width: layout.fieldWidth,
            height: layout.line,
            fontSize: config.fontSize
          })
          const inputTop = field.y + layout.line + constants.labelGap
          border(
            renderer,
            canvas,
            { x: field.x, y: inputTop, width: layout.fieldWidth, height: constants.inputHeight },
            config.borderRadius,
            config.borderColor,
            opacity
          )
          draw(
            {
              text: field.value || 'YYYY-MM-DD',
              x: field.x + 10,
              y: inputTop,
              width: Math.max(0, layout.fieldWidth - 38),
              height: constants.inputHeight,
              fontSize: config.fontSize
            },
            field.value ? opacity : opacity * 0.6
          )
          if (layout.fieldWidth >= 44) {
            configureControlPaint(renderer, config.textColor, opacity * 0.65, 1.4)
            calendar(renderer, canvas, field.x + layout.fieldWidth - 26, inputTop + 14)
          }
        }
        let state: 'empty' | 'partial' | 'ready' = populated ? 'partial' : 'empty'
        if (config.initialStart && config.initialEnd) state = 'ready'
        const statusWidth = Math.max(
          0,
          width -
            constants.inset * 2 -
            (config.allowClear ? constants.clearWidth + constants.gap : 0)
        )
        let status = copy[state]
        if (config.initialStart && config.initialEnd && config.initialStart > config.initialEnd)
          status = copy.order
        if (invalid) status = copy.bounds
        draw({
          text: status,
          x: constants.inset,
          y: layout.footerTop,
          width: statusWidth,
          height: constants.inputHeight,
          fontSize: 12,
          multiline: true
        })
        if (config.allowClear && width >= constants.clearWidth + constants.inset * 2) {
          const clearLeft = width - constants.inset - constants.clearWidth
          const alpha = opacity * clearOpacity
          border(
            renderer,
            canvas,
            {
              x: clearLeft,
              y: layout.footerTop,
              width: constants.clearWidth,
              height: constants.inputHeight
            },
            config.borderRadius,
            config.borderColor,
            alpha
          )
          draw(
            {
              text: copy.clear,
              x: clearLeft + 4,
              y: layout.footerTop,
              width: constants.clearWidth - 8,
              height: constants.inputHeight,
              fontSize: config.fontSize,
              centered: true
            },
            alpha
          )
        }
      })
    )
  })
}
export const DATE_RANGE_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: dateRange.DATE_RANGE_PLUGIN_ID,
  moduleType: dateRange.DATE_RANGE_MODULE_TYPE,
  render: renderDateRangeModulePreview
})
