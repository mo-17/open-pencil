import { DROPDOWN_MENU_COMPILER_MODULE_LOWERER } from '#compiler/modules/dropdown-menu'
import { MODAL_COMPILER_MODULE_LOWERER } from '#compiler/modules/modal'
import { CompilerModuleRegistry } from '#compiler/modules/registry'
import { SLIDE_MENU_COMPILER_MODULE_LOWERER } from '#compiler/modules/slide-menu'
import { UPLOAD_BUTTON_COMPILER_MODULE_LOWERER } from '#compiler/modules/upload-button'
import { VIDEO_COMPILER_MODULE_LOWERER } from '#compiler/modules/video'
import { VR_TOUR_COMPILER_MODULE_LOWERER } from '#compiler/modules/vr-tour'

import { DROPDOWN_MENU_VUE_MODULE_ADAPTER } from './dropdown-menu'
import { MODAL_VUE_MODULE_ADAPTER } from './modal'
import { SLIDE_MENU_VUE_MODULE_ADAPTER } from './slide-menu'
import { UPLOAD_BUTTON_VUE_MODULE_ADAPTER } from './upload-button'
import { VIDEO_VUE_MODULE_ADAPTER } from './video'
import { VR_TOUR_VUE_MODULE_ADAPTER } from './vr-tour'

/** Vue v1 intentionally registers only fully implemented module runtimes.
 * Every other trusted module remains a static shell with an explicit warning. */
export const BUILTIN_VUE_MODULE_REGISTRY = new CompilerModuleRegistry()
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
  .freeze()
