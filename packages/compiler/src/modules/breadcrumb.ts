import {
  BREADCRUMB_MODULE_TYPE,
  BREADCRUMB_PLUGIN_ID,
  resolveBreadcrumbModule
} from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const BREADCRUMB_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: BREADCRUMB_PLUGIN_ID,
  moduleType: BREADCRUMB_MODULE_TYPE,
  warningCodePrefix: 'breadcrumb-module',
  displayName: 'Breadcrumb',
  resolve: resolveBreadcrumbModule,
  payload: (config) => ({ ...config, items: config.items.map((item) => ({ ...item })) })
})
