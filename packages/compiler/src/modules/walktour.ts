import {
  WALKTOUR_MODULE_TYPE,
  WALKTOUR_PLUGIN_ID,
  resolveWalktourModule
} from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const WALKTOUR_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: WALKTOUR_PLUGIN_ID,
  moduleType: WALKTOUR_MODULE_TYPE,
  warningCodePrefix: 'walktour-module',
  displayName: 'Walktour',
  resolve: resolveWalktourModule,
  payload: (config) => ({ ...config })
})
