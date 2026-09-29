import * as emptyState from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const EMPTY_STATE_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: emptyState.EMPTY_STATE_PLUGIN_ID,
  moduleType: emptyState.EMPTY_STATE_MODULE_TYPE,
  warningCodePrefix: 'empty-state-module',
  displayName: 'Empty State',
  resolve: emptyState.resolveEmptyStateModule,
  payload: (config) => ({ ...config })
})
