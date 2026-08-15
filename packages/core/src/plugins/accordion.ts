import {
  assertBoundedPluginConfigBytes,
  hasExactPluginKeys,
  parseBoundedPluginNumber,
  parseBoundedPluginText,
  parseCanonicalPluginColor,
  parsePluginBoolean
} from '@open-pencil/plugin-contracts/adapter-helpers'
import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import * as moduleContract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import type { ModulePropertyField, ModuleResolution } from './types'

export const ACCORDION_PLUGIN_ID = 'open-pencil.accordion'
export const ACCORDION_MODULE_TYPE = 'accordion'
export const ACCORDION_MODULE_CONFIG_VERSION = 1
export const ACCORDION_MODULE_DEFAULT_SIZE = Object.freeze({ width: 520, height: 360 })
export const ACCORDION_MODULE_LIMITS = Object.freeze({
  itemsMin: 1,
  itemsMax: 16,
  id: 64,
  label: 80,
  title: 120,
  content: 4_000,
  totalText: 20_000,
  fontSizeMin: 10,
  fontSizeMax: 48,
  configBytes: 32_768
})

export interface AccordionItemV1 extends JSONObject {
  id: string
  title: string
  content: string
}

export interface AccordionModuleConfigV1 extends JSONObject {
  label: string
  items: AccordionItemV1[]
  allowMultiple: boolean
  initialOpenIds: string[]
  showDividers: boolean
  backgroundColor: string
  textColor: string
  accentColor: string
  fontSize: number
}

export type AccordionModuleConfig = AccordionModuleConfigV1

const DEFAULT_ITEMS: AccordionItemV1[] = [
  { id: 'first', title: 'First section', content: 'Add the first section content.' },
  { id: 'second', title: 'Second section', content: 'Add the second section content.' },
  { id: 'third', title: 'Third section', content: 'Add the third section content.' }
]
DEFAULT_ITEMS.forEach(Object.freeze)
Object.freeze(DEFAULT_ITEMS)
const DEFAULT_OPEN_IDS: string[] = ['first']
Object.freeze(DEFAULT_OPEN_IDS)

export const ACCORDION_MODULE_DEFAULT_CONFIG: Readonly<AccordionModuleConfigV1> = Object.freeze({
  label: 'Expandable sections',
  items: DEFAULT_ITEMS,
  allowMultiple: false,
  initialOpenIds: DEFAULT_OPEN_IDS,
  showDividers: true,
  backgroundColor: '#FFFFFF',
  textColor: '#111827',
  accentColor: '#2563EB',
  fontSize: 14
})

const CONFIG_KEYS = new Set([
  'label',
  'items',
  'allowMultiple',
  'initialOpenIds',
  'showDividers',
  'backgroundColor',
  'textColor',
  'accentColor',
  'fontSize'
])
const ITEM_KEYS = new Set(['id', 'title', 'content'])
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/

function parseItemId(value: unknown, path: string): string {
  const id = parseBoundedPluginText(value, path, 1, ACCORDION_MODULE_LIMITS.id)
  if (!ID_PATTERN.test(id)) {
    throw new TypeError(`${path} must start with a letter and contain only letters, digits, _ or -`)
  }
  return id
}

function parseAccordionItems(value: unknown): AccordionItemV1[] {
  const ids = new Set<string>()
  let totalText = 0
  return moduleContract.parseBoundedModuleObjectArray(
    value,
    ACCORDION_MODULE_LIMITS.itemsMin,
    ACCORDION_MODULE_LIMITS.itemsMax,
    `accordion config items must contain ${ACCORDION_MODULE_LIMITS.itemsMin} to ${ACCORDION_MODULE_LIMITS.itemsMax} items`,
    (index) => `accordion config items[${index}] must be an accordion item object`,
    (entry, index) => {
      if (!hasExactPluginKeys(entry, ITEM_KEYS)) {
        throw new TypeError(
          `accordion config items[${index}] must contain exactly id, title, and content`
        )
      }
      const id = parseItemId(entry.id, `accordion config items[${index}].id`)
      if (ids.has(id)) throw new TypeError(`accordion config item id ${id} must be unique`)
      ids.add(id)
      const title = parseBoundedPluginText(
        entry.title,
        `accordion config items[${index}].title`,
        1,
        ACCORDION_MODULE_LIMITS.title
      )
      const content = parseBoundedPluginText(
        entry.content,
        `accordion config items[${index}].content`,
        0,
        ACCORDION_MODULE_LIMITS.content
      )
      totalText += title.length + content.length
      if (totalText > ACCORDION_MODULE_LIMITS.totalText) {
        throw new TypeError(
          `accordion config text must not exceed ${ACCORDION_MODULE_LIMITS.totalText} characters`
        )
      }
      return { id, title, content }
    }
  )
}

function parseInitialOpenIds(value: unknown, itemIds: ReadonlySet<string>, allowMultiple: boolean) {
  if (!Array.isArray(value) || value.length > ACCORDION_MODULE_LIMITS.itemsMax) {
    throw new TypeError(
      `accordion config initialOpenIds must contain at most ${ACCORDION_MODULE_LIMITS.itemsMax} ids`
    )
  }
  if (!allowMultiple && value.length > 1) {
    throw new TypeError('accordion config initialOpenIds must contain at most one id')
  }
  const seen = new Set<string>()
  return Array.from(value, (entry, index) => {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError(`accordion config initialOpenIds[${index}] must be present`)
    }
    const id = parseItemId(entry, `accordion config initialOpenIds[${index}]`)
    if (!itemIds.has(id)) {
      throw new TypeError(
        `accordion config initialOpenIds[${index}] must reference an existing item`
      )
    }
    if (seen.has(id)) throw new TypeError('accordion config initialOpenIds must be unique')
    seen.add(id)
    return id
  })
}

function parseAccordionConfig(value: unknown) {
  return moduleContract.parseExactModuleConfig(
    value,
    CONFIG_KEYS,
    'accordion config must contain exactly label, items, allowMultiple, initialOpenIds, showDividers, backgroundColor, textColor, accentColor, and fontSize',
    (source): AccordionModuleConfigV1 => {
      const items = parseAccordionItems(source.items)
      const allowMultiple = parsePluginBoolean(
        source.allowMultiple,
        'accordion config allowMultiple'
      )
      const config: AccordionModuleConfigV1 = {
        label: parseBoundedPluginText(
          source.label,
          'accordion config label',
          1,
          ACCORDION_MODULE_LIMITS.label
        ),
        items,
        allowMultiple,
        initialOpenIds: parseInitialOpenIds(
          source.initialOpenIds,
          new Set(items.map((item) => item.id)),
          allowMultiple
        ),
        showDividers: parsePluginBoolean(source.showDividers, 'accordion config showDividers'),
        backgroundColor: parseCanonicalPluginColor(
          source.backgroundColor,
          'accordion config backgroundColor'
        ),
        textColor: parseCanonicalPluginColor(source.textColor, 'accordion config textColor'),
        accentColor: parseCanonicalPluginColor(source.accentColor, 'accordion config accentColor'),
        fontSize: parseBoundedPluginNumber(
          source.fontSize,
          'accordion config fontSize',
          ACCORDION_MODULE_LIMITS.fontSizeMin,
          ACCORDION_MODULE_LIMITS.fontSizeMax
        )
      }
      assertBoundedPluginConfigBytes(
        config,
        'accordion config',
        ACCORDION_MODULE_LIMITS.configBytes
      )
      return config
    }
  )
}

const ACCORDION_MODULE_CONTRACT: moduleContract.ModuleContract<AccordionModuleConfigV1> = {
  pluginId: ACCORDION_PLUGIN_ID,
  moduleType: ACCORDION_MODULE_TYPE,
  configVersion: ACCORDION_MODULE_CONFIG_VERSION,
  displayName: 'accordion',
  defaultConfig: ACCORDION_MODULE_DEFAULT_CONFIG,
  parseConfig: parseAccordionConfig
}

export function createAccordionModuleInstance(config?: unknown): ModuleInstanceV1 {
  return moduleContract.createContractModuleInstance(ACCORDION_MODULE_CONTRACT, config)
}

export function createAccordionModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'Accordion',
    defaultSize: ACCORDION_MODULE_DEFAULT_SIZE,
    fillColor: { r: 1, g: 1, b: 1, a: 1 },
    strokeColor: { r: 0.82, g: 0.84, b: 0.88, a: 1 },
    module: createAccordionModuleInstance(config)
  })
}

export function resolveAccordionModule(value: unknown): ModuleResolution<AccordionModuleConfigV1> {
  return moduleContract.resolveContractModule(value, ACCORDION_MODULE_CONTRACT)
}

const ACCORDION_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['label'],
    kind: 'text',
    label: 'Accessible label',
    i18nLabelKey: 'lowcodeModuleFieldAccordionLabel'
  },
  {
    path: ['items'],
    kind: 'json',
    label: 'Sections',
    i18nLabelKey: 'lowcodeModuleFieldAccordionItems'
  },
  {
    path: ['allowMultiple'],
    kind: 'boolean',
    label: 'Allow multiple',
    i18nLabelKey: 'lowcodeModuleFieldAccordionMultiple'
  },
  {
    path: ['initialOpenIds'],
    kind: 'json',
    label: 'Initially open',
    i18nLabelKey: 'lowcodeModuleFieldAccordionInitialOpen'
  },
  {
    path: ['showDividers'],
    kind: 'boolean',
    label: 'Show dividers',
    i18nLabelKey: 'lowcodeModuleFieldAccordionDividers'
  },
  {
    path: ['backgroundColor'],
    kind: 'color',
    label: 'Background',
    i18nLabelKey: 'lowcodeModuleFieldAccordionBackground'
  },
  {
    path: ['textColor'],
    kind: 'color',
    label: 'Text color',
    i18nLabelKey: 'lowcodeModuleFieldAccordionTextColor'
  },
  {
    path: ['accentColor'],
    kind: 'color',
    label: 'Accent color',
    i18nLabelKey: 'lowcodeModuleFieldAccordionAccentColor'
  },
  {
    path: ['fontSize'],
    kind: 'number',
    label: 'Font size',
    i18nLabelKey: 'lowcodeModuleFieldAccordionFontSize',
    min: ACCORDION_MODULE_LIMITS.fontSizeMin,
    max: ACCORDION_MODULE_LIMITS.fontSizeMax,
    step: 1
  }
])

export const ACCORDION_MODULE_DEFINITION = moduleContract.createContractModuleDefinition(
  ACCORDION_MODULE_CONTRACT,
  {
    name: 'Accordion',
    description: 'Accessible bounded expandable sections with validated initial state.',
    i18nNameKey: 'lowcodeModuleAccordionName',
    i18nDescriptionKey: 'lowcodeModuleAccordionDescription',
    defaultSize: ACCORDION_MODULE_DEFAULT_SIZE,
    fields: ACCORDION_MODULE_FIELDS,
    createInstance: createAccordionModuleInstance,
    createFrameOverrides: createAccordionModuleFrameOverrides,
    resolve: resolveAccordionModule
  }
)

export const ACCORDION_PLUGIN = moduleContract.createSingleModulePlugin(
  ACCORDION_PLUGIN_ID,
  'OpenPencil Accordion',
  ACCORDION_MODULE_DEFINITION
)
