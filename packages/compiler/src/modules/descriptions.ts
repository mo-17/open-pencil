import * as descriptions from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const DESCRIPTIONS_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: descriptions.DESCRIPTIONS_PLUGIN_ID,
  moduleType: descriptions.DESCRIPTIONS_MODULE_TYPE,
  warningCodePrefix: 'descriptions-module',
  displayName: 'Descriptions',
  resolve: descriptions.resolveDescriptionsModule,
  payload: (config) => ({ ...config })
})
