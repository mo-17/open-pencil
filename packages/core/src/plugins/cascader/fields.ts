import { createModuleFieldFactory } from '#core/plugins/property-fields'
import type { ModulePropertyField } from '#core/plugins/types'

const field = createModuleFieldFactory('lowcodeModuleCascader')
export const CASCADER_MODULE_FIELDS: readonly ModulePropertyField[] = [
  field('label', 'text', 'Accessible label'),
  field('placeholder', 'text', 'Placeholder'),
  field('items', 'json', 'Hierarchy and initial path'),
  field('initialPath', 'json', 'Initial path'),
  field('searchable', 'boolean', 'Allow search'),
  field('clearable', 'boolean', 'Allow clearing'),
  field('disabled', 'boolean', 'Disabled'),
  field('backgroundColor', 'color', 'Background'),
  field('textColor', 'color', 'Text color'),
  field('accentColor', 'color', 'Accent color'),
  field('borderColor', 'color', 'Border color'),
  field('fontSize', 'number', 'Font size', { min: 10, max: 24, step: 1 }),
  field('rowHeight', 'number', 'Option height', { min: 32, max: 64, step: 1 }),
  field('borderRadius', 'number', 'Corner radius', { min: 0, max: 24, step: 1 })
]
