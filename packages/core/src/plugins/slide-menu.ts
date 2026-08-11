import {
  isPlainJsonObject,
  validateModuleInstance,
  type ModuleInstanceV1,
  type SceneNode
} from '@open-pencil/scene-graph'
import type { JsonObject } from '@open-pencil/scene-graph/primitives'

import { createModuleFrameOverrides } from './module-frame'
import {
  hasExactPluginKeys,
  isSafePluginHref,
  mergePluginConfigWithDefaults,
  parseBoundedPluginText as boundedText,
  parseCanonicalPluginColor as canonicalColor
} from './parse-helpers'
import type { ModuleDefinition, ModulePropertyField, ModuleResolution } from './types'

export const SLIDE_MENU_PLUGIN_ID = 'open-pencil.slide-menu'
export const SLIDE_MENU_MODULE_TYPE = 'slide-menu'
export const SLIDE_MENU_MODULE_CONFIG_VERSION = 2
export const SLIDE_MENU_MODULE_DEFAULT_SIZE = Object.freeze({ width: 180, height: 48 })
export const SLIDE_MENU_MODULE_LIMITS = Object.freeze({
  triggerLabel: 80,
  title: 120,
  description: 1_000,
  items: 20,
  itemLabel: 80,
  itemHref: 2_048,
  panelSizeMin: 160,
  panelSizeMax: 720,
  overlayOpacityMin: 0,
  overlayOpacityMax: 0.9
})

export type SlideMenuPresentationV1 = 'menu' | 'dialog'
export type SlideMenuDirectionV1 = 'left' | 'right' | 'top' | 'bottom'

export interface SlideMenuItemV1 extends JsonObject {
  label: string
  href: string
}

export interface SlideMenuModuleConfigV1 extends JsonObject {
  presentation: SlideMenuPresentationV1
  direction: SlideMenuDirectionV1
  triggerLabel: string
  title: string
  description: string
  items: SlideMenuItemV1[]
  closeOnBackdrop: boolean
  showCloseButton: boolean
  panelSize: number
  panelBackground: string
  textColor: string
  overlayOpacity: number
}

export interface SlideMenuModuleConfigV2 extends SlideMenuModuleConfigV1 {
  showTriggerIcon: boolean
  showTriggerLabel: boolean
}

export type SlideMenuModuleConfig = SlideMenuModuleConfigV2

const DEFAULT_ITEMS: SlideMenuItemV1[] = [
  { label: 'Home', href: '/' },
  { label: 'Features', href: '/features' },
  { label: 'Contact', href: '/contact' }
]
DEFAULT_ITEMS.forEach(Object.freeze)
Object.freeze(DEFAULT_ITEMS)

export const SLIDE_MENU_MODULE_DEFAULT_CONFIG: Readonly<SlideMenuModuleConfigV2> = Object.freeze({
  presentation: 'menu',
  direction: 'left',
  triggerLabel: 'Open menu',
  showTriggerIcon: true,
  showTriggerLabel: true,
  title: 'Navigation',
  description: 'Choose a destination.',
  items: DEFAULT_ITEMS,
  closeOnBackdrop: true,
  showCloseButton: true,
  panelSize: 320,
  panelBackground: '#FFFFFF',
  textColor: '#111827',
  overlayOpacity: 0.45
})

const LEGACY_CONFIG_KEYS = new Set([
  'presentation',
  'direction',
  'triggerLabel',
  'title',
  'description',
  'items',
  'closeOnBackdrop',
  'showCloseButton',
  'panelSize',
  'panelBackground',
  'textColor',
  'overlayOpacity'
])
const CONFIG_KEYS = new Set([...LEGACY_CONFIG_KEYS, 'showTriggerIcon', 'showTriggerLabel'])
const ITEM_KEYS = new Set(['label', 'href'])
const PRESENTATIONS = new Set<SlideMenuPresentationV1>(['menu', 'dialog'])
const DIRECTIONS = new Set<SlideMenuDirectionV1>(['left', 'right', 'top', 'bottom'])
type SupportedConfigVersion = 1 | typeof SLIDE_MENU_MODULE_CONFIG_VERSION
type ParseResult = { ok: true; config: SlideMenuModuleConfigV2 } | { ok: false; reason: string }

function boundedNumber(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`${path} must be between ${minimum} and ${maximum}`)
  }
  return value
}

export function isSafeSlideMenuHref(value: unknown): value is string {
  return isSafePluginHref(value, 'slide menu item href', SLIDE_MENU_MODULE_LIMITS.itemHref, false)
}

function parseItems(value: unknown): SlideMenuItemV1[] {
  if (!Array.isArray(value) || value.length > SLIDE_MENU_MODULE_LIMITS.items) {
    throw new TypeError(
      `slide menu config items must be an array of at most ${SLIDE_MENU_MODULE_LIMITS.items} items`
    )
  }
  const items: SlideMenuItemV1[] = []
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError(`slide menu config items[${index}] must be a menu item object`)
    }
    const item = value[index]
    if (!isPlainJsonObject(item) || !hasExactPluginKeys(item, ITEM_KEYS)) {
      throw new TypeError(`slide menu config items[${index}] must contain exactly label and href`)
    }
    const label = boundedText(
      item.label,
      `slide menu config items[${index}].label`,
      1,
      SLIDE_MENU_MODULE_LIMITS.itemLabel
    )
    if (!isSafeSlideMenuHref(item.href)) {
      throw new TypeError(`slide menu config items[${index}].href must be a safe bounded href`)
    }
    items.push({ label, href: item.href })
  }
  return items
}

function parseSlideMenuConfig(value: unknown, configVersion: SupportedConfigVersion): ParseResult {
  const keys = configVersion === 1 ? LEGACY_CONFIG_KEYS : CONFIG_KEYS
  if (!isPlainJsonObject(value) || !hasExactPluginKeys(value, keys)) {
    return {
      ok: false,
      reason:
        configVersion === 1
          ? 'slide menu config v1 must contain exactly presentation, direction, triggerLabel, title, description, items, closeOnBackdrop, showCloseButton, panelSize, panelBackground, textColor, and overlayOpacity'
          : 'slide menu config v2 must contain exactly presentation, direction, triggerLabel, showTriggerIcon, showTriggerLabel, title, description, items, closeOnBackdrop, showCloseButton, panelSize, panelBackground, textColor, and overlayOpacity'
    }
  }
  try {
    if (
      typeof value.presentation !== 'string' ||
      !PRESENTATIONS.has(value.presentation as SlideMenuPresentationV1)
    ) {
      throw new TypeError('slide menu config presentation must be menu or dialog')
    }
    if (
      typeof value.direction !== 'string' ||
      !DIRECTIONS.has(value.direction as SlideMenuDirectionV1)
    ) {
      throw new TypeError('slide menu config direction must be left, right, top, or bottom')
    }
    const triggerLabel = boundedText(
      value.triggerLabel,
      'slide menu config triggerLabel',
      1,
      SLIDE_MENU_MODULE_LIMITS.triggerLabel
    )
    const title = boundedText(
      value.title,
      'slide menu config title',
      1,
      SLIDE_MENU_MODULE_LIMITS.title
    )
    const description = boundedText(
      value.description,
      'slide menu config description',
      0,
      SLIDE_MENU_MODULE_LIMITS.description
    )
    const items = parseItems(value.items)
    const showTriggerIcon = configVersion === 1 ? true : value.showTriggerIcon
    if (typeof showTriggerIcon !== 'boolean') {
      throw new TypeError('slide menu config showTriggerIcon must be a boolean')
    }
    const showTriggerLabel = configVersion === 1 ? true : value.showTriggerLabel
    if (typeof showTriggerLabel !== 'boolean') {
      throw new TypeError('slide menu config showTriggerLabel must be a boolean')
    }
    if (typeof value.closeOnBackdrop !== 'boolean') {
      throw new TypeError('slide menu config closeOnBackdrop must be a boolean')
    }
    if (typeof value.showCloseButton !== 'boolean') {
      throw new TypeError('slide menu config showCloseButton must be a boolean')
    }
    const panelSize = boundedNumber(
      value.panelSize,
      'slide menu config panelSize',
      SLIDE_MENU_MODULE_LIMITS.panelSizeMin,
      SLIDE_MENU_MODULE_LIMITS.panelSizeMax
    )
    const panelBackground = canonicalColor(
      value.panelBackground,
      'slide menu config panelBackground'
    )
    const textColor = canonicalColor(value.textColor, 'slide menu config textColor')
    const overlayOpacity = boundedNumber(
      value.overlayOpacity,
      'slide menu config overlayOpacity',
      SLIDE_MENU_MODULE_LIMITS.overlayOpacityMin,
      SLIDE_MENU_MODULE_LIMITS.overlayOpacityMax
    )
    return {
      ok: true,
      config: {
        presentation: value.presentation as SlideMenuPresentationV1,
        direction: value.direction as SlideMenuDirectionV1,
        triggerLabel,
        showTriggerIcon,
        showTriggerLabel,
        title,
        description,
        items,
        closeOnBackdrop: value.closeOnBackdrop,
        showCloseButton: value.showCloseButton,
        panelSize,
        panelBackground,
        textColor,
        overlayOpacity
      }
    }
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) }
  }
}

export function createSlideMenuModuleInstance(config?: unknown): ModuleInstanceV1 {
  const parsed = parseSlideMenuConfig(
    mergePluginConfigWithDefaults(SLIDE_MENU_MODULE_DEFAULT_CONFIG, config),
    SLIDE_MENU_MODULE_CONFIG_VERSION
  )
  if (!parsed.ok) throw new TypeError(parsed.reason)
  return {
    version: 1,
    pluginId: SLIDE_MENU_PLUGIN_ID,
    moduleType: SLIDE_MENU_MODULE_TYPE,
    configVersion: SLIDE_MENU_MODULE_CONFIG_VERSION,
    config: parsed.config
  }
}

export function createSlideMenuModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'Slide Menu',
    defaultSize: SLIDE_MENU_MODULE_DEFAULT_SIZE,
    fillColor: { r: 0.15, g: 0.39, b: 0.92, a: 1 },
    strokeColor: { r: 0.11, g: 0.31, b: 0.85, a: 1 },
    module: createSlideMenuModuleInstance(config)
  })
}

export function resolveSlideMenuModule(value: unknown): ModuleResolution<SlideMenuModuleConfigV2> {
  if (value === null || value === undefined) return null
  const instance = validateModuleInstance(value)
  if (!instance.ok) return { ok: false, reason: instance.reason }
  if (
    instance.value.pluginId !== SLIDE_MENU_PLUGIN_ID ||
    instance.value.moduleType !== SLIDE_MENU_MODULE_TYPE
  ) {
    return null
  }
  if (
    instance.value.configVersion !== 1 &&
    instance.value.configVersion !== SLIDE_MENU_MODULE_CONFIG_VERSION
  ) {
    return {
      ok: false,
      reason: `unsupported slide menu config version ${instance.value.configVersion}`
    }
  }
  const config = parseSlideMenuConfig(instance.value.config, instance.value.configVersion)
  if (!config.ok) return config
  return {
    ok: true,
    instance: {
      ...instance.value,
      configVersion: SLIDE_MENU_MODULE_CONFIG_VERSION,
      config: config.config
    },
    config: config.config
  }
}

const SLIDE_MENU_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['presentation'],
    kind: 'select',
    label: 'Presentation',
    i18nLabelKey: 'lowcodeModuleFieldSlideMenuPresentation',
    options: ['menu', 'dialog']
  },
  {
    path: ['direction'],
    kind: 'select',
    label: 'Direction',
    i18nLabelKey: 'lowcodeModuleFieldSlideMenuDirection',
    options: ['left', 'right', 'top', 'bottom']
  },
  {
    path: ['triggerLabel'],
    kind: 'text',
    label: 'Trigger label',
    i18nLabelKey: 'lowcodeModuleFieldSlideMenuTriggerLabel'
  },
  {
    path: ['showTriggerIcon'],
    kind: 'boolean',
    label: 'Show trigger icon',
    i18nLabelKey: 'lowcodeModuleFieldSlideMenuShowTriggerIcon'
  },
  {
    path: ['showTriggerLabel'],
    kind: 'boolean',
    label: 'Show trigger label',
    i18nLabelKey: 'lowcodeModuleFieldSlideMenuShowTriggerLabel'
  },
  {
    path: ['title'],
    kind: 'text',
    label: 'Title',
    i18nLabelKey: 'lowcodeModuleFieldSlideMenuTitle'
  },
  {
    path: ['description'],
    kind: 'text',
    label: 'Description',
    i18nLabelKey: 'lowcodeModuleFieldSlideMenuDescription'
  },
  {
    path: ['items'],
    kind: 'json',
    label: 'Items',
    i18nLabelKey: 'lowcodeModuleFieldSlideMenuItems'
  },
  {
    path: ['closeOnBackdrop'],
    kind: 'boolean',
    label: 'Close on backdrop',
    i18nLabelKey: 'lowcodeModuleFieldSlideMenuCloseOnBackdrop'
  },
  {
    path: ['showCloseButton'],
    kind: 'boolean',
    label: 'Show close button',
    i18nLabelKey: 'lowcodeModuleFieldSlideMenuShowCloseButton'
  },
  {
    path: ['panelSize'],
    kind: 'number',
    label: 'Panel size',
    i18nLabelKey: 'lowcodeModuleFieldSlideMenuPanelSize',
    min: SLIDE_MENU_MODULE_LIMITS.panelSizeMin,
    max: SLIDE_MENU_MODULE_LIMITS.panelSizeMax,
    step: 1
  },
  {
    path: ['panelBackground'],
    kind: 'color',
    label: 'Panel background',
    i18nLabelKey: 'lowcodeModuleFieldSlideMenuPanelBackground'
  },
  {
    path: ['textColor'],
    kind: 'color',
    label: 'Text color',
    i18nLabelKey: 'lowcodeModuleFieldSlideMenuTextColor'
  },
  {
    path: ['overlayOpacity'],
    kind: 'number',
    label: 'Overlay opacity',
    i18nLabelKey: 'lowcodeModuleFieldSlideMenuOverlayOpacity',
    min: SLIDE_MENU_MODULE_LIMITS.overlayOpacityMin,
    max: SLIDE_MENU_MODULE_LIMITS.overlayOpacityMax,
    step: 0.05
  }
])

export const SLIDE_MENU_MODULE_DEFINITION: ModuleDefinition<SlideMenuModuleConfigV2> =
  Object.freeze({
    pluginId: SLIDE_MENU_PLUGIN_ID,
    moduleType: SLIDE_MENU_MODULE_TYPE,
    name: 'Slide Menu',
    description: 'A bounded slide-in navigation menu or dialog with safe links.',
    i18nNameKey: 'lowcodeModuleSlideMenuName',
    i18nDescriptionKey: 'lowcodeModuleSlideMenuDescription',
    configVersion: SLIDE_MENU_MODULE_CONFIG_VERSION,
    defaultSize: SLIDE_MENU_MODULE_DEFAULT_SIZE,
    defaultConfig: structuredClone(SLIDE_MENU_MODULE_DEFAULT_CONFIG),
    fields: SLIDE_MENU_MODULE_FIELDS,
    createInstance: createSlideMenuModuleInstance,
    createFrameOverrides: createSlideMenuModuleFrameOverrides,
    resolve: resolveSlideMenuModule
  })

export const SLIDE_MENU_PLUGIN = Object.freeze({
  id: SLIDE_MENU_PLUGIN_ID,
  name: 'OpenPencil Slide Menu',
  version: '1.0.0',
  modules: Object.freeze([SLIDE_MENU_MODULE_DEFINITION])
})
