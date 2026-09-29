import { createModuleFieldFactory } from '#core/plugins/property-fields'
import type { ModulePropertyField } from '#core/plugins/types'

const field = createModuleFieldFactory('lowcodeModulePagination')
export const PAGINATION_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  field('label', 'text', 'Accessible label'),
  field('total', 'number', 'Total items', { min: 0, max: 1_000_000_000, step: 1 }),
  field('pageSize', 'number', 'Items per page', { min: 1, max: 1000, step: 1 }),
  field('initialPage', 'number', 'Initial page', { min: 1, max: 1_000_000_000, step: 1 }),
  field('showFirstLast', 'boolean', 'Show first and last buttons'),
  field('disabled', 'boolean', 'Disabled'),
  field('size', 'select', 'Size', { options: ['comfortable', 'compact'] }),
  field('backgroundColor', 'color', 'Background'),
  field('textColor', 'color', 'Text color'),
  field('accentColor', 'color', 'Active color'),
  field('borderColor', 'color', 'Border color'),
  field('borderRadius', 'number', 'Corner radius', { min: 0, max: 24, step: 1 }),
  field('fontSize', 'number', 'Font size', { min: 10, max: 24, step: 1 })
])
