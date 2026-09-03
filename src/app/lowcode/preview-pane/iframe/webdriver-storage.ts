import { IS_BROWSER } from '@open-pencil/core/constants'

import { PREVIEW_WEBDRIVER_AUTOMATION_STORAGE_KEY } from './messages'

type ReadableStorage = Pick<Storage, 'getItem'>
type MutableStorage = Pick<Storage, 'getItem' | 'removeItem'>

export function hasPreviewWebdriverAutomationFlag(storage: ReadableStorage | null): boolean {
  if (!storage) return false
  try {
    return storage.getItem(PREVIEW_WEBDRIVER_AUTOMATION_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function consumePreviewWebdriverAutomationFlag(storage: MutableStorage | null): boolean {
  if (!hasPreviewWebdriverAutomationFlag(storage)) return false
  try {
    storage?.removeItem(PREVIEW_WEBDRIVER_AUTOMATION_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

export function consumePreviewWebdriverAutomationRequest(): boolean {
  if (!IS_BROWSER) return false
  try {
    return consumePreviewWebdriverAutomationFlag(window.sessionStorage)
  } catch {
    // Accessing the storage object itself may throw in hardened/private WebViews.
    return false
  }
}
