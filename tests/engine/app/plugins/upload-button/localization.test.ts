import { describe, expect, test } from 'bun:test'

import { UPLOAD_BUTTON_MODULE_TYPE, UPLOAD_BUTTON_PLUGIN_ID } from '@open-pencil/core/plugins'

import {
  bundledPluginLocalizedSearchText,
  localizedAppPluginContributionText,
  localizedAppPluginModulePropertyText,
  localizedAppPluginText
} from '@/app/plugins/localization'

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

const panelKeys = [
  'lowcodeModuleUploadButtonName',
  'lowcodeModuleUploadButtonDescription',
  'lowcodeModuleFieldUploadButtonAccept',
  'lowcodeModuleFieldUploadButtonMultiple',
  'lowcodeModuleFieldUploadButtonMaxFiles',
  'lowcodeUploadAcceptAdd',
  'lowcodeUploadAcceptInvalidToken',
  'lowcodeUploadAcceptEmptyToken',
  'lowcodeUploadAcceptDuplicateToken',
  'lowcodeUploadAcceptValidationHint',
  'lowcodeUploadLocalOnlyNotice',
  'lowcodeUploadSingleFileMaxHint'
] as const

describe('Upload Button app localization', () => {
  test('provides reviewed Simplified Chinese catalog and contribution copy', () => {
    expect(localizedAppPluginText(UPLOAD_BUTTON_PLUGIN_ID, 'zh-CN')).toMatchObject({
      name: 'OpenPencil 上传按钮'
    })
    expect(
      localizedAppPluginContributionText(
        UPLOAD_BUTTON_PLUGIN_ID,
        UPLOAD_BUTTON_MODULE_TYPE,
        'zh-CN'
      )
    ).toMatchObject({ name: '上传按钮' })
    expect(bundledPluginLocalizedSearchText(UPLOAD_BUTTON_PLUGIN_ID)).toContain('本地文件选择器')
    expect(
      localizedAppPluginModulePropertyText('lowcodeModuleFieldUploadButtonMaxFileBytes', 'zh-CN')
    ).toBe('单文件最大字节数')
  })

  test('translates safety and editor copy in all eight locale bundles', () => {
    for (const panels of translatedPanels) {
      for (const key of panelKeys) {
        expect(typeof panels[key]).toBe('string')
        expect((panels[key] as string).trim().length).toBeGreaterThan(0)
      }
    }
  })
})
