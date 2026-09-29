import {
  SLIDER_MODULE_TYPE,
  SLIDER_PLUGIN_ID,
  resolveSliderModule
} from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const SLIDER_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: SLIDER_PLUGIN_ID,
  moduleType: SLIDER_MODULE_TYPE,
  warningCodePrefix: 'slider-module',
  displayName: 'Slider',
  resolve: resolveSliderModule,
  payload: (config) => ({ ...config })
})
