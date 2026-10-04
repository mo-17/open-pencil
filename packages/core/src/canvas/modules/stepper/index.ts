import type { Canvas } from 'canvaskit-wasm'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { configureControlPaint } from '#core/canvas/control-content'
import { drawNavigationLabel } from '#core/canvas/modules/navigation/shared'
import {
  configureModulePreviewPaint,
  renderResolvedModulePreview,
  withModulePreviewOpacity,
  withModulePreviewSurface
} from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import { readModuleInitialValue, moduleControlState } from '#core/canvas/modules/value-controls'
import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  STEPPER_MODULE_TYPE,
  STEPPER_PLUGIN_ID,
  STEPPER_LAYOUT,
  resolveStepperModule,
  stepperCurrentIndex,
  type StepperItemV1,
  type StepperModuleConfig
} from '#core/plugins/stepper'

function marker(item: StepperItemV1, index: number, config: StepperModuleConfig) {
  let status: string = item.status
  if (status === 'auto') {
    status = 'pending'
    if (index < config.currentIndex) status = 'completed'
    if (index === config.currentIndex) status = 'current'
  }
  let color = config.accentColor
  if (status === 'error') color = config.errorColor
  if (status === 'pending') color = config.textColor + '33'
  let mark = config.showNumbers ? String(index + 1) : '•'
  if (status === 'completed') mark = '✓'
  if (status === 'error') mark = '!'
  return { status, color, mark }
}

export function renderStepperModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph?: SceneGraph
): boolean {
  return renderResolvedModulePreview(node, resolveStepperModule, (frame) => {
    const initial = readModuleInitialValue(graph, node, 'currentIndex', 'number')
    const current = stepperCurrentIndex(frame.config, initial.value, initial.bound)
    const config = { ...frame.config, currentIndex: current ?? -1 }
    const { width } = frame
    const vertical = config.orientation === 'vertical'
    const titleHeight = config.fontSize * STEPPER_LAYOUT.titleLineHeight
    const descriptionHeight =
      config.fontSize *
      STEPPER_LAYOUT.descriptionTextScale *
      STEPPER_LAYOUT.descriptionLineHeight *
      STEPPER_LAYOUT.descriptionLines
    const rowHeight = Math.max(
      STEPPER_LAYOUT.verticalMinHeight,
      titleHeight + descriptionHeight + STEPPER_LAYOUT.verticalGap
    )
    const cellWidth = vertical
      ? Math.max(0, width - 32)
      : Math.max(
          STEPPER_LAYOUT.horizontalMinWidth,
          (width - 32 - (config.items.length - 1) * 12) / config.items.length
        )
    withModulePreviewSurface(
      renderer,
      canvas,
      frame,
      config.backgroundColor,
      () => {
        if (current === null) {
          drawNavigationLabel(
            renderer,
            canvas,
            node,
            node.interactiveProps?.lang === 'zh-CN' ? '当前步骤不可用' : 'Current step unavailable',
            { x: 16, y: 16, width: Math.max(0, width - 32), height: 22 },
            { fontSize: 12, color: config.errorColor }
          )
          return
        }
        config.items.forEach((item, index) => {
          const x = vertical ? 16 : 16 + index * (cellWidth + 12)
          const y = vertical ? 16 + index * rowHeight : 16
          if (x >= frame.width || y >= frame.height) return
          const { status, color, mark } = marker(item, index, config)
          withModulePreviewOpacity(renderer, canvas, item.disabled ? 0.5 : 1, () => {
            const opacity = 1
            if (index < config.items.length - 1) {
              configureControlPaint(
                renderer,
                status === 'completed' ? config.accentColor : config.textColor + '33',
                opacity,
                2
              )
              if (vertical)
                canvas.drawLine(x + 16, y + 40, x + 16, y + rowHeight - 8, renderer.auxStroke)
              else canvas.drawLine(x + 40, y + 16, x + cellWidth, y + 16, renderer.auxStroke)
            }
            configureModulePreviewPaint(
              renderer,
              status === 'pending' ? config.backgroundColor : color
            )
            renderer.fillPaint.setAlphaf(opacity)
            canvas.drawCircle(x + 16, y + 16, 16, renderer.fillPaint)
            configureControlPaint(renderer, color, opacity, 1)
            canvas.drawCircle(x + 16, y + 16, 15.5, renderer.auxStroke)
            drawNavigationLabel(
              renderer,
              canvas,
              node,
              mark,
              { x, y: y + 5, width: 32, height: 25 },
              {
                fontSize: 14,
                color: status === 'pending' ? config.textColor : '#FFFFFF',
                strong: true,
                center: true
              }
            )
            const textX = vertical ? x + 44 : x
            const textY = vertical ? y : y + 40
            const textWidth = Math.max(0, cellWidth - (vertical ? 44 : 8))
            const textColor = config.textColor + 'FF'
            drawNavigationLabel(
              renderer,
              canvas,
              node,
              item.title,
              { x: textX, y: textY, width: textWidth, height: titleHeight },
              { fontSize: config.fontSize, color: textColor, strong: true }
            )
            drawNavigationLabel(
              renderer,
              canvas,
              node,
              item.description,
              {
                x: textX,
                y: textY + titleHeight,
                width: textWidth,
                height: descriptionHeight
              },
              {
                fontSize: config.fontSize * STEPPER_LAYOUT.descriptionTextScale,
                color: config.textColor + 'BF',
                lines: STEPPER_LAYOUT.descriptionLines
              }
            )
          })
        })
      },
      moduleControlState(node).disabled ? 0.5 : 1
    )
  })
}

export const STEPPER_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: STEPPER_PLUGIN_ID,
  moduleType: STEPPER_MODULE_TYPE,
  render: renderStepperModulePreview
})
