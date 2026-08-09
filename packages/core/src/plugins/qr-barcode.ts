import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JsonObject } from '@open-pencil/scene-graph/primitives'

import {
  createContractModuleDefinition,
  createContractModuleInstance,
  createSingleModulePlugin,
  parseExactModuleConfig,
  resolveContractModule,
  type ModuleContract
} from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import {
  assertBoundedPluginConfigBytes,
  parseBoundedPluginInteger,
  parseBoundedPluginText,
  parseCanonicalPluginColor,
  parsePluginBoolean,
  parsePluginStringEnum
} from './parse-helpers'
import type { ModulePropertyField, ModuleResolution } from './types'

export const QR_BARCODE_PLUGIN_ID = 'open-pencil.qr-barcode'
export const QR_BARCODE_MODULE_TYPE = 'qr-barcode'
export const QR_BARCODE_MODULE_CONFIG_VERSION = 1
export const QR_BARCODE_MODULE_DEFAULT_SIZE = Object.freeze({ width: 320, height: 320 })
export const QR_BARCODE_MODULE_LIMITS = Object.freeze({
  qrValue: 2_048,
  barcodeValue: 128,
  caption: 120,
  quietZoneMin: 0,
  quietZoneMax: 32,
  configBytes: 8_192
})

export type QrBarcodeFormatV1 = 'qr' | 'code128'
export type QrErrorCorrectionV1 = 'low' | 'medium' | 'quartile' | 'high'

export interface QrBarcodeModuleConfigV1 extends JsonObject {
  format: QrBarcodeFormatV1
  value: string
  caption: string
  showCaption: boolean
  errorCorrection: QrErrorCorrectionV1
  quietZone: number
  foregroundColor: string
  backgroundColor: string
}

export type QrBarcodeModuleConfig = QrBarcodeModuleConfigV1

export const QR_BARCODE_MODULE_DEFAULT_CONFIG: Readonly<QrBarcodeModuleConfigV1> = Object.freeze({
  format: 'qr',
  value: 'OpenPencil',
  caption: 'Scan code',
  showCaption: true,
  errorCorrection: 'medium',
  quietZone: 12,
  foregroundColor: '#111827',
  backgroundColor: '#FFFFFF'
})

const CONFIG_KEYS = new Set([
  'format',
  'value',
  'caption',
  'showCaption',
  'errorCorrection',
  'quietZone',
  'foregroundColor',
  'backgroundColor'
])
const FORMATS = new Set<QrBarcodeFormatV1>(['qr', 'code128'])
const ERROR_CORRECTIONS = new Set<QrErrorCorrectionV1>(['low', 'medium', 'quartile', 'high'])

function parseEncodedValue(value: unknown, format: QrBarcodeFormatV1): string {
  const maximum =
    format === 'qr' ? QR_BARCODE_MODULE_LIMITS.qrValue : QR_BARCODE_MODULE_LIMITS.barcodeValue
  const parsed = parseBoundedPluginText(value, 'QR/barcode config value', 1, maximum)
  for (let index = 0; index < parsed.length; index += 1) {
    const code = parsed.charCodeAt(index)
    if (code <= 31 || code === 127) {
      throw new TypeError('QR/barcode config value must not contain control characters')
    }
    if (format === 'code128' && code > 126) {
      throw new TypeError('QR/barcode config code128 value must contain printable ASCII only')
    }
  }
  return parsed
}

function parseQrBarcodeConfig(value: unknown) {
  return parseExactModuleConfig(
    value,
    CONFIG_KEYS,
    'QR/barcode config must contain exactly format, value, caption, showCaption, errorCorrection, quietZone, foregroundColor, and backgroundColor',
    (source): QrBarcodeModuleConfigV1 => {
      const format = parsePluginStringEnum(
        source.format,
        'QR/barcode config format',
        FORMATS,
        'qr or code128'
      )
      const config: QrBarcodeModuleConfigV1 = {
        format,
        value: parseEncodedValue(source.value, format),
        caption: parseBoundedPluginText(
          source.caption,
          'QR/barcode config caption',
          0,
          QR_BARCODE_MODULE_LIMITS.caption
        ),
        showCaption: parsePluginBoolean(source.showCaption, 'QR/barcode config showCaption'),
        errorCorrection: parsePluginStringEnum(
          source.errorCorrection,
          'QR/barcode config errorCorrection',
          ERROR_CORRECTIONS,
          'low, medium, quartile, or high'
        ),
        quietZone: parseBoundedPluginInteger(
          source.quietZone,
          'QR/barcode config quietZone',
          QR_BARCODE_MODULE_LIMITS.quietZoneMin,
          QR_BARCODE_MODULE_LIMITS.quietZoneMax
        ),
        foregroundColor: parseCanonicalPluginColor(
          source.foregroundColor,
          'QR/barcode config foregroundColor'
        ),
        backgroundColor: parseCanonicalPluginColor(
          source.backgroundColor,
          'QR/barcode config backgroundColor'
        )
      }
      assertBoundedPluginConfigBytes(
        config,
        'QR/barcode config',
        QR_BARCODE_MODULE_LIMITS.configBytes
      )
      return config
    }
  )
}

const QR_BARCODE_MODULE_CONTRACT: ModuleContract<QrBarcodeModuleConfigV1> = {
  pluginId: QR_BARCODE_PLUGIN_ID,
  moduleType: QR_BARCODE_MODULE_TYPE,
  configVersion: QR_BARCODE_MODULE_CONFIG_VERSION,
  displayName: 'QR/barcode',
  defaultConfig: QR_BARCODE_MODULE_DEFAULT_CONFIG,
  parseConfig: parseQrBarcodeConfig
}

export function createQrBarcodeModuleInstance(config?: unknown): ModuleInstanceV1 {
  return createContractModuleInstance(QR_BARCODE_MODULE_CONTRACT, config)
}

export function createQrBarcodeModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'QR / Barcode',
    defaultSize: QR_BARCODE_MODULE_DEFAULT_SIZE,
    fillColor: { r: 1, g: 1, b: 1, a: 1 },
    strokeColor: { r: 0.82, g: 0.84, b: 0.88, a: 1 },
    module: createQrBarcodeModuleInstance(config)
  })
}

export function resolveQrBarcodeModule(value: unknown): ModuleResolution<QrBarcodeModuleConfigV1> {
  return resolveContractModule(value, QR_BARCODE_MODULE_CONTRACT)
}

const QR_BARCODE_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['format'],
    kind: 'select',
    label: 'Format',
    i18nLabelKey: 'lowcodeModuleFieldQrBarcodeFormat',
    options: ['qr', 'code128']
  },
  {
    path: ['value'],
    kind: 'text',
    label: 'Value',
    i18nLabelKey: 'lowcodeModuleFieldQrBarcodeValue'
  },
  {
    path: ['caption'],
    kind: 'text',
    label: 'Caption',
    i18nLabelKey: 'lowcodeModuleFieldQrBarcodeCaption'
  },
  {
    path: ['showCaption'],
    kind: 'boolean',
    label: 'Show caption',
    i18nLabelKey: 'lowcodeModuleFieldQrBarcodeShowCaption'
  },
  {
    path: ['errorCorrection'],
    kind: 'select',
    label: 'Error correction',
    i18nLabelKey: 'lowcodeModuleFieldQrBarcodeErrorCorrection',
    options: ['low', 'medium', 'quartile', 'high']
  },
  {
    path: ['quietZone'],
    kind: 'number',
    label: 'Quiet zone',
    i18nLabelKey: 'lowcodeModuleFieldQrBarcodeQuietZone',
    min: QR_BARCODE_MODULE_LIMITS.quietZoneMin,
    max: QR_BARCODE_MODULE_LIMITS.quietZoneMax,
    step: 1
  },
  {
    path: ['foregroundColor'],
    kind: 'color',
    label: 'Foreground',
    i18nLabelKey: 'lowcodeModuleFieldQrBarcodeForeground'
  },
  {
    path: ['backgroundColor'],
    kind: 'color',
    label: 'Background',
    i18nLabelKey: 'lowcodeModuleFieldQrBarcodeBackground'
  }
])

export const QR_BARCODE_MODULE_DEFINITION = createContractModuleDefinition(
  QR_BARCODE_MODULE_CONTRACT,
  {
    name: 'QR / Barcode',
    description: 'Bounded QR or Code 128 data with deterministic offline design preview.',
    i18nNameKey: 'lowcodeModuleQrBarcodeName',
    i18nDescriptionKey: 'lowcodeModuleQrBarcodeDescription',
    defaultSize: QR_BARCODE_MODULE_DEFAULT_SIZE,
    fields: QR_BARCODE_MODULE_FIELDS,
    createInstance: createQrBarcodeModuleInstance,
    createFrameOverrides: createQrBarcodeModuleFrameOverrides,
    resolve: resolveQrBarcodeModule
  }
)

export const QR_BARCODE_PLUGIN = createSingleModulePlugin(
  QR_BARCODE_PLUGIN_ID,
  'OpenPencil QR / Barcode',
  QR_BARCODE_MODULE_DEFINITION
)
