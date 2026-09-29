import * as values from '@open-pencil/plugin-contracts/adapter-helpers'
import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { TRANSPARENT } from '#core/constants'

import { DESCRIPTIONS_FIELDS } from './descriptions/fields'
import { parseDescriptionsItems } from './descriptions/items'
import * as contract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import type { ModuleResolution } from './types'

export { DESCRIPTIONS_ITEM_FIELDS } from './descriptions/fields'
export {
  DESCRIPTIONS_LAYOUT,
  descriptionsColumns,
  descriptionsCellMetrics
} from './descriptions/layout'
export const DESCRIPTIONS_PLUGIN_ID = 'open-pencil.descriptions'
export const DESCRIPTIONS_MODULE_TYPE = 'descriptions'
export const DESCRIPTIONS_MODULE_CONFIG_VERSION = 1
export const DESCRIPTIONS_MODULE_DEFAULT_SIZE = Object.freeze({ width: 480, height: 240 })
export const DESCRIPTIONS_MODULE_LIMITS = Object.freeze({
  itemsMin: 1,
  itemsMax: 24,
  id: 64,
  label: 120,
  value: 1000,
  configBytes: 65536
})
export interface DescriptionsItemV1 extends JSONObject {
  id: string
  label: string
  value: string
}
export interface DescriptionsModuleConfigV1 extends JSONObject {
  label: string
  items: DescriptionsItemV1[]
  columns: number
  layout: 'horizontal' | 'vertical'
  bordered: boolean
  density: 'comfortable' | 'compact'
  fontSize: number
  borderRadius: number
  backgroundColor: string
  labelBackgroundColor: string
  borderColor: string
  labelColor: string
  textColor: string
}
export type DescriptionsModuleConfig = DescriptionsModuleConfigV1
export const DESCRIPTIONS_DEFAULT_ITEM: Readonly<DescriptionsItemV1> = Object.freeze({
  id: 'item',
  label: 'Label',
  value: 'Value'
})
const items: DescriptionsItemV1[] = [
  { id: 'name', label: 'Name', value: 'Sample project' },
  { id: 'status', label: 'Status', value: 'Draft' },
  { id: 'owner', label: 'Owner', value: 'Design team' },
  { id: 'updated', label: 'Updated', value: '2026-09-28' },
  { id: 'category', label: 'Category', value: 'Local example' },
  { id: 'notes', label: 'Notes', value: 'Editable display text' }
]
items.forEach(Object.freeze)
Object.freeze(items)
export const DESCRIPTIONS_MODULE_DEFAULT_CONFIG: Readonly<DescriptionsModuleConfigV1> =
  Object.freeze({
    label: 'Project details',
    items,
    columns: 2,
    layout: 'horizontal',
    bordered: true,
    density: 'comfortable',
    fontSize: 14,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    labelBackgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    labelColor: '#64748B',
    textColor: '#172B4D'
  })
const CONFIG_KEYS = new Set(Object.keys(DESCRIPTIONS_MODULE_DEFAULT_CONFIG))
const CONTRACT: contract.ModuleContract<DescriptionsModuleConfigV1> = {
  pluginId: DESCRIPTIONS_PLUGIN_ID,
  moduleType: DESCRIPTIONS_MODULE_TYPE,
  configVersion: 1,
  displayName: 'descriptions',
  defaultConfig: DESCRIPTIONS_MODULE_DEFAULT_CONFIG,
  parseConfig: (value) =>
    contract.parseExactModuleConfig(
      value,
      CONFIG_KEYS,
      'descriptions config must contain exactly its declared fields',
      (source) => {
        const config: DescriptionsModuleConfigV1 = {
          label: values.parseBoundedPluginText(source.label, 'descriptions label', 1, 120),
          items: parseDescriptionsItems(source.items),
          columns: values.parseBoundedPluginInteger(source.columns, 'descriptions columns', 1, 3),
          layout: values.parsePluginStringEnum(
            source.layout,
            'descriptions layout',
            new Set(['horizontal', 'vertical'] as const),
            'horizontal or vertical'
          ),
          bordered: values.parsePluginBoolean(source.bordered, 'descriptions bordered'),
          density: values.parsePluginStringEnum(
            source.density,
            'descriptions density',
            new Set(['comfortable', 'compact'] as const),
            'comfortable or compact'
          ),
          fontSize: values.parseBoundedPluginInteger(
            source.fontSize,
            'descriptions fontSize',
            10,
            24
          ),
          borderRadius: values.parseBoundedPluginInteger(
            source.borderRadius,
            'descriptions borderRadius',
            0,
            24
          ),
          backgroundColor: values.parseCanonicalPluginColor(
            source.backgroundColor,
            'descriptions backgroundColor'
          ),
          labelBackgroundColor: values.parseCanonicalPluginColor(
            source.labelBackgroundColor,
            'descriptions labelBackgroundColor'
          ),
          borderColor: values.parseCanonicalPluginColor(
            source.borderColor,
            'descriptions borderColor'
          ),
          labelColor: values.parseCanonicalPluginColor(
            source.labelColor,
            'descriptions labelColor'
          ),
          textColor: values.parseCanonicalPluginColor(source.textColor, 'descriptions textColor')
        }
        if (!config.label.trim())
          throw new TypeError('Descriptions needs a readable accessible label')
        values.assertBoundedPluginConfigBytes(
          config,
          'descriptions config',
          DESCRIPTIONS_MODULE_LIMITS.configBytes
        )
        return config
      }
    )
}
export function createDescriptionsModuleInstance(config?: unknown): ModuleInstanceV1 {
  return contract.createContractModuleInstance(CONTRACT, config)
}
export function resolveDescriptionsModule(
  value: unknown
): ModuleResolution<DescriptionsModuleConfigV1> {
  return contract.resolveContractModule(value, CONTRACT)
}
export function createDescriptionsModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return {
    ...createModuleFrameOverrides({
      name: 'Descriptions',
      defaultSize: DESCRIPTIONS_MODULE_DEFAULT_SIZE,
      fillColor: TRANSPARENT,
      strokeColor: TRANSPARENT,
      module: createDescriptionsModuleInstance(config)
    }),
    fills: [],
    strokes: [],
    cornerRadius: 0
  }
}
export const DESCRIPTIONS_MODULE_DEFINITION = contract.createContractModuleDefinition(CONTRACT, {
  name: 'Descriptions',
  description: 'An authored label and value list; no form controls, data fetching, or actions.',
  i18nNameKey: 'lowcodeModuleDescriptionsName',
  i18nDescriptionKey: 'lowcodeModuleDescriptionsDescription',
  defaultSize: DESCRIPTIONS_MODULE_DEFAULT_SIZE,
  fields: DESCRIPTIONS_FIELDS,
  createInstance: createDescriptionsModuleInstance,
  createFrameOverrides: createDescriptionsModuleFrameOverrides,
  resolve: resolveDescriptionsModule
})
export const DESCRIPTIONS_PLUGIN = contract.createSingleModulePlugin(
  DESCRIPTIONS_PLUGIN_ID,
  'OpenPencil Descriptions',
  DESCRIPTIONS_MODULE_DEFINITION
)
