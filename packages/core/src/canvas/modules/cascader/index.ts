import type { Canvas } from 'canvaskit-wasm'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { configureControlPaint } from '#core/canvas/control-content'
import { moduleLabelTextNode } from '#core/canvas/modules/label'
import * as preview from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import { readModuleInitialValue, moduleControlState } from '#core/canvas/modules/value-controls'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { withTextParagraph } from '#core/canvas/text'
import { parseColor } from '#core/color'
import * as cascader from '#core/plugins/cascader'

import { cascaderLanguage } from './text'

export function renderCascaderModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph?: SceneGraph
): boolean {
  return preview.renderResolvedModulePreview(node, cascader.resolveCascaderModule, (frame) => {
    const { width, height } = frame
    const config = { ...frame.config, ...moduleControlState(node, frame.config) }
    const binding = readModuleInitialValue(graph, node, 'value', 'array')
    const selected = cascader.parseCascaderPath(
      config.items,
      binding.bound ? binding.value : config.initialPath
    )
    const summary = selected === null ? '—' : cascader.cascaderPathLabels(config.items, selected)
    const opacity = 1
    const clear = config.clearable && Boolean(selected?.length)
    preview.withModulePreviewOpacity(renderer, canvas, config.disabled ? 0.5 : 1, () =>
      preview.withModulePreviewRectClip(renderer, canvas, { x: 0, y: 0, width, height }, () => {
        const radius = Math.min(config.borderRadius, width / 2, height / 2)
        preview.configureModulePreviewPaint(renderer, config.backgroundColor)
        renderer.fillPaint.setAlphaf(opacity)
        canvas.drawRRect(
          renderer.ck.RRectXY(renderer.ck.XYWHRect(0, 0, width, height), radius, radius),
          renderer.fillPaint
        )
        if (width > 1 && height > 1) {
          configureControlPaint(renderer, config.borderColor, opacity, 1)
          canvas.drawRRect(
            renderer.ck.RRectXY(
              renderer.ck.XYWHRect(0.5, 0.5, width - 1, height - 1),
              radius,
              radius
            ),
            renderer.auxStroke
          )
        }
        const textWidth = Math.max(0, width - (clear ? 80 : 44))
        if (textWidth > 0 && renderer.fontProvider && renderer.fontsLoaded) {
          const text = moduleLabelTextNode(
            node,
            summary || config.placeholder,
            textWidth,
            config.fontSize,
            cascaderLanguage(node)
          )
          const readiness = renderer.nodeFontReadiness(text)
          if (readiness === 'ready' || readiness === 'substituted') {
            const color = parseColor(config.textColor)
            withTextParagraph(
              renderer,
              text,
              renderer.color4f(color.r, color.g, color.b, opacity * (summary ? 1 : 0.6)),
              { halfLeading: true },
              (paragraph) => {
                canvas.drawParagraph(paragraph, 12, (height - config.fontSize * 1.5) / 2)
              }
            )
          }
        }
        if (width >= 36 && height >= 12) {
          configureControlPaint(renderer, config.textColor, opacity * 0.65, 1.5)
          const x = width - 20,
            y = height / 2
          const path = renderer.ck.Path.MakeFromSVGString(
            `M${x - 4} ${y - 2}L${x} ${y + 2}L${x + 4} ${y - 2}`
          )
          if (path) {
            canvas.drawPath(path, renderer.auxStroke)
            path.delete()
          }
          if (clear && width >= 80) {
            const left = width - 52
            const close = renderer.ck.Path.MakeFromSVGString(
              `M${left - 3} ${y - 3}L${left + 3} ${y + 3}M${left + 3} ${y - 3}L${left - 3} ${y + 3}`
            )
            if (close) {
              canvas.drawPath(close, renderer.auxStroke)
              close.delete()
            }
          }
        }
        renderer.fillPaint.setAlphaf(1)
      })
    )
  })
}
export const CASCADER_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: cascader.CASCADER_PLUGIN_ID,
  moduleType: cascader.CASCADER_MODULE_TYPE,
  render: renderCascaderModulePreview
})
