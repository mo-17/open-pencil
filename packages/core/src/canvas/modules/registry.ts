import type { Canvas } from 'canvaskit-wasm'

import {
  moduleDefinitionKey,
  readModuleInstance,
  validateModuleIdentity,
  type SceneNode
} from '@open-pencil/scene-graph'

import { renderMapModulePreview } from '#core/canvas/lowcode'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { MAP_MODULE_TYPE, MAP_PLUGIN_ID } from '#core/plugins/map'

import { ACCORDION_MODULE_CANVAS_ADAPTER, renderAccordionModulePreview } from './accordion'
import { AUDIO_PLAYER_MODULE_CANVAS_ADAPTER, renderAudioPlayerModulePreview } from './audio-player'
import { CAROUSEL_MODULE_CANVAS_ADAPTER, renderCarouselModulePreview } from './carousel'
import { CHART_MODULE_CANVAS_ADAPTER, renderChartModulePreview } from './chart'
import { CODE_BLOCK_MODULE_CANVAS_ADAPTER, renderCodeBlockModulePreview } from './code-block'
import { DATA_GRID_MODULE_CANVAS_ADAPTER, renderDataGridModulePreview } from './data-grid'
import { HTML_MODULE_CANVAS_ADAPTER, renderHtmlModulePreview } from './html'
import { LOTTIE_MODULE_CANVAS_ADAPTER, renderLottieModulePreview } from './lottie'
import { MARKDOWN_MODULE_CANVAS_ADAPTER, renderMarkdownModulePreview } from './markdown'
import { PDF_VIEWER_MODULE_CANVAS_ADAPTER, renderPdfViewerModulePreview } from './pdf-viewer'
import { QR_BARCODE_MODULE_CANVAS_ADAPTER, renderQrBarcodeModulePreview } from './qr-barcode'
import { RICH_TEXT_MODULE_CANVAS_ADAPTER, renderRichTextModulePreview } from './rich-text'
import { SLIDE_MENU_MODULE_CANVAS_ADAPTER, renderSlideMenuModulePreview } from './slide-menu'
import { TABLE_MODULE_CANVAS_ADAPTER, renderTableModulePreview } from './table'
import { TABS_MODULE_CANVAS_ADAPTER, renderTabsModulePreview } from './tabs'
import type { ModuleCanvasAdapter } from './types'
import { VIDEO_MODULE_CANVAS_ADAPTER, renderVideoModulePreview } from './video'

const MAP_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: MAP_PLUGIN_ID,
  moduleType: MAP_MODULE_TYPE,
  render: renderMapModulePreview
})

export class ModuleCanvasAdapterRegistry {
  readonly #adapters = new Map<string, ModuleCanvasAdapter>()
  #frozen = false

  register(adapter: ModuleCanvasAdapter): this {
    if (this.#frozen) throw new Error('Module canvas adapter registry is frozen')
    const pluginReason = validateModuleIdentity(adapter.pluginId, 'canvas module pluginId')
    if (pluginReason) throw new TypeError(pluginReason)
    const moduleReason = validateModuleIdentity(adapter.moduleType, 'canvas module moduleType')
    if (moduleReason) throw new TypeError(moduleReason)
    if (typeof adapter.render !== 'function') {
      throw new TypeError('Canvas module adapter render must be a function')
    }
    const key = moduleDefinitionKey(adapter.pluginId, adapter.moduleType)
    if (this.#adapters.has(key)) throw new Error(`Duplicate module canvas adapter: ${key}`)
    this.#adapters.set(key, Object.freeze({ ...adapter }))
    return this
  }

  freeze(): this {
    this.#frozen = true
    return this
  }

  get(pluginId: string, moduleType: string): ModuleCanvasAdapter | undefined {
    return this.#adapters.get(moduleDefinitionKey(pluginId, moduleType))
  }

  render(renderer: SkiaRenderer, canvas: Canvas, node: SceneNode): boolean {
    const instance = readModuleInstance(node.interactiveProps?.module)
    if (!instance) return false
    return this.get(instance.pluginId, instance.moduleType)?.render(renderer, canvas, node) ?? false
  }
}

export const BUILTIN_MODULE_CANVAS_ADAPTERS = new ModuleCanvasAdapterRegistry()
  .register(MAP_MODULE_CANVAS_ADAPTER)
  .register(CHART_MODULE_CANVAS_ADAPTER)
  .register(RICH_TEXT_MODULE_CANVAS_ADAPTER)
  .register(HTML_MODULE_CANVAS_ADAPTER)
  .register(VIDEO_MODULE_CANVAS_ADAPTER)
  .register(TABLE_MODULE_CANVAS_ADAPTER)
  .register(SLIDE_MENU_MODULE_CANVAS_ADAPTER)
  .register(LOTTIE_MODULE_CANVAS_ADAPTER)
  .register(CAROUSEL_MODULE_CANVAS_ADAPTER)
  .register(DATA_GRID_MODULE_CANVAS_ADAPTER)
  .register(TABS_MODULE_CANVAS_ADAPTER)
  .register(ACCORDION_MODULE_CANVAS_ADAPTER)
  .register(QR_BARCODE_MODULE_CANVAS_ADAPTER)
  .register(MARKDOWN_MODULE_CANVAS_ADAPTER)
  .register(CODE_BLOCK_MODULE_CANVAS_ADAPTER)
  .register(PDF_VIEWER_MODULE_CANVAS_ADAPTER)
  .register(AUDIO_PLAYER_MODULE_CANVAS_ADAPTER)
  .freeze()

export function renderModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return BUILTIN_MODULE_CANVAS_ADAPTERS.render(renderer, canvas, node)
}

export {
  renderAccordionModulePreview,
  renderAudioPlayerModulePreview,
  renderChartModulePreview,
  renderCarouselModulePreview,
  renderCodeBlockModulePreview,
  renderDataGridModulePreview,
  renderHtmlModulePreview,
  renderLottieModulePreview,
  renderMarkdownModulePreview,
  renderPdfViewerModulePreview,
  renderQrBarcodeModulePreview,
  renderRichTextModulePreview,
  renderSlideMenuModulePreview,
  renderTableModulePreview,
  renderTabsModulePreview,
  renderVideoModulePreview
}
