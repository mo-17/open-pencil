import {
  AUDIO_PLAYER_MODULE_TYPE,
  AUDIO_PLAYER_PLUGIN_ID,
  resolveAudioPlayerModule
} from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const AUDIO_PLAYER_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: AUDIO_PLAYER_PLUGIN_ID,
  moduleType: AUDIO_PLAYER_MODULE_TYPE,
  warningCodePrefix: 'audio-player-module',
  displayName: 'Audio Player',
  resolve: resolveAudioPlayerModule,
  payload: (config) => ({ ...config })
})
