import {
  DROPDOWN_MENU_MODULE_TYPE,
  DROPDOWN_MENU_PLUGIN_ID,
  resolveDropdownMenuModule
} from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const DROPDOWN_MENU_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: DROPDOWN_MENU_PLUGIN_ID,
  moduleType: DROPDOWN_MENU_MODULE_TYPE,
  warningCodePrefix: 'dropdown-menu-module',
  displayName: 'Dropdown Menu',
  resolve: resolveDropdownMenuModule,
  payload: (config) => ({ ...config, items: config.items.map((item) => ({ ...item })) })
})
