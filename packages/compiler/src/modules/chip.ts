import { CHIP_MODULE_TYPE, CHIP_PLUGIN_ID, resolveChipModule } from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'
export const CHIP_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: CHIP_PLUGIN_ID,
  moduleType: CHIP_MODULE_TYPE,
  warningCodePrefix: 'chip-module',
  displayName: 'Chip',
  resolve: resolveChipModule,
  payload: (config) => ({ ...config })
})
