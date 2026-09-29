import { expect, type Page } from '@playwright/test'

import type { TemplateId } from './fixture'

export async function exerciseWalktourTemplate(page: Page, id: TemplateId): Promise<boolean> {
  if (id !== 'walktour') return false
  const root = page.locator('[data-openpencil-walktour]')
  const trigger = root.locator('[data-walktour-trigger]')
  const dialog = root.locator('[data-walktour-dialog]')
  const action = (name: string) => dialog.locator(`[data-walktour-action="${name}"]`)
  await expect(dialog).not.toBeVisible()
  await trigger.click()
  await expect(dialog).toHaveAttribute('data-walktour-step', 'step1')
  await expect(dialog.locator('[data-walktour-panel]')).toHaveAttribute(
    'data-walktour-target',
    'available'
  )
  await action('next').click()
  await expect(dialog).toHaveAttribute('data-walktour-step', 'step2')
  await action('previous').click()
  await expect(dialog).toHaveAttribute('data-walktour-step', 'step1')
  await action('next').click()
  await action('next').click()
  await action('next').click()
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await action('skip').click()
  await expect(dialog).not.toBeVisible()
  await trigger.click()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await trigger.click()
  await expect(dialog).toHaveAttribute('data-walktour-step', 'step1')
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await expectWalktourViewport(page, width)
  }
  return true
}

/** Wait for the open guide's resize projection, while closed/default views need no polling. */
export async function expectWalktourViewport(page: Page, width: number): Promise<void> {
  const panel = page.locator(
    '[data-openpencil-walktour] [data-walktour-dialog][open] [data-walktour-panel]'
  )
  if ((await panel.count()) === 0) return
  await expect
    .poll(
      async () => {
        const box = await panel.boundingBox(),
          viewport = page.viewportSize()
        return Boolean(
          box &&
          viewport &&
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= width + 1 &&
          box.y + box.height <= viewport.height + 1
        )
      },
      { message: 'Walktour panel must converge inside the current viewport' }
    )
    .toBe(true)
}
