import {
  PROGRESS_MODULE_TYPE,
  PROGRESS_PLUGIN_ID,
  resolveProgressModule
} from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const PROGRESS_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: PROGRESS_PLUGIN_ID,
  moduleType: PROGRESS_MODULE_TYPE,
  warningCodePrefix: 'progress-module',
  displayName: 'Progress',
  resolve: resolveProgressModule,
  payload: (config) => ({ ...config })
})
