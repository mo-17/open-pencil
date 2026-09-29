import { expect, test } from '@playwright/test'

import { withAlert } from '#tests/helpers/compiler/modules/alert/browser'

test.use({ viewport: { width: 800, height: 800 } })

for (const target of ['react', 'vue'] as const) {
  test(`${target} Alert presents semantic appearances, safe text and optional dismiss actions`, async ({
    page
  }, info) => {
    await withAlert(page, target, async () => {
      const hosts = page.locator('[data-openpencil-alert]')
      await expect(hosts).toHaveCount(4)
      await expect(hosts.nth(0).getByRole('status')).toHaveText('保存成功修改已在本机保存。')
      await expect(hosts.nth(1).getByRole('alert')).toHaveAttribute('aria-live', 'assertive')
      await expect(hosts.nth(1)).toHaveCSS('background-color', 'rgb(146, 64, 14)')
      await expect(hosts.nth(1)).toHaveCSS('color', 'rgb(255, 255, 255)')
      await expect(hosts.nth(2).getByRole('button')).toHaveCount(0)
      await expect(hosts.nth(2)).toHaveCSS('background-color', 'rgb(255, 255, 255)')
      await expect(hosts.nth(3).getByRole('group')).toHaveAttribute('aria-live', 'off')
      await expect(hosts.nth(3)).toContainText('<b>纯文本</b>')
      await expect(hosts.nth(3)).toContainText('<img src=x onerror="alert(1)">')
      await expect(hosts.nth(3).locator('b,img')).toHaveCount(0)
      await expect(hosts.nth(3).locator('[data-alert-icon]')).toHaveCount(0)
      for (const host of await hosts.all())
        expect(await host.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
      await page.screenshot({ path: info.outputPath(`${target}-alert.png`) })
    })
  })

  test(`${target} Alert dismissal stays local, restores nearby focus and survives equal rerenders`, async ({
    page
  }) => {
    await withAlert(
      page,
      target,
      async () => {
        const local = page.getByRole('region', { name: 'Local alert region' })
        const other = page.getByRole('region', { name: 'Other instance' })
        const close = local.getByRole('button', { name: '关闭提示' })
        await close.focus()
        await page.keyboard.press('Enter')
        await expect(local.getByRole('status')).toHaveCount(0)
        await expect(local.getByRole('link', { name: 'Next action' })).toBeFocused()
        await expect(other.getByRole('status')).toBeVisible()
        await page.getByRole('button', { name: 'Rerender 0', exact: true }).click()
        await expect(local.getByRole('status')).toHaveCount(0)
        await page.getByRole('button', { name: 'Change message', exact: true }).click()
        await expect(local.getByRole('status')).toContainText('更新提示')
        await expect(
          page.getByRole('button', { name: 'Change message', exact: true })
        ).toBeFocused()
        await close.click()
        await page.getByRole('button', { name: 'Change message', exact: true }).click()
        await expect(local.getByRole('status')).toContainText('保存成功')
        await close.click()
        await page.getByRole('button', { name: 'Toggle mount', exact: true }).click()
        await page.getByRole('button', { name: 'Toggle mount', exact: true }).click()
        await expect(local.getByRole('status')).toBeVisible()
        await other.getByRole('button', { name: '关闭提示' }).focus()
        await page.keyboard.press('Enter')
        await expect(other).toBeFocused()
        await expect(other).toHaveAttribute('tabindex', '-1')
        await page.keyboard.press('Tab')
        await expect(
          page
            .getByRole('region', { name: 'Narrow message' })
            .getByRole('button', { name: '关闭提示' })
        ).toBeFocused()
        await expect(other).not.toHaveAttribute('tabindex')
        await expect(local.getByRole('status')).toBeVisible()
      },
      true
    )
  })

  test(`${target} Alert wraps long narrow text without horizontal overflow or stealing external focus`, async ({
    page
  }) => {
    await withAlert(
      page,
      target,
      async () => {
        const narrow = page
          .getByRole('region', { name: 'Narrow message' })
          .locator('[data-openpencil-alert]')
        expect(await narrow.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
        expect(await narrow.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)
        const copy = narrow.locator('[data-alert-copy]')
        const box = await copy.boundingBox()
        expect(box?.width).toBeCloseTo(16, 0)
        const local = page.getByRole('region', { name: 'Local alert region' })
        await local.getByRole('button', { name: 'Previous', exact: true }).focus()
        await local.getByRole('button', { name: '关闭提示' }).dispatchEvent('click')
        await expect(local.getByRole('button', { name: 'Previous', exact: true })).toBeFocused()
        await expect(local.getByRole('status')).toHaveCount(0)
        const other = page.getByRole('region', { name: 'Other instance' })
        await other.evaluate((node) => node.setAttribute('tabindex', '0'))
        await other.getByRole('button', { name: '关闭提示' }).focus()
        await page.keyboard.press('Enter')
        await expect(other).toBeFocused()
        await page.getByRole('button', { name: 'Rerender 0', exact: true }).focus()
        await expect(other).toHaveAttribute('tabindex', '0')
        const narrowRegion = page.getByRole('region', { name: 'Narrow message' })
        await narrowRegion.getByRole('button', { name: '关闭提示' }).focus()
        await page.keyboard.press('Enter')
        await expect(narrowRegion).toHaveAttribute('tabindex', '-1')
        await narrowRegion.evaluate((node) => node.setAttribute('tabindex', '2'))
        await page.getByRole('button', { name: 'Rerender 0', exact: true }).focus()
        await expect(narrowRegion).toHaveAttribute('tabindex', '2')
      },
      true
    )
  })
}
