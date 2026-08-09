import {
  MARKDOWN_MODULE_TYPE,
  MARKDOWN_PLUGIN_ID,
  resolveMarkdownModule
} from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const MARKDOWN_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: MARKDOWN_PLUGIN_ID,
  moduleType: MARKDOWN_MODULE_TYPE,
  warningCodePrefix: 'markdown-module',
  displayName: 'Markdown',
  resolve: resolveMarkdownModule,
  payload: (config) => ({ ...config })
})
