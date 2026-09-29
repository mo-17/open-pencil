import { ACCORDION_PLUGIN } from './accordion'
import { ALERT_PLUGIN } from './alert'
import { AUDIO_PLAYER_PLUGIN } from './audio-player'
import { AVATAR_PLUGIN } from './avatar'
import { BADGE_PLUGIN } from './badge'
import { BREADCRUMB_PLUGIN } from './breadcrumb'
import { CAROUSEL_PLUGIN } from './carousel'
import { CHART_PLUGIN } from './chart'
import { CHIP_PLUGIN } from './chip'
import { CODE_BLOCK_PLUGIN } from './code-block'
import { DATA_GRID_PLUGIN } from './data-grid'
import { DATE_RANGE_PLUGIN } from './date-range'
import { DESCRIPTIONS_PLUGIN } from './descriptions'
import { DROPDOWN_MENU_PLUGIN } from './dropdown-menu'
import { EMPTY_STATE_PLUGIN } from './empty-state'
import { HTML_PLUGIN } from './html'
import { LOTTIE_PLUGIN } from './lottie'
import { MAP_PLUGIN } from './map'
import { MARKDOWN_PLUGIN } from './markdown'
import { MODAL_PLUGIN } from './modal'
import { ORG_CHART_PLUGIN } from './org-chart'
import { PAGINATION_PLUGIN } from './pagination'
import { PDF_VIEWER_PLUGIN } from './pdf-viewer'
import { POPOVER_PLUGIN } from './popover'
import { PROGRESS_PLUGIN } from './progress'
import { QR_BARCODE_PLUGIN } from './qr-barcode'
import { RATING_PLUGIN } from './rating'
import { PluginRegistry } from './registry'
import { RICH_TEXT_PLUGIN } from './rich-text'
import { SKELETON_PLUGIN } from './skeleton'
import { SLIDE_MENU_PLUGIN } from './slide-menu'
import { SLIDER_PLUGIN } from './slider'
import { STEPPER_PLUGIN } from './stepper'
import { TABLE_PLUGIN } from './table'
import { TABS_PLUGIN } from './tabs'
import { TIMELINE_PLUGIN } from './timeline'
import { TOOLTIP_PLUGIN } from './tooltip'
import { TREE_PLUGIN } from './tree'
import { UPLOAD_BUTTON_PLUGIN } from './upload-button'
import { VIDEO_PLUGIN } from './video'
import { VR_TOUR_PLUGIN } from './vr-tour'
import { CASCADER_PLUGIN } from './cascader'
import { WALKTOUR_PLUGIN } from './walktour'

export const BUILTIN_PLUGIN_REGISTRY = new PluginRegistry()
  .register(MAP_PLUGIN)
  .register(CHART_PLUGIN)
  .register(RICH_TEXT_PLUGIN)
  .register(HTML_PLUGIN)
  .register(VIDEO_PLUGIN)
  .register(TABLE_PLUGIN)
  .register(SLIDE_MENU_PLUGIN)
  .register(MODAL_PLUGIN)
  .register(DROPDOWN_MENU_PLUGIN)
  .register(UPLOAD_BUTTON_PLUGIN)
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
  .register(VR_TOUR_PLUGIN)
  .register(SLIDER_PLUGIN)
  .register(RATING_PLUGIN)
  .register(STEPPER_PLUGIN)
  .register(BREADCRUMB_PLUGIN)
  .register(ALERT_PLUGIN)
  .register(PROGRESS_PLUGIN)
  .register(CHIP_PLUGIN)
  .register(AVATAR_PLUGIN)
  .register(BADGE_PLUGIN)
  .register(TIMELINE_PLUGIN)
  .register(TOOLTIP_PLUGIN)
  .register(SKELETON_PLUGIN)
  .register(EMPTY_STATE_PLUGIN)
  .register(DATE_RANGE_PLUGIN)
  .register(DESCRIPTIONS_PLUGIN)
  .register(PAGINATION_PLUGIN)
  .register(ORG_CHART_PLUGIN)
  .register(WALKTOUR_PLUGIN)
  .register(CASCADER_PLUGIN)
  .register(TREE_PLUGIN)
  .register(POPOVER_PLUGIN)
  .freeze()
