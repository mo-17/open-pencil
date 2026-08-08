import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { ellipsizeLabelText } from '#core/canvas/labels/text'
import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  LOTTIE_MODULE_TYPE,
  LOTTIE_PLUGIN_ID,
  resolveLottieModule,
  type LottieModuleConfigV1
} from '#core/plugins/lottie'

import { configureModulePreviewPaint, modulePreviewFrame } from './preview'
import type { ModuleCanvasAdapter } from './types'

function previewSource(config: LottieModuleConfigV1): string {
  if (config.source === 'json') return 'Embedded JSON'
  if (config.url === '') return 'No URL'
  return new URL(config.url).hostname
}

/** Build deterministic metadata for the offline CanvasKit placeholder. */
export function lottiePreviewLabel(config: LottieModuleConfigV1): string {
  const duration = (config.data.op - config.data.ip) / config.data.fr
  const states = [
    `${config.data.fr} fps`,
    `${duration.toFixed(duration < 10 ? 1 : 0)} s`,
    config.fit,
    `${config.speed}x`
  ]
  if (config.direction === 'reverse') states.push('reverse')
  if (config.loop) states.push('loop')
  return `${previewSource(config)} · ${states.join(' · ')}`
}

function drawLottieMark(
  renderer: SkiaRenderer,
  canvas: Canvas,
  centerX: number,
  centerY: number,
  radius: number
): void {
  configureModulePreviewPaint(renderer, '#67E8F9')
  canvas.drawCircle(centerX, centerY, radius, renderer.fillPaint)
  configureModulePreviewPaint(renderer, '#0F172A')
  canvas.drawCircle(centerX, centerY, radius * 0.68, renderer.fillPaint)

  configureModulePreviewPaint(renderer, '#A5F3FC')
  const path = new renderer.ck.Path()
  try {
    path.moveTo(centerX - radius * 0.32, centerY + radius * 0.34)
    path.lineTo(centerX - radius * 0.08, centerY - radius * 0.32)
    path.lineTo(centerX + radius * 0.34, centerY + radius * 0.1)
    path.lineTo(centerX + radius * 0.08, centerY + radius * 0.34)
    path.lineTo(centerX - radius * 0.02, centerY + radius * 0.16)
    path.close()
    canvas.drawPath(path, renderer.fillPaint)
  } finally {
    path.delete()
  }
}

/** Draw an offline placeholder only; neither URL nor animation data is executed by CanvasKit. */
export function renderLottieModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  const frame = modulePreviewFrame(node)
  if (!frame) return false
  const resolved = resolveLottieModule(frame.node.interactiveProps?.module)
  if (!resolved?.ok) return false
  if (frame.empty) return true
  const { width, height } = frame
  const inset = Math.min(24, Math.max(8, Math.min(width, height) * 0.06))
  const footerHeight = Math.min(34, Math.max(20, height * 0.14))

  canvas.save()
  try {
    canvas.clipRRect(renderer.makeRRect(frame.node), renderer.ck.ClipOp.Intersect, true)
    configureModulePreviewPaint(renderer, '#0F172A')
    canvas.drawRect(
      renderer.ck.LTRBRect(inset, inset, width - inset, height - inset),
      renderer.fillPaint
    )

    const markRadius = Math.max(10, Math.min(34, Math.min(width, height - footerHeight) * 0.13))
    drawLottieMark(renderer, canvas, width / 2, (height - footerHeight) / 2, markRadius)

    const font = renderer.labelFont
    if (font && height >= inset * 2 + 18) {
      configureModulePreviewPaint(renderer, '#CFFAFE')
      const label = ellipsizeLabelText(
        font,
        lottiePreviewLabel(resolved.config),
        Math.max(0, width - inset * 2)
      )
      if (label) {
        canvas.drawText(label, inset, height - Math.max(4, inset * 0.4), renderer.fillPaint, font)
      }
    }
  } finally {
    canvas.restore()
  }
  return true
}

export const LOTTIE_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: LOTTIE_PLUGIN_ID,
  moduleType: LOTTIE_MODULE_TYPE,
  render: renderLottieModulePreview
})
