import {
  CASCADER_MODULE_TYPE,
  CASCADER_PLUGIN_ID,
  resolveCascaderModule
} from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const CASCADER_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: CASCADER_PLUGIN_ID,
  moduleType: CASCADER_MODULE_TYPE,
  warningCodePrefix: 'cascader-module',
  displayName: 'Cascader',
  resolve: resolveCascaderModule,
  payload: (config) => ({ ...config })
})
