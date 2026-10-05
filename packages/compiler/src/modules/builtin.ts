import { ACCORDION_COMPILER_MODULE_LOWERER } from './accordion'
import { ALERT_COMPILER_MODULE_LOWERER } from './alert'
import { AUDIO_PLAYER_COMPILER_MODULE_LOWERER } from './audio-player'
import { AVATAR_COMPILER_MODULE_LOWERER } from './avatar'
import { BADGE_COMPILER_MODULE_LOWERER } from './badge'
import { BREADCRUMB_COMPILER_MODULE_LOWERER } from './breadcrumb'
import { CAROUSEL_COMPILER_MODULE_LOWERER } from './carousel'
import { CASCADER_COMPILER_MODULE_LOWERER } from './cascader'
import { CHART_COMPILER_MODULE_LOWERER } from './chart'
import { CHIP_COMPILER_MODULE_LOWERER } from './chip'
import { CODE_BLOCK_COMPILER_MODULE_LOWERER } from './code-block'
import { DATA_GRID_COMPILER_MODULE_LOWERER } from './data-grid'
import { DATE_RANGE_COMPILER_MODULE_LOWERER } from './date-range'
import { DESCRIPTIONS_COMPILER_MODULE_LOWERER } from './descriptions'
import { DROPDOWN_MENU_COMPILER_MODULE_LOWERER } from './dropdown-menu'
import { EMPTY_STATE_COMPILER_MODULE_LOWERER } from './empty-state'
import { HTML_COMPILER_MODULE_LOWERER } from './html'
import { LOTTIE_COMPILER_MODULE_LOWERER } from './lottie'
import { MAP_COMPILER_MODULE_LOWERER } from './map'
import { MARKDOWN_COMPILER_MODULE_LOWERER } from './markdown'
import { MODAL_COMPILER_MODULE_LOWERER } from './modal'
import { ORG_CHART_COMPILER_MODULE_LOWERER } from './org-chart'
import { PAGINATION_COMPILER_MODULE_LOWERER } from './pagination'
import { PDF_VIEWER_COMPILER_MODULE_LOWERER } from './pdf-viewer'
import { POPOVER_COMPILER_MODULE_LOWERER } from './popover'
import { PROGRESS_COMPILER_MODULE_LOWERER } from './progress'
import { QR_BARCODE_COMPILER_MODULE_LOWERER } from './qr-barcode'
import { RATING_COMPILER_MODULE_LOWERER } from './rating'
import { CompilerModuleRegistry } from './registry'
import { RICH_TEXT_COMPILER_MODULE_LOWERER } from './rich-text'
import { SKELETON_COMPILER_MODULE_LOWERER } from './skeleton'
import { SLIDE_MENU_COMPILER_MODULE_LOWERER } from './slide-menu'
import { SLIDER_COMPILER_MODULE_LOWERER } from './slider'
import { STEPPER_COMPILER_MODULE_LOWERER } from './stepper'
import { TABLE_COMPILER_MODULE_LOWERER } from './table'
import { TABS_COMPILER_MODULE_LOWERER } from './tabs'
import { TIMELINE_COMPILER_MODULE_LOWERER } from './timeline'
import { TOOLTIP_COMPILER_MODULE_LOWERER } from './tooltip'
import { TREE_COMPILER_MODULE_LOWERER } from './tree'
import { UPLOAD_BUTTON_COMPILER_MODULE_LOWERER } from './upload-button'
import { VIDEO_COMPILER_MODULE_LOWERER } from './video'
import { VR_TOUR_COMPILER_MODULE_LOWERER } from './vr-tour'
import { WALKTOUR_COMPILER_MODULE_LOWERER } from './walktour'

/** Framework-neutral installation manifest for trusted compiler modules.
 * Adapter targets live in their owning adapter layer so IR collection never
 * imports framework code. */
export const BUILTIN_COMPILER_MODULE_REGISTRY = new CompilerModuleRegistry()
  .register({ lowerer: VR_TOUR_COMPILER_MODULE_LOWERER, targets: {} })
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
  .register({ lowerer: SLIDER_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: RATING_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: STEPPER_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: BREADCRUMB_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: ALERT_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: PROGRESS_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: CHIP_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: AVATAR_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: BADGE_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: TIMELINE_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: TOOLTIP_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: SKELETON_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: EMPTY_STATE_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: DATE_RANGE_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: TREE_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: POPOVER_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: DESCRIPTIONS_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: PAGINATION_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: ORG_CHART_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: WALKTOUR_COMPILER_MODULE_LOWERER, targets: {} })
  .register({ lowerer: CASCADER_COMPILER_MODULE_LOWERER, targets: {} })
  .freeze()
