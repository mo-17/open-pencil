import { TREE_MODULE_TYPE, TREE_PLUGIN_ID, resolveTreeModule } from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'
export const TREE_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: TREE_PLUGIN_ID,
  moduleType: TREE_MODULE_TYPE,
  warningCodePrefix: 'tree-module',
  displayName: 'Tree',
  resolve: resolveTreeModule,
  payload: (config) => ({ ...config })
})
