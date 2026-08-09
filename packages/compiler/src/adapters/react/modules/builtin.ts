import { ACCORDION_COMPILER_MODULE_LOWERER } from '#compiler/modules/accordion'
import { AUDIO_PLAYER_COMPILER_MODULE_LOWERER } from '#compiler/modules/audio-player'
import { CAROUSEL_COMPILER_MODULE_LOWERER } from '#compiler/modules/carousel'
import { CHART_COMPILER_MODULE_LOWERER } from '#compiler/modules/chart'
import { CODE_BLOCK_COMPILER_MODULE_LOWERER } from '#compiler/modules/code-block'
import { DATA_GRID_COMPILER_MODULE_LOWERER } from '#compiler/modules/data-grid'
import { HTML_COMPILER_MODULE_LOWERER } from '#compiler/modules/html'
import { LOTTIE_COMPILER_MODULE_LOWERER } from '#compiler/modules/lottie'
import { MAP_COMPILER_MODULE_LOWERER } from '#compiler/modules/map'
import { MARKDOWN_COMPILER_MODULE_LOWERER } from '#compiler/modules/markdown'
import { PDF_VIEWER_COMPILER_MODULE_LOWERER } from '#compiler/modules/pdf-viewer'
import { QR_BARCODE_COMPILER_MODULE_LOWERER } from '#compiler/modules/qr-barcode'
import { CompilerModuleRegistry } from '#compiler/modules/registry'
import { RICH_TEXT_COMPILER_MODULE_LOWERER } from '#compiler/modules/rich-text'
import { SLIDE_MENU_COMPILER_MODULE_LOWERER } from '#compiler/modules/slide-menu'
import { TABLE_COMPILER_MODULE_LOWERER } from '#compiler/modules/table'
import { TABS_COMPILER_MODULE_LOWERER } from '#compiler/modules/tabs'
import { VIDEO_COMPILER_MODULE_LOWERER } from '#compiler/modules/video'

import { ACCORDION_REACT_MODULE_ADAPTER } from './accordion'
import { AUDIO_PLAYER_REACT_MODULE_ADAPTER } from './audio-player'
import { CAROUSEL_REACT_MODULE_ADAPTER } from './carousel'
import { CHART_REACT_MODULE_ADAPTER } from './chart'
import { CODE_BLOCK_REACT_MODULE_ADAPTER } from './code-block'
import { DATA_GRID_REACT_MODULE_ADAPTER } from './data-grid'
import { HTML_REACT_MODULE_ADAPTER } from './html'
import { LOTTIE_REACT_MODULE_ADAPTER } from './lottie'
import { MAP_REACT_MODULE_ADAPTER } from './map'
import { MARKDOWN_REACT_MODULE_ADAPTER } from './markdown'
import { PDF_VIEWER_REACT_MODULE_ADAPTER } from './pdf-viewer'
import { QR_BARCODE_REACT_MODULE_ADAPTER } from './qr-barcode'
import { RICH_TEXT_REACT_MODULE_ADAPTER } from './rich-text'
import { SLIDE_MENU_REACT_MODULE_ADAPTER } from './slide-menu'
import { TABLE_REACT_MODULE_ADAPTER } from './table'
import { TABS_REACT_MODULE_ADAPTER } from './tabs'
import { VIDEO_REACT_MODULE_ADAPTER } from './video'

/** React-owned target registry. It deliberately mirrors the neutral lowerer
 * manifest while keeping framework adapters out of the IR dependency graph. */
export const BUILTIN_REACT_MODULE_REGISTRY = new CompilerModuleRegistry()
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
  .freeze()
