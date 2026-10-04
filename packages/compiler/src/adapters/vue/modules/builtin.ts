import { ACCORDION_COMPILER_MODULE_LOWERER } from '#compiler/modules/accordion'
import * as alertLowerer from '#compiler/modules/alert'
import * as audioPlayerLowerer from '#compiler/modules/audio-player'
import * as avatarLowerer from '#compiler/modules/avatar'
import * as badgeLowerer from '#compiler/modules/badge'
import * as breadcrumbLowerer from '#compiler/modules/breadcrumb'
import { CAROUSEL_COMPILER_MODULE_LOWERER } from '#compiler/modules/carousel'
import { CASCADER_COMPILER_MODULE_LOWERER } from '#compiler/modules/cascader'
import { CHART_COMPILER_MODULE_LOWERER } from '#compiler/modules/chart'
import * as chipLowerer from '#compiler/modules/chip'
import { CODE_BLOCK_COMPILER_MODULE_LOWERER } from '#compiler/modules/code-block'
import { DATA_GRID_COMPILER_MODULE_LOWERER } from '#compiler/modules/data-grid'
import { DATE_RANGE_COMPILER_MODULE_LOWERER } from '#compiler/modules/date-range'
import { DESCRIPTIONS_COMPILER_MODULE_LOWERER } from '#compiler/modules/descriptions'
import { DROPDOWN_MENU_COMPILER_MODULE_LOWERER } from '#compiler/modules/dropdown-menu'
import { EMPTY_STATE_COMPILER_MODULE_LOWERER } from '#compiler/modules/empty-state'
import * as htmlLowerer from '#compiler/modules/html'
import * as lottieLowerer from '#compiler/modules/lottie'
import * as mapLowerer from '#compiler/modules/map'
import { MARKDOWN_COMPILER_MODULE_LOWERER } from '#compiler/modules/markdown'
import { MODAL_COMPILER_MODULE_LOWERER } from '#compiler/modules/modal'
import { ORG_CHART_COMPILER_MODULE_LOWERER } from '#compiler/modules/org-chart'
import { PAGINATION_COMPILER_MODULE_LOWERER } from '#compiler/modules/pagination'
import * as pdfViewerLowerer from '#compiler/modules/pdf-viewer'
import { POPOVER_COMPILER_MODULE_LOWERER } from '#compiler/modules/popover'
import * as progressLowerer from '#compiler/modules/progress'
import * as qrBarcodeLowerer from '#compiler/modules/qr-barcode'
import * as ratingLowerer from '#compiler/modules/rating'
import { CompilerModuleRegistry } from '#compiler/modules/registry'
import * as richTextLowerer from '#compiler/modules/rich-text'
import { SKELETON_COMPILER_MODULE_LOWERER } from '#compiler/modules/skeleton'
import { SLIDE_MENU_COMPILER_MODULE_LOWERER } from '#compiler/modules/slide-menu'
import * as sliderLowerer from '#compiler/modules/slider'
import * as stepperLowerer from '#compiler/modules/stepper'
import { TABLE_COMPILER_MODULE_LOWERER } from '#compiler/modules/table'
import { TABS_COMPILER_MODULE_LOWERER } from '#compiler/modules/tabs'
import * as timelineLowerer from '#compiler/modules/timeline'
import { TOOLTIP_COMPILER_MODULE_LOWERER } from '#compiler/modules/tooltip'
import { TREE_COMPILER_MODULE_LOWERER } from '#compiler/modules/tree'
import { UPLOAD_BUTTON_COMPILER_MODULE_LOWERER } from '#compiler/modules/upload-button'
import { VIDEO_COMPILER_MODULE_LOWERER } from '#compiler/modules/video'
import { VR_TOUR_COMPILER_MODULE_LOWERER } from '#compiler/modules/vr-tour'
import { WALKTOUR_COMPILER_MODULE_LOWERER } from '#compiler/modules/walktour'

import { ACCORDION_VUE_MODULE_ADAPTER } from './accordion'
import { ALERT_VUE_MODULE_ADAPTER } from './alert'
import { AUDIO_PLAYER_VUE_MODULE_ADAPTER } from './audio-player'
import { AVATAR_VUE_MODULE_ADAPTER } from './avatar'
import { BADGE_VUE_MODULE_ADAPTER } from './badge'
import { BREADCRUMB_VUE_MODULE_ADAPTER } from './breadcrumb'
import { CAROUSEL_VUE_MODULE_ADAPTER } from './carousel'
import { CASCADER_VUE_MODULE_ADAPTER } from './cascader'
import { CHART_VUE_MODULE_ADAPTER } from './chart'
import { CHIP_VUE_MODULE_ADAPTER } from './chip'
import { CODE_BLOCK_VUE_MODULE_ADAPTER } from './code-block'
import { DATA_GRID_VUE_MODULE_ADAPTER } from './data-grid'
import { DATE_RANGE_VUE_MODULE_ADAPTER } from './date-range'
import { DESCRIPTIONS_VUE_MODULE_ADAPTER } from './descriptions'
import { DROPDOWN_MENU_VUE_MODULE_ADAPTER } from './dropdown-menu'
import { EMPTY_STATE_VUE_MODULE_ADAPTER } from './empty-state'
import { HTML_VUE_MODULE_ADAPTER } from './html'
import { LOTTIE_VUE_MODULE_ADAPTER } from './lottie'
import { MAP_VUE_MODULE_ADAPTER } from './map'
import { MARKDOWN_VUE_MODULE_ADAPTER } from './markdown'
import { MODAL_VUE_MODULE_ADAPTER } from './modal'
import { ORG_CHART_VUE_MODULE_ADAPTER } from './org-chart'
import { PAGINATION_VUE_MODULE_ADAPTER } from './pagination'
import { PDF_VIEWER_VUE_MODULE_ADAPTER } from './pdf-viewer'
import { POPOVER_VUE_MODULE_ADAPTER } from './popover'
import { PROGRESS_VUE_MODULE_ADAPTER } from './progress'
import { QR_BARCODE_VUE_MODULE_ADAPTER } from './qr-barcode'
import { RATING_VUE_MODULE_ADAPTER } from './rating'
import { RICH_TEXT_VUE_MODULE_ADAPTER } from './rich-text'
import { SKELETON_VUE_MODULE_ADAPTER } from './skeleton'
import { SLIDE_MENU_VUE_MODULE_ADAPTER } from './slide-menu'
import { SLIDER_VUE_MODULE_ADAPTER } from './slider'
import { STEPPER_VUE_MODULE_ADAPTER } from './stepper'
import { TABLE_VUE_MODULE_ADAPTER } from './table'
import { TABS_VUE_MODULE_ADAPTER } from './tabs'
import { TIMELINE_VUE_MODULE_ADAPTER } from './timeline'
import { TOOLTIP_VUE_MODULE_ADAPTER } from './tooltip'
import { TREE_VUE_MODULE_ADAPTER } from './tree'
import { UPLOAD_BUTTON_VUE_MODULE_ADAPTER } from './upload-button'
import { VIDEO_VUE_MODULE_ADAPTER } from './video'
import { VR_TOUR_VUE_MODULE_ADAPTER } from './vr-tour'
import { WALKTOUR_VUE_MODULE_ADAPTER } from './walktour'

/** Vue v1 intentionally registers only fully implemented module runtimes.
 * Every other trusted module remains a static shell with an explicit warning. */
export const BUILTIN_VUE_MODULE_REGISTRY = new CompilerModuleRegistry()
  .register({
    lowerer: ACCORDION_COMPILER_MODULE_LOWERER,
    targets: { vue: ACCORDION_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: CAROUSEL_COMPILER_MODULE_LOWERER,
    targets: { vue: CAROUSEL_VUE_MODULE_ADAPTER }
  })
  .register({ lowerer: TABS_COMPILER_MODULE_LOWERER, targets: { vue: TABS_VUE_MODULE_ADAPTER } })
  .register({ lowerer: TABLE_COMPILER_MODULE_LOWERER, targets: { vue: TABLE_VUE_MODULE_ADAPTER } })
  .register({
    lowerer: DATA_GRID_COMPILER_MODULE_LOWERER,
    targets: { vue: DATA_GRID_VUE_MODULE_ADAPTER }
  })
  .register({ lowerer: VIDEO_COMPILER_MODULE_LOWERER, targets: { vue: VIDEO_VUE_MODULE_ADAPTER } })
  .register({
    lowerer: VR_TOUR_COMPILER_MODULE_LOWERER,
    targets: { vue: VR_TOUR_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: MODAL_COMPILER_MODULE_LOWERER,
    targets: { vue: MODAL_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: DROPDOWN_MENU_COMPILER_MODULE_LOWERER,
    targets: { vue: DROPDOWN_MENU_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: SLIDE_MENU_COMPILER_MODULE_LOWERER,
    targets: { vue: SLIDE_MENU_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: UPLOAD_BUTTON_COMPILER_MODULE_LOWERER,
    targets: { vue: UPLOAD_BUTTON_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: sliderLowerer.SLIDER_COMPILER_MODULE_LOWERER,
    targets: { vue: SLIDER_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: ratingLowerer.RATING_COMPILER_MODULE_LOWERER,
    targets: { vue: RATING_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: stepperLowerer.STEPPER_COMPILER_MODULE_LOWERER,
    targets: { vue: STEPPER_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: breadcrumbLowerer.BREADCRUMB_COMPILER_MODULE_LOWERER,
    targets: { vue: BREADCRUMB_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: alertLowerer.ALERT_COMPILER_MODULE_LOWERER,
    targets: { vue: ALERT_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: progressLowerer.PROGRESS_COMPILER_MODULE_LOWERER,
    targets: { vue: PROGRESS_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: chipLowerer.CHIP_COMPILER_MODULE_LOWERER,
    targets: { vue: CHIP_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: avatarLowerer.AVATAR_COMPILER_MODULE_LOWERER,
    targets: { vue: AVATAR_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: badgeLowerer.BADGE_COMPILER_MODULE_LOWERER,
    targets: { vue: BADGE_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: timelineLowerer.TIMELINE_COMPILER_MODULE_LOWERER,
    targets: { vue: TIMELINE_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: TOOLTIP_COMPILER_MODULE_LOWERER,
    targets: { vue: TOOLTIP_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: SKELETON_COMPILER_MODULE_LOWERER,
    targets: { vue: SKELETON_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: EMPTY_STATE_COMPILER_MODULE_LOWERER,
    targets: { vue: EMPTY_STATE_VUE_MODULE_ADAPTER }
  })
  .register({ lowerer: CHART_COMPILER_MODULE_LOWERER, targets: { vue: CHART_VUE_MODULE_ADAPTER } })
  .register({
    lowerer: CODE_BLOCK_COMPILER_MODULE_LOWERER,
    targets: { vue: CODE_BLOCK_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: MARKDOWN_COMPILER_MODULE_LOWERER,
    targets: { vue: MARKDOWN_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: DATE_RANGE_COMPILER_MODULE_LOWERER,
    targets: { vue: DATE_RANGE_VUE_MODULE_ADAPTER }
  })
  .register({ lowerer: TREE_COMPILER_MODULE_LOWERER, targets: { vue: TREE_VUE_MODULE_ADAPTER } })
  .register({
    lowerer: POPOVER_COMPILER_MODULE_LOWERER,
    targets: { vue: POPOVER_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: DESCRIPTIONS_COMPILER_MODULE_LOWERER,
    targets: { vue: DESCRIPTIONS_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: PAGINATION_COMPILER_MODULE_LOWERER,
    targets: { vue: PAGINATION_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: ORG_CHART_COMPILER_MODULE_LOWERER,
    targets: { vue: ORG_CHART_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: WALKTOUR_COMPILER_MODULE_LOWERER,
    targets: { vue: WALKTOUR_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: CASCADER_COMPILER_MODULE_LOWERER,
    targets: { vue: CASCADER_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: htmlLowerer.HTML_COMPILER_MODULE_LOWERER,
    targets: { vue: HTML_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: mapLowerer.MAP_COMPILER_MODULE_LOWERER,
    targets: { vue: MAP_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: pdfViewerLowerer.PDF_VIEWER_COMPILER_MODULE_LOWERER,
    targets: { vue: PDF_VIEWER_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: richTextLowerer.RICH_TEXT_COMPILER_MODULE_LOWERER,
    targets: { vue: RICH_TEXT_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: audioPlayerLowerer.AUDIO_PLAYER_COMPILER_MODULE_LOWERER,
    targets: { vue: AUDIO_PLAYER_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: lottieLowerer.LOTTIE_COMPILER_MODULE_LOWERER,
    targets: { vue: LOTTIE_VUE_MODULE_ADAPTER }
  })
  .register({
    lowerer: qrBarcodeLowerer.QR_BARCODE_COMPILER_MODULE_LOWERER,
    targets: { vue: QR_BARCODE_VUE_MODULE_ADAPTER }
  })
  .freeze()
