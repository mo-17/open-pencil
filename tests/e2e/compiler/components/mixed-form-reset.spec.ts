import { expect, test } from '@playwright/test'

import { withMixedForm } from '#tests/helpers/compiler/components/mixed-form/browser'

for (const target of ['react', 'vue'] as const) {
  test(`${target} compiled mixed FORM restores business state, DOM and serialized module fields`, async ({
    page
  }) => {
    await withMixedForm(page, target, async () => {
      const main = page.locator('form').first()
      const pageNumber = page.getByRole('spinbutton', { name: 'Page number' })
      const documentNumber = page.getByRole('spinbutton', { name: 'Document number' })
      const otherNumber = page.getByRole('spinbutton', { name: 'Other number' })
      const color = page.getByRole('textbox', { name: 'Color', exact: true })
      const city = page.getByRole('combobox', { name: 'City' })
      const cascader = page.getByRole('combobox', { name: 'Destination' })
      const lower = page.getByRole('group', { name: 'Budget' }).getByRole('slider').first()
      const start = page.getByRole('group', { name: 'Travel dates' }).getByLabel('Start date')
      const feedback = page.getByText(/Mixed:/)

      await expect(feedback).toHaveText('Mixed:2/4/#2563eb/北京 Beijing/9/0')
      await page.getByRole('button', { name: 'External number', exact: true }).click()
      await page.getByRole('button', { name: 'External document number' }).click()
      await expect(pageNumber).toHaveValue('8')
      await expect(documentNumber).toHaveValue('7')
      await pageNumber.fill('3')
      await documentNumber.fill('5')
      await color.fill('#112233')
      await city.fill('厦门 Xiamen')
      await lower.focus()
      await page.keyboard.press('ArrowRight')
      await start.fill('2026-09-01')
      await cascader.click()
      await page.getByRole('treeitem', { name: 'Asia', exact: true }).click()
      await page.getByRole('treeitem', { name: 'China', exact: true }).click()
      await page.getByRole('treeitem', { name: 'Xiamen', exact: true }).click()
      await otherNumber.fill('12')
      await expect(feedback).toHaveText('Mixed:3/5/#112233/厦门 Xiamen/12/0')
      await expect(lower).toHaveValue('21')
      await expect(start).toHaveValue('2026-09-01')
      expect(
        await main.evaluate((element) =>
          [...new FormData(element as HTMLFormElement)].filter(([name]) => name === 'path')
        )
      ).toEqual([
        ['path', 'asia'],
        ['path', 'china'],
        ['path', 'xiamen']
      ])

      await main.evaluate((element) => (element as HTMLFormElement).reset())
      await expect(feedback).toHaveText('Mixed:2/4/#2563eb/北京 Beijing/12/0')
      await expect(pageNumber).toHaveValue('2')
      await expect(documentNumber).toHaveValue('4')
      await expect(color).toHaveValue('#2563eb')
      await expect(city).toHaveValue('北京 Beijing')
      await expect(lower).toHaveValue('20')
      await expect(start).toHaveValue('')
      await expect(cascader).toContainText('Choose a location')
      expect(
        await main.evaluate((element) => [...new FormData(element as HTMLFormElement)])
      ).toEqual(
        expect.arrayContaining([
          ['amount', '20'],
          ['end', '80'],
          ['startDate', '']
        ])
      )
      await page
        .locator('form')
        .last()
        .evaluate((element) => (element as HTMLFormElement).reset())
      await expect(feedback).toHaveText('Mixed:2/4/#2563eb/北京 Beijing/9/0')
      await expect(otherNumber).toHaveValue('9')
    })
  })

  test(`${target} mixed FORM cancelled reset preserves edits and hidden fields reset before remount`, async ({
    page
  }) => {
    await withMixedForm(page, target, async () => {
      const main = page.locator('form').first()
      const pageNumber = page.getByRole('spinbutton', { name: 'Page number' })
      const documentNumber = page.getByRole('spinbutton', { name: 'Document number' })
      const city = page.getByRole('combobox', { name: 'City' })
      const feedback = page.getByText(/Mixed:/)
      await pageNumber.fill('6')
      await city.fill('')
      await city.blur()
      await expect(city).toHaveValue('')
      await expect(city).toHaveAttribute('aria-invalid', 'true')
      await expect(feedback).toHaveText('Mixed:6/4/#2563eb//9/0')
      await main.evaluate((element) => {
        element.addEventListener('reset', (event) => event.preventDefault(), { once: true })
        ;(element as HTMLFormElement).reset()
      })
      await expect(pageNumber).toHaveValue('6')
      await expect(city).toHaveValue('')
      await expect(feedback).toHaveText('Mixed:6/4/#2563eb//9/0')
      await expect(city).toHaveAttribute('aria-invalid', 'true')

      await documentNumber.fill('')
      await documentNumber.blur()
      await expect(documentNumber).toHaveAttribute('aria-invalid', 'true')
      await page.getByRole('button', { name: 'External document number' }).click()
      await expect(documentNumber).toHaveValue('7')
      await expect(documentNumber).not.toHaveAttribute('aria-invalid', 'true')

      await page.getByRole('button', { name: 'Hide city' }).click()
      await expect(city).toHaveCount(0)
      await main.evaluate((element) => (element as HTMLFormElement).reset())
      await expect(feedback).toHaveText('Mixed:2/4/#2563eb/北京 Beijing/9/0')
      await page.getByRole('button', { name: 'Show city' }).click()
      await expect(city).toHaveValue('北京 Beijing')
      await expect(city).not.toHaveAttribute('aria-invalid', 'true')
    })
  })

  test(`${target} mixed FORM respects readonly, disabled and clean component instance ownership`, async ({
    page
  }) => {
    await withMixedForm(page, target, async () => {
      const main = page.locator('form').first()
      const other = page.locator('form').last()
      const review = main.getByRole('group', { name: 'Review score' }).getByRole('slider')
      const locked = main.getByRole('group', { name: 'Locked score' }).getByRole('slider')
      const embedded = main.getByRole('group', { name: 'Main embedded score' }).getByRole('slider')
      const otherEmbedded = other
        .getByRole('group', { name: 'Other embedded score' })
        .getByRole('slider')
      const feedback = page.getByText(/Protected:/)
      const entries = (form: typeof main) =>
        form.evaluate((element) => [...new FormData(element as HTMLFormElement)])

      await expect(feedback).toHaveText('Protected:11/17/6/13')
      await expect(review).toHaveAttribute('aria-readonly', 'true')
      await expect(locked).toBeDisabled()
      await review.focus()
      await page.keyboard.press('ArrowRight')
      await expect(review).toHaveValue('11')
      expect(await entries(main)).toEqual(
        expect.arrayContaining([
          ['reviewScore', '11'],
          ['mainEmbedded', '6']
        ])
      )
      expect((await entries(main)).some(([name]) => name === 'lockedScore')).toBe(false)
      expect((await entries(main)).some(([name]) => name === 'otherEmbedded')).toBe(false)

      await page.getByRole('button', { name: 'External Review score' }).click()
      await page.getByRole('button', { name: 'External Locked score' }).click()
      await page.getByRole('button', { name: 'External mainEmbedded' }).click()
      await page.getByRole('button', { name: 'External otherEmbedded' }).click()
      await expect(feedback).toHaveText('Protected:12/18/7/14')
      await expect(review).toHaveValue('12')
      await expect(locked).toHaveValue('18')
      await expect(embedded).toHaveValue('7')
      await expect(otherEmbedded).toHaveValue('14')
      expect(await entries(main)).toEqual(
        expect.arrayContaining([
          ['reviewScore', '12'],
          ['mainEmbedded', '7']
        ])
      )
      expect((await entries(main)).some(([name]) => name === 'lockedScore')).toBe(false)

      await main.evaluate((element) => (element as HTMLFormElement).reset())
      await expect(feedback).toHaveText('Protected:11/17/6/14')
      await expect(review).toHaveValue('11')
      await expect(locked).toHaveValue('17')
      await expect(embedded).toHaveValue('6')
      await expect(otherEmbedded).toHaveValue('14')
      expect(await entries(main)).toEqual(
        expect.arrayContaining([
          ['reviewScore', '11'],
          ['mainEmbedded', '6']
        ])
      )
      expect((await entries(main)).some(([name]) => name === 'lockedScore')).toBe(false)
      expect(await entries(other)).toEqual(expect.arrayContaining([['otherEmbedded', '14']]))

      await other.evaluate((element) => (element as HTMLFormElement).reset())
      await expect(feedback).toHaveText('Protected:11/17/6/13')
      await expect(otherEmbedded).toHaveValue('13')
    })
  })
}
