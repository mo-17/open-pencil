import { expect, type Page, type JSHandle } from '@playwright/test'

import { injectMockChatTransport } from '#tests/helpers/chat/transport'

import type * as BrowserFixture from './browser'

type ChatOwnerFixture = ReturnType<typeof BrowserFixture.createChatOwnerFixture>

/** Load a normally compiled browser fixture and wait for the public history boundary. */
export async function observeChatOwner(page: Page) {
  const owner = await page.evaluateHandle(async () => {
    const path = '/tests/helpers/chat/owner-lifecycle/browser.ts'
    const fixture: typeof BrowserFixture = await import(path)
    return fixture.createChatOwnerFixture()
  })
  try {
    await expect.poll(() => owner.evaluate((state) => state.snapshot().historyId)).not.toBeNull()
    await expect.poll(() => owner.evaluate((state) => state.snapshot().historyBusy)).toBe(false)
    return owner
  } catch (error) {
    await releaseChatOwner(page, owner)
    throw error
  }
}

/** Restore SDK methods, canvas Blob delivery, preparation handles, tabs and the test transport. */
export async function releaseChatOwner(page: Page, owner: JSHandle<ChatOwnerFixture>) {
  try {
    if (!page.isClosed()) await owner.evaluate((state) => state.dispose())
  } finally {
    try {
      if (!page.isClosed()) await injectMockChatTransport(page)
    } finally {
      await owner.dispose()
    }
  }
}
