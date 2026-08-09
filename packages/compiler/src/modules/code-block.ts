import {
  CODE_BLOCK_MODULE_TYPE,
  CODE_BLOCK_PLUGIN_ID,
  resolveCodeBlockModule
} from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const CODE_BLOCK_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: CODE_BLOCK_PLUGIN_ID,
  moduleType: CODE_BLOCK_MODULE_TYPE,
  warningCodePrefix: 'code-block-module',
  displayName: 'Code Block',
  resolve: resolveCodeBlockModule,
  payload: (config) => ({ ...config })
})
