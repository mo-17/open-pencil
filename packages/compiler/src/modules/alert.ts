import { ALERT_MODULE_TYPE, ALERT_PLUGIN_ID, resolveAlertModule } from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const ALERT_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: ALERT_PLUGIN_ID,
  moduleType: ALERT_MODULE_TYPE,
  warningCodePrefix: 'alert-module',
  displayName: 'Alert',
  resolve: resolveAlertModule,
  payload: (config) => ({ ...config })
})
