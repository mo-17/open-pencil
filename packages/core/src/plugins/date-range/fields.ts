import type { ModulePropertyField } from '#core/plugins/types'

export const DATE_RANGE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['label'],
    kind: 'text',
    label: 'Group label',
    i18nLabelKey: 'lowcodeModuleFieldDateRangeLabel'
  },
  {
    path: ['startLabel'],
    kind: 'text',
    label: 'Start label (empty: automatic)',
    i18nLabelKey: 'lowcodeModuleFieldDateRangeStartLabel'
  },
  {
    path: ['endLabel'],
    kind: 'text',
    label: 'End label (empty: automatic)',
    i18nLabelKey: 'lowcodeModuleFieldDateRangeEndLabel'
  },
  {
    path: ['initialStart'],
    kind: 'text',
    label: 'Initial start (YYYY-MM-DD or empty)',
    i18nLabelKey: 'lowcodeModuleFieldDateRangeInitialStart'
  },
  {
    path: ['initialEnd'],
    kind: 'text',
    label: 'Initial end (YYYY-MM-DD or empty)',
    i18nLabelKey: 'lowcodeModuleFieldDateRangeInitialEnd'
  },
  {
    path: ['min'],
    kind: 'text',
    label: 'Earliest date (YYYY-MM-DD or empty)',
    i18nLabelKey: 'lowcodeModuleFieldDateRangeMin'
  },
  {
    path: ['max'],
    kind: 'text',
    label: 'Latest date (YYYY-MM-DD or empty)',
    i18nLabelKey: 'lowcodeModuleFieldDateRangeMax'
  },
  {
    path: ['disabled'],
    kind: 'boolean',
    label: 'Disabled',
    i18nLabelKey: 'lowcodeModuleFieldDisabled'
  },
  {
    path: ['allowClear'],
    kind: 'boolean',
    label: 'Allow clearing',
    i18nLabelKey: 'lowcodeModuleFieldDateRangeAllowClear'
  },
  {
    path: ['backgroundColor'],
    kind: 'color',
    label: 'Background',
    i18nLabelKey: 'lowcodeModuleFieldBackgroundColor'
  },
  {
    path: ['textColor'],
    kind: 'color',
    label: 'Text color',
    i18nLabelKey: 'lowcodeModuleFieldTextColor'
  },
  {
    path: ['borderColor'],
    kind: 'color',
    label: 'Border color',
    i18nLabelKey: 'lowcodeModuleFieldBorderColor'
  },
  {
    path: ['accentColor'],
    kind: 'color',
    label: 'Accent color',
    i18nLabelKey: 'lowcodeModuleFieldAccentColor'
  },
  {
    path: ['fontSize'],
    kind: 'number',
    label: 'Font size',
    min: 10,
    max: 24,
    step: 1,
    i18nLabelKey: 'lowcodeModuleFieldFontSize'
  },
  {
    path: ['borderRadius'],
    kind: 'number',
    label: 'Corner radius',
    min: 0,
    max: 24,
    step: 1,
    i18nLabelKey: 'lowcodeModuleFieldBorderRadius'
  }
])
