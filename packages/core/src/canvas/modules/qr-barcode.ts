import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  QR_BARCODE_MODULE_TYPE,
  QR_BARCODE_PLUGIN_ID,
  resolveQrBarcodeModule,
  type QrBarcodeModuleConfigV1
} from '#core/plugins/qr-barcode'

import {
  configureModulePreviewPaint,
  drawModulePreviewLabel,
  renderResolvedModulePreview,
  withModulePreviewSurface
} from './preview'
import type { ModuleCanvasAdapter } from './types'

function previewHash(value: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

function pseudoBit(seed: number, index: number): boolean {
  let value = seed ^ Math.imul(index + 1, 2_654_435_761)
  value ^= value >>> 15
  value = Math.imul(value, 2_246_822_519)
  return (value & 3) !== 0
}

function drawQrPlaceholder(
  renderer: SkiaRenderer,
  canvas: Canvas,
  config: QrBarcodeModuleConfigV1,
  left: number,
  top: number,
  size: number
): void {
  const units = 21
  const unit = size / units
  const seed = previewHash(config.value)
  configureModulePreviewPaint(renderer, config.foregroundColor)
  for (let row = 0; row < units; row += 1) {
    for (let column = 0; column < units; column += 1) {
      if (!pseudoBit(seed, row * units + column)) continue
      canvas.drawRect(
        renderer.ck.LTRBRect(
          left + column * unit,
          top + row * unit,
          left + (column + 1) * unit,
          top + (row + 1) * unit
        ),
        renderer.fillPaint
      )
    }
  }
}

function drawBarcodePlaceholder(
  renderer: SkiaRenderer,
  canvas: Canvas,
  config: QrBarcodeModuleConfigV1,
  left: number,
  top: number,
  width: number,
  height: number
): void {
  const bars = 72
  const unit = width / bars
  const seed = previewHash(config.value)
  configureModulePreviewPaint(renderer, config.foregroundColor)
  for (let index = 0; index < bars; index += 1) {
    if (!pseudoBit(seed, index)) continue
    canvas.drawRect(
      renderer.ck.LTRBRect(left + index * unit, top, left + (index + 1) * unit, top + height),
      renderer.fillPaint
    )
  }
}

/** Draw a deterministic visual placeholder; no QR, barcode, or remote bytes are decoded. */
export function renderQrBarcodeModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolveQrBarcodeModule, (frame) => {
    const { width, height, config } = frame
    const captionHeight = config.showCaption ? Math.min(34, height * 0.16) : 0
    const quiet = Math.min(config.quietZone, Math.min(width, height) * 0.2)
    withModulePreviewSurface(renderer, canvas, frame, config.backgroundColor, () => {
      const availableHeight = Math.max(0, height - captionHeight - quiet * 2)
      if (config.format === 'qr') {
        const size = Math.max(0, Math.min(width - quiet * 2, availableHeight))
        drawQrPlaceholder(renderer, canvas, config, (width - size) / 2, quiet, size)
      } else {
        drawBarcodePlaceholder(
          renderer,
          canvas,
          config,
          quiet,
          quiet,
          Math.max(0, width - quiet * 2),
          availableHeight
        )
      }
      if (config.showCaption) {
        drawModulePreviewLabel(
          renderer,
          canvas,
          config.caption || config.value,
          width,
          height,
          Math.max(4, quiet),
          config.foregroundColor
        )
      }
    })
  })
}

export const QR_BARCODE_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: QR_BARCODE_PLUGIN_ID,
  moduleType: QR_BARCODE_MODULE_TYPE,
  render: renderQrBarcodeModulePreview
})
