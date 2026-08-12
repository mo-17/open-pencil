import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  PDF_VIEWER_MODULE_TYPE,
  PDF_VIEWER_PLUGIN_ID,
  resolvePDFViewerModule,
  type PDFViewerModuleConfigV1
} from '#core/plugins/pdf-viewer'

import {
  configureModulePreviewPaint,
  drawModulePreviewCellText,
  renderResolvedModulePreview,
  withModulePreviewSurface
} from './preview'
import type { ModuleCanvasAdapter } from './types'

export function pdfViewerPreviewStatus(config: PDFViewerModuleConfigV1): string {
  const total = config.pageCountHint > 0 ? ` / ${config.pageCountHint}` : ''
  const source = config.sourceUrl === '' ? 'No source' : config.sourceUrl
  return `${source} · Page ${config.initialPage}${total} · ${config.fit}`
}

/** Draw document metadata and a paper placeholder; PDF bytes are never loaded or parsed. */
export function renderPDFViewerModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolvePDFViewerModule, (frame) => {
    const { width, height, config } = frame
    const toolbarHeight = config.showToolbar ? Math.min(42, Math.max(28, height * 0.08)) : 0
    const inset = Math.min(28, Math.max(8, Math.min(width, height) * 0.05))
    withModulePreviewSurface(renderer, canvas, frame, config.backgroundColor, () => {
      if (config.showToolbar) {
        configureModulePreviewPaint(renderer, config.accentColor)
        canvas.drawRect(renderer.ck.LTRBRect(0, 0, width, toolbarHeight), renderer.fillPaint)
        drawModulePreviewCellText(
          renderer,
          canvas,
          `${config.title} · ${pdfViewerPreviewStatus(config)}`,
          0,
          0,
          width,
          toolbarHeight,
          '#FFFFFF',
          { horizontalInsetRatio: 0.025, baselineRatio: 0.68 }
        )
      }

      const paperTop = toolbarHeight + inset
      const paperHeight = Math.max(0, height - paperTop - inset)
      const paperWidth = Math.max(0, Math.min(width - inset * 2, paperHeight * 0.74))
      const paperLeft = (width - paperWidth) / 2
      configureModulePreviewPaint(renderer, '#FFFFFF')
      canvas.drawRect(
        renderer.ck.LTRBRect(paperLeft, paperTop, paperLeft + paperWidth, paperTop + paperHeight),
        renderer.fillPaint
      )
      configureModulePreviewPaint(renderer, '#D1D5DB')
      for (let index = 1; index <= 6; index += 1) {
        const lineTop = paperTop + (paperHeight * index) / 8
        canvas.drawRect(
          renderer.ck.LTRBRect(
            paperLeft + paperWidth * 0.12,
            lineTop,
            paperLeft + paperWidth * (index % 3 === 0 ? 0.68 : 0.88),
            lineTop + 2
          ),
          renderer.fillPaint
        )
      }
    })
  })
}

export const PDF_VIEWER_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: PDF_VIEWER_PLUGIN_ID,
  moduleType: PDF_VIEWER_MODULE_TYPE,
  render: renderPDFViewerModulePreview
})
