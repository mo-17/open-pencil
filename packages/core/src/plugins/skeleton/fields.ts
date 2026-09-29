import type { ModulePropertyField } from '#core/plugins/types'

export const SKELETON_FIELDS: readonly ModulePropertyField[] = [
  {
    path: ['variant'],
    kind: 'select',
    label: 'Shape',
    options: ['text', 'rectangle', 'circle'],
    i18nLabelKey: 'lowcodeModuleFieldSkeletonVariant'
  },
  {
    path: ['rows'],
    kind: 'number',
    label: 'Text rows',
    min: 1,
    max: 12,
    step: 1,
    i18nLabelKey: 'lowcodeModuleFieldSkeletonRows'
  },
  {
    path: ['lineHeight'],
    kind: 'number',
    label: 'Line height',
    min: 4,
    max: 48,
    step: 1,
    i18nLabelKey: 'lowcodeModuleFieldSkeletonLineHeight'
  },
  {
    path: ['gap'],
    kind: 'number',
    label: 'Line gap',
    min: 0,
    max: 32,
    step: 1,
    i18nLabelKey: 'lowcodeModuleFieldSkeletonGap'
  },
  {
    path: ['lastLineWidth'],
    kind: 'number',
    label: 'Last line width (%)',
    min: 10,
    max: 100,
    step: 1,
    i18nLabelKey: 'lowcodeModuleFieldSkeletonLastLineWidth'
  },
  {
    path: ['color'],
    kind: 'color',
    label: 'Placeholder color',
    i18nLabelKey: 'lowcodeModuleFieldSkeletonColor'
  },
  {
    path: ['backgroundColor'],
    kind: 'color',
    label: 'Background color',
    i18nLabelKey: 'lowcodeModuleFieldSkeletonBackgroundColor'
  },
  {
    path: ['borderRadius'],
    kind: 'number',
    label: 'Corner radius',
    min: 0,
    max: 48,
    step: 1,
    i18nLabelKey: 'lowcodeModuleFieldSkeletonBorderRadius'
  },
  {
    path: ['animation'],
    kind: 'select',
    label: 'Animation',
    options: ['none', 'pulse'],
    i18nLabelKey: 'lowcodeModuleFieldSkeletonAnimation'
  },
  {
    path: ['label'],
    kind: 'text',
    label: 'Loading description',
    i18nLabelKey: 'lowcodeModuleFieldSkeletonLabel'
  },
  {
    path: ['showLabel'],
    kind: 'boolean',
    label: 'Show description',
    i18nLabelKey: 'lowcodeModuleFieldSkeletonShowLabel'
  },
  {
    path: ['textColor'],
    kind: 'color',
    label: 'Description color',
    i18nLabelKey: 'lowcodeModuleFieldSkeletonTextColor'
  },
  {
    path: ['fontSize'],
    kind: 'number',
    label: 'Description font size',
    min: 10,
    max: 32,
    step: 1,
    i18nLabelKey: 'lowcodeModuleFieldSkeletonFontSize'
  }
]
