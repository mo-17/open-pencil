import { describe, expect, test } from 'bun:test'

import {
  ALERT_MODULE_DEFINITION,
  CHIP_MODULE_DEFINITION,
  PROGRESS_MODULE_DEFINITION
} from '@open-pencil/core/plugins'

import {
  feedbackControlHint,
  feedbackPropertyVisible
} from '@/app/lowcode/feedback-controls/properties'
import { localizedAppPluginModulePropertyText } from '@/app/plugins/localization'

import { expectDefined } from '#tests/helpers/assert'

describe('feedback module visual authoring', () => {
  test('mode changes preserve authored values while hiding irrelevant controls', () => {
    const progress = { value: 72.5, indeterminate: true, variant: 'linear' }
    expect(feedbackPropertyVisible('open-pencil.progress', 'value', progress)).toBe(false)
    expect(feedbackPropertyVisible('open-pencil.progress', 'pendingLabel', progress)).toBe(true)
    expect(feedbackPropertyVisible('open-pencil.progress', 'diameter', progress)).toBe(false)
    expect(
      feedbackPropertyVisible('open-pencil.progress', 'value', {
        ...progress,
        indeterminate: false
      })
    ).toBe(true)
    expect(progress.value).toBe(72.5)
    expect(
      feedbackPropertyVisible('open-pencil.chip', 'initialSelected', { selectable: false })
    ).toBe(false)
    expect(feedbackPropertyVisible('open-pencil.chip', 'deleteLabel', { deletable: true })).toBe(
      true
    )
    expect(feedbackPropertyVisible('open-pencil.alert', 'closeLabel', { closable: false })).toBe(
      false
    )
    expect(feedbackPropertyVisible('external.progress', 'value', progress)).toBe(true)
  })

  test('all feedback fields and enumerated options have Chinese inspector copy', () => {
    for (const definition of [
      ALERT_MODULE_DEFINITION,
      PROGRESS_MODULE_DEFINITION,
      CHIP_MODULE_DEFINITION
    ]) {
      for (const field of definition.fields) {
        expect(
          localizedAppPluginModulePropertyText(expectDefined(field.i18nLabelKey), 'zh-CN')
        ).toBeTruthy()
        for (const option of field.options ?? [])
          expect(
            localizedAppPluginModulePropertyText(`${field.i18nLabelKey}:${option}`, 'zh-CN')
          ).toBeTruthy()
      }
      expect(feedbackControlHint(definition.pluginId, 'zh-CN')).toMatch(/实例|真实任务/)
      expect(feedbackControlHint(definition.pluginId, 'en')).not.toMatch(/实例|真实任务/)
    }
  })
})
