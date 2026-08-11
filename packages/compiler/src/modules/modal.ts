import { MODAL_MODULE_TYPE, MODAL_PLUGIN_ID, resolveModalModule } from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const MODAL_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: MODAL_PLUGIN_ID,
  moduleType: MODAL_MODULE_TYPE,
  warningCodePrefix: 'modal-module',
  displayName: 'Modal',
  resolve: resolveModalModule,
  payload: (config) => ({ ...config })
})
