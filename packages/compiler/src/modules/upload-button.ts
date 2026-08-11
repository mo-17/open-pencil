import {
  resolveUploadButtonModule,
  UPLOAD_BUTTON_MODULE_TYPE,
  UPLOAD_BUTTON_PLUGIN_ID
} from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const UPLOAD_BUTTON_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: UPLOAD_BUTTON_PLUGIN_ID,
  moduleType: UPLOAD_BUTTON_MODULE_TYPE,
  warningCodePrefix: 'upload-button-module',
  displayName: 'Upload Button',
  resolve: resolveUploadButtonModule,
  payload: (config) => ({ ...config, accept: [...config.accept] })
})
