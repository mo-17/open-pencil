import {
  STEPPER_MODULE_TYPE,
  STEPPER_PLUGIN_ID,
  resolveStepperModule
} from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const STEPPER_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: STEPPER_PLUGIN_ID,
  moduleType: STEPPER_MODULE_TYPE,
  warningCodePrefix: 'stepper-module',
  displayName: 'Stepper',
  resolve: resolveStepperModule,
  payload: (config) => ({ ...config, items: config.items.map((item) => ({ ...item })) })
})
