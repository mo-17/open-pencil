import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import * as moduleContract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import {
  assertBoundedPluginConfigBytes,
  parseBoundedPluginInteger,
  parseBoundedPluginText,
  parseCanonicalPluginColor,
  parsePluginBoolean,
  parsePluginStringEnum,
  parseSafePluginAssetSource
} from './parse-helpers'
import type { ModulePropertyField, ModuleResolution } from './types'

export const PDF_VIEWER_PLUGIN_ID = 'open-pencil.pdf-viewer'
export const PDF_VIEWER_MODULE_TYPE = 'pdf-viewer'
export const PDF_VIEWER_MODULE_CONFIG_VERSION = 1
export const PDF_VIEWER_MODULE_DEFAULT_SIZE = Object.freeze({ width: 640, height: 720 })
export const PDF_VIEWER_MODULE_LIMITS = Object.freeze({
  sourceUrl: 2_048,
  title: 160,
  pageMax: 100_000,
  configBytes: 8_192
})

export type PDFViewerFitV1 = 'width' | 'page'

export interface PDFViewerModuleConfigV1 extends JSONObject {
  sourceUrl: string
  title: string
  initialPage: number
  pageCountHint: number
  fit: PDFViewerFitV1
  showToolbar: boolean
  allowDownload: boolean
  backgroundColor: string
  accentColor: string
}

export type PDFViewerModuleConfig = PDFViewerModuleConfigV1

export const PDF_VIEWER_MODULE_DEFAULT_CONFIG: Readonly<PDFViewerModuleConfigV1> = Object.freeze({
  sourceUrl: '',
  title: 'Document',
  initialPage: 1,
  pageCountHint: 0,
  fit: 'width',
  showToolbar: true,
  allowDownload: false,
  backgroundColor: '#E5E7EB',
  accentColor: '#374151'
})

const CONFIG_KEYS = new Set([
  'sourceUrl',
  'title',
  'initialPage',
  'pageCountHint',
  'fit',
  'showToolbar',
  'allowDownload',
  'backgroundColor',
  'accentColor'
])
const FITS = new Set<PDFViewerFitV1>(['width', 'page'])

function parsePDFViewerConfig(value: unknown) {
  return moduleContract.parseExactModuleConfig(
    value,
    CONFIG_KEYS,
    'PDF viewer config must contain exactly sourceUrl, title, initialPage, pageCountHint, fit, showToolbar, allowDownload, backgroundColor, and accentColor',
    (source): PDFViewerModuleConfigV1 => {
      const initialPage = parseBoundedPluginInteger(
        source.initialPage,
        'PDF viewer config initialPage',
        1,
        PDF_VIEWER_MODULE_LIMITS.pageMax
      )
      const pageCountHint = parseBoundedPluginInteger(
        source.pageCountHint,
        'PDF viewer config pageCountHint',
        0,
        PDF_VIEWER_MODULE_LIMITS.pageMax
      )
      if (pageCountHint > 0 && initialPage > pageCountHint) {
        throw new TypeError('PDF viewer config initialPage must not exceed pageCountHint')
      }
      const config: PDFViewerModuleConfigV1 = {
        sourceUrl: parseSafePluginAssetSource(
          source.sourceUrl,
          'PDF viewer config sourceUrl',
          PDF_VIEWER_MODULE_LIMITS.sourceUrl
        ),
        title: parseBoundedPluginText(
          source.title,
          'PDF viewer config title',
          1,
          PDF_VIEWER_MODULE_LIMITS.title
        ),
        initialPage,
        pageCountHint,
        fit: parsePluginStringEnum(source.fit, 'PDF viewer config fit', FITS, 'width or page'),
        showToolbar: parsePluginBoolean(source.showToolbar, 'PDF viewer config showToolbar'),
        allowDownload: parsePluginBoolean(source.allowDownload, 'PDF viewer config allowDownload'),
        backgroundColor: parseCanonicalPluginColor(
          source.backgroundColor,
          'PDF viewer config backgroundColor'
        ),
        accentColor: parseCanonicalPluginColor(source.accentColor, 'PDF viewer config accentColor')
      }
      assertBoundedPluginConfigBytes(
        config,
        'PDF viewer config',
        PDF_VIEWER_MODULE_LIMITS.configBytes
      )
      return config
    }
  )
}

const PDF_VIEWER_MODULE_CONTRACT: moduleContract.ModuleContract<PDFViewerModuleConfigV1> = {
  pluginId: PDF_VIEWER_PLUGIN_ID,
  moduleType: PDF_VIEWER_MODULE_TYPE,
  configVersion: PDF_VIEWER_MODULE_CONFIG_VERSION,
  displayName: 'PDF viewer',
  defaultConfig: PDF_VIEWER_MODULE_DEFAULT_CONFIG,
  parseConfig: parsePDFViewerConfig
}

export function createPDFViewerModuleInstance(config?: unknown): ModuleInstanceV1 {
  return moduleContract.createContractModuleInstance(PDF_VIEWER_MODULE_CONTRACT, config)
}

export function createPDFViewerModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'PDF Viewer',
    defaultSize: PDF_VIEWER_MODULE_DEFAULT_SIZE,
    fillColor: { r: 0.9, g: 0.91, b: 0.92, a: 1 },
    strokeColor: { r: 0.61, g: 0.64, b: 0.69, a: 1 },
    module: createPDFViewerModuleInstance(config)
  })
}

export function resolvePDFViewerModule(value: unknown): ModuleResolution<PDFViewerModuleConfigV1> {
  return moduleContract.resolveContractModule(value, PDF_VIEWER_MODULE_CONTRACT)
}

const PDF_VIEWER_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['sourceUrl'],
    kind: 'text',
    label: 'PDF source',
    i18nLabelKey: 'lowcodeModuleFieldPdfViewerSource'
  },
  {
    path: ['title'],
    kind: 'text',
    label: 'Title',
    i18nLabelKey: 'lowcodeModuleFieldPdfViewerTitle'
  },
  {
    path: ['initialPage'],
    kind: 'number',
    label: 'Initial page',
    i18nLabelKey: 'lowcodeModuleFieldPdfViewerInitialPage',
    min: 1,
    max: PDF_VIEWER_MODULE_LIMITS.pageMax,
    step: 1
  },
  {
    path: ['pageCountHint'],
    kind: 'number',
    label: 'Page count hint',
    i18nLabelKey: 'lowcodeModuleFieldPdfViewerPageCount',
    min: 0,
    max: PDF_VIEWER_MODULE_LIMITS.pageMax,
    step: 1
  },
  {
    path: ['fit'],
    kind: 'select',
    label: 'Fit',
    i18nLabelKey: 'lowcodeModuleFieldPdfViewerFit',
    options: ['width', 'page']
  },
  {
    path: ['showToolbar'],
    kind: 'boolean',
    label: 'Show toolbar',
    i18nLabelKey: 'lowcodeModuleFieldPdfViewerToolbar'
  },
  {
    path: ['allowDownload'],
    kind: 'boolean',
    label: 'Allow download',
    i18nLabelKey: 'lowcodeModuleFieldPdfViewerDownload'
  },
  {
    path: ['backgroundColor'],
    kind: 'color',
    label: 'Background',
    i18nLabelKey: 'lowcodeModuleFieldPdfViewerBackground'
  },
  {
    path: ['accentColor'],
    kind: 'color',
    label: 'Accent color',
    i18nLabelKey: 'lowcodeModuleFieldPdfViewerAccentColor'
  }
])

export const PDF_VIEWER_MODULE_DEFINITION = moduleContract.createContractModuleDefinition(
  PDF_VIEWER_MODULE_CONTRACT,
  {
    name: 'PDF Viewer',
    description: 'Bounded PDF source metadata with explicit page and download behavior.',
    i18nNameKey: 'lowcodeModulePdfViewerName',
    i18nDescriptionKey: 'lowcodeModulePdfViewerDescription',
    defaultSize: PDF_VIEWER_MODULE_DEFAULT_SIZE,
    fields: PDF_VIEWER_MODULE_FIELDS,
    createInstance: createPDFViewerModuleInstance,
    createFrameOverrides: createPDFViewerModuleFrameOverrides,
    resolve: resolvePDFViewerModule
  }
)

export const PDF_VIEWER_PLUGIN = moduleContract.createSingleModulePlugin(
  PDF_VIEWER_PLUGIN_ID,
  'OpenPencil PDF Viewer',
  PDF_VIEWER_MODULE_DEFINITION
)
