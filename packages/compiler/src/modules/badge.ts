import * as badge from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const BADGE_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: badge.BADGE_PLUGIN_ID,
  moduleType: badge.BADGE_MODULE_TYPE,
  warningCodePrefix: 'badge-module',
  displayName: 'Badge',
  resolve: badge.resolveBadgeModule,
  payload: (config) => ({ ...config })
})
