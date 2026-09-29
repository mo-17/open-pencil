import {
  RATING_MODULE_TYPE,
  RATING_PLUGIN_ID,
  resolveRatingModule
} from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const RATING_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: RATING_PLUGIN_ID,
  moduleType: RATING_MODULE_TYPE,
  warningCodePrefix: 'rating-module',
  displayName: 'Rating',
  resolve: resolveRatingModule,
  payload: (config) => ({ ...config })
})
