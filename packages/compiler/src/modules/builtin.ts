import { ACCORDION_COMPILER_MODULE_LOWERER } from './accordion'
import { AUDIO_PLAYER_COMPILER_MODULE_LOWERER } from './audio-player'
import { CAROUSEL_COMPILER_MODULE_LOWERER } from './carousel'
import { CHART_COMPILER_MODULE_LOWERER } from './chart'
import { CODE_BLOCK_COMPILER_MODULE_LOWERER } from './code-block'
import { DATA_GRID_COMPILER_MODULE_LOWERER } from './data-grid'
import { DROPDOWN_MENU_COMPILER_MODULE_LOWERER } from './dropdown-menu'
import { HTML_COMPILER_MODULE_LOWERER } from './html'
import { LOTTIE_COMPILER_MODULE_LOWERER } from './lottie'
import { MAP_COMPILER_MODULE_LOWERER } from './map'
import { MARKDOWN_COMPILER_MODULE_LOWERER } from './markdown'
import { MODAL_COMPILER_MODULE_LOWERER } from './modal'
import { PDF_VIEWER_COMPILER_MODULE_LOWERER } from './pdf-viewer'
import { QR_BARCODE_COMPILER_MODULE_LOWERER } from './qr-barcode'
import { CompilerModuleRegistry } from './registry'
import { RICH_TEXT_COMPILER_MODULE_LOWERER } from './rich-text'
import { SLIDE_MENU_COMPILER_MODULE_LOWERER } from './slide-menu'
import { TABLE_COMPILER_MODULE_LOWERER } from './table'
import { TABS_COMPILER_MODULE_LOWERER } from './tabs'
import { UPLOAD_BUTTON_COMPILER_MODULE_LOWERER } from './upload-button'
import { VIDEO_COMPILER_MODULE_LOWERER } from './video'

/** Framework-neutral installation manifest for trusted compiler modules.
 * Adapter targets live in their owning adapter layer so IR collection never
 * imports framework code. */
export const BUILTIN_COMPILER_MODULE_REGISTRY = new CompilerModuleRegistry()
  .register({
    lowerer: MAP_COMPILER_MODULE_LOWERER,
    targets: {}
  })
  .register({
    lowerer: CHART_COMPILER_MODULE_LOWERER,
    targets: {}
  })
  .register({
    lowerer: HTML_COMPILER_MODULE_LOWERER,
    targets: {}
  })
  .register({
    lowerer: RICH_TEXT_COMPILER_MODULE_LOWERER,
    targets: {}
  })
  .register({
    lowerer: SLIDE_MENU_COMPILER_MODULE_LOWERER,
    targets: {}
  })
  .register({
    lowerer: MODAL_COMPILER_MODULE_LOWERER,
    targets: {}
  })
  .register({
    lowerer: DROPDOWN_MENU_COMPILER_MODULE_LOWERER,
    targets: {}
  })
  .register({
    lowerer: VIDEO_COMPILER_MODULE_LOWERER,
    targets: {}
  })
  .register({
    lowerer: TABLE_COMPILER_MODULE_LOWERER,
    targets: {}
  })
  .register({
    lowerer: LOTTIE_COMPILER_MODULE_LOWERER,
    targets: {}
  })
  .register({
    lowerer: CAROUSEL_COMPILER_MODULE_LOWERER,
    targets: {}
  })
  .register({
    lowerer: DATA_GRID_COMPILER_MODULE_LOWERER,
    targets: {}
  })
  .register({ lowerer: TABS_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: ACCORDION_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: QR_BARCODE_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: MARKDOWN_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: CODE_BLOCK_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: PDF_VIEWER_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: AUDIO_PLAYER_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: UPLOAD_BUTTON_COMPILER_MODULE_LOWERER, targets: {} })
  .freeze()
