import type { ModulePropertyField } from '#core/plugins/types'
const field = (
  key: string,
  label: string,
  kind: ModulePropertyField['kind'],
  options: Partial<ModulePropertyField> = {}
): ModulePropertyField => ({
  path: [key],
  kind,
  label,
  i18nLabelKey: 'lowcodeModuleFieldTree' + key[0].toUpperCase() + key.slice(1),
  ...options
})
export const TREE_MODULE_FIELDS: readonly ModulePropertyField[] = [
  field('presentation', 'Presentation', 'select', { options: ['tree', 'select'] }),
  field('label', 'Label', 'text'),
  field('placeholder', 'Placeholder', 'text'),
  field('selectionMode', 'Selection mode', 'select', { options: ['single', 'multiple'] }),
  field('items', 'Tree items and initial state', 'json'),
  field('searchable', 'Allow search', 'boolean'),
  field('disabled', 'Disabled', 'boolean'),
  field('showValue', 'Show selected values', 'boolean'),
  field('backgroundColor', 'Background', 'color'),
  field('textColor', 'Text color', 'color'),
  field('accentColor', 'Accent color', 'color'),
  field('borderColor', 'Border color', 'color'),
  field('fontSize', 'Font size', 'number', { min: 10, max: 24, step: 1 }),
  field('rowHeight', 'Row height', 'number', { min: 32, max: 64, step: 1 })
]
