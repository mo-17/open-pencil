import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import {
  configureModulePreviewPaint,
  renderResolvedModulePreview,
  withModulePreviewSurface
} from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import type { SkiaRenderer } from '#core/canvas/renderer'
import type { TextLayout } from '#core/canvas/text'
import { parseColor } from '#core/color'
import { tabsPreviewGeometry } from '#core/plugins/content/tabs'
import {
  TABS_MODULE_TYPE,
  TABS_PLUGIN_ID,
  resolveTabsModule,
  type TabsModuleConfig
} from '#core/plugins/tabs'

import { tabsBodyTextNode, tabsHeaderTextNode } from './text'

const HEADER_PADDING = 8
const HEADER_GAP = 4
const TAB_PADDING_X = 12

function prepareParagraph(
  renderer: SkiaRenderer,
  label: SceneNode,
  cssColor: string
): TextLayout | null {
  if (!renderer.fontProvider || !renderer.fontsLoaded) return null
  const readiness = renderer.nodeFontReadiness(label)
  if (readiness !== 'ready' && readiness !== 'substituted') return null
  const color = parseColor(cssColor)
  return renderer.buildParagraph(label, renderer.color4f(color.r, color.g, color.b, color.a), {
    halfLeading: true
  })
}

function drawHeader(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  config: TabsModuleConfig
) {
  const { header, tabHeight } = tabsPreviewGeometry(node, config)
  const availableWidth = Math.max(0, header.width - HEADER_PADDING * 2)
  if (availableWidth <= 0 || header.height <= HEADER_PADDING) return
  const labels: Array<TextLayout | null> = []
  canvas.save()
  try {
    for (const tab of config.tabs) {
      labels.push(
        prepareParagraph(
          renderer,
          tabsHeaderTextNode(node, tab.label, config.fontSize),
          tab.id === config.initialTabId ? config.backgroundColor : config.textColor
        )
      )
    }
    // Label widths depend on shaped glyphs. Wait for fallback fonts instead of
    // estimating CJK widths and briefly placing later tabs over earlier ones.
    if (labels.some((label) => label === null)) return
    canvas.clipRect(
      renderer.ck.LTRBRect(0, 0, header.width, header.height),
      renderer.ck.ClipOp.Intersect,
      true
    )
    let x = HEADER_PADDING
    let y = HEADER_PADDING
    for (let index = 0; index < labels.length; index++) {
      const paragraph = labels[index]
      if (!paragraph) continue
      const width =
        config.orientation === 'horizontal'
          ? Math.min(availableWidth, Math.ceil(paragraph.getLongestLine()) + TAB_PADDING_X * 2)
          : availableWidth
      if (config.tabs[index].id === config.initialTabId) {
        configureModulePreviewPaint(renderer, config.accentColor)
        canvas.drawRRect(
          renderer.ck.RRectXY(renderer.ck.LTRBRect(x, y, x + width, y + tabHeight), 6, 6),
          renderer.fillPaint
        )
      }
      if (width > TAB_PADDING_X * 2) {
        paragraph.layout(width - TAB_PADDING_X * 2)
        paragraph.draw(canvas, x + TAB_PADDING_X, y + (tabHeight - paragraph.getHeight()) / 2)
      }
      if (config.orientation === 'horizontal') x += width + HEADER_GAP
      else y += tabHeight + HEADER_GAP
    }
  } finally {
    for (const label of labels) label?.delete()
    canvas.restore()
  }
}

function drawInlineContent(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  config: TabsModuleConfig,
  text: string,
  content: Rect
): void {
  if (!text || content.width <= 0 || content.height <= 0) return
  const paragraph = prepareParagraph(
    renderer,
    tabsBodyTextNode(node, text, config.fontSize, content.width, content.height),
    config.textColor
  )
  if (!paragraph) return
  canvas.save()
  try {
    canvas.clipRect(
      renderer.ck.LTRBRect(
        content.x,
        content.y,
        content.x + content.width,
        content.y + content.height
      ),
      renderer.ck.ClipOp.Intersect,
      true
    )
    paragraph.draw(canvas, content.x, content.y)
  } finally {
    canvas.restore()
    paragraph.delete()
  }
}

/** Paint the authored initial tab or the editor's temporary view projection. */
export function renderTabsModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolveTabsModule, (frame) => {
    const { config } = frame
    const { header, content } = tabsPreviewGeometry(node, config)
    const activeIndex = config.tabs.findIndex((tab) => tab.id === config.initialTabId)
    const active = config.tabs[activeIndex]
    const horizontal = config.orientation === 'horizontal'
    withModulePreviewSurface(renderer, canvas, frame, config.backgroundColor, () => {
      drawHeader(renderer, canvas, node, config)
      if (config.showDivider) {
        configureModulePreviewPaint(renderer, config.accentColor)
        renderer.fillPaint.setAlphaf(0x55 / 0xff)
        canvas.drawRect(
          horizontal
            ? renderer.ck.LTRBRect(0, header.height - 1, header.width, header.height)
            : renderer.ck.LTRBRect(header.width - 1, 0, header.width, header.height),
          renderer.fillPaint
        )
      }
      // Explicit content is painted by the scene's active-child traversal.
      // A missing/ambiguous named slot must not silently substitute inline text.
      if (!active.contentChildName) {
        drawInlineContent(renderer, canvas, node, config, active.content, content)
      }
    })
  })
}

export const TABS_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: TABS_PLUGIN_ID,
  moduleType: TABS_MODULE_TYPE,
  render: renderTabsModulePreview
})
