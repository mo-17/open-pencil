/** Both web targets use the same local encoders and drawing parameters. */
export const QRCODE_VERSION = '1.5.4'
export const JSBARCODE_VERSION = '3.12.3'

export const QR_BARCODE_RUNTIME_SOURCE = `
export interface OpenPencilQrBarcodeConfig {
  format: 'qr' | 'code128'
  value: string
  caption: string
  showCaption: boolean
  errorCorrection: 'low' | 'medium' | 'quartile' | 'high'
  quietZone: number
  foregroundColor: string
  backgroundColor: string
}

const ERROR_LEVEL = { low: 'L', medium: 'M', quartile: 'Q', high: 'H' } as const

function qrCodeOptions(config: OpenPencilQrBarcodeConfig) {
  return {
    color: { dark: config.foregroundColor, light: config.backgroundColor },
    errorCorrectionLevel: ERROR_LEVEL[config.errorCorrection],
    margin: Math.max(0, Math.round(config.quietZone / 4)),
    width: 1024
  }
}

function barcodeOptions(config: OpenPencilQrBarcodeConfig) {
  return {
    background: config.backgroundColor,
    displayValue: false,
    format: 'CODE128',
    height: 160,
    lineColor: config.foregroundColor,
    margin: config.quietZone,
    width: 3
  }
}
`
