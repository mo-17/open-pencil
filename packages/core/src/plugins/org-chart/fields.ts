import { createModuleFieldFactory } from '#core/plugins/property-fields'
import type { ModulePropertyField } from '#core/plugins/types'

const field = createModuleFieldFactory('lowcodeModuleOrgChart')
export const ORG_CHART_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  field('label', 'text', 'Accessible label'),
  field('items', 'json', 'Organization items'),
  field('direction', 'select', 'Direction', { options: ['vertical', 'horizontal'] }),
  field('collapsible', 'boolean', 'Allow branch collapse'),
  field('initialCollapsedIds', 'json', 'Initially collapsed branches'),
  field('backgroundColor', 'color', 'Background'),
  field('cardColor', 'color', 'Card background'),
  field('textColor', 'color', 'Text color'),
  field('mutedColor', 'color', 'Description color'),
  field('accentColor', 'color', 'Accent color'),
  field('borderColor', 'color', 'Border color'),
  field('connectorColor', 'color', 'Connector color'),
  field('fontSize', 'number', 'Font size', { min: 10, max: 24, step: 1 }),
  field('borderRadius', 'number', 'Corner radius', { min: 0, max: 24, step: 1 })
])
