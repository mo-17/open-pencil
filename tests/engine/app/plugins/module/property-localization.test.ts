import { describe, expect, test } from 'bun:test'

import {
  ACCORDION_MODULE_DEFINITION,
  AUDIO_PLAYER_MODULE_DEFINITION,
  CODE_BLOCK_MODULE_DEFINITION,
  MARKDOWN_MODULE_DEFINITION,
  PDF_VIEWER_MODULE_DEFINITION,
  QR_BARCODE_MODULE_DEFINITION,
  TABS_MODULE_DEFINITION,
  type ModuleDefinition
} from '@open-pencil/core/plugins'

import { localizedAppPluginModulePropertyText } from '@/app/plugins/localization'

const PHASE_6_MODULE_DEFINITIONS: readonly ModuleDefinition[] = [
  TABS_MODULE_DEFINITION,
  ACCORDION_MODULE_DEFINITION,
  QR_BARCODE_MODULE_DEFINITION,
  MARKDOWN_MODULE_DEFINITION,
  CODE_BLOCK_MODULE_DEFINITION,
  PDF_VIEWER_MODULE_DEFINITION,
  AUDIO_PLAYER_MODULE_DEFINITION
]

function declaredPropertyKeys(): readonly string[] {
  return PHASE_6_MODULE_DEFINITIONS.flatMap((definition) =>
    definition.fields.flatMap((field) => [
      ...(field.i18nLabelKey ? [field.i18nLabelKey] : []),
      ...(field.kind === 'select' && field.i18nLabelKey
        ? field.options.map((option) => `${field.i18nLabelKey}:${option}`)
        : [])
    ])
  )
}

describe('bundled module property localization', () => {
  test('covers every Phase 6 field and select option with reviewed Simplified Chinese copy', () => {
    const keys = declaredPropertyKeys()
    expect(keys).toHaveLength(100)
    expect(new Set(keys).size).toBe(100)

    for (const key of keys) {
      const text = localizedAppPluginModulePropertyText(key, 'zh-CN')
      expect(text, key).toBeDefined()
      expect(text, key).toMatch(/[\u3400-\u9fff]/u)
      expect(text, key).not.toBe(key)
    }
  })

  test('leaves unknown keys and other locales to the caller fallback', () => {
    expect(localizedAppPluginModulePropertyText('unknown-property-key', 'zh-CN')).toBeUndefined()
    expect(
      localizedAppPluginModulePropertyText('lowcodeModuleFieldTabsOrientation', 'en')
    ).toBeUndefined()
    expect(
      localizedAppPluginModulePropertyText('lowcodeModuleFieldTabsOrientation:horizontal', 'en')
    ).toBeUndefined()
  })

  test('does not reuse a select option translation outside its field context', () => {
    expect(localizedAppPluginModulePropertyText('none', 'zh-CN')).toBeUndefined()
    expect(
      localizedAppPluginModulePropertyText('lowcodeModuleFieldDataGridSelection:none', 'zh-CN')
    ).toBeUndefined()
    expect(
      localizedAppPluginModulePropertyText('lowcodeModuleFieldAudioPlayerPreload:none', 'zh-CN')
    ).toBe('不预加载')
  })
})
