import {
  TIMELINE_MODULE_TYPE,
  TIMELINE_PLUGIN_ID,
  resolveTimelineModule
} from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const TIMELINE_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: TIMELINE_PLUGIN_ID,
  moduleType: TIMELINE_MODULE_TYPE,
  warningCodePrefix: 'timeline-module',
  displayName: 'Timeline',
  resolve: resolveTimelineModule,
  payload: (config) => ({ ...config })
})
