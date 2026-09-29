import {
  DATE_RANGE_MODULE_TYPE,
  DATE_RANGE_PLUGIN_ID,
  resolveDateRangeModule
} from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const DATE_RANGE_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: DATE_RANGE_PLUGIN_ID,
  moduleType: DATE_RANGE_MODULE_TYPE,
  warningCodePrefix: 'date-range-module',
  displayName: 'Date range',
  resolve: resolveDateRangeModule,
  payload: (config) => ({ ...config })
})
