import * as tooltip from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'
export const TOOLTIP_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: tooltip.TOOLTIP_PLUGIN_ID,
  moduleType: tooltip.TOOLTIP_MODULE_TYPE,
  warningCodePrefix: 'tooltip-module',
  displayName: 'Tooltip',
  resolve: tooltip.resolveTooltipModule,
  payload: (config) => ({ ...config })
})
