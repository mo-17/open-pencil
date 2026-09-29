import { expect, test } from '@playwright/test'

import { withTooltip } from '#tests/helpers/compiler/modules/tooltip/browser'
test.use({ viewport: { width: 520, height: 480 }, hasTouch: true })
for (const target of ['react', 'vue'] as const) {
  test(`${target} Tooltip opens on hover and focus, keeps plain text hoverable and flips at the viewport edge`, async ({
    page
  }, info) => {
    await withTooltip(page, target, async () => {
      const triggers = page.locator('[data-tooltip-trigger]')
      await expect(triggers).toHaveCount(4)
      await expect(page.getByRole('tooltip')).toHaveCount(0)
      await triggers.nth(0).hover()
      const bubble = page.getByRole('tooltip')
      await expect(bubble).toHaveText('<b>此处是纯文本说明</b>')
      await expect(bubble.locator('b')).toHaveCount(0)
      await expect(bubble).toHaveAttribute('data-tooltip-side', 'bottom')
      const id = await bubble.getAttribute('id')
      if (!id) throw new Error('Missing tooltip identity')
      await expect(triggers.nth(0)).toHaveAttribute('aria-describedby', id)
      await bubble.hover()
      await expect(bubble).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(bubble).toHaveCount(0)
      await expect(triggers.nth(0)).not.toHaveAttribute('aria-describedby', /.+/)
      await page.mouse.move(510, 470)
      await triggers.nth(1).focus()
      await expect(page.getByRole('tooltip')).toBeVisible()
      const box = await page.getByRole('tooltip').boundingBox()
      if (!box) throw new Error('Missing tooltip bounds')
      expect(box.x).toBeGreaterThanOrEqual(7)
      expect(box.x + box.width).toBeLessThanOrEqual(513)
      await page.screenshot({ path: info.outputPath(`${target}-tooltip.png`) })
      await page.keyboard.press('Tab')
      await expect(triggers.nth(2)).toBeFocused()
      await expect(triggers.nth(2)).toHaveAttribute('aria-describedby', /.+/)
    })
  })
  test(`${target} Tooltip keeps delayed work instance-local and cleans up across update, outside dismissal and unmount`, async ({
    page
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await withTooltip(
      page,
      target,
      async () => {
        const current = page.getByRole('region', { name: 'Current tooltip' }),
          trigger = current.getByRole('button', { name: 'Help', exact: true })
        const business = page.getByRole('textbox', { name: 'Business input' })
        await business.fill('Initial business value')
        await trigger.hover()
        await expect(page.getByRole('tooltip')).toHaveText('First help')
        await business.fill('Unrelated business rerender')
        await expect(page.getByRole('tooltip')).toHaveText('First help')
        const content = page.getByRole('textbox', { name: 'Help content' })
        await content.focus()
        await trigger.hover()
        await expect(page.getByRole('tooltip')).toHaveText('First help')
        await content.fill('Changed while hovered')
        await expect(page.getByRole('tooltip')).toHaveCount(0)
        await content.fill('First help')
        await page.mouse.move(510, 470)
        await trigger.hover()
        await expect(page.getByRole('tooltip')).toHaveText('First help')
        await page.getByRole('button', { name: 'Outside', exact: true }).click()
        await expect(page.getByRole('tooltip')).toHaveCount(0)
        await trigger.focus()
        await expect(page.getByRole('tooltip')).toHaveText('First help')
        await page.getByRole('button', { name: 'Update', exact: true }).click()
        await expect(page.getByRole('tooltip')).toHaveCount(0)
        await trigger.focus()
        await expect(page.getByRole('tooltip')).toHaveText('Updated help')
        await expect(page.getByRole('tooltip')).toHaveAttribute('data-tooltip-side', 'bottom')
        await page.getByRole('button', { name: 'Toggle component' }).click()
        await expect(page.getByRole('tooltip')).toHaveCount(0)
        await page.getByRole('button', { name: 'Other help', exact: true }).focus()
        await expect(page.getByRole('tooltip')).toHaveText('First help')
        await page.keyboard.press('Escape')
        await expect(page.getByRole('tooltip')).toHaveCount(0)
        await page.getByRole('button', { name: 'Toggle component' }).click()
        await trigger.hover()
        await page.mouse.move(500, 450)
        await page.getByRole('button', { name: 'Toggle component' }).click()
        await page.waitForTimeout(250)
        await expect(current.getByRole('button')).toHaveCount(0)
        await expect(page.getByRole('tooltip')).toHaveCount(0)
        expect(errors).toEqual([])
      },
      true
    )
  })
  test(`${target} Tooltip supports touch toggle and keeps long help inside a short viewport`, async ({
    page
  }) => {
    await withTooltip(
      page,
      target,
      async () => {
        const trigger = page.getByRole('button', { name: 'Help', exact: true })
        await trigger.tap()
        await expect(page.getByRole('tooltip')).toHaveText('First help')
        await trigger.tap()
        await expect(page.getByRole('tooltip')).toHaveCount(0)
        await page.getByRole('button', { name: 'Outside', exact: true }).tap()
        await trigger.focus()
        await expect(page.getByRole('tooltip')).toHaveText('First help')
        await page.keyboard.press('Escape')
        await page.getByRole('textbox', { name: 'Help content' }).fill('Long help '.repeat(70))
        await page.setViewportSize({ width: 220, height: 120 })
        await trigger.tap()
        const bubble = page.getByRole('tooltip')
        await expect(bubble).toBeVisible()
        const box = await bubble.boundingBox()
        if (!box) throw new Error('Missing short viewport tooltip')
        expect(box.x).toBeGreaterThanOrEqual(7)
        expect(box.y).toBeGreaterThanOrEqual(7)
        expect(box.x + box.width).toBeLessThanOrEqual(213)
        expect(box.y + box.height).toBeLessThanOrEqual(113)
        await expect(bubble.locator('[data-tooltip-text]')).toHaveCSS('overflow-y', 'auto')
      },
      true
    )
  })
  test(`${target} Tooltip releases keyboard activation on blur and cancels help delayed past Escape`, async ({
    page
  }) => {
    await withTooltip(
      page,
      target,
      async () => {
        const current = page.getByRole('region', { name: 'Current tooltip' })
        const trigger = current.getByRole('button', { name: 'Help', exact: true })
        await trigger.focus()
        await expect(current.getByRole('tooltip')).toHaveText('First help')
        await page.keyboard.press('Enter')
        await page.keyboard.press('Tab')
        await expect(page.getByRole('button', { name: 'Other help', exact: true })).toBeFocused()
        await expect(current.getByRole('tooltip')).toHaveCount(0)
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: 'Slow hover', exact: true }).click()
        await trigger.hover()
        await expect(current.getByRole('tooltip')).toHaveCount(0)
        await page.keyboard.press('Escape')
        await page.waitForTimeout(1100)
        await expect(current.getByRole('tooltip')).toHaveCount(0)
        await page.mouse.move(510, 470)
        await trigger.hover()
        await expect(current.getByRole('tooltip')).toHaveText('First help')
      },
      true
    )
  })
}
