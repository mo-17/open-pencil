import { describe, expect, test } from 'bun:test'

import { DROPDOWN_MENU_MODULE_TYPE, DROPDOWN_MENU_PLUGIN_ID } from '@open-pencil/core/plugins'

import {
  bundledPluginLocalizedSearchText,
  localizedAppPluginContributionText,
  localizedAppPluginModulePropertyText,
  localizedAppPluginText
} from '@/app/plugins/localization'
import { dropdownMenuOptionPanelKey } from '@/app/plugins/module-option-localization'

import dePanels from '#vue/i18n/locales/de/panels.json'
import esPanels from '#vue/i18n/locales/es/panels.json'
import frPanels from '#vue/i18n/locales/fr/panels.json'
import itPanels from '#vue/i18n/locales/it/panels.json'
import jaPanels from '#vue/i18n/locales/ja/panels.json'
import plPanels from '#vue/i18n/locales/pl/panels.json'
import ruPanels from '#vue/i18n/locales/ru/panels.json'
import zhCnPanels from '#vue/i18n/locales/zh-cn/panels.json'

const translatedPanels: readonly Readonly<Record<string, unknown>>[] = [
  dePanels,
  esPanels,
  frPanels,
  itPanels,
  jaPanels,
  plPanels,
  ruPanels,
  zhCnPanels
]

const optionCases = [
  ['lowcodeModuleFieldDropdownMenuTriggerMode', 'click'],
  ['lowcodeModuleFieldDropdownMenuTriggerMode', 'hover'],
  ['lowcodeModuleFieldDropdownMenuPlacement', 'bottomLeft'],
  ['lowcodeModuleFieldDropdownMenuPlacement', 'bottom'],
  ['lowcodeModuleFieldDropdownMenuPlacement', 'bottomRight'],
  ['lowcodeModuleFieldDropdownMenuPlacement', 'topLeft'],
  ['lowcodeModuleFieldDropdownMenuPlacement', 'top'],
  ['lowcodeModuleFieldDropdownMenuPlacement', 'topRight'],
  ['lowcodeModuleFieldDropdownMenuPlacement', 'leftTop'],
  ['lowcodeModuleFieldDropdownMenuPlacement', 'left'],
  ['lowcodeModuleFieldDropdownMenuPlacement', 'leftBottom'],
  ['lowcodeModuleFieldDropdownMenuPlacement', 'rightTop'],
  ['lowcodeModuleFieldDropdownMenuPlacement', 'right'],
  ['lowcodeModuleFieldDropdownMenuPlacement', 'rightBottom']
] as const

describe('Dropdown Menu app localization', () => {
  test('provides reviewed Simplified Chinese catalog and contribution copy', () => {
    expect(localizedAppPluginText(DROPDOWN_MENU_PLUGIN_ID, 'zh-CN')).toMatchObject({
      name: 'OpenPencil 下拉菜单'
    })
    expect(
      localizedAppPluginContributionText(
        DROPDOWN_MENU_PLUGIN_ID,
        DROPDOWN_MENU_MODULE_TYPE,
        'zh-CN'
      )
    ).toMatchObject({ name: '下拉菜单' })
    expect(bundledPluginLocalizedSearchText(DROPDOWN_MENU_PLUGIN_ID)).toContain('快捷键提示')
  })

  test('localizes field labels and each select identity without changing stored values', () => {
    expect(
      localizedAppPluginModulePropertyText(
        'lowcodeModuleFieldDropdownMenuShowTriggerChevron',
        'zh-CN'
      )
    ).toBe('显示触发箭头')
    expect(
      localizedAppPluginModulePropertyText(
        'lowcodeModuleFieldDropdownMenuTriggerMode:hover',
        'zh-CN'
      )
    ).toBe('悬停')
    expect(
      localizedAppPluginModulePropertyText(
        'lowcodeModuleFieldDropdownMenuPlacement:rightBottom',
        'zh-CN'
      )
    ).toBe('右侧底部对齐')
    expect(
      localizedAppPluginModulePropertyText(
        'lowcodeModuleFieldDropdownMenuPlacement:rightBottom',
        'de'
      )
    ).toBeUndefined()

    for (const [fieldKey, option] of optionCases) {
      const panelKey = dropdownMenuOptionPanelKey(fieldKey, option)
      expect(panelKey).toBeDefined()
      if (!panelKey) throw new Error(`Missing Dropdown Menu panel key for ${fieldKey}:${option}`)
      for (const panels of translatedPanels) {
        const label = panels[panelKey]
        expect(typeof label).toBe('string')
        expect(label).not.toBe(option)
      }
    }
    expect(dropdownMenuOptionPanelKey('lowcodeModuleFieldUnrelated', 'rightBottom')).toBeUndefined()
  })
})
