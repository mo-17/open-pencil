import type { ModulePropertyField } from '#core/plugins/types'

export const DESCRIPTIONS_ITEM_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['id'],
    kind: 'text',
    label: 'Identifier',
    i18nLabelKey: 'lowcodeModuleDescriptionsItemId'
  },
  {
    path: ['label'],
    kind: 'text',
    label: 'Label',
    i18nLabelKey: 'lowcodeModuleDescriptionsItemLabel'
  },
  {
    path: ['value'],
    kind: 'text',
    label: 'Value',
    i18nLabelKey: 'lowcodeModuleDescriptionsItemValue'
  }
])
export const DESCRIPTIONS_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['label'],
    kind: 'text',
    label: 'Accessible label',
    i18nLabelKey: 'lowcodeModuleDescriptionsLabel'
  },
  { path: ['items'], kind: 'json', label: 'Items', i18nLabelKey: 'lowcodeModuleDescriptionsItems' },
  {
    path: ['columns'],
    kind: 'number',
    label: 'Columns',
    i18nLabelKey: 'lowcodeModuleDescriptionsColumns',
    min: 1,
    max: 3,
    step: 1
  },
  {
    path: ['layout'],
    kind: 'select',
    label: 'Layout',
    i18nLabelKey: 'lowcodeModuleDescriptionsLayout',
    options: ['horizontal', 'vertical']
  },
  {
    path: ['bordered'],
    kind: 'boolean',
    label: 'Show borders',
    i18nLabelKey: 'lowcodeModuleDescriptionsBordered'
  },
  {
    path: ['density'],
    kind: 'select',
    label: 'Density',
    i18nLabelKey: 'lowcodeModuleDescriptionsDensity',
    options: ['comfortable', 'compact']
  },
  {
    path: ['fontSize'],
    kind: 'number',
    label: 'Font size',
    i18nLabelKey: 'lowcodeModuleDescriptionsFontSize',
    min: 10,
    max: 24,
    step: 1
  },
  {
    path: ['borderRadius'],
    kind: 'number',
    label: 'Corner radius',
    i18nLabelKey: 'lowcodeModuleDescriptionsBorderRadius',
    min: 0,
    max: 24,
    step: 1
  },
  {
    path: ['backgroundColor'],
    kind: 'color',
    label: 'Background',
    i18nLabelKey: 'lowcodeModuleDescriptionsBackgroundColor'
  },
  {
    path: ['labelBackgroundColor'],
    kind: 'color',
    label: 'Label background',
    i18nLabelKey: 'lowcodeModuleDescriptionsLabelBackgroundColor'
  },
  {
    path: ['borderColor'],
    kind: 'color',
    label: 'Border color',
    i18nLabelKey: 'lowcodeModuleDescriptionsBorderColor'
  },
  {
    path: ['labelColor'],
    kind: 'color',
    label: 'Label color',
    i18nLabelKey: 'lowcodeModuleDescriptionsLabelColor'
  },
  {
    path: ['textColor'],
    kind: 'color',
    label: 'Value color',
    i18nLabelKey: 'lowcodeModuleDescriptionsTextColor'
  }
])
