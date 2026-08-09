import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JsonObject } from '@open-pencil/scene-graph/primitives'

import {
  createContractModuleDefinition,
  createContractModuleInstance,
  createSingleModulePlugin,
  parseBoundedModuleObjectArray,
  parseExactModuleConfig,
  resolveContractModule,
  type ModuleContract
} from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import {
  assertBoundedPluginConfigBytes,
  hasExactPluginKeys,
  parseBoundedPluginNumber,
  parseBoundedPluginText,
  parseCanonicalPluginColor,
  parsePluginBoolean,
  parsePluginStringEnum
} from './parse-helpers'
import type { ModulePropertyField, ModuleResolution } from './types'

export const TABS_PLUGIN_ID = 'open-pencil.tabs'
export const TABS_MODULE_TYPE = 'tabs'
export const TABS_MODULE_CONFIG_VERSION = 1
export const TABS_MODULE_DEFAULT_SIZE = Object.freeze({ width: 520, height: 300 })
export const TABS_MODULE_LIMITS = Object.freeze({
  tabsMin: 2,
  tabsMax: 12,
  id: 64,
  label: 80,
  content: 4_000,
  totalText: 20_000,
  fontSizeMin: 10,
  fontSizeMax: 48,
  configBytes: 32_768
})

export type TabsOrientationV1 = 'horizontal' | 'vertical'
export type TabsActivationModeV1 = 'automatic' | 'manual'

export interface TabsItemV1 extends JsonObject {
  id: string
  label: string
  content: string
}

export interface TabsModuleConfigV1 extends JsonObject {
  label: string
  tabs: TabsItemV1[]
  initialTabId: string
  orientation: TabsOrientationV1
  activationMode: TabsActivationModeV1
  showDivider: boolean
  backgroundColor: string
  textColor: string
  accentColor: string
  fontSize: number
}

export type TabsModuleConfig = TabsModuleConfigV1

const DEFAULT_TABS: TabsItemV1[] = [
  { id: 'overview', label: 'Overview', content: 'Summarize the most important information.' },
  { id: 'details', label: 'Details', content: 'Add supporting details for this section.' }
]
DEFAULT_TABS.forEach(Object.freeze)
Object.freeze(DEFAULT_TABS)

export const TABS_MODULE_DEFAULT_CONFIG: Readonly<TabsModuleConfigV1> = Object.freeze({
  label: 'Content tabs',
  tabs: DEFAULT_TABS,
  initialTabId: 'overview',
  orientation: 'horizontal',
  activationMode: 'automatic',
  showDivider: true,
  backgroundColor: '#FFFFFF',
  textColor: '#111827',
  accentColor: '#2563EB',
  fontSize: 14
})

const CONFIG_KEYS = new Set([
  'label',
  'tabs',
  'initialTabId',
  'orientation',
  'activationMode',
  'showDivider',
  'backgroundColor',
  'textColor',
  'accentColor',
  'fontSize'
])
const TAB_KEYS = new Set(['id', 'label', 'content'])
const ORIENTATIONS = new Set<TabsOrientationV1>(['horizontal', 'vertical'])
const ACTIVATION_MODES = new Set<TabsActivationModeV1>(['automatic', 'manual'])
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/

function parseTabId(value: unknown, path: string): string {
  const id = parseBoundedPluginText(value, path, 1, TABS_MODULE_LIMITS.id)
  if (!ID_PATTERN.test(id)) {
    throw new TypeError(`${path} must start with a letter and contain only letters, digits, _ or -`)
  }
  return id
}

function parseTabs(value: unknown): TabsItemV1[] {
  const ids = new Set<string>()
  let totalText = 0
  return parseBoundedModuleObjectArray(
    value,
    TABS_MODULE_LIMITS.tabsMin,
    TABS_MODULE_LIMITS.tabsMax,
    `tabs config tabs must contain ${TABS_MODULE_LIMITS.tabsMin} to ${TABS_MODULE_LIMITS.tabsMax} items`,
    (index) => `tabs config tabs[${index}] must be a tab object`,
    (entry, index) => {
      if (!hasExactPluginKeys(entry, TAB_KEYS)) {
        throw new TypeError(
          `tabs config tabs[${index}] must contain exactly id, label, and content`
        )
      }
      const id = parseTabId(entry.id, `tabs config tabs[${index}].id`)
      if (ids.has(id)) throw new TypeError(`tabs config tab id ${id} must be unique`)
      ids.add(id)
      const label = parseBoundedPluginText(
        entry.label,
        `tabs config tabs[${index}].label`,
        1,
        TABS_MODULE_LIMITS.label
      )
      const content = parseBoundedPluginText(
        entry.content,
        `tabs config tabs[${index}].content`,
        0,
        TABS_MODULE_LIMITS.content
      )
      totalText += label.length + content.length
      if (totalText > TABS_MODULE_LIMITS.totalText) {
        throw new TypeError(
          `tabs config text must not exceed ${TABS_MODULE_LIMITS.totalText} characters`
        )
      }
      return { id, label, content }
    }
  )
}

function parseTabsConfig(value: unknown) {
  return parseExactModuleConfig(
    value,
    CONFIG_KEYS,
    'tabs config must contain exactly label, tabs, initialTabId, orientation, activationMode, showDivider, backgroundColor, textColor, accentColor, and fontSize',
    (source): TabsModuleConfigV1 => {
      const tabs = parseTabs(source.tabs)
      const initialTabId = parseTabId(source.initialTabId, 'tabs config initialTabId')
      if (!tabs.some((tab) => tab.id === initialTabId)) {
        throw new TypeError('tabs config initialTabId must reference an existing tab')
      }
      const config: TabsModuleConfigV1 = {
        label: parseBoundedPluginText(
          source.label,
          'tabs config label',
          1,
          TABS_MODULE_LIMITS.label
        ),
        tabs,
        initialTabId,
        orientation: parsePluginStringEnum(
          source.orientation,
          'tabs config orientation',
          ORIENTATIONS,
          'horizontal or vertical'
        ),
        activationMode: parsePluginStringEnum(
          source.activationMode,
          'tabs config activationMode',
          ACTIVATION_MODES,
          'automatic or manual'
        ),
        showDivider: parsePluginBoolean(source.showDivider, 'tabs config showDivider'),
        backgroundColor: parseCanonicalPluginColor(
          source.backgroundColor,
          'tabs config backgroundColor'
        ),
        textColor: parseCanonicalPluginColor(source.textColor, 'tabs config textColor'),
        accentColor: parseCanonicalPluginColor(source.accentColor, 'tabs config accentColor'),
        fontSize: parseBoundedPluginNumber(
          source.fontSize,
          'tabs config fontSize',
          TABS_MODULE_LIMITS.fontSizeMin,
          TABS_MODULE_LIMITS.fontSizeMax
        )
      }
      assertBoundedPluginConfigBytes(config, 'tabs config', TABS_MODULE_LIMITS.configBytes)
      return config
    }
  )
}

const TABS_MODULE_CONTRACT: ModuleContract<TabsModuleConfigV1> = {
  pluginId: TABS_PLUGIN_ID,
  moduleType: TABS_MODULE_TYPE,
  configVersion: TABS_MODULE_CONFIG_VERSION,
  displayName: 'tabs',
  defaultConfig: TABS_MODULE_DEFAULT_CONFIG,
  parseConfig: parseTabsConfig
}

export function createTabsModuleInstance(config?: unknown): ModuleInstanceV1 {
  return createContractModuleInstance(TABS_MODULE_CONTRACT, config)
}

export function createTabsModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'Tabs',
    defaultSize: TABS_MODULE_DEFAULT_SIZE,
    fillColor: { r: 1, g: 1, b: 1, a: 1 },
    strokeColor: { r: 0.82, g: 0.84, b: 0.88, a: 1 },
    module: createTabsModuleInstance(config)
  })
}

export function resolveTabsModule(value: unknown): ModuleResolution<TabsModuleConfigV1> {
  return resolveContractModule(value, TABS_MODULE_CONTRACT)
}

const TABS_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['label'],
    kind: 'text',
    label: 'Accessible label',
    i18nLabelKey: 'lowcodeModuleFieldTabsLabel'
  },
  { path: ['tabs'], kind: 'json', label: 'Tabs', i18nLabelKey: 'lowcodeModuleFieldTabsItems' },
  {
    path: ['initialTabId'],
    kind: 'text',
    label: 'Initial tab',
    i18nLabelKey: 'lowcodeModuleFieldTabsInitialTab'
  },
  {
    path: ['orientation'],
    kind: 'select',
    label: 'Orientation',
    i18nLabelKey: 'lowcodeModuleFieldTabsOrientation',
    options: ['horizontal', 'vertical']
  },
  {
    path: ['activationMode'],
    kind: 'select',
    label: 'Activation',
    i18nLabelKey: 'lowcodeModuleFieldTabsActivation',
    options: ['automatic', 'manual']
  },
  {
    path: ['showDivider'],
    kind: 'boolean',
    label: 'Show divider',
    i18nLabelKey: 'lowcodeModuleFieldTabsDivider'
  },
  {
    path: ['backgroundColor'],
    kind: 'color',
    label: 'Background',
    i18nLabelKey: 'lowcodeModuleFieldTabsBackground'
  },
  {
    path: ['textColor'],
    kind: 'color',
    label: 'Text color',
    i18nLabelKey: 'lowcodeModuleFieldTabsTextColor'
  },
  {
    path: ['accentColor'],
    kind: 'color',
    label: 'Accent color',
    i18nLabelKey: 'lowcodeModuleFieldTabsAccentColor'
  },
  {
    path: ['fontSize'],
    kind: 'number',
    label: 'Font size',
    i18nLabelKey: 'lowcodeModuleFieldTabsFontSize',
    min: TABS_MODULE_LIMITS.fontSizeMin,
    max: TABS_MODULE_LIMITS.fontSizeMax,
    step: 1
  }
])

export const TABS_MODULE_DEFINITION = createContractModuleDefinition(TABS_MODULE_CONTRACT, {
  name: 'Tabs',
  description: 'Accessible bounded tab navigation with inline panel content.',
  i18nNameKey: 'lowcodeModuleTabsName',
  i18nDescriptionKey: 'lowcodeModuleTabsDescription',
  defaultSize: TABS_MODULE_DEFAULT_SIZE,
  fields: TABS_MODULE_FIELDS,
  createInstance: createTabsModuleInstance,
  createFrameOverrides: createTabsModuleFrameOverrides,
  resolve: resolveTabsModule
})

export const TABS_PLUGIN = createSingleModulePlugin(
  TABS_PLUGIN_ID,
  'OpenPencil Tabs',
  TABS_MODULE_DEFINITION
)
