import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  AUDIO_PLAYER_MODULE_TYPE,
  AUDIO_PLAYER_PLUGIN_ID,
  resolveAudioPlayerModule,
  type AudioPlayerModuleConfigV1
} from '#core/plugins/audio-player'

import {
  configureModulePreviewPaint,
  drawModulePreviewCellText,
  renderResolvedModulePreview,
  withModulePreviewSurface
} from './preview'
import type { ModuleCanvasAdapter } from './types'

function drawAudioPlayIcon(
  renderer: SkiaRenderer,
  canvas: Canvas,
  centerX: number,
  centerY: number,
  radius: number,
  color: string
): void {
  configureModulePreviewPaint(renderer, color)
  canvas.drawCircle(centerX, centerY, radius, renderer.fillPaint)
  configureModulePreviewPaint(renderer, '#111827')
  const path = new renderer.ck.Path()
  try {
    path.moveTo(centerX - radius * 0.25, centerY - radius * 0.45)
    path.lineTo(centerX + radius * 0.5, centerY)
    path.lineTo(centerX - radius * 0.25, centerY + radius * 0.45)
    path.close()
    canvas.drawPath(path, renderer.fillPaint)
  } finally {
    path.delete()
  }
}

function waveformHeight(config: AudioPlayerModuleConfigV1, index: number): number {
  const source = `${config.title}\u0000${config.artist}\u0000${config.src}`
  let value = 17 + index * 31
  for (let offset = index % 7; offset < source.length; offset += 7) {
    value = Math.imul(value ^ source.charCodeAt(offset), 33)
  }
  return 0.2 + ((value >>> 0) % 80) / 100
}

/** Draw inert metadata and a deterministic waveform; audio bytes are never requested or decoded. */
export function renderAudioPlayerModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolveAudioPlayerModule, (frame) => {
    const { width, height, config } = frame
    const inset = Math.min(20, Math.max(8, Math.min(width, height) * 0.09))
    const iconRadius = Math.min(22, Math.max(10, height * 0.2))
    const controlWidth = config.controls ? iconRadius * 2 + inset * 1.5 : inset
    const waveLeft = controlWidth
    const waveRight = Math.max(waveLeft, width - inset)
    withModulePreviewSurface(renderer, canvas, frame, config.backgroundColor, () => {
      if (config.controls) {
        drawAudioPlayIcon(
          renderer,
          canvas,
          inset + iconRadius,
          height / 2,
          iconRadius,
          config.accentColor
        )
      }
      configureModulePreviewPaint(renderer, config.accentColor)
      const bars = 32
      const barWidth = Math.max(1, (waveRight - waveLeft) / bars)
      for (let index = 0; index < bars; index += 1) {
        const barHeight = Math.max(2, height * 0.34 * waveformHeight(config, index))
        const centerY = height * 0.58
        canvas.drawRect(
          renderer.ck.LTRBRect(
            waveLeft + index * barWidth,
            centerY - barHeight / 2,
            waveLeft + index * barWidth + Math.max(1, barWidth * 0.45),
            centerY + barHeight / 2
          ),
          renderer.fillPaint
        )
      }
      drawModulePreviewCellText(
        renderer,
        canvas,
        config.artist === '' ? config.title : `${config.title} · ${config.artist}`,
        waveLeft,
        0,
        Math.max(0, waveRight - waveLeft),
        height * 0.36,
        config.textColor,
        { horizontalInsetRatio: 0.02, baselineRatio: 0.72 }
      )
    })
  })
}

export const AUDIO_PLAYER_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: AUDIO_PLAYER_PLUGIN_ID,
  moduleType: AUDIO_PLAYER_MODULE_TYPE,
  render: renderAudioPlayerModulePreview
})
