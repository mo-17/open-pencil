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
  parseBoundedPluginNumber,
  parseBoundedPluginText,
  parseCanonicalPluginColor,
  parsePluginBoolean,
  parsePluginStringEnum
} from './parse-helpers'
import type { ModulePropertyField, ModuleResolution } from './types'

export const CODE_BLOCK_PLUGIN_ID = 'open-pencil.code-block'
export const CODE_BLOCK_MODULE_TYPE = 'code-block'
export const CODE_BLOCK_MODULE_CONFIG_VERSION = 1
export const CODE_BLOCK_MODULE_DEFAULT_SIZE = Object.freeze({ width: 640, height: 360 })
export const CODE_BLOCK_MODULE_LIMITS = Object.freeze({
  label: 120,
  code: 65_536,
  fontSizeMin: 10,
  fontSizeMax: 32,
  configBytes: 98_304
})

export type CodeBlockLanguageV1 =
  | 'plaintext'
  | 'javascript'
  | 'typescript'
  | 'json'
  | 'html'
  | 'css'
  | 'bash'
  | 'python'
  | 'rust'
  | 'dart'
export type CodeBlockThemeV1 = 'light' | 'dark'

export interface CodeBlockModuleConfigV1 extends JsonObject {
  label: string
  code: string
  language: CodeBlockLanguageV1
  theme: CodeBlockThemeV1
  showLineNumbers: boolean
  wrapLines: boolean
  showCopyButton: boolean
  fontSize: number
  tabSize: number
  backgroundColor: string
  textColor: string
  accentColor: string
}

export type CodeBlockModuleConfig = CodeBlockModuleConfigV1

export const CODE_BLOCK_MODULE_DEFAULT_CONFIG: Readonly<CodeBlockModuleConfigV1> = Object.freeze({
  label: 'Code example',
  code: 'const greeting: string = "Hello, OpenPencil"\nconsole.log(greeting)',
  language: 'typescript',
  theme: 'dark',
  showLineNumbers: true,
  wrapLines: false,
  showCopyButton: true,
  fontSize: 14,
  tabSize: 2,
  backgroundColor: '#111827',
  textColor: '#F9FAFB',
  accentColor: '#60A5FA'
})

const CONFIG_KEYS = new Set([
  'label',
  'code',
  'language',
  'theme',
  'showLineNumbers',
  'wrapLines',
  'showCopyButton',
  'fontSize',
  'tabSize',
  'backgroundColor',
  'textColor',
  'accentColor'
])
const LANGUAGES = new Set<CodeBlockLanguageV1>([
  'plaintext',
  'javascript',
  'typescript',
  'json',
  'html',
  'css',
  'bash',
  'python',
  'rust',
  'dart'
])
const THEMES = new Set<CodeBlockThemeV1>(['light', 'dark'])
const TAB_SIZES = new Set([2, 4, 8])

function parseCodeBlockConfig(value: unknown) {
  return parseExactModuleConfig(
    value,
    CONFIG_KEYS,
    'code block config must contain exactly label, code, language, theme, showLineNumbers, wrapLines, showCopyButton, fontSize, tabSize, backgroundColor, textColor, and accentColor',
    (source): CodeBlockModuleConfigV1 => {
      const tabSize = parseBoundedPluginInteger(source.tabSize, 'code block config tabSize', 2, 8)
      if (!TAB_SIZES.has(tabSize))
        throw new TypeError('code block config tabSize must be 2, 4, or 8')
      const config: CodeBlockModuleConfigV1 = {
        label: parseBoundedPluginText(
          source.label,
          'code block config label',
          1,
          CODE_BLOCK_MODULE_LIMITS.label
        ),
        code: parseBoundedPluginText(
          source.code,
          'code block config code',
          0,
          CODE_BLOCK_MODULE_LIMITS.code
        ),
        language: parsePluginStringEnum(
          source.language,
          'code block config language',
          LANGUAGES,
          'a supported language'
        ),
        theme: parsePluginStringEnum(
          source.theme,
          'code block config theme',
          THEMES,
          'light or dark'
        ),
        showLineNumbers: parsePluginBoolean(
          source.showLineNumbers,
          'code block config showLineNumbers'
        ),
        wrapLines: parsePluginBoolean(source.wrapLines, 'code block config wrapLines'),
        showCopyButton: parsePluginBoolean(
          source.showCopyButton,
          'code block config showCopyButton'
        ),
        fontSize: parseBoundedPluginNumber(
          source.fontSize,
          'code block config fontSize',
          CODE_BLOCK_MODULE_LIMITS.fontSizeMin,
          CODE_BLOCK_MODULE_LIMITS.fontSizeMax
        ),
        tabSize,
        backgroundColor: parseCanonicalPluginColor(
          source.backgroundColor,
          'code block config backgroundColor'
        ),
        textColor: parseCanonicalPluginColor(source.textColor, 'code block config textColor'),
        accentColor: parseCanonicalPluginColor(source.accentColor, 'code block config accentColor')
      }
      assertBoundedPluginConfigBytes(
        config,
        'code block config',
        CODE_BLOCK_MODULE_LIMITS.configBytes
      )
      return config
    }
  )
}

const CODE_BLOCK_MODULE_CONTRACT: ModuleContract<CodeBlockModuleConfigV1> = {
  pluginId: CODE_BLOCK_PLUGIN_ID,
  moduleType: CODE_BLOCK_MODULE_TYPE,
  configVersion: CODE_BLOCK_MODULE_CONFIG_VERSION,
  displayName: 'code block',
  defaultConfig: CODE_BLOCK_MODULE_DEFAULT_CONFIG,
  parseConfig: parseCodeBlockConfig
}

export function createCodeBlockModuleInstance(config?: unknown): ModuleInstanceV1 {
  return createContractModuleInstance(CODE_BLOCK_MODULE_CONTRACT, config)
}

export function createCodeBlockModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'Code Block',
    defaultSize: CODE_BLOCK_MODULE_DEFAULT_SIZE,
    fillColor: { r: 0.07, g: 0.09, b: 0.15, a: 1 },
    strokeColor: { r: 0.23, g: 0.29, b: 0.39, a: 1 },
    module: createCodeBlockModuleInstance(config)
  })
}

export function resolveCodeBlockModule(value: unknown): ModuleResolution<CodeBlockModuleConfigV1> {
  return resolveContractModule(value, CODE_BLOCK_MODULE_CONTRACT)
}

const CODE_BLOCK_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['label'],
    kind: 'text',
    label: 'Accessible label',
    i18nLabelKey: 'lowcodeModuleFieldCodeBlockLabel'
  },
  { path: ['code'], kind: 'text', label: 'Code', i18nLabelKey: 'lowcodeModuleFieldCodeBlockCode' },
  {
    path: ['language'],
    kind: 'select',
    label: 'Language',
    i18nLabelKey: 'lowcodeModuleFieldCodeBlockLanguage',
    options: [...LANGUAGES]
  },
  {
    path: ['theme'],
    kind: 'select',
    label: 'Theme',
    i18nLabelKey: 'lowcodeModuleFieldCodeBlockTheme',
    options: ['light', 'dark']
  },
  {
    path: ['showLineNumbers'],
    kind: 'boolean',
    label: 'Line numbers',
    i18nLabelKey: 'lowcodeModuleFieldCodeBlockLineNumbers'
  },
  {
    path: ['wrapLines'],
    kind: 'boolean',
    label: 'Wrap lines',
    i18nLabelKey: 'lowcodeModuleFieldCodeBlockWrapLines'
  },
  {
    path: ['showCopyButton'],
    kind: 'boolean',
    label: 'Copy button',
    i18nLabelKey: 'lowcodeModuleFieldCodeBlockCopyButton'
  },
  {
    path: ['fontSize'],
    kind: 'number',
    label: 'Font size',
    i18nLabelKey: 'lowcodeModuleFieldCodeBlockFontSize',
    min: CODE_BLOCK_MODULE_LIMITS.fontSizeMin,
    max: CODE_BLOCK_MODULE_LIMITS.fontSizeMax,
    step: 1
  },
  {
    path: ['tabSize'],
    kind: 'number',
    label: 'Tab size',
    i18nLabelKey: 'lowcodeModuleFieldCodeBlockTabSize',
    min: 2,
    max: 8,
    step: 2
  },
  {
    path: ['backgroundColor'],
    kind: 'color',
    label: 'Background',
    i18nLabelKey: 'lowcodeModuleFieldCodeBlockBackground'
  },
  {
    path: ['textColor'],
    kind: 'color',
    label: 'Text color',
    i18nLabelKey: 'lowcodeModuleFieldCodeBlockTextColor'
  },
  {
    path: ['accentColor'],
    kind: 'color',
    label: 'Accent color',
    i18nLabelKey: 'lowcodeModuleFieldCodeBlockAccentColor'
  }
])

export const CODE_BLOCK_MODULE_DEFINITION = createContractModuleDefinition(
  CODE_BLOCK_MODULE_CONTRACT,
  {
    name: 'Code Block',
    description: 'Bounded source display with explicit language, line, and copy presentation.',
    i18nNameKey: 'lowcodeModuleCodeBlockName',
    i18nDescriptionKey: 'lowcodeModuleCodeBlockDescription',
    defaultSize: CODE_BLOCK_MODULE_DEFAULT_SIZE,
    fields: CODE_BLOCK_MODULE_FIELDS,
    createInstance: createCodeBlockModuleInstance,
    createFrameOverrides: createCodeBlockModuleFrameOverrides,
    resolve: resolveCodeBlockModule
  }
)

export const CODE_BLOCK_PLUGIN = createSingleModulePlugin(
  CODE_BLOCK_PLUGIN_ID,
  'OpenPencil Code Block',
  CODE_BLOCK_MODULE_DEFINITION
)
