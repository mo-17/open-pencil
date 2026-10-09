import type { Canvas } from 'canvaskit-wasm'

import {
  moduleDefinitionKey,
  readModuleInstance,
  validateModuleIdentity,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

import { renderMapModulePreview } from '#core/canvas/lowcode'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { MAP_MODULE_TYPE, MAP_PLUGIN_ID } from '#core/plugins/map'

import { ACCORDION_MODULE_CANVAS_ADAPTER, renderAccordionModulePreview } from './accordion'
import { ALERT_MODULE_CANVAS_ADAPTER } from './alert'
import { AUDIO_PLAYER_MODULE_CANVAS_ADAPTER, renderAudioPlayerModulePreview } from './audio-player'
import { AVATAR_MODULE_CANVAS_ADAPTER } from './avatar'
import { BADGE_MODULE_CANVAS_ADAPTER } from './badge'
import { BREADCRUMB_MODULE_CANVAS_ADAPTER } from './breadcrumb'
import { CAROUSEL_MODULE_CANVAS_ADAPTER, renderCarouselModulePreview } from './carousel'
import { CASCADER_MODULE_CANVAS_ADAPTER } from './cascader'
import { CHART_MODULE_CANVAS_ADAPTER, renderChartModulePreview } from './chart'
import { CHIP_MODULE_CANVAS_ADAPTER } from './chip'
import { CODE_BLOCK_MODULE_CANVAS_ADAPTER, renderCodeBlockModulePreview } from './code-block'
import { DATA_GRID_MODULE_CANVAS_ADAPTER, renderDataGridModulePreview } from './data-grid'
import { DATE_RANGE_MODULE_CANVAS_ADAPTER } from './date-range'
import { DESCRIPTIONS_MODULE_CANVAS_ADAPTER } from './descriptions'
import {
  DROPDOWN_MENU_MODULE_CANVAS_ADAPTER,
  renderDropdownMenuModulePreview
} from './dropdown-menu'
import { EFFECT_PICK_MODULE_CANVAS_ADAPTER } from './effect-pick'
import { EMPTY_STATE_MODULE_CANVAS_ADAPTER } from './empty-state'
import { HTML_MODULE_CANVAS_ADAPTER, renderHTMLModulePreview } from './html'
import { LOTTIE_MODULE_CANVAS_ADAPTER, renderLottieModulePreview } from './lottie'
import { MARKDOWN_MODULE_CANVAS_ADAPTER, renderMarkdownModulePreview } from './markdown'
import { MODAL_MODULE_CANVAS_ADAPTER, renderModalModulePreview } from './modal'
import { ORG_CHART_MODULE_CANVAS_ADAPTER } from './org-chart'
import { PAGINATION_MODULE_CANVAS_ADAPTER } from './pagination'
import { PDF_VIEWER_MODULE_CANVAS_ADAPTER, renderPDFViewerModulePreview } from './pdf-viewer'
import { POPOVER_MODULE_CANVAS_ADAPTER } from './popover'
import { PROGRESS_MODULE_CANVAS_ADAPTER } from './progress'
import { QR_BARCODE_MODULE_CANVAS_ADAPTER, renderQrBarcodeModulePreview } from './qr-barcode'
import { RATING_MODULE_CANVAS_ADAPTER } from './rating'
import { RICH_TEXT_MODULE_CANVAS_ADAPTER, renderRichTextModulePreview } from './rich-text'
import { SKELETON_MODULE_CANVAS_ADAPTER } from './skeleton'
import { SLIDE_MENU_MODULE_CANVAS_ADAPTER, renderSlideMenuModulePreview } from './slide-menu'
import { SLIDER_MODULE_CANVAS_ADAPTER } from './slider'
import { STEPPER_MODULE_CANVAS_ADAPTER } from './stepper'
import { TABLE_MODULE_CANVAS_ADAPTER, renderTableModulePreview } from './table'
import { TABS_MODULE_CANVAS_ADAPTER, renderTabsModulePreview } from './tabs'
import { TIMELINE_MODULE_CANVAS_ADAPTER } from './timeline'
import { TOOLTIP_MODULE_CANVAS_ADAPTER } from './tooltip'
import { TREE_MODULE_CANVAS_ADAPTER } from './tree'
import type { ModuleCanvasAdapter } from './types'
import {
  UPLOAD_BUTTON_MODULE_CANVAS_ADAPTER,
  renderUploadButtonModulePreview
} from './upload-button'
import { VIDEO_MODULE_CANVAS_ADAPTER, renderVideoModulePreview } from './video'
import { VR_TOUR_MODULE_CANVAS_ADAPTER, renderVRTourModulePreview } from './vr-tour'
import { WALKTOUR_MODULE_CANVAS_ADAPTER } from './walktour'

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

  render(renderer: SkiaRenderer, canvas: Canvas, node: SceneNode, graph?: SceneGraph): boolean {
    const instance = readModuleInstance(node.interactiveProps?.module)
    if (!instance) return false
    return (
      this.get(instance.pluginId, instance.moduleType)?.render(renderer, canvas, node, graph) ??
      false
    )
  }
}

export const BUILTIN_MODULE_CANVAS_ADAPTERS = new ModuleCanvasAdapterRegistry()
  .register(EFFECT_PICK_MODULE_CANVAS_ADAPTER)
  .register(MAP_MODULE_CANVAS_ADAPTER)
  .register(CHART_MODULE_CANVAS_ADAPTER)
  .register(RICH_TEXT_MODULE_CANVAS_ADAPTER)
  .register(HTML_MODULE_CANVAS_ADAPTER)
  .register(VIDEO_MODULE_CANVAS_ADAPTER)
  .register(TABLE_MODULE_CANVAS_ADAPTER)
  .register(SLIDE_MENU_MODULE_CANVAS_ADAPTER)
  .register(MODAL_MODULE_CANVAS_ADAPTER)
  .register(DROPDOWN_MENU_MODULE_CANVAS_ADAPTER)
  .register(UPLOAD_BUTTON_MODULE_CANVAS_ADAPTER)
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
  .register(VR_TOUR_MODULE_CANVAS_ADAPTER)
  .register(SLIDER_MODULE_CANVAS_ADAPTER)
  .register(RATING_MODULE_CANVAS_ADAPTER)
  .register(STEPPER_MODULE_CANVAS_ADAPTER)
  .register(BREADCRUMB_MODULE_CANVAS_ADAPTER)
  .register(ALERT_MODULE_CANVAS_ADAPTER)
  .register(PROGRESS_MODULE_CANVAS_ADAPTER)
  .register(CHIP_MODULE_CANVAS_ADAPTER)
  .register(AVATAR_MODULE_CANVAS_ADAPTER)
  .register(BADGE_MODULE_CANVAS_ADAPTER)
  .register(TIMELINE_MODULE_CANVAS_ADAPTER)
  .register(TOOLTIP_MODULE_CANVAS_ADAPTER)
  .register(SKELETON_MODULE_CANVAS_ADAPTER)
  .register(EMPTY_STATE_MODULE_CANVAS_ADAPTER)
  .register(DATE_RANGE_MODULE_CANVAS_ADAPTER)
  .register(DESCRIPTIONS_MODULE_CANVAS_ADAPTER)
  .register(PAGINATION_MODULE_CANVAS_ADAPTER)
  .register(ORG_CHART_MODULE_CANVAS_ADAPTER)
  .register(WALKTOUR_MODULE_CANVAS_ADAPTER)
  .register(CASCADER_MODULE_CANVAS_ADAPTER)
  .register(TREE_MODULE_CANVAS_ADAPTER)
  .register(POPOVER_MODULE_CANVAS_ADAPTER)
  .freeze()

export function renderModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph?: SceneGraph
): boolean {
  return BUILTIN_MODULE_CANVAS_ADAPTERS.render(renderer, canvas, node, graph)
}

export {
  renderAccordionModulePreview,
  renderAudioPlayerModulePreview,
  renderChartModulePreview,
  renderCarouselModulePreview,
  renderCodeBlockModulePreview,
  renderDataGridModulePreview,
  renderDropdownMenuModulePreview,
  renderHTMLModulePreview,
  renderLottieModulePreview,
  renderMarkdownModulePreview,
  renderModalModulePreview,
  renderPDFViewerModulePreview,
  renderQrBarcodeModulePreview,
  renderRichTextModulePreview,
  renderSlideMenuModulePreview,
  renderTableModulePreview,
  renderTabsModulePreview,
  renderUploadButtonModulePreview,
  renderVideoModulePreview,
  renderVRTourModulePreview
}
