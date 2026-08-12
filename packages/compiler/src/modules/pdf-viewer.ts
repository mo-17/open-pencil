import {
  PDF_VIEWER_MODULE_TYPE,
  PDF_VIEWER_PLUGIN_ID,
  resolvePDFViewerModule
} from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const PDF_VIEWER_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: PDF_VIEWER_PLUGIN_ID,
  moduleType: PDF_VIEWER_MODULE_TYPE,
  warningCodePrefix: 'pdf-viewer-module',
  displayName: 'PDF Viewer',
  resolve: resolvePDFViewerModule,
  payload: (config) => ({ ...config })
})
