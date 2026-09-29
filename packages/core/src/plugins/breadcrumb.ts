import * as pluginParsers from '@open-pencil/plugin-contracts/adapter-helpers'
import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'

import * as moduleContract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import {
  NAVIGATION_APPEARANCE_FIELDS,
  parseNavigationAppearance,
  type NavigationAppearance
} from './navigation/shared'
import type { SlideMenuItemV1 } from './slide-menu'
import type { ModulePropertyField, ModuleResolution } from './types'

export const BREADCRUMB_PLUGIN_ID = 'open-pencil.breadcrumb'
export const BREADCRUMB_MODULE_TYPE = 'breadcrumb'
export const BREADCRUMB_MODULE_CONFIG_VERSION = 1
export const BREADCRUMB_MODULE_DEFAULT_SIZE = Object.freeze({ width: 440, height: 56 })
export const BREADCRUMB_MODULE_LIMITS = Object.freeze({
  itemsMin: 1,
  itemsMax: 12,
  label: 120,
  href: 2048,
  configBytes: 32_768
})
export type BreadcrumbItemV1 = SlideMenuItemV1
export interface BreadcrumbModuleConfigV1 extends NavigationAppearance {
  items: BreadcrumbItemV1[]
  separator: 'slash' | 'chevron' | 'dot'
  wrap: boolean
}
export type BreadcrumbModuleConfig = BreadcrumbModuleConfigV1
const items: BreadcrumbItemV1[] = [
  { label: 'Home', href: '/' },
  { label: 'Library', href: '' },
  { label: 'Current page', href: '' }
]
items.forEach(Object.freeze)
Object.freeze(items)
export const BREADCRUMB_MODULE_DEFAULT_CONFIG: Readonly<BreadcrumbModuleConfigV1> = Object.freeze({
  label: 'Breadcrumb',
  items,
  separator: 'chevron',
  wrap: true,
  backgroundColor: '#FFFFFF',
  textColor: '#172B4D',
  accentColor: '#2563EB',
  fontSize: 14
})
const ITEM_KEYS = new Set(['label', 'href'])
const CONFIG_KEYS = new Set(Object.keys(BREADCRUMB_MODULE_DEFAULT_CONFIG))
function parseBreadcrumbConfig(value: unknown) {
  return moduleContract.parseExactModuleConfig(
    value,
    CONFIG_KEYS,
    'breadcrumb config must contain exactly its supported fields',
    (source) => {
      const parsedItems = moduleContract.parseBoundedModuleObjectArray(
        source.items,
        1,
        12,
        'breadcrumb items must contain 1 to 12 entries',
        (index) => `breadcrumb items[${index}] must be a plain object`,
        (entry) => {
          if (!pluginParsers.hasExactPluginKeys(entry, ITEM_KEYS))
            throw new TypeError('breadcrumb item must contain label and href')
          if (!pluginParsers.isSafePluginHref(entry.href, 'breadcrumb href', 2048, true))
            throw new TypeError(
              'breadcrumb href must be empty, a relative path, an anchor, or a safe HTTPS URL'
            )
          return {
            label: pluginParsers.parseBoundedPluginText(
              entry.label,
              'breadcrumb item label',
              1,
              120
            ),
            href: entry.href
          }
        }
      )
      const config: BreadcrumbModuleConfigV1 = {
        ...parseNavigationAppearance(source),
        items: parsedItems,
        separator: pluginParsers.parsePluginStringEnum(
          source.separator,
          'breadcrumb separator',
          new Set(['slash', 'chevron', 'dot'] as const),
          'slash, chevron, or dot'
        ),
        wrap: pluginParsers.parsePluginBoolean(source.wrap, 'breadcrumb wrap')
      }
      pluginParsers.assertBoundedPluginConfigBytes(
        config,
        'breadcrumb config',
        BREADCRUMB_MODULE_LIMITS.configBytes
      )
      return config
    }
  )
}
const CONTRACT: moduleContract.ModuleContract<BreadcrumbModuleConfigV1> = {
  pluginId: BREADCRUMB_PLUGIN_ID,
  moduleType: BREADCRUMB_MODULE_TYPE,
  configVersion: BREADCRUMB_MODULE_CONFIG_VERSION,
  displayName: 'breadcrumb',
  defaultConfig: BREADCRUMB_MODULE_DEFAULT_CONFIG,
  parseConfig: parseBreadcrumbConfig
}
export function createBreadcrumbModuleInstance(config?: unknown): ModuleInstanceV1 {
  return moduleContract.createContractModuleInstance(CONTRACT, config)
}
export function resolveBreadcrumbModule(
  value: unknown
): ModuleResolution<BreadcrumbModuleConfigV1> {
  return moduleContract.resolveContractModule(value, CONTRACT)
}
export function createBreadcrumbModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'Breadcrumb',
    defaultSize: BREADCRUMB_MODULE_DEFAULT_SIZE,
    fillColor: { r: 1, g: 1, b: 1, a: 1 },
    strokeColor: { r: 0.82, g: 0.84, b: 0.88, a: 0 },
    module: createBreadcrumbModuleInstance(config)
  })
}
const FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['items'],
    kind: 'json',
    label: 'Breadcrumb items',
    i18nLabelKey: 'lowcodeModuleFieldBreadcrumbItems'
  },
  {
    path: ['separator'],
    kind: 'select',
    label: 'Separator',
    options: ['slash', 'chevron', 'dot'],
    i18nLabelKey: 'lowcodeModuleFieldBreadcrumbSeparator'
  },
  {
    path: ['wrap'],
    kind: 'boolean',
    label: 'Wrap items',
    i18nLabelKey: 'lowcodeModuleFieldBreadcrumbWrap'
  },
  ...NAVIGATION_APPEARANCE_FIELDS
])
export const BREADCRUMB_MODULE_DEFINITION = moduleContract.createContractModuleDefinition(
  CONTRACT,
  {
    name: 'Breadcrumb',
    description: 'Safe breadcrumb links with a current-page label and responsive wrapping.',
    i18nNameKey: 'lowcodeModuleBreadcrumbName',
    i18nDescriptionKey: 'lowcodeModuleBreadcrumbDescription',
    defaultSize: BREADCRUMB_MODULE_DEFAULT_SIZE,
    fields: FIELDS,
    createInstance: createBreadcrumbModuleInstance,
    createFrameOverrides: createBreadcrumbModuleFrameOverrides,
    resolve: resolveBreadcrumbModule
  }
)
export const BREADCRUMB_PLUGIN = moduleContract.createSingleModulePlugin(
  BREADCRUMB_PLUGIN_ID,
  'OpenPencil Breadcrumb',
  BREADCRUMB_MODULE_DEFINITION
)
