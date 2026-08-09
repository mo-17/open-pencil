import { ACCORDION_PLUGIN } from './accordion'
import { AUDIO_PLAYER_PLUGIN } from './audio-player'
import { CAROUSEL_PLUGIN } from './carousel'
import { CHART_PLUGIN } from './chart'
import { CODE_BLOCK_PLUGIN } from './code-block'
import { DATA_GRID_PLUGIN } from './data-grid'
import { HTML_PLUGIN } from './html'
import { LOTTIE_PLUGIN } from './lottie'
import { MAP_PLUGIN } from './map'
import { MARKDOWN_PLUGIN } from './markdown'
import { PDF_VIEWER_PLUGIN } from './pdf-viewer'
import { QR_BARCODE_PLUGIN } from './qr-barcode'
import { PluginRegistry } from './registry'
import { RICH_TEXT_PLUGIN } from './rich-text'
import { SLIDE_MENU_PLUGIN } from './slide-menu'
import { TABLE_PLUGIN } from './table'
import { TABS_PLUGIN } from './tabs'
import { VIDEO_PLUGIN } from './video'

export const BUILTIN_PLUGIN_REGISTRY = new PluginRegistry()
  .register(MAP_PLUGIN)
  .register(CHART_PLUGIN)
  .register(RICH_TEXT_PLUGIN)
  .register(HTML_PLUGIN)
  .register(VIDEO_PLUGIN)
  .register(TABLE_PLUGIN)
  .register(SLIDE_MENU_PLUGIN)
  .register(LOTTIE_PLUGIN)
  .register(CAROUSEL_PLUGIN)
  .register(DATA_GRID_PLUGIN)
  .register(TABS_PLUGIN)
  .register(ACCORDION_PLUGIN)
  .register(QR_BARCODE_PLUGIN)
  .register(MARKDOWN_PLUGIN)
  .register(CODE_BLOCK_PLUGIN)
  .register(PDF_VIEWER_PLUGIN)
  .register(AUDIO_PLAYER_PLUGIN)
  .freeze()
