import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JsonObject } from '@open-pencil/scene-graph/primitives'

import * as moduleContract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import {
  assertBoundedPluginConfigBytes,
  hasExactPluginKeys,
  isSafePluginHref,
  parseBoundedPluginNumber,
  parseBoundedPluginText,
  parseCanonicalPluginColor,
  parsePluginBoolean,
  parsePluginStringEnum
} from './parse-helpers'
import type { ModulePropertyField, ModuleResolution } from './types'

export const DROPDOWN_MENU_PLUGIN_ID = 'open-pencil.dropdown-menu'
export const DROPDOWN_MENU_MODULE_TYPE = 'dropdown-menu'
export const DROPDOWN_MENU_MODULE_CONFIG_VERSION = 1
export const DROPDOWN_MENU_MODULE_DEFAULT_SIZE = Object.freeze({ width: 180, height: 48 })
export const DROPDOWN_MENU_MODULE_LIMITS = Object.freeze({
  triggerLabel: 80,
  itemsMin: 1,
  itemsMax: 20,
  itemLabel: 80,
  itemHref: 2_048,
  itemShortcut: 24,
  menuWidthMin: 160,
  menuWidthMax: 480,
  configBytes: 32_768
})

export type DropdownMenuTriggerModeV1 = 'click' | 'hover'
export type DropdownMenuPlacementV1 =
  | 'bottomLeft'
  | 'bottom'
  | 'bottomRight'
  | 'topLeft'
  | 'top'
  | 'topRight'
  | 'leftTop'
  | 'left'
  | 'leftBottom'
  | 'rightTop'
  | 'right'
  | 'rightBottom'

export interface DropdownMenuItemV1 extends JsonObject {
  type: 'item'
  label: string
  href: string
  disabled: boolean
  danger: boolean
  shortcut: string
}

export interface DropdownMenuSeparatorV1 extends JsonObject {
  type: 'separator'
}

export type DropdownMenuEntryV1 = DropdownMenuItemV1 | DropdownMenuSeparatorV1

export interface DropdownMenuModuleConfigV1 extends JsonObject {
  triggerLabel: string
  showTriggerLabel: boolean
  showTriggerChevron: boolean
  triggerMode: DropdownMenuTriggerModeV1
  placement: DropdownMenuPlacementV1
  items: DropdownMenuEntryV1[]
  closeOnSelect: boolean
  closeOnEscape: boolean
  closeOnOutsidePress: boolean
  menuWidth: number
  triggerBackground: string
  triggerTextColor: string
  menuBackground: string
  itemTextColor: string
  accentColor: string
  dangerColor: string
}

export type DropdownMenuModuleConfig = DropdownMenuModuleConfigV1

const DEFAULT_ITEMS: DropdownMenuEntryV1[] = [
  {
    type: 'item',
    label: 'Dashboard',
    href: '/',
    disabled: false,
    danger: false,
    shortcut: ''
  },
  {
    type: 'item',
    label: 'Settings',
    href: '/settings',
    disabled: false,
    danger: false,
    shortcut: '⌘,'
  },
  { type: 'separator' },
  {
    type: 'item',
    label: 'Documentation',
    href: 'https://openpencil.dev/',
    disabled: false,
    danger: false,
    shortcut: ''
  }
]
DEFAULT_ITEMS.forEach(Object.freeze)
Object.freeze(DEFAULT_ITEMS)

export const DROPDOWN_MENU_MODULE_DEFAULT_CONFIG: Readonly<DropdownMenuModuleConfigV1> =
  Object.freeze({
    triggerLabel: 'Open menu',
    showTriggerLabel: true,
    showTriggerChevron: true,
    triggerMode: 'click',
    placement: 'bottomLeft',
    items: DEFAULT_ITEMS,
    closeOnSelect: true,
    closeOnEscape: true,
    closeOnOutsidePress: true,
    menuWidth: 240,
    triggerBackground: '#2563EB',
    triggerTextColor: '#FFFFFF',
    menuBackground: '#FFFFFF',
    itemTextColor: '#111827',
    accentColor: '#2563EB',
    dangerColor: '#DC2626'
  })

const CONFIG_KEYS = new Set([
  'triggerLabel',
  'showTriggerLabel',
  'showTriggerChevron',
  'triggerMode',
  'placement',
  'items',
  'closeOnSelect',
  'closeOnEscape',
  'closeOnOutsidePress',
  'menuWidth',
  'triggerBackground',
  'triggerTextColor',
  'menuBackground',
  'itemTextColor',
  'accentColor',
  'dangerColor'
])
const ITEM_KEYS = new Set(['type', 'label', 'href', 'disabled', 'danger', 'shortcut'])
const SEPARATOR_KEYS = new Set(['type'])
const TRIGGER_MODES = new Set<DropdownMenuTriggerModeV1>(['click', 'hover'])
const PLACEMENTS = new Set<DropdownMenuPlacementV1>([
  'bottomLeft',
  'bottom',
  'bottomRight',
  'topLeft',
  'top',
  'topRight',
  'leftTop',
  'left',
  'leftBottom',
  'rightTop',
  'right',
  'rightBottom'
])

export function isSafeDropdownMenuHref(value: unknown): value is string {
  return isSafePluginHref(
    value,
    'dropdown menu item href',
    DROPDOWN_MENU_MODULE_LIMITS.itemHref,
    true
  )
}

function parseDropdownMenuItems(value: unknown): DropdownMenuEntryV1[] {
  const entries = moduleContract.parseBoundedModuleObjectArray(
    value,
    DROPDOWN_MENU_MODULE_LIMITS.itemsMin,
    DROPDOWN_MENU_MODULE_LIMITS.itemsMax,
    `dropdown menu config items must contain ${DROPDOWN_MENU_MODULE_LIMITS.itemsMin} to ${DROPDOWN_MENU_MODULE_LIMITS.itemsMax} entries`,
    (index) => `dropdown menu config items[${index}] must be a menu entry object`,
    (entry, index): DropdownMenuEntryV1 => {
      if (entry.type === 'separator') {
        if (!hasExactPluginKeys(entry, SEPARATOR_KEYS)) {
          throw new TypeError(
            `dropdown menu config items[${index}] separator must contain exactly type`
          )
        }
        return { type: 'separator' }
      }
      if (entry.type !== 'item') {
        throw new TypeError(`dropdown menu config items[${index}].type must be item or separator`)
      }
      if (!hasExactPluginKeys(entry, ITEM_KEYS)) {
        throw new TypeError(
          `dropdown menu config items[${index}] item must contain exactly type, label, href, disabled, danger, and shortcut`
        )
      }
      const label = parseBoundedPluginText(
        entry.label,
        `dropdown menu config items[${index}].label`,
        1,
        DROPDOWN_MENU_MODULE_LIMITS.itemLabel
      )
      if (!isSafeDropdownMenuHref(entry.href)) {
        throw new TypeError(
          `dropdown menu config items[${index}].href must be empty or a safe bounded href`
        )
      }
      return {
        type: 'item',
        label,
        href: entry.href,
        disabled: parsePluginBoolean(
          entry.disabled,
          `dropdown menu config items[${index}].disabled`
        ),
        danger: parsePluginBoolean(entry.danger, `dropdown menu config items[${index}].danger`),
        shortcut: parseBoundedPluginText(
          entry.shortcut,
          `dropdown menu config items[${index}].shortcut`,
          0,
          DROPDOWN_MENU_MODULE_LIMITS.itemShortcut
        )
      }
    }
  )
  if (!entries.some((entry) => entry.type === 'item')) {
    throw new TypeError('dropdown menu config items must contain at least one item')
  }
  return entries
}

function parseDropdownMenuConfig(value: unknown) {
  return moduleContract.parseExactModuleConfig(
    value,
    CONFIG_KEYS,
    'dropdown menu config must contain exactly triggerLabel, showTriggerLabel, showTriggerChevron, triggerMode, placement, items, closeOnSelect, closeOnEscape, closeOnOutsidePress, menuWidth, triggerBackground, triggerTextColor, menuBackground, itemTextColor, accentColor, and dangerColor',
    (source): DropdownMenuModuleConfigV1 => {
      const config: DropdownMenuModuleConfigV1 = {
        triggerLabel: parseBoundedPluginText(
          source.triggerLabel,
          'dropdown menu config triggerLabel',
          1,
          DROPDOWN_MENU_MODULE_LIMITS.triggerLabel
        ),
        showTriggerLabel: parsePluginBoolean(
          source.showTriggerLabel,
          'dropdown menu config showTriggerLabel'
        ),
        showTriggerChevron: parsePluginBoolean(
          source.showTriggerChevron,
          'dropdown menu config showTriggerChevron'
        ),
        triggerMode: parsePluginStringEnum(
          source.triggerMode,
          'dropdown menu config triggerMode',
          TRIGGER_MODES,
          'click or hover'
        ),
        placement: parsePluginStringEnum(
          source.placement,
          'dropdown menu config placement',
          PLACEMENTS,
          'one of the 12 supported placements'
        ),
        items: parseDropdownMenuItems(source.items),
        closeOnSelect: parsePluginBoolean(
          source.closeOnSelect,
          'dropdown menu config closeOnSelect'
        ),
        closeOnEscape: parsePluginBoolean(
          source.closeOnEscape,
          'dropdown menu config closeOnEscape'
        ),
        closeOnOutsidePress: parsePluginBoolean(
          source.closeOnOutsidePress,
          'dropdown menu config closeOnOutsidePress'
        ),
        menuWidth: parseBoundedPluginNumber(
          source.menuWidth,
          'dropdown menu config menuWidth',
          DROPDOWN_MENU_MODULE_LIMITS.menuWidthMin,
          DROPDOWN_MENU_MODULE_LIMITS.menuWidthMax
        ),
        triggerBackground: parseCanonicalPluginColor(
          source.triggerBackground,
          'dropdown menu config triggerBackground'
        ),
        triggerTextColor: parseCanonicalPluginColor(
          source.triggerTextColor,
          'dropdown menu config triggerTextColor'
        ),
        menuBackground: parseCanonicalPluginColor(
          source.menuBackground,
          'dropdown menu config menuBackground'
        ),
        itemTextColor: parseCanonicalPluginColor(
          source.itemTextColor,
          'dropdown menu config itemTextColor'
        ),
        accentColor: parseCanonicalPluginColor(
          source.accentColor,
          'dropdown menu config accentColor'
        ),
        dangerColor: parseCanonicalPluginColor(
          source.dangerColor,
          'dropdown menu config dangerColor'
        )
      }
      if (!config.showTriggerLabel && !config.showTriggerChevron) {
        throw new TypeError('dropdown menu config must show a trigger label or chevron')
      }
      assertBoundedPluginConfigBytes(
        config,
        'dropdown menu config',
        DROPDOWN_MENU_MODULE_LIMITS.configBytes
      )
      return config
    }
  )
}

const DROPDOWN_MENU_MODULE_CONTRACT: moduleContract.ModuleContract<DropdownMenuModuleConfigV1> = {
  pluginId: DROPDOWN_MENU_PLUGIN_ID,
  moduleType: DROPDOWN_MENU_MODULE_TYPE,
  configVersion: DROPDOWN_MENU_MODULE_CONFIG_VERSION,
  displayName: 'dropdown menu',
  defaultConfig: DROPDOWN_MENU_MODULE_DEFAULT_CONFIG,
  parseConfig: parseDropdownMenuConfig
}

export function createDropdownMenuModuleInstance(config?: unknown): ModuleInstanceV1 {
  return moduleContract.createContractModuleInstance(DROPDOWN_MENU_MODULE_CONTRACT, config)
}

export function createDropdownMenuModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'Dropdown Menu',
    defaultSize: DROPDOWN_MENU_MODULE_DEFAULT_SIZE,
    fillColor: { r: 0.15, g: 0.39, b: 0.92, a: 1 },
    strokeColor: { r: 0.11, g: 0.31, b: 0.85, a: 1 },
    module: createDropdownMenuModuleInstance(config)
  })
}

export function resolveDropdownMenuModule(
  value: unknown
): ModuleResolution<DropdownMenuModuleConfigV1> {
  return moduleContract.resolveContractModule(value, DROPDOWN_MENU_MODULE_CONTRACT)
}

const DROPDOWN_MENU_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['triggerLabel'],
    kind: 'text',
    label: 'Trigger label',
    i18nLabelKey: 'lowcodeModuleFieldDropdownMenuTriggerLabel'
  },
  {
    path: ['showTriggerLabel'],
    kind: 'boolean',
    label: 'Show trigger label',
    i18nLabelKey: 'lowcodeModuleFieldDropdownMenuShowTriggerLabel'
  },
  {
    path: ['showTriggerChevron'],
    kind: 'boolean',
    label: 'Show trigger chevron',
    i18nLabelKey: 'lowcodeModuleFieldDropdownMenuShowTriggerChevron'
  },
  {
    path: ['triggerMode'],
    kind: 'select',
    label: 'Trigger mode',
    i18nLabelKey: 'lowcodeModuleFieldDropdownMenuTriggerMode',
    options: ['click', 'hover']
  },
  {
    path: ['placement'],
    kind: 'select',
    label: 'Placement',
    i18nLabelKey: 'lowcodeModuleFieldDropdownMenuPlacement',
    options: [
      'bottomLeft',
      'bottom',
      'bottomRight',
      'topLeft',
      'top',
      'topRight',
      'leftTop',
      'left',
      'leftBottom',
      'rightTop',
      'right',
      'rightBottom'
    ]
  },
  {
    path: ['items'],
    kind: 'json',
    label: 'Items',
    i18nLabelKey: 'lowcodeModuleFieldDropdownMenuItems'
  },
  {
    path: ['closeOnSelect'],
    kind: 'boolean',
    label: 'Close on select',
    i18nLabelKey: 'lowcodeModuleFieldDropdownMenuCloseOnSelect'
  },
  {
    path: ['closeOnEscape'],
    kind: 'boolean',
    label: 'Close on Escape',
    i18nLabelKey: 'lowcodeModuleFieldDropdownMenuCloseOnEscape'
  },
  {
    path: ['closeOnOutsidePress'],
    kind: 'boolean',
    label: 'Close on outside press',
    i18nLabelKey: 'lowcodeModuleFieldDropdownMenuCloseOnOutsidePress'
  },
  {
    path: ['menuWidth'],
    kind: 'number',
    label: 'Menu width',
    i18nLabelKey: 'lowcodeModuleFieldDropdownMenuMenuWidth',
    min: DROPDOWN_MENU_MODULE_LIMITS.menuWidthMin,
    max: DROPDOWN_MENU_MODULE_LIMITS.menuWidthMax,
    step: 1
  },
  {
    path: ['triggerBackground'],
    kind: 'color',
    label: 'Trigger background',
    i18nLabelKey: 'lowcodeModuleFieldDropdownMenuTriggerBackground'
  },
  {
    path: ['triggerTextColor'],
    kind: 'color',
    label: 'Trigger text color',
    i18nLabelKey: 'lowcodeModuleFieldDropdownMenuTriggerTextColor'
  },
  {
    path: ['menuBackground'],
    kind: 'color',
    label: 'Menu background',
    i18nLabelKey: 'lowcodeModuleFieldDropdownMenuMenuBackground'
  },
  {
    path: ['itemTextColor'],
    kind: 'color',
    label: 'Item text color',
    i18nLabelKey: 'lowcodeModuleFieldDropdownMenuItemTextColor'
  },
  {
    path: ['accentColor'],
    kind: 'color',
    label: 'Accent color',
    i18nLabelKey: 'lowcodeModuleFieldDropdownMenuAccentColor'
  },
  {
    path: ['dangerColor'],
    kind: 'color',
    label: 'Danger color',
    i18nLabelKey: 'lowcodeModuleFieldDropdownMenuDangerColor'
  }
])

export const DROPDOWN_MENU_MODULE_DEFINITION = moduleContract.createContractModuleDefinition(
  DROPDOWN_MENU_MODULE_CONTRACT,
  {
    name: 'Dropdown Menu',
    description:
      'An accessible bounded dropdown menu with keyboard, pointer, and placement controls.',
    i18nNameKey: 'lowcodeModuleDropdownMenuName',
    i18nDescriptionKey: 'lowcodeModuleDropdownMenuDescription',
    defaultSize: DROPDOWN_MENU_MODULE_DEFAULT_SIZE,
    fields: DROPDOWN_MENU_MODULE_FIELDS,
    createInstance: createDropdownMenuModuleInstance,
    createFrameOverrides: createDropdownMenuModuleFrameOverrides,
    resolve: resolveDropdownMenuModule
  }
)

export const DROPDOWN_MENU_PLUGIN = moduleContract.createSingleModulePlugin(
  DROPDOWN_MENU_PLUGIN_ID,
  'OpenPencil Dropdown Menu',
  DROPDOWN_MENU_MODULE_DEFINITION
)
