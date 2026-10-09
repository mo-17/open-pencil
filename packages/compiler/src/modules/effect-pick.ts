import {
  EFFECT_PICK_MODULE_TYPE,
  EFFECT_PICK_PLUGIN_ID,
  resolveEffectPickModule
} from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const EFFECT_PICK_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: EFFECT_PICK_PLUGIN_ID,
  moduleType: EFFECT_PICK_MODULE_TYPE,
  warningCodePrefix: 'effect-pick-module',
  displayName: 'EffectPick',
  resolve: resolveEffectPickModule,
  payload: (config) => ({ ...config })
})
