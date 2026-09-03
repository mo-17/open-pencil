import { describe, expect, test } from 'bun:test'

import { PREVIEW_WEBDRIVER_AUTOMATION_STORAGE_KEY } from '@/app/lowcode/preview-pane/iframe/messages'
import {
  consumePreviewWebdriverAutomationFlag,
  hasPreviewWebdriverAutomationFlag
} from '@/app/lowcode/preview-pane/iframe/webdriver-storage'

describe('preview WebDriver automation storage flag', () => {
  test('requires the exact opt-in value', () => {
    expect(
      hasPreviewWebdriverAutomationFlag({
        getItem: (key) => (key === PREVIEW_WEBDRIVER_AUTOMATION_STORAGE_KEY ? '1' : null)
      })
    ).toBe(true)
    expect(hasPreviewWebdriverAutomationFlag({ getItem: () => 'true' })).toBe(false)
    expect(hasPreviewWebdriverAutomationFlag({ getItem: () => null })).toBe(false)
    expect(hasPreviewWebdriverAutomationFlag(null)).toBe(false)
  })

  test('fails closed when storage access throws', () => {
    expect(
      hasPreviewWebdriverAutomationFlag({
        getItem: () => {
          throw new DOMException('blocked', 'SecurityError')
        }
      })
    ).toBe(false)
  })

  test('consumes the opt-in after one frame boot', () => {
    let value: string | null = '1'
    const storage = {
      getItem: () => value,
      removeItem: () => {
        value = null
      }
    }

    expect(consumePreviewWebdriverAutomationFlag(storage)).toBe(true)
    expect(value).toBeNull()
    expect(consumePreviewWebdriverAutomationFlag(storage)).toBe(false)
  })

  test('fails closed if the opt-in cannot be removed', () => {
    expect(
      consumePreviewWebdriverAutomationFlag({
        getItem: () => '1',
        removeItem: () => {
          throw new DOMException('blocked', 'SecurityError')
        }
      })
    ).toBe(false)
  })
})
