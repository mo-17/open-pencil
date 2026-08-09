import {
  QR_BARCODE_MODULE_TYPE,
  QR_BARCODE_PLUGIN_ID,
  resolveQrBarcodeModule
} from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const QR_BARCODE_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: QR_BARCODE_PLUGIN_ID,
  moduleType: QR_BARCODE_MODULE_TYPE,
  warningCodePrefix: 'qr-barcode-module',
  displayName: 'QR / Barcode',
  resolve: resolveQrBarcodeModule,
  payload: (config) => ({ ...config })
})
