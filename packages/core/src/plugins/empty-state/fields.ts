import type { ModulePropertyField } from '#core/plugins/types'

export const EMPTY_STATE_FIELDS: readonly ModulePropertyField[] = [
  {
    path: ['title'],
    kind: 'text',
    label: 'Title',
    i18nLabelKey: 'lowcodeModuleFieldEmptyStateTitle'
  },
  {
    path: ['description'],
    kind: 'text',
    label: 'Description',
    i18nLabelKey: 'lowcodeModuleFieldEmptyStateDescription'
  },
  {
    path: ['illustration'],
    kind: 'select',
    label: 'Illustration',
    i18nLabelKey: 'lowcodeModuleFieldEmptyStateIllustration',
    options: ['box', 'search', 'none']
  },
  {
    path: ['alignment'],
    kind: 'select',
    label: 'Alignment',
    i18nLabelKey: 'lowcodeModuleFieldEmptyStateAlignment',
    options: ['center', 'left']
  },
  {
    path: ['iconSize'],
    kind: 'number',
    label: 'Illustration size',
    i18nLabelKey: 'lowcodeModuleFieldEmptyStateIconSize',
    min: 24,
    max: 128,
    step: 1
  },
  {
    path: ['fontSize'],
    kind: 'number',
    label: 'Text size',
    i18nLabelKey: 'lowcodeModuleFieldEmptyStateFontSize',
    min: 10,
    max: 24,
    step: 1
  },
  {
    path: ['gap'],
    kind: 'number',
    label: 'Content gap',
    i18nLabelKey: 'lowcodeModuleFieldEmptyStateGap',
    min: 4,
    max: 32,
    step: 1
  },
  {
    path: ['padding'],
    kind: 'number',
    label: 'Padding',
    i18nLabelKey: 'lowcodeModuleFieldEmptyStatePadding',
    min: 8,
    max: 64,
    step: 1
  },
  {
    path: ['borderRadius'],
    kind: 'number',
    label: 'Corner radius',
    i18nLabelKey: 'lowcodeModuleFieldEmptyStateRadius',
    min: 0,
    max: 32,
    step: 1
  },
  {
    path: ['backgroundColor'],
    kind: 'color',
    label: 'Background',
    i18nLabelKey: 'lowcodeModuleFieldEmptyStateBackground'
  },
  {
    path: ['textColor'],
    kind: 'color',
    label: 'Title color',
    i18nLabelKey: 'lowcodeModuleFieldEmptyStateTextColor'
  },
  {
    path: ['descriptionColor'],
    kind: 'color',
    label: 'Description color',
    i18nLabelKey: 'lowcodeModuleFieldEmptyStateDescriptionColor'
  },
  {
    path: ['illustrationColor'],
    kind: 'color',
    label: 'Illustration color',
    i18nLabelKey: 'lowcodeModuleFieldEmptyStateIllustrationColor'
  }
]
