import { describe, expect, test } from 'bun:test'

import { resolveBrowserLocale } from '#vue/i18n/locale'
import jaTools from '#vue/i18n/locales/ja/tools.json'
import zhPanels from '#vue/i18n/locales/zh-cn/panels.json'

describe('browser locale matching', () => {
  test('matches a primary regional locale before secondary languages', () => {
    expect(resolveBrowserLocale(['en-US', 'it-IT', 'it', 'es-ES', 'es', 'en'])).toBe('en')
  })

  test('preserves browser language preference order', () => {
    expect(resolveBrowserLocale(['it-IT', 'en-US'])).toBe('it')
  })

  test('prefers exact supported regional locales', () => {
    expect(resolveBrowserLocale(['zh-CN', 'en-US'])).toBe('zh-CN')
    expect(resolveBrowserLocale(['ZH-cn', 'en-US'])).toBe('zh-CN')
  })

  test('does not substitute a different regional locale', () => {
    expect(resolveBrowserLocale(['zh-TW', 'fr-CA'])).toBe('fr')
  })

  test('falls back to English when no locale matches', () => {
    expect(resolveBrowserLocale(['ko-KR'])).toBe('en')
  })
})

describe('built-in module translations', () => {
  test('ships localized map tool and property-panel labels', () => {
    expect(jaTools.map).toBe('地図')
    expect(zhPanels.lowcodeModule).toBe('模块')
    expect(zhPanels.lowcodeModuleMapName).toBe('地图')
    expect(zhPanels.lowcodeModuleFieldLongitude).toBe('经度')
    expect(zhPanels.lowcodeModuleFieldMarkers).toBe('标记')
  })
})
