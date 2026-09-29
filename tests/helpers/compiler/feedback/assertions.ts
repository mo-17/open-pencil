import { expect, type Locator, type Page } from '@playwright/test'

/** Scope announcements to the dismissible notification, not persistent request status. */
export function successNotification(page: Page): Locator {
  return page.getByRole('status').filter({
    has: page.getByRole('button', { name: /^Dismiss(?: notification)?$/u })
  })
}

export async function dismissSuccess(page: Page, message: string | RegExp): Promise<void> {
  const toast = successNotification(page)
  await expect(toast).toHaveCount(1)
  await expect(toast).toContainText(message)
  await expect(toast).toBeInViewport()
  await toast.getByRole('button', { name: /^Dismiss(?: notification)?$/u }).tap()
  await expect(toast).toHaveCount(0)
}

/** Removing or disabling the action are both valid pending presentations. */
export async function expectUnavailable(action: Locator): Promise<void> {
  await expect
    .poll(async () => (await action.count()) === 0 || (await action.isDisabled()))
    .toBe(true)
}

export async function confirmDialog(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: /^(OK|Confirm|Delete note)$/u })
    .last()
    .tap()
}
