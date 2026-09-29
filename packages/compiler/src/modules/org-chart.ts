import {
  ORG_CHART_MODULE_TYPE,
  ORG_CHART_PLUGIN_ID,
  resolveOrgChartModule
} from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const ORG_CHART_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: ORG_CHART_PLUGIN_ID,
  moduleType: ORG_CHART_MODULE_TYPE,
  warningCodePrefix: 'org-chart-module',
  displayName: 'Org Chart',
  resolve: resolveOrgChartModule,
  payload: (config) => ({ ...config })
})
