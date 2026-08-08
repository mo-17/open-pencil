import { CHART_COMPILER_MODULE_LOWERER } from './chart'
import { CAROUSEL_COMPILER_MODULE_LOWERER } from './carousel'
import { DATA_GRID_COMPILER_MODULE_LOWERER } from './data-grid'
import { HTML_COMPILER_MODULE_LOWERER } from './html'
import { MAP_COMPILER_MODULE_LOWERER } from './map'
import { LOTTIE_COMPILER_MODULE_LOWERER } from './lottie'
import { CompilerModuleRegistry } from './registry'
import { RICH_TEXT_COMPILER_MODULE_LOWERER } from './rich-text'
import { SLIDE_MENU_COMPILER_MODULE_LOWERER } from './slide-menu'
import { TABLE_COMPILER_MODULE_LOWERER } from './table'
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
  .freeze()
