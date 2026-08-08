import { CHART_COMPILER_MODULE_LOWERER } from '#compiler/modules/chart'
import { CAROUSEL_COMPILER_MODULE_LOWERER } from '#compiler/modules/carousel'
import { DATA_GRID_COMPILER_MODULE_LOWERER } from '#compiler/modules/data-grid'
import { HTML_COMPILER_MODULE_LOWERER } from '#compiler/modules/html'
import { LOTTIE_COMPILER_MODULE_LOWERER } from '#compiler/modules/lottie'
import { MAP_COMPILER_MODULE_LOWERER } from '#compiler/modules/map'
import { CompilerModuleRegistry } from '#compiler/modules/registry'
import { RICH_TEXT_COMPILER_MODULE_LOWERER } from '#compiler/modules/rich-text'
import { SLIDE_MENU_COMPILER_MODULE_LOWERER } from '#compiler/modules/slide-menu'
import { TABLE_COMPILER_MODULE_LOWERER } from '#compiler/modules/table'
import { VIDEO_COMPILER_MODULE_LOWERER } from '#compiler/modules/video'

import { CHART_REACT_MODULE_ADAPTER } from './chart'
import { CAROUSEL_REACT_MODULE_ADAPTER } from './carousel'
import { DATA_GRID_REACT_MODULE_ADAPTER } from './data-grid'
import { HTML_REACT_MODULE_ADAPTER } from './html'
import { LOTTIE_REACT_MODULE_ADAPTER } from './lottie'
import { MAP_REACT_MODULE_ADAPTER } from './map'
import { RICH_TEXT_REACT_MODULE_ADAPTER } from './rich-text'
import { SLIDE_MENU_REACT_MODULE_ADAPTER } from './slide-menu'
import { TABLE_REACT_MODULE_ADAPTER } from './table'
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
  .freeze()
