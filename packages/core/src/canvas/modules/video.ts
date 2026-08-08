import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { ellipsizeLabelText } from '#core/canvas/labels/text'
import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  VIDEO_MODULE_TYPE,
  VIDEO_PLUGIN_ID,
  resolveVideoModule,
  type VideoModuleConfigV1
} from '#core/plugins/video'

import { configureModulePreviewPaint, modulePreviewFrame } from './preview'
import type { ModuleCanvasAdapter } from './types'

/** Build a short deterministic status label without loading either media URL. */
export function videoPreviewLabel(config: VideoModuleConfigV1): string {
  const source = config.src === '' ? 'No source' : new URL(config.src).hostname
  const states: string[] = [config.fit]
  if (config.controls) states.push('controls')
  if (config.autoplay) states.push('autoplay')
  if (config.muted) states.push('muted')
  if (config.loop) states.push('loop')
  return `${source} · ${states.join(' · ')}`
}

function drawPlayIcon(
  renderer: SkiaRenderer,
  canvas: Canvas,
  x: number,
  y: number,
  size: number
): void {
  configureModulePreviewPaint(renderer, '#F9FAFB')
  canvas.drawCircle(x, y, size, renderer.fillPaint)
  configureModulePreviewPaint(renderer, '#111827')
  const path = new renderer.ck.Path()
  try {
    path.moveTo(x - size * 0.25, y - size * 0.45)
    path.lineTo(x + size * 0.5, y)
    path.lineTo(x - size * 0.25, y + size * 0.45)
    path.close()
    canvas.drawPath(path, renderer.fillPaint)
  } finally {
    path.delete()
  }
}

/** Draw an offline placeholder only; src and poster are never requested by CanvasKit. */
export function renderVideoModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  const frame = modulePreviewFrame(node)
  if (frame === null) return false
  const moduleValue = frame.node.interactiveProps?.module
  const resolved = resolveVideoModule(moduleValue)
  if (resolved === null || !resolved.ok) return false
  const { width, height, empty } = frame
  if (empty) return true
  const inset = Math.min(24, Math.max(8, Math.min(width, height) * 0.06))
  const footerHeight = Math.min(34, Math.max(20, height * 0.14))

  canvas.save()
  try {
    canvas.clipRRect(renderer.makeRRect(frame.node), renderer.ck.ClipOp.Intersect, true)
    configureModulePreviewPaint(renderer, '#111827')
    canvas.drawRect(
      renderer.ck.LTRBRect(inset, inset, width - inset, height - inset),
      renderer.fillPaint
    )
    const iconSize = Math.max(8, Math.min(28, Math.min(width, height - footerHeight) * 0.1))
    drawPlayIcon(renderer, canvas, width / 2, (height - footerHeight) / 2, iconSize)

    if (resolved.config.controls && width > inset * 2 + 24) {
      const barY = Math.max(inset, height - inset - footerHeight)
      configureModulePreviewPaint(renderer, '#4B5563')
      canvas.drawRect(
        renderer.ck.LTRBRect(inset * 1.5, barY, width - inset * 1.5, barY + 3),
        renderer.fillPaint
      )
      configureModulePreviewPaint(renderer, '#F9FAFB')
      canvas.drawCircle(inset * 1.5, barY + 1.5, 4, renderer.fillPaint)
    }

    const font = renderer.labelFont
    if (font && height >= inset * 2 + 18) {
      configureModulePreviewPaint(renderer, '#D1D5DB')
      const label = ellipsizeLabelText(
        font,
        videoPreviewLabel(resolved.config),
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

export const VIDEO_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: VIDEO_PLUGIN_ID,
  moduleType: VIDEO_MODULE_TYPE,
  render: renderVideoModulePreview
})
