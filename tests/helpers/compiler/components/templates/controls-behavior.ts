import { expect, type Page } from '@playwright/test'

/** Exercise the added module recipes; the existing helper owns the other template families. */
export async function exerciseControlTemplate(page: Page, id: string): Promise<boolean> {
  switch (id) {
    case 'slider': {
      const input = page.getByRole('slider', { name: '音量', exact: true })
      await expect(input).toHaveValue('40')
      await input.focus()
      await input.press('ArrowRight')
      await expect(input).toHaveValue('45')
      await expect(page.locator('[data-openpencil-slider] output')).toHaveText('45')
      await expect(page.getByText('当前值: 45', { exact: true })).toBeVisible()
      return true
    }
    case 'range-slider': {
      const start = page.getByRole('slider', { name: '偏好范围 (1)', exact: true })
      const end = page.getByRole('slider', { name: '偏好范围 (2)', exact: true })
      await expect(start).toHaveValue('25')
      await expect(end).toHaveValue('75')
      await start.focus()
      await start.press('ArrowRight')
      await expect(start).toHaveValue('30')
      await expect(end).toHaveValue('75')
      await end.focus()
      await end.press('ArrowLeft')
      await expect(end).toHaveValue('70')
      await expect(page.locator('[data-openpencil-slider] output')).toHaveText('30 – 70')
      await expect(page.getByText('当前值: 30', { exact: true })).toBeVisible()
      await expect(page.getByText('结束值: 70', { exact: true })).toBeVisible()
      return true
    }
    case 'rating': {
      const input = page.getByRole('slider', { name: '使用体验', exact: true })
      await expect(input).toHaveAttribute('aria-valuenow', '3.5')
      await input.focus()
      await input.press('ArrowRight')
      await expect(input).toHaveAttribute('aria-valuenow', '4')
      await page.getByRole('button', { name: '清空评分', exact: true }).click()
      await expect(input).toHaveAttribute('aria-valuenow', '0')
      await input.focus()
      await input.press('End')
      await input.press('ArrowLeft')
      await expect(page.locator('[data-openpencil-rating] output')).toHaveText('4.5 / 5')
      await expect(page.getByText('当前值: 4.5', { exact: true })).toBeVisible()
      return true
    }
    case 'stepper': {
      const steps = page.locator('[data-openpencil-stepper]')
      await expect(steps.locator('[aria-current="step"]')).toContainText('检查')
      await steps.getByRole('button', { name: '完成', exact: true }).focus()
      await page.keyboard.press('Enter')
      await expect(steps.locator('[aria-current="step"]')).toContainText('完成')
      await expect(steps.locator('li').nth(1)).toHaveAttribute('data-state', 'completed')
      await expect(page.getByText('当前步骤索引: 2', { exact: true })).toBeVisible()
      const next = page.getByRole('button', { name: '下一步', exact: true })
      const previous = page.getByRole('button', { name: '上一步', exact: true })
      await expect(next).toBeDisabled()
      await next.evaluate((button) => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await expect(page.getByText('当前步骤索引: 2', { exact: true })).toBeVisible()
      await previous.click()
      await expect(steps.locator('[aria-current="step"]')).toContainText('检查')
      await previous.click()
      await expect(page.getByText('当前步骤索引: 0', { exact: true })).toBeVisible()
      await expect(previous).toBeDisabled()
      await previous.evaluate((button) => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await expect(page.getByText('当前步骤索引: 0', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: '重置步骤', exact: true }).click()
      await expect(page.getByText('当前步骤索引: 1', { exact: true })).toBeVisible()
      expect(
        await steps.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
      ).toBe(true)
      const frame = await steps.boundingBox()
      const finalDescription = steps.locator('[data-step-description]').last()
      await expect(finalDescription).toHaveText('完成设置')
      const description = await finalDescription.boundingBox()
      if (!frame || !description) throw new Error('Final step description is unavailable')
      expect(description.x + description.width).toBeLessThanOrEqual(frame.x + frame.width)
      expect(
        await finalDescription.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
      ).toBe(true)
      return true
    }
    case 'breadcrumb': {
      const navigation = page.getByRole('navigation', { name: '页面层级', exact: true })
      const home = navigation.getByRole('link', { name: '首页', exact: true })
      await expect(home).toHaveAttribute('href', '#top')
      await home.focus()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/#top$/)
      await expect(navigation.locator('[aria-current="page"]')).toHaveText('当前页面')
      await expect(navigation.getByRole('link')).toHaveCount(1)
      return true
    }
    default:
      return false
  }
}
