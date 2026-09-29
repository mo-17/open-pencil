import {
  POPOVER_MODULE_TYPE,
  POPOVER_PLUGIN_ID,
  resolvePopoverModule
} from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const POPOVER_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: POPOVER_PLUGIN_ID,
  moduleType: POPOVER_MODULE_TYPE,
  warningCodePrefix: 'popover-module',
  displayName: 'Popover',
  resolve: resolvePopoverModule,
  payload: (config) => ({ ...config })
})
