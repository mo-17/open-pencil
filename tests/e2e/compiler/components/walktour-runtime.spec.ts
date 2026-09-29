import { expect, test, type Locator } from '@playwright/test'

import { withWalktour } from '#tests/helpers/compiler/components/walktour/browser'

async function panelInViewport(panel: Locator) {
  await expect
    .poll(() =>
      panel.evaluate((element) => {
        const box = element.getBoundingClientRect()
        return (
          box.left >= -1 &&
          box.top >= -1 &&
          box.right <= window.innerWidth + 1 &&
          box.bottom <= window.innerHeight + 1
        )
      })
    )
    .toBe(true)
}
test.use({ viewport: { width: 375, height: 900 } })
for (const target of ['react', 'vue'] as const) {
  test(`${target} Walktour compiled child targets retain geometry, conditional/list content and manual steps`, async ({
    page
  }) => {
    await withWalktour(page, target, false, async () => {
      const host = page.locator('[data-openpencil-walktour]'),
        trigger = host.getByRole('button', { name: 'Start guide', exact: true }),
        dialog = host.locator('[data-walktour-dialog]'),
        panel = dialog.locator('[data-walktour-panel]')
      await expect(dialog).not.toBeVisible()
      await expect(page.getByText('Unmapped stays visible', { exact: true })).toHaveCount(1)
      await expect(page.getByText('Row: Alpha', { exact: true })).toHaveCount(1)
      await expect(page.getByText('Row: Beta', { exact: true })).toHaveCount(1)
      const child = host.getByText('Profile card', { exact: true }),
        before = await child.boundingBox()
      await trigger.click()
      await expect(dialog).toBeVisible()
      await expect(panel).toHaveAttribute('data-walktour-target', 'overview')
      await expect(dialog.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled()
      await dialog.getByRole('button', { name: 'Next', exact: true }).click()
      await expect(dialog).toHaveAttribute('data-walktour-step', 'profile')
      await expect(panel).toHaveAttribute('data-walktour-target', 'available')
      await expect
        .poll(async () => {
          const highlight = await dialog.locator('[data-walktour-highlight]').boundingBox(),
            box = await child.boundingBox()
          return Boolean(
            highlight &&
            box &&
            Math.abs(highlight.x - box.x) < 1 &&
            Math.abs(highlight.y - box.y) < 1 &&
            Math.abs(highlight.width - box.width) < 1
          )
        })
        .toBe(true)
      expect(await child.boundingBox()).toEqual(before)
      await panelInViewport(panel)
      await dialog.getByRole('button', { name: 'Next', exact: true }).click()
      await expect(panel).toHaveAttribute('data-walktour-target', 'unavailable')
      await expect(dialog.locator('[data-walktour-reason]')).toContainText('hidden or unavailable')
      await expect(dialog).toHaveAttribute('data-walktour-step', 'hidden')
      await dialog.getByRole('button', { name: 'Next', exact: true }).click()
      await expect(panel).toHaveAttribute('data-walktour-target', 'available')
      await dialog.getByRole('button', { name: 'Restart', exact: true }).click()
      await expect(dialog).toHaveAttribute('data-walktour-step', 'intro')
      await page.keyboard.press('Escape')
      await expect(dialog).not.toBeVisible()
      await expect(trigger).toBeFocused()
    })
  })
  test(`${target} Walktour isolates instances, traps focus, clamps overlays and never submits or bubbles business clicks`, async ({
    page
  }) => {
    await withWalktour(page, target, true, async () => {
      const hosts = page.locator('[data-openpencil-walktour]'),
        main = hosts.first(),
        other = hosts.nth(1),
        trigger = main.locator('[data-walktour-trigger]'),
        dialog = main.locator('[data-walktour-dialog]'),
        panel = dialog.locator('[data-walktour-panel]')
      await trigger.click()
      await expect(dialog).toBeVisible()
      await expect(other.locator('[data-walktour-dialog]')).not.toBeVisible()
      await expect(dialog.locator('[data-walktour-content]')).toContainText(
        '<script> remains text.'
      )
      await expect(dialog.locator('script')).toHaveCount(0)
      await expect
        .poll(() =>
          dialog.locator('[data-walktour-highlight]').evaluate((element) => {
            const box = element.getBoundingClientRect()
            return Math.round(box.width) + ':' + Math.round(box.height)
          })
        )
        .toBe('240:100')
      await panelInViewport(panel)
      const close = dialog.getByRole('button', { name: 'Close guide', exact: true }),
        next = dialog.getByRole('button', { name: 'Next', exact: true })
      await close.focus()
      await page.keyboard.press('Shift+Tab')
      await expect(next).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(close).toBeFocused()
      await next.click()
      await expect(panel).toHaveAttribute('data-walktour-target', 'unavailable')
      await next.click()
      await expect(panel).toHaveAttribute('data-walktour-target', 'overview')
      await dialog.getByRole('button', { name: 'Finish', exact: true }).click()
      await expect(dialog).not.toBeVisible()
      await expect(trigger).toBeFocused()
      await expect(main.locator('[data-walktour-status]')).toContainText('completed')
      await trigger.click()
      await expect(dialog).toHaveAttribute('data-walktour-step', 'alpha')
      await page.setViewportSize({ width: 180, height: 230 })
      await panelInViewport(panel)
      await page.keyboard.press('Escape')
      await page.setViewportSize({ width: 375, height: 900 })
      await page.getByRole('button', { name: 'Hide targets', exact: true }).click()
      await trigger.click()
      await expect(panel).toHaveAttribute('data-walktour-target', 'unavailable')
      await dialog.getByRole('button', { name: 'Skip guide', exact: true }).click()
      await expect(main.locator('[data-walktour-status]')).toContainText('skipped')
      await other.locator('[data-walktour-trigger]').click()
      await expect(other.locator('[data-walktour-dialog]')).toBeVisible()
      await expect(dialog).not.toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.locator('output')).toHaveText('Clicks[0] Submits[0]')
    })
  })
  test(`${target} Walktour closes stale config, cleans up unmount and fails safely when dialog opening is unavailable`, async ({
    page
  }) => {
    await withWalktour(page, target, true, async () => {
      const main = page.locator('[data-openpencil-walktour]').first(),
        trigger = main.locator('[data-walktour-trigger]'),
        dialog = main.locator('[data-walktour-dialog]')
      await trigger.click()
      const stale = await dialog.getByRole('button', { name: 'Next', exact: true }).elementHandle()
      await page
        .getByRole('button', { name: 'Reconfigure', exact: true })
        .evaluate((element: HTMLButtonElement) => element.click())
      await expect(dialog).not.toBeVisible()
      await expect(trigger).toBeFocused()
      await stale?.evaluate((element) =>
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      )
      await expect(dialog).not.toBeVisible()
      await trigger.click()
      await expect(dialog).toHaveAttribute('data-walktour-step', 'alpha')
      await page
        .getByRole('button', { name: 'Mount', exact: true })
        .evaluate((element: HTMLButtonElement) => element.click())
      await expect(page.locator('[data-walktour-dialog][open]')).toHaveCount(0)
      await stale?.evaluate((element) =>
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      )
      await page.getByRole('button', { name: 'Mount', exact: true }).click()
      await page.getByRole('button', { name: 'Language', exact: true }).click()
      await trigger.click()
      await expect(dialog.getByRole('button', { name: '关闭引导', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Language', exact: true }).click()
      const original = await page.evaluateHandle(() => HTMLDialogElement.prototype.showModal)
      try {
        await page.evaluate(() =>
          Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
            configurable: true,
            writable: true,
            value: undefined
          })
        )
        await trigger.click()
        await expect(dialog).not.toBeVisible()
        await expect(trigger).toHaveAttribute('aria-expanded', 'false')
        await expect(main.locator('[data-walktour-status]')).toContainText('cannot display')
        await page.evaluate(() => {
          HTMLDialogElement.prototype.showModal = function () {
            throw new Error('Test dialog failure')
          }
        })
        await trigger.click()
        await expect(dialog).not.toBeVisible()
        await expect(page.locator('[data-walktour-dialog][open]')).toHaveCount(0)
      } finally {
        await page.evaluate((fn) => {
          HTMLDialogElement.prototype.showModal = fn
        }, original)
        await original.dispose()
      }
      await trigger.click()
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Disable', exact: true }).click()
      await expect(trigger).toBeDisabled()
      await expect(page.locator('output')).toHaveText('Clicks[0] Submits[0]')
    })
  })
}
