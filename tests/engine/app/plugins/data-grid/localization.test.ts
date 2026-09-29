import { describe, expect, test } from 'bun:test'

import {
  DATA_GRID_MODULE_DEFINITION,
  TABLE_MODULE_DEFINITION,
  createDataGridModuleInstance
} from '@open-pencil/core/plugins'

import { moduleOptionPanelKey } from '@/app/plugins/module-option-localization'

import dePanels from '#vue/i18n/locales/de/panels.json'
import esPanels from '#vue/i18n/locales/es/panels.json'
import frPanels from '#vue/i18n/locales/fr/panels.json'
import itPanels from '#vue/i18n/locales/it/panels.json'
import jaPanels from '#vue/i18n/locales/ja/panels.json'
import plPanels from '#vue/i18n/locales/pl/panels.json'
import ruPanels from '#vue/i18n/locales/ru/panels.json'
import zhPanels from '#vue/i18n/locales/zh-cn/panels.json'
import { panelMessageDefaults } from '#vue/i18n/messages/panels'

const bundles: Record<string, Readonly<Record<string, unknown>>> = {
  en: panelMessageDefaults,
  de: dePanels,
  es: esPanels,
  fr: frPanels,
  it: itPanels,
  ja: jaPanels,
  pl: plPanels,
  ru: ruPanels,
  'zh-CN': zhPanels
}

function propertyLabels(panels: Readonly<Record<string, unknown>>) {
  return DATA_GRID_MODULE_DEFINITION.fields.map((field) => ({
    property: field.path.join('.'),
    label: field.i18nLabelKey ? panels[field.i18nLabelKey] : undefined,
    options:
      field.kind === 'select'
        ? field.options.map((value) => {
            const key = moduleOptionPanelKey(field.i18nLabelKey, value)
            return { value, label: key ? panels[key] : undefined }
          })
        : []
  }))
}

describe('DataGrid inspector localization', () => {
  test('every field and enum option resolves in English and all eight supported translations', () => {
    for (const [locale, panels] of Object.entries(bundles)) {
      const labels = propertyLabels(panels)
      expect(labels).toHaveLength(15)
      for (const field of labels) {
        expect(typeof field.label, `${locale}/${field.property}`).toBe('string')
        expect(String(field.label).trim().length).toBeGreaterThan(0)
        for (const option of field.options) {
          expect(typeof option.label, `${locale}/${field.property}/${option.value}`).toBe('string')
          expect(String(option.label).trim().length).toBeGreaterThan(0)
          expect(option.label).not.toBe(option.value)
        }
      }
    }
  })

  test('Chinese labels describe table operations while enum identities remain stable', () => {
    const en = propertyLabels(panelMessageDefaults)
    const zh = propertyLabels(zhPanels)
    expect(en.find((field) => field.property === 'pageSize')?.label).toBe('Rows per page')
    expect(zh.find((field) => field.property === 'pageSize')?.label).toBe('每页行数')
    expect(zh.find((field) => field.property === 'initialSort')?.label).toBe('初始排序')
    expect(zh.find((field) => field.property === 'filters')?.label).toBe('初始筛选')
    expect(zh.find((field) => field.property === 'selectionMode')?.options).toEqual([
      { value: 'none', label: '不允许选行' },
      { value: 'single', label: '单行选择' },
      { value: 'multiple', label: '多行选择' }
    ])
    expect(zh.find((field) => field.property === 'density')?.options).toEqual([
      { value: 'compact', label: '紧凑' },
      { value: 'comfortable', label: '宽松' }
    ])
  })

  test('locale projection does not mutate a v1 instance or turn localized labels into stored values', () => {
    const instance = createDataGridModuleInstance({
      selectionMode: 'multiple',
      density: 'comfortable'
    })
    const before = structuredClone(instance)
    for (const panels of Object.values(bundles)) propertyLabels(panels)
    expect(instance).toEqual(before)
    expect(instance.configVersion).toBe(1)
    expect(instance.config).toMatchObject({ selectionMode: 'multiple', density: 'comfortable' })
    expect(() => createDataGridModuleInstance({ selectionMode: '多行选择' })).toThrow()
    expect(() => createDataGridModuleInstance({ density: '宽松' })).toThrow()
  })

  test('shared table presentation metadata preserves order and each module font-size limits', () => {
    const table = TABLE_MODULE_DEFINITION.fields
    const grid = DATA_GRID_MODULE_DEFINITION.fields
    expect(table.map((field) => field.path[0])).toEqual([
      'table',
      'showHeader',
      'striped',
      'borderColor',
      'headerBackground',
      'textColor',
      'fontSize'
    ])
    expect(grid.map((field) => field.path[0])).toEqual([
      'showCsvTools',
      'data',
      'initialSort',
      'filters',
      'pageSize',
      'selectionMode',
      'density',
      'showHeader',
      'stickyHeader',
      'striped',
      'borderColor',
      'headerBackground',
      'textColor',
      'accentColor',
      'fontSize'
    ])
    for (const key of ['showHeader', 'striped', 'borderColor', 'headerBackground', 'textColor']) {
      const left = table.find((field) => field.path[0] === key)
      const right = grid.find((field) => field.path[0] === key)
      expect(left).toEqual(right)
      expect(Object.isFrozen(left)).toBe(true)
      expect(Object.isFrozen(left?.path)).toBe(true)
    }
    expect(table.find((field) => field.path[0] === 'fontSize')).toMatchObject({
      min: 8,
      max: 72,
      step: 1
    })
    expect(grid.find((field) => field.path[0] === 'fontSize')).toMatchObject({
      min: 8,
      max: 32,
      step: 1
    })
  })

  test('enum translation remains field-scoped and preserves existing dropdown menu mappings', () => {
    expect(moduleOptionPanelKey('lowcodeModuleFieldUnrelated', 'multiple')).toBeUndefined()
    expect(moduleOptionPanelKey('lowcodeModuleFieldDataGridDensity', 'multiple')).toBeUndefined()
    expect(moduleOptionPanelKey(undefined, 'none')).toBeUndefined()
    expect(moduleOptionPanelKey('lowcodeModuleFieldDropdownMenuTriggerMode', 'hover')).toBe(
      'lowcodeModuleFieldDropdownMenuTriggerModeHover'
    )
  })
})
