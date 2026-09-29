import { expect, test } from '@playwright/test'

import { withPopover } from '#tests/helpers/compiler/modules/popover/browser'

for (const target of ['react', 'vue'] as const) {
  test(`${target} Popover maps editable children and confirms locally with visible feedback`, async ({
    page
  }) => {
    await withPopover(page, target, async () => {
      const trigger = page.getByRole('button', { name: '编辑说明', exact: true })
      await expect(page.getByPlaceholder('填写备注')).toBeHidden()
      await trigger.click()
      const dialog = page.getByRole('dialog', { name: '详细信息' })
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText('这里是可编辑的子图层')
      await expect(dialog).not.toContainText('备用文字')
      await dialog.getByPlaceholder('填写备注').fill('保存前的备注')
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(trigger).toBeFocused()
      await trigger.press('Enter')
      await expect(dialog.getByPlaceholder('填写备注')).toHaveValue('保存前的备注')
      await page.keyboard.press('Escape')
      const confirmation = page.locator('[data-openpencil-popover]').filter({
        has: page.getByRole('button', { name: '确认设置', exact: true })
      })
      await confirmation.getByRole('button', { name: '确认设置', exact: true }).click()
      await confirmation.getByRole('button', { name: '确认', exact: true }).click()
      await expect(confirmation.getByRole('status')).toHaveText('已确认；未执行业务操作。')
      await expect(page.getByRole('button', { name: '确认设置', exact: true })).toBeFocused()
      await page.getByRole('button', { name: '确认设置', exact: true }).click()
      await page.getByRole('button', { name: '取消', exact: true }).click()
      await expect(confirmation.getByRole('status')).toHaveText('已取消。')
    })
  })

  test(`${target} Popover guards updates, focus, independent instances and safe text`, async ({
    page
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await withPopover(
      page,
      target,
      async () => {
        await page.setViewportSize({ width: 375, height: 720 })
        const current = page.getByRole('region', { name: 'Current popover' })
        const trigger = current.getByRole('button', { name: 'Show details', exact: true })
        await trigger.click()
        const bounds = await current.getByRole('dialog').boundingBox()
        if (!bounds) throw new Error('Popover panel is not laid out')
        expect(bounds.x).toBeGreaterThanOrEqual(7)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(368)
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(713)
        await expect(current.getByRole('dialog')).toContainText('<img src=x onerror=alert(1)>')
        await expect(current.locator('img')).toHaveCount(0)
        await current.getByRole('button', { name: 'Update inside' }).click()
        await expect(current.getByRole('dialog')).toBeHidden()
        await expect(trigger).toBeFocused()
        await trigger.click()
        await expect(current.getByRole('dialog', { name: 'Changed title' })).toBeVisible()
        await current.getByRole('button', { name: 'Confirm', exact: true }).click()
        await expect(current.getByRole('status')).toHaveText(
          'Confirmed; no business action was performed.'
        )
        await page.getByRole('button', { name: 'Language', exact: true }).click()
        await trigger.click()
        await expect(current.getByRole('button', { name: '关闭浮层' })).toBeVisible()
        await current.getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(current.getByRole('status')).toHaveText('已取消。')
        await page.getByRole('button', { name: 'Toggle disabled' }).click()
        await expect(trigger).toBeDisabled()
        await page.getByRole('button', { name: 'Toggle disabled' }).click()
        await trigger.click()
        await page.getByRole('button', { name: 'Outside', exact: true }).click()
        await expect(current.getByRole('dialog')).toBeHidden()
        await expect(page.getByRole('button', { name: 'Outside', exact: true })).toBeFocused()
        const editable = page.getByRole('region', { name: 'Editable popover' })
        await editable.getByRole('button', { name: 'Edit content' }).click()
        await editable.getByLabel('Local note').fill('同值配置重渲染仍可编辑')
        await expect(editable.getByRole('dialog')).toBeVisible()
        await expect(editable.getByLabel('Local note')).toBeFocused()
        await page.keyboard.press('Escape')
        await expect(editable.getByRole('button', { name: 'Edit content' })).toBeFocused()
        await trigger.click()
        await current.getByRole('button', { name: 'Unmount inside' }).click()
        await expect(current.getByRole('button')).toHaveCount(0)
        const other = page.getByRole('region', { name: 'Other popover' })
        await other.getByRole('button', { name: 'Other details' }).click()
        await expect(other.getByRole('dialog')).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(other.getByRole('dialog')).toBeHidden()
        expect(errors).toEqual([])
      },
      true
    )
  })

  test(`${target} Popover has a local fallback without Popover API and releases keyboard focus`, async ({
    page
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(HTMLElement.prototype, 'showPopover', {
        configurable: true,
        value: undefined
      })
    })
    await withPopover(
      page,
      target,
      async () => {
        const other = page.getByRole('region', { name: 'Other popover' })
        const trigger = other.getByRole('button', { name: 'Other details' })
        await trigger.focus()
        await trigger.press('Enter')
        const dialog = other.getByRole('dialog')
        await expect(dialog).toBeVisible()
        await expect(dialog).toBeFocused()
        await expect(dialog).toHaveCSS('position', 'absolute')
        await page.keyboard.press('Tab')
        await expect(other.getByRole('button', { name: 'Close popover' })).toBeFocused()
        await page.keyboard.press('Tab')
        await page.keyboard.press('Tab')
        await page.keyboard.press('Tab')
        await expect(dialog).toBeHidden()
        await trigger.click()
        await page.keyboard.press('Escape')
        await expect(trigger).toBeFocused()
      },
      true
    )
  })
}
