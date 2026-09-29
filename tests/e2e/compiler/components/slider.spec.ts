import { expect, test, type Locator, type Page } from '@playwright/test'

import { withSlider } from '#tests/helpers/compiler/modules/slider/browser'

async function dragThumb(page: Page, input: Locator, next: number): Promise<void> {
  const box = await input.boundingBox()
  if (!box) throw new Error('Expected visible slider')
  const min = Number(await input.getAttribute('min'))
  const max = Number(await input.getAttribute('max'))
  const current = Number(await input.inputValue())
  const project = (value: number) => box.x + 10 + ((value - min) / (max - min)) * (box.width - 20)
  await page.mouse.move(project(current), box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(project(next), box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
}

for (const target of ['react', 'vue'] as const) {
  test(`${target} Slider supports native keyboard, pointer steps and independent local values`, async ({
    page
  }, info) => {
    await page.setViewportSize({ width: 375, height: 700 })
    await withSlider(page, target, async () => {
      const volume = page.getByRole('slider', { name: '音量', exact: true })
      await expect(volume).toHaveValue('30')
      await volume.focus()
      await page.keyboard.press('ArrowRight')
      await expect(volume).toHaveValue('31')
      await page.keyboard.press('PageUp')
      await expect(volume).toHaveValue('41')
      await page.keyboard.press('Home')
      await expect(volume).toHaveValue('0')
      await page.keyboard.press('End')
      await expect(volume).toHaveValue('100')
      await dragThumb(page, volume, 50)
      await expect(volume).toHaveValue('50')
      const range = page.getByRole('group', { name: '价格范围', exact: true })
      await expect(range.getByRole('slider').first()).toHaveValue('0.1')
      await expect(range.getByRole('slider').last()).toHaveValue('0.6')
      const track = page
        .getByRole('group', { name: '音量', exact: true })
        .locator('[data-slider-control]')
      const box = await track.boundingBox()
      if (!box) throw new Error('Expected slider track')
      await page.mouse.click(box.x + 10 + (box.width - 20) * 0.2, box.y + box.height / 2)
      await expect(volume).toHaveValue('20')
      const hosts = page.locator('[data-openpencil-slider]')
      expect(
        await hosts.evaluateAll((elements) =>
          elements.every((element) => element.scrollWidth <= element.clientWidth + 1)
        )
      ).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      )
      await page.screenshot({ path: info.outputPath(`${target}-slider-narrow.png`) })
    })
  })

  test(`${target} range handles never cross and overlapping handles can separate at an unaligned maximum`, async ({
    page
  }) => {
    await withSlider(page, target, async () => {
      const range = page.getByRole('group', { name: '价格范围', exact: true })
      const lower = range.getByRole('slider').first(),
        upper = range.getByRole('slider').last()
      await lower.focus()
      await page.keyboard.press('ArrowRight')
      await expect(lower).toHaveValue('0.2')
      await expect(lower).toHaveAttribute('aria-valuemax', '0.6')
      await page.keyboard.press('End')
      await expect(lower).toHaveValue('0.6')
      await expect(upper).toHaveValue('0.6')
      await dragThumb(page, lower, -0.1)
      await expect(lower).toHaveValue('-0.1')
      await expect(upper).toHaveValue('0.6')
      await upper.focus()
      await page.keyboard.press('Home')
      await expect(upper).toHaveValue('-0.1')
      await expect(upper).toHaveAttribute('aria-valuemin', '-0.1')
      await page.keyboard.press('ArrowRight')
      await expect(upper).toHaveValue('0')
      await lower.focus()
      await page.keyboard.press('End')
      await expect(lower).toHaveValue('0')
      await expect(upper).toHaveValue('0')
    })
  })

  test(`${target} read-only Slider remains focusable and disabled Slider cannot mutate`, async ({
    page
  }) => {
    await withSlider(page, target, async () => {
      const readonly = page.getByRole('slider', { name: '只读', exact: true })
      await readonly.focus()
      await expect(readonly).toBeFocused()
      await expect(readonly).toHaveAttribute('aria-readonly', 'true')
      await page.keyboard.press('End')
      await expect(readonly).toHaveValue('40')
      await dragThumb(page, readonly, 80)
      await expect(readonly).toHaveValue('40')
      const disabled = page.getByRole('group', { name: '已禁用', exact: true }).getByRole('slider')
      await expect(disabled.first()).toBeDisabled()
      await expect(disabled.last()).toBeDisabled()
      await page.keyboard.press('Tab')
      await expect(disabled.first()).not.toBeFocused()
      await expect(disabled.last()).not.toBeFocused()
      await expect(disabled.first()).toHaveValue('25')
      await expect(disabled.last()).toHaveValue('75')
    })
  })

  test(`${target} Slider preserves values on equal props and resets on replacement or remount`, async ({
    page
  }) => {
    await withSlider(
      page,
      target,
      async () => {
        const group = page.getByRole('group', { name: 'Lifecycle range', exact: true })
        const lower = group.getByRole('slider').first(),
          upper = group.getByRole('slider').last()
        await lower.focus()
        await page.keyboard.press('ArrowRight')
        await expect(lower).toHaveValue('31')
        await page.getByRole('button', { name: 'Rerender 0', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Rerender 1', exact: true })).toBeVisible()
        await expect(lower).toHaveValue('31')
        await page.getByRole('button', { name: 'Replace config', exact: true }).click()
        await expect(lower).toHaveValue('-0.2')
        await expect(upper).toHaveValue('0.6')
        await lower.focus()
        await page.keyboard.press('ArrowUp')
        await expect(lower).toHaveValue('-0.1')
        await page.getByRole('button', { name: 'Toggle mount', exact: true }).click()
        await expect(group).toHaveCount(0)
        await page.getByRole('button', { name: 'Toggle mount', exact: true }).click()
        await expect(lower).toHaveValue('-0.2')
        await expect(upper).toHaveValue('0.6')
      },
      true
    )
  })
}
