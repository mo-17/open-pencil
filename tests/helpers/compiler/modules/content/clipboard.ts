import type { Page } from '@playwright/test'

type ClipboardMode = 'success' | 'failure' | 'pending'
interface ClipboardHarness {
  mode: ClipboardMode
  calls: string[]
  pending: { resolve: () => void; reject: (error: Error) => void }[]
}
type ClipboardWindow = Window & { __contentClipboard?: ClipboardHarness }

/** This page-local API double never requests permissions or writes the system clipboard. */
export async function installContentClipboard(page: Page) {
  await page.addInitScript(() => {
    const harness: ClipboardHarness = { mode: 'success', calls: [], pending: [] }
    ;(window as ClipboardWindow).__contentClipboard = harness
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(text: string): Promise<void> {
          harness.calls.push(text)
          if (harness.mode === 'failure')
            return Promise.reject(new Error('Private clipboard error detail'))
          if (harness.mode === 'pending')
            return new Promise<void>((resolve, reject) => {
              harness.pending.push({ resolve, reject })
            })
          return Promise.resolve()
        }
      }
    })
  })
}

export async function clipboardMode(page: Page, mode: ClipboardMode) {
  await page.evaluate((mode) => {
    const harness = (window as ClipboardWindow).__contentClipboard
    if (!harness) throw new Error('Clipboard test double unavailable')
    harness.mode = mode
  }, mode)
}

export async function clipboardSnapshot(page: Page) {
  return page.evaluate(() => {
    const harness = (window as ClipboardWindow).__contentClipboard
    if (!harness) throw new Error('Clipboard test double unavailable')
    return { calls: harness.calls, pending: harness.pending.length }
  })
}

export async function finishContentClipboard(page: Page, success = true) {
  await page.evaluate((success) => {
    const harness = (window as ClipboardWindow).__contentClipboard
    if (!harness) throw new Error('Clipboard test double unavailable')
    for (const pending of harness.pending.splice(0)) {
      if (success) pending.resolve()
      else pending.reject(new Error('Private clipboard error detail'))
    }
  }, success)
}
