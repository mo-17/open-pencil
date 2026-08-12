import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

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
  parseBoundedPluginNumber,
  parseBoundedPluginText,
  parseCanonicalPluginColor,
  parsePluginStringEnum
} from './parse-helpers'
import type { ModulePropertyField, ModuleResolution } from './types'

export const MARKDOWN_PLUGIN_ID = 'open-pencil.markdown'
export const MARKDOWN_MODULE_TYPE = 'markdown'
export const MARKDOWN_MODULE_CONFIG_VERSION = 1
export const MARKDOWN_MODULE_DEFAULT_SIZE = Object.freeze({ width: 640, height: 480 })
export const MARKDOWN_MODULE_LIMITS = Object.freeze({
  source: 65_536,
  fontSizeMin: 10,
  fontSizeMax: 48,
  lineHeightMin: 1,
  lineHeightMax: 3,
  configBytes: 98_304
})

export type MarkdownFlavorV1 = 'commonmark' | 'gfm'
export type MarkdownLinkTargetV1 = 'same-tab' | 'new-tab'

export interface MarkdownModuleConfigV1 extends JSONObject {
  source: string
  flavor: MarkdownFlavorV1
  linkTarget: MarkdownLinkTargetV1
  backgroundColor: string
  textColor: string
  headingColor: string
  accentColor: string
  fontSize: number
  lineHeight: number
}

export type MarkdownModuleConfig = MarkdownModuleConfigV1

export const MARKDOWN_MODULE_DEFAULT_CONFIG: Readonly<MarkdownModuleConfigV1> = Object.freeze({
  source: '# Markdown\n\nWrite **formatted** content with safe links and lists.',
  flavor: 'gfm',
  linkTarget: 'same-tab',
  backgroundColor: '#FFFFFF',
  textColor: '#374151',
  headingColor: '#111827',
  accentColor: '#2563EB',
  fontSize: 16,
  lineHeight: 1.6
})

const CONFIG_KEYS = new Set([
  'source',
  'flavor',
  'linkTarget',
  'backgroundColor',
  'textColor',
  'headingColor',
  'accentColor',
  'fontSize',
  'lineHeight'
])
const FLAVORS = new Set<MarkdownFlavorV1>(['commonmark', 'gfm'])
const LINK_TARGETS = new Set<MarkdownLinkTargetV1>(['same-tab', 'new-tab'])

function parseMarkdownConfig(value: unknown) {
  return parseExactModuleConfig(
    value,
    CONFIG_KEYS,
    'markdown config must contain exactly source, flavor, linkTarget, backgroundColor, textColor, headingColor, accentColor, fontSize, and lineHeight',
    (source): MarkdownModuleConfigV1 => {
      const config: MarkdownModuleConfigV1 = {
        source: parseBoundedPluginText(
          source.source,
          'markdown config source',
          0,
          MARKDOWN_MODULE_LIMITS.source
        ),
        flavor: parsePluginStringEnum(
          source.flavor,
          'markdown config flavor',
          FLAVORS,
          'commonmark or gfm'
        ),
        linkTarget: parsePluginStringEnum(
          source.linkTarget,
          'markdown config linkTarget',
          LINK_TARGETS,
          'same-tab or new-tab'
        ),
        backgroundColor: parseCanonicalPluginColor(
          source.backgroundColor,
          'markdown config backgroundColor'
        ),
        textColor: parseCanonicalPluginColor(source.textColor, 'markdown config textColor'),
        headingColor: parseCanonicalPluginColor(
          source.headingColor,
          'markdown config headingColor'
        ),
        accentColor: parseCanonicalPluginColor(source.accentColor, 'markdown config accentColor'),
        fontSize: parseBoundedPluginNumber(
          source.fontSize,
          'markdown config fontSize',
          MARKDOWN_MODULE_LIMITS.fontSizeMin,
          MARKDOWN_MODULE_LIMITS.fontSizeMax
        ),
        lineHeight: parseBoundedPluginNumber(
          source.lineHeight,
          'markdown config lineHeight',
          MARKDOWN_MODULE_LIMITS.lineHeightMin,
          MARKDOWN_MODULE_LIMITS.lineHeightMax
        )
      }
      assertBoundedPluginConfigBytes(config, 'markdown config', MARKDOWN_MODULE_LIMITS.configBytes)
      return config
    }
  )
}

const MARKDOWN_MODULE_CONTRACT: ModuleContract<MarkdownModuleConfigV1> = {
  pluginId: MARKDOWN_PLUGIN_ID,
  moduleType: MARKDOWN_MODULE_TYPE,
  configVersion: MARKDOWN_MODULE_CONFIG_VERSION,
  displayName: 'markdown',
  defaultConfig: MARKDOWN_MODULE_DEFAULT_CONFIG,
  parseConfig: parseMarkdownConfig
}

export function createMarkdownModuleInstance(config?: unknown): ModuleInstanceV1 {
  return createContractModuleInstance(MARKDOWN_MODULE_CONTRACT, config)
}

export function createMarkdownModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'Markdown',
    defaultSize: MARKDOWN_MODULE_DEFAULT_SIZE,
    fillColor: { r: 1, g: 1, b: 1, a: 1 },
    strokeColor: { r: 0.82, g: 0.84, b: 0.88, a: 1 },
    module: createMarkdownModuleInstance(config)
  })
}

export function resolveMarkdownModule(value: unknown): ModuleResolution<MarkdownModuleConfigV1> {
  return resolveContractModule(value, MARKDOWN_MODULE_CONTRACT)
}

const MARKDOWN_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['source'],
    kind: 'text',
    label: 'Markdown',
    i18nLabelKey: 'lowcodeModuleFieldMarkdownSource'
  },
  {
    path: ['flavor'],
    kind: 'select',
    label: 'Flavor',
    i18nLabelKey: 'lowcodeModuleFieldMarkdownFlavor',
    options: ['commonmark', 'gfm']
  },
  {
    path: ['linkTarget'],
    kind: 'select',
    label: 'Link target',
    i18nLabelKey: 'lowcodeModuleFieldMarkdownLinkTarget',
    options: ['same-tab', 'new-tab']
  },
  {
    path: ['backgroundColor'],
    kind: 'color',
    label: 'Background',
    i18nLabelKey: 'lowcodeModuleFieldMarkdownBackground'
  },
  {
    path: ['textColor'],
    kind: 'color',
    label: 'Text color',
    i18nLabelKey: 'lowcodeModuleFieldMarkdownTextColor'
  },
  {
    path: ['headingColor'],
    kind: 'color',
    label: 'Heading color',
    i18nLabelKey: 'lowcodeModuleFieldMarkdownHeadingColor'
  },
  {
    path: ['accentColor'],
    kind: 'color',
    label: 'Accent color',
    i18nLabelKey: 'lowcodeModuleFieldMarkdownAccentColor'
  },
  {
    path: ['fontSize'],
    kind: 'number',
    label: 'Font size',
    i18nLabelKey: 'lowcodeModuleFieldMarkdownFontSize',
    min: MARKDOWN_MODULE_LIMITS.fontSizeMin,
    max: MARKDOWN_MODULE_LIMITS.fontSizeMax,
    step: 1
  },
  {
    path: ['lineHeight'],
    kind: 'number',
    label: 'Line height',
    i18nLabelKey: 'lowcodeModuleFieldMarkdownLineHeight',
    min: MARKDOWN_MODULE_LIMITS.lineHeightMin,
    max: MARKDOWN_MODULE_LIMITS.lineHeightMax,
    step: 0.1
  }
])

export const MARKDOWN_MODULE_DEFINITION = createContractModuleDefinition(MARKDOWN_MODULE_CONTRACT, {
  name: 'Markdown',
  description: 'Bounded Markdown content with raw HTML kept outside the executable rendering path.',
  i18nNameKey: 'lowcodeModuleMarkdownName',
  i18nDescriptionKey: 'lowcodeModuleMarkdownDescription',
  defaultSize: MARKDOWN_MODULE_DEFAULT_SIZE,
  fields: MARKDOWN_MODULE_FIELDS,
  createInstance: createMarkdownModuleInstance,
  createFrameOverrides: createMarkdownModuleFrameOverrides,
  resolve: resolveMarkdownModule
})

export const MARKDOWN_PLUGIN = createSingleModulePlugin(
  MARKDOWN_PLUGIN_ID,
  'OpenPencil Markdown',
  MARKDOWN_MODULE_DEFINITION
)
