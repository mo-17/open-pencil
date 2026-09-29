import { TABLE_HEADER_FIELD, TABLE_APPEARANCE_FIELDS } from '#core/plugins/table-fields'
import type { ModulePropertyField } from '#core/plugins/types'

import type { DATA_GRID_MODULE_LIMITS } from './index'

export function dataGridModuleFields(
  limits: typeof DATA_GRID_MODULE_LIMITS
): readonly ModulePropertyField[] {
  return Object.freeze([
    {
      path: ['showCsvTools'],
      kind: 'boolean',
      label: 'Show CSV import/export tools',
      i18nLabelKey: 'lowcodeModuleFieldDataGridShowCsvTools'
    },
    {
      path: ['data'],
      kind: 'json',
      label: 'Grid data',
      i18nLabelKey: 'lowcodeModuleFieldDataGridData'
    },
    {
      path: ['initialSort'],
      kind: 'json',
      label: 'Initial sort',
      i18nLabelKey: 'lowcodeModuleFieldDataGridInitialSort'
    },
    {
      path: ['filters'],
      kind: 'json',
      label: 'Initial filters',
      i18nLabelKey: 'lowcodeModuleFieldDataGridFilters'
    },
    {
      path: ['pageSize'],
      kind: 'number',
      label: 'Page size',
      i18nLabelKey: 'lowcodeModuleFieldDataGridPageSize',
      min: limits.pageSizeMin,
      max: limits.pageSizeMax,
      step: 1
    },
    {
      path: ['selectionMode'],
      kind: 'select',
      label: 'Selection mode',
      i18nLabelKey: 'lowcodeModuleFieldDataGridSelectionMode',
      options: ['none', 'single', 'multiple']
    },
    {
      path: ['density'],
      kind: 'select',
      label: 'Density',
      i18nLabelKey: 'lowcodeModuleFieldDataGridDensity',
      options: ['compact', 'comfortable']
    },
    TABLE_HEADER_FIELD,
    {
      path: ['stickyHeader'],
      kind: 'boolean',
      label: 'Sticky header',
      i18nLabelKey: 'lowcodeModuleFieldDataGridStickyHeader'
    },
    ...TABLE_APPEARANCE_FIELDS,
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
      i18nLabelKey: 'lowcodeModuleFieldFontSize',
      min: limits.fontSizeMin,
      max: limits.fontSizeMax,
      step: 1
    }
  ])
}
