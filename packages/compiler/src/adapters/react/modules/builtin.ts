import { ACCORDION_COMPILER_MODULE_LOWERER } from '#compiler/modules/accordion'
import { ALERT_COMPILER_MODULE_LOWERER } from '#compiler/modules/alert'
import { AUDIO_PLAYER_COMPILER_MODULE_LOWERER } from '#compiler/modules/audio-player'
import { AVATAR_COMPILER_MODULE_LOWERER } from '#compiler/modules/avatar'
import { BADGE_COMPILER_MODULE_LOWERER } from '#compiler/modules/badge'
import { BREADCRUMB_COMPILER_MODULE_LOWERER } from '#compiler/modules/breadcrumb'
import { CAROUSEL_COMPILER_MODULE_LOWERER } from '#compiler/modules/carousel'
import { CASCADER_COMPILER_MODULE_LOWERER } from '#compiler/modules/cascader'
import { CHART_COMPILER_MODULE_LOWERER } from '#compiler/modules/chart'
import { CHIP_COMPILER_MODULE_LOWERER } from '#compiler/modules/chip'
import { CODE_BLOCK_COMPILER_MODULE_LOWERER } from '#compiler/modules/code-block'
import { DATA_GRID_COMPILER_MODULE_LOWERER } from '#compiler/modules/data-grid'
import { DATE_RANGE_COMPILER_MODULE_LOWERER } from '#compiler/modules/date-range'
import { DESCRIPTIONS_COMPILER_MODULE_LOWERER } from '#compiler/modules/descriptions'
import { DROPDOWN_MENU_COMPILER_MODULE_LOWERER } from '#compiler/modules/dropdown-menu'
import { EFFECT_PICK_COMPILER_MODULE_LOWERER } from '#compiler/modules/effect-pick'
import { EMPTY_STATE_COMPILER_MODULE_LOWERER } from '#compiler/modules/empty-state'
import { HTML_COMPILER_MODULE_LOWERER } from '#compiler/modules/html'
import { LOTTIE_COMPILER_MODULE_LOWERER } from '#compiler/modules/lottie'
import { MAP_COMPILER_MODULE_LOWERER } from '#compiler/modules/map'
import { MARKDOWN_COMPILER_MODULE_LOWERER } from '#compiler/modules/markdown'
import { MODAL_COMPILER_MODULE_LOWERER } from '#compiler/modules/modal'
import { ORG_CHART_COMPILER_MODULE_LOWERER } from '#compiler/modules/org-chart'
import { PAGINATION_COMPILER_MODULE_LOWERER } from '#compiler/modules/pagination'
import { PDF_VIEWER_COMPILER_MODULE_LOWERER } from '#compiler/modules/pdf-viewer'
import { POPOVER_COMPILER_MODULE_LOWERER } from '#compiler/modules/popover'
import { PROGRESS_COMPILER_MODULE_LOWERER } from '#compiler/modules/progress'
import { QR_BARCODE_COMPILER_MODULE_LOWERER } from '#compiler/modules/qr-barcode'
import { RATING_COMPILER_MODULE_LOWERER } from '#compiler/modules/rating'
import { CompilerModuleRegistry } from '#compiler/modules/registry'
import { RICH_TEXT_COMPILER_MODULE_LOWERER } from '#compiler/modules/rich-text'
import { SKELETON_COMPILER_MODULE_LOWERER } from '#compiler/modules/skeleton'
import { SLIDE_MENU_COMPILER_MODULE_LOWERER } from '#compiler/modules/slide-menu'
import { SLIDER_COMPILER_MODULE_LOWERER } from '#compiler/modules/slider'
import { STEPPER_COMPILER_MODULE_LOWERER } from '#compiler/modules/stepper'
import { TABLE_COMPILER_MODULE_LOWERER } from '#compiler/modules/table'
import { TABS_COMPILER_MODULE_LOWERER } from '#compiler/modules/tabs'
import { TIMELINE_COMPILER_MODULE_LOWERER } from '#compiler/modules/timeline'
import { TOOLTIP_COMPILER_MODULE_LOWERER } from '#compiler/modules/tooltip'
import { TREE_COMPILER_MODULE_LOWERER } from '#compiler/modules/tree'
import { UPLOAD_BUTTON_COMPILER_MODULE_LOWERER } from '#compiler/modules/upload-button'
import { VIDEO_COMPILER_MODULE_LOWERER } from '#compiler/modules/video'
import { VR_TOUR_COMPILER_MODULE_LOWERER } from '#compiler/modules/vr-tour'
import { WALKTOUR_COMPILER_MODULE_LOWERER } from '#compiler/modules/walktour'

import { ACCORDION_REACT_MODULE_ADAPTER } from './accordion'
import { ALERT_REACT_MODULE_ADAPTER } from './alert'
import { AUDIO_PLAYER_REACT_MODULE_ADAPTER } from './audio-player'
import { AVATAR_REACT_MODULE_ADAPTER } from './avatar'
import { BADGE_REACT_MODULE_ADAPTER } from './badge'
import { BREADCRUMB_REACT_MODULE_ADAPTER } from './breadcrumb'
import { CAROUSEL_REACT_MODULE_ADAPTER } from './carousel'
import { CASCADER_REACT_MODULE_ADAPTER } from './cascader'
import { CHART_REACT_MODULE_ADAPTER } from './chart'
import { CHIP_REACT_MODULE_ADAPTER } from './chip'
import { CODE_BLOCK_REACT_MODULE_ADAPTER } from './code-block'
import { DATA_GRID_REACT_MODULE_ADAPTER } from './data-grid'
import { DATE_RANGE_REACT_MODULE_ADAPTER } from './date-range'
import { DESCRIPTIONS_REACT_MODULE_ADAPTER } from './descriptions'
import { DROPDOWN_MENU_REACT_MODULE_ADAPTER } from './dropdown-menu'
import { EFFECT_PICK_REACT_MODULE_ADAPTER } from './effect-pick'
import { EMPTY_STATE_REACT_MODULE_ADAPTER } from './empty-state'
import { HTML_REACT_MODULE_ADAPTER } from './html'
import { LOTTIE_REACT_MODULE_ADAPTER } from './lottie'
import { MAP_REACT_MODULE_ADAPTER } from './map'
import { MARKDOWN_REACT_MODULE_ADAPTER } from './markdown'
import { MODAL_REACT_MODULE_ADAPTER } from './modal'
import { ORG_CHART_REACT_MODULE_ADAPTER } from './org-chart'
import { PAGINATION_REACT_MODULE_ADAPTER } from './pagination'
import { PDF_VIEWER_REACT_MODULE_ADAPTER } from './pdf-viewer'
import { POPOVER_REACT_MODULE_ADAPTER } from './popover'
import { PROGRESS_REACT_MODULE_ADAPTER } from './progress'
import { QR_BARCODE_REACT_MODULE_ADAPTER } from './qr-barcode'
import { RATING_REACT_MODULE_ADAPTER } from './rating'
import { RICH_TEXT_REACT_MODULE_ADAPTER } from './rich-text'
import { SKELETON_REACT_MODULE_ADAPTER } from './skeleton'
import { SLIDE_MENU_REACT_MODULE_ADAPTER } from './slide-menu'
import { SLIDER_REACT_MODULE_ADAPTER } from './slider'
import { STEPPER_REACT_MODULE_ADAPTER } from './stepper'
import { TABLE_REACT_MODULE_ADAPTER } from './table'
import { TABS_REACT_MODULE_ADAPTER } from './tabs'
import { TIMELINE_REACT_MODULE_ADAPTER } from './timeline'
import { TOOLTIP_REACT_MODULE_ADAPTER } from './tooltip'
import { TREE_REACT_MODULE_ADAPTER } from './tree'
import { UPLOAD_BUTTON_REACT_MODULE_ADAPTER } from './upload-button'
import { VIDEO_REACT_MODULE_ADAPTER } from './video'
import { VR_TOUR_REACT_MODULE_ADAPTER } from './vr-tour'
import { WALKTOUR_REACT_MODULE_ADAPTER } from './walktour'

/** React-owned target registry. It deliberately mirrors the neutral lowerer
 * manifest while keeping framework adapters out of the IR dependency graph. */
export const BUILTIN_REACT_MODULE_REGISTRY = new CompilerModuleRegistry()
  .register({
    lowerer: VR_TOUR_COMPILER_MODULE_LOWERER,
    targets: { react: VR_TOUR_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: MAP_COMPILER_MODULE_LOWERER,
    targets: { react: MAP_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: CHART_COMPILER_MODULE_LOWERER,
    targets: { react: CHART_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: HTML_COMPILER_MODULE_LOWERER,
    targets: { react: HTML_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: RICH_TEXT_COMPILER_MODULE_LOWERER,
    targets: { react: RICH_TEXT_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: SLIDE_MENU_COMPILER_MODULE_LOWERER,
    targets: { react: SLIDE_MENU_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: MODAL_COMPILER_MODULE_LOWERER,
    targets: { react: MODAL_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: DROPDOWN_MENU_COMPILER_MODULE_LOWERER,
    targets: { react: DROPDOWN_MENU_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: VIDEO_COMPILER_MODULE_LOWERER,
    targets: { react: VIDEO_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: TABLE_COMPILER_MODULE_LOWERER,
    targets: { react: TABLE_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: LOTTIE_COMPILER_MODULE_LOWERER,
    targets: { react: LOTTIE_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: CAROUSEL_COMPILER_MODULE_LOWERER,
    targets: { react: CAROUSEL_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: DATA_GRID_COMPILER_MODULE_LOWERER,
    targets: { react: DATA_GRID_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: TABS_COMPILER_MODULE_LOWERER,
    targets: { react: TABS_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: ACCORDION_COMPILER_MODULE_LOWERER,
    targets: { react: ACCORDION_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: QR_BARCODE_COMPILER_MODULE_LOWERER,
    targets: { react: QR_BARCODE_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: MARKDOWN_COMPILER_MODULE_LOWERER,
    targets: { react: MARKDOWN_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: CODE_BLOCK_COMPILER_MODULE_LOWERER,
    targets: { react: CODE_BLOCK_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: PDF_VIEWER_COMPILER_MODULE_LOWERER,
    targets: { react: PDF_VIEWER_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: AUDIO_PLAYER_COMPILER_MODULE_LOWERER,
    targets: { react: AUDIO_PLAYER_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: UPLOAD_BUTTON_COMPILER_MODULE_LOWERER,
    targets: { react: UPLOAD_BUTTON_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: SLIDER_COMPILER_MODULE_LOWERER,
    targets: { react: SLIDER_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: RATING_COMPILER_MODULE_LOWERER,
    targets: { react: RATING_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: STEPPER_COMPILER_MODULE_LOWERER,
    targets: { react: STEPPER_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: BREADCRUMB_COMPILER_MODULE_LOWERER,
    targets: { react: BREADCRUMB_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: ALERT_COMPILER_MODULE_LOWERER,
    targets: { react: ALERT_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: PROGRESS_COMPILER_MODULE_LOWERER,
    targets: { react: PROGRESS_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: CHIP_COMPILER_MODULE_LOWERER,
    targets: { react: CHIP_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: AVATAR_COMPILER_MODULE_LOWERER,
    targets: { react: AVATAR_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: BADGE_COMPILER_MODULE_LOWERER,
    targets: { react: BADGE_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: TIMELINE_COMPILER_MODULE_LOWERER,
    targets: { react: TIMELINE_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: TOOLTIP_COMPILER_MODULE_LOWERER,
    targets: { react: TOOLTIP_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: SKELETON_COMPILER_MODULE_LOWERER,
    targets: { react: SKELETON_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: EMPTY_STATE_COMPILER_MODULE_LOWERER,
    targets: { react: EMPTY_STATE_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: DATE_RANGE_COMPILER_MODULE_LOWERER,
    targets: { react: DATE_RANGE_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: TREE_COMPILER_MODULE_LOWERER,
    targets: { react: TREE_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: POPOVER_COMPILER_MODULE_LOWERER,
    targets: { react: POPOVER_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: DESCRIPTIONS_COMPILER_MODULE_LOWERER,
    targets: { react: DESCRIPTIONS_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: PAGINATION_COMPILER_MODULE_LOWERER,
    targets: { react: PAGINATION_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: ORG_CHART_COMPILER_MODULE_LOWERER,
    targets: { react: ORG_CHART_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: WALKTOUR_COMPILER_MODULE_LOWERER,
    targets: { react: WALKTOUR_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: CASCADER_COMPILER_MODULE_LOWERER,
    targets: { react: CASCADER_REACT_MODULE_ADAPTER }
  })
  .register({
    lowerer: EFFECT_PICK_COMPILER_MODULE_LOWERER,
    targets: { react: EFFECT_PICK_REACT_MODULE_ADAPTER }
  })
  .freeze()
