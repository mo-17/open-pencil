import { TABS_MODULE_TYPE, TABS_PLUGIN_ID, resolveTabsModule } from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const TABS_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: TABS_PLUGIN_ID,
  moduleType: TABS_MODULE_TYPE,
  warningCodePrefix: 'tabs-module',
  displayName: 'Tabs',
  resolve: resolveTabsModule,
  payload: (config) => ({
    label: config.label,
    tabs: config.tabs.map((tab) => ({ ...tab })),
    initialTabId: config.initialTabId,
    orientation: config.orientation,
    activationMode: config.activationMode,
    showDivider: config.showDivider,
    backgroundColor: config.backgroundColor,
    textColor: config.textColor,
    accentColor: config.accentColor,
    fontSize: config.fontSize
  })
})
