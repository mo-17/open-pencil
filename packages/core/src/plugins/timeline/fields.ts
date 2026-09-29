import { NAVIGATION_APPEARANCE_FIELDS } from '#core/plugins/navigation/shared'
import type { ModulePropertyField } from '#core/plugins/types'

export const TIMELINE_ITEM_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['id'],
    kind: 'text',
    label: 'Identifier',
    i18nLabelKey: 'lowcodeModuleFieldTimelineItemId'
  },
  {
    path: ['title'],
    kind: 'text',
    label: 'Title',
    i18nLabelKey: 'lowcodeModuleFieldTimelineItemTitle'
  },
  {
    path: ['description'],
    kind: 'text',
    label: 'Description',
    i18nLabelKey: 'lowcodeModuleFieldTimelineItemDescription'
  },
  {
    path: ['time'],
    kind: 'text',
    label: 'Time label',
    i18nLabelKey: 'lowcodeModuleFieldTimelineItemTime'
  },
  {
    path: ['status'],
    kind: 'select',
    label: 'Status',
    options: ['completed', 'current', 'pending', 'error'],
    i18nLabelKey: 'lowcodeModuleFieldTimelineItemStatus'
  }
])

export const TIMELINE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['items'],
    kind: 'json',
    label: 'Events',
    i18nLabelKey: 'lowcodeModuleFieldTimelineItems'
  },
  {
    path: ['layout'],
    kind: 'select',
    label: 'Layout',
    options: ['start', 'alternate'],
    i18nLabelKey: 'lowcodeModuleFieldTimelineLayout'
  },
  {
    path: ['emptyText'],
    kind: 'text',
    label: 'Empty message',
    i18nLabelKey: 'lowcodeModuleFieldTimelineEmptyText'
  },
  {
    path: ['completedColor'],
    kind: 'color',
    label: 'Completed color',
    i18nLabelKey: 'lowcodeModuleFieldTimelineCompletedColor'
  },
  {
    path: ['errorColor'],
    kind: 'color',
    label: 'Error color',
    i18nLabelKey: 'lowcodeModuleFieldTimelineErrorColor'
  },
  {
    path: ['lineColor'],
    kind: 'color',
    label: 'Line color',
    i18nLabelKey: 'lowcodeModuleFieldTimelineLineColor'
  },
  {
    path: ['itemGap'],
    kind: 'number',
    label: 'Event spacing',
    min: 8,
    max: 64,
    step: 1,
    i18nLabelKey: 'lowcodeModuleFieldTimelineItemGap'
  },
  {
    path: ['markerSize'],
    kind: 'number',
    label: 'Marker size',
    min: 8,
    max: 24,
    step: 1,
    i18nLabelKey: 'lowcodeModuleFieldTimelineMarkerSize'
  },
  {
    path: ['lineWidth'],
    kind: 'number',
    label: 'Line width',
    min: 1,
    max: 4,
    step: 1,
    i18nLabelKey: 'lowcodeModuleFieldTimelineLineWidth'
  },
  ...NAVIGATION_APPEARANCE_FIELDS
])
