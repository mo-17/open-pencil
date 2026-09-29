import {
  SKELETON_MODULE_TYPE,
  SKELETON_PLUGIN_ID,
  resolveSkeletonModule
} from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const SKELETON_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: SKELETON_PLUGIN_ID,
  moduleType: SKELETON_MODULE_TYPE,
  warningCodePrefix: 'skeleton-module',
  displayName: 'Skeleton',
  resolve: resolveSkeletonModule,
  payload: (config) => ({ ...config })
})
