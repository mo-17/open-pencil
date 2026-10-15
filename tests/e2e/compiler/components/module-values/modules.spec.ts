import { expect, test, type Page } from '@playwright/test'
import * as v from 'valibot'

import { withFormModules } from '#tests/helpers/compiler/components/form-modules/browser'

async function submission(page: Page) {
  return v.parse(
    v.pipe(v.string(), v.parseJson(), v.array(v.tuple([v.string(), v.string()]))),
    (await page.locator('[data-submission]').textContent()) || '[]'
  )
}
for (const target of ['react', 'vue'] as const) {
  test(`${target} module controls write typed values once and submit independent named endpoints`, async ({
    page
  }) => {
    await withFormModules(page, target, async () => {
      const range = page.getByRole('group', { name: 'Linked range' }),
        lower = range.getByRole('slider').first(),
        upper = range.getByRole('slider').last(),
        rating = page.getByRole('slider', { name: 'Linked rating', exact: true }),
        date = page.getByRole('group', { name: 'Linked dates' }),
        start = date.getByLabel('Start date', { exact: true }),
        end = date.getByLabel('End date', { exact: true })
      await lower.focus()
      await page.keyboard.press('ArrowRight')
      await expect(lower).toHaveValue('21')
      await expect(upper).toHaveValue('80')
      await upper.focus()
      await page.keyboard.press('ArrowLeft')
      await expect(upper).toHaveValue('79')
      await rating.focus()
      await page.keyboard.press('ArrowRight')
      await expect(rating).toHaveAttribute('aria-valuenow', '3.5')
      await start.fill('2026-09-02')
      await end.fill('2026-09-06')
      await end.blur()
      await expect(page.locator('[data-values]')).toContainText(
        'Values[21,79,3.5,2026-09-02,2026-09-06] Changes[5] Blur[end]'
      )
      await page.getByRole('button', { name: 'Submit', exact: true }).click()
      expect(await submission(page)).toEqual([
        ['low', '21'],
        ['high', '79'],
        ['score', '3.5'],
        ['start', '2026-09-02'],
        ['end', '2026-09-06']
      ])
      await page.getByRole('button', { name: 'Read only', exact: true }).click()
      await lower.focus()
      await page.keyboard.press('End')
      await rating.focus()
      await page.keyboard.press('Home')
      await expect(lower).toHaveValue('21')
      await expect(rating).toHaveAttribute('aria-valuenow', '3.5')
      await expect(start).toHaveAttribute('readonly', '')
      await page.getByRole('button', { name: 'Submit', exact: true }).click()
      expect(await submission(page)).toHaveLength(5)
      await page.getByRole('button', { name: 'Read only', exact: true }).click()
      await start.fill('')
      await end.fill('')
      await page.getByRole('button', { name: 'Zero rating', exact: true }).click()
      await page.getByRole('button', { name: 'Read only', exact: true }).click()
      expect(
        await page
          .locator('#main-form')
          .evaluate((form) => (form as HTMLFormElement).checkValidity())
      ).toBe(true)
      await page.getByRole('button', { name: 'Submit', exact: true }).click()
      expect(await submission(page)).toEqual([
        ['low', '21'],
        ['high', '79'],
        ['score', '0'],
        ['start', ''],
        ['end', '']
      ])
      await page.getByRole('button', { name: 'Reset', exact: true }).click()
      await expect(page.locator('[data-values]')).toContainText(
        'Values[20,80,3,2026-09-01,2026-09-05]'
      )
      await expect(start).toHaveAttribute('readonly', '')
      await page.getByRole('button', { name: 'Disabled', exact: true }).click()
      await page.getByRole('button', { name: 'Submit', exact: true }).click()
      expect(await submission(page)).toEqual([])
    })
  })
  test(`${target} invalid controlled values remain unavailable and native validation focuses the correct field`, async ({
    page
  }) => {
    await withFormModules(page, target, async () => {
      const range = page.getByRole('group', { name: 'Linked range' }),
        lower = range.getByRole('slider').first(),
        rating = page.getByRole('slider', { name: 'Linked rating', exact: true }),
        date = page.getByRole('group', { name: 'Linked dates' })
      await page.getByRole('button', { name: 'Invalid values', exact: true }).click()
      await expect(range.locator('output')).toHaveText('— – —')
      await expect(rating).not.toHaveAttribute('aria-valuenow', /.+/)
      await expect(date.getByLabel('Start date', { exact: true })).toHaveValue('')
      await expect(page.locator('[data-values]')).toContainText(
        'Values[undefined,80,99,2026-02-30,undefined] Changes[0]'
      )
      expect(
        await page
          .locator('#main-form')
          .evaluate((form) => new FormData(form as HTMLFormElement).getAll('low'))
      ).toEqual([''])
      await page.getByRole('button', { name: 'Submit', exact: true }).click()
      await expect(lower).toBeFocused()
      await expect(page.locator('[data-submission]')).toHaveText('')
      await page.keyboard.press('Home')
      await expect(lower).toHaveValue('0')
      await expect(page.locator('[data-values]')).toContainText('Values[0,80,99')
      await page.getByRole('button', { name: 'Reset', exact: true }).click()
      await expect(page.locator('[data-values]')).toContainText(
        'Values[20,80,3,2026-09-01,2026-09-05]'
      )
      await page.getByRole('button', { name: 'Zero rating', exact: true }).click()
      await page.getByRole('button', { name: 'Submit', exact: true }).click()
      await expect(rating).toBeFocused()
      await expect(rating).toHaveAttribute('aria-invalid', 'true')
      await page.getByRole('button', { name: 'Reset', exact: true }).click()
      await expect(page.locator('[data-values]')).toContainText(
        'Values[20,80,3,2026-09-01,2026-09-05]'
      )
      await date.getByLabel('Start date', { exact: true }).fill('2026-10-01')
      await page.getByRole('button', { name: 'Submit', exact: true }).click()
      await expect(date.getByLabel('Start date', { exact: true })).toBeFocused()
      await expect(date.getByRole('status')).toContainText('Start date must not be after end date.')
      await page.getByRole('button', { name: 'Reset', exact: true }).click()
      await expect(page.locator('[data-values]')).toContainText(
        'Values[20,80,3,2026-09-01,2026-09-05]'
      )
      await page.getByRole('button', { name: 'Server error', exact: true }).click()
      await expect(page.getByRole('alert')).toHaveText('End field rejected')
      await expect(date.getByLabel('End date', { exact: true })).toHaveAttribute(
        'aria-describedby',
        /end-error/
      )
      await page.getByRole('button', { name: 'Submit', exact: true }).click()
      await expect(date.getByLabel('End date', { exact: true })).toBeFocused()
    })
  })
  test(`${target} reset cancellation, real form ownership and detached instances preserve boundaries`, async ({
    page
  }) => {
    await withFormModules(page, target, async () => {
      const lower = page.getByRole('group', { name: 'Linked range' }).getByRole('slider').first(),
        local = page.getByRole('slider', { name: 'Local rating', exact: true })
      await lower.focus()
      await page.keyboard.press('ArrowRight')
      await local.focus()
      await page.keyboard.press('End')
      await page.getByRole('button', { name: 'Cancel reset', exact: true }).click()
      await page.getByRole('button', { name: 'Reset', exact: true }).click()
      await expect(lower).toHaveValue('21')
      await expect(local).toHaveAttribute('aria-valuenow', '5')
      await page.getByRole('button', { name: 'Cancel reset', exact: true }).click()
      await page.getByRole('button', { name: 'Reset', exact: true }).click()
      await expect(lower).toHaveValue('20')
      await expect(local).toHaveAttribute('aria-valuenow', '3')
      await page.getByRole('button', { name: 'Submit external', exact: true }).click()
      expect(await submission(page)).toEqual([['external', '3']])
      await page.getByRole('button', { name: 'Submit unrelated', exact: true }).click()
      expect(await submission(page)).toEqual([])
      await lower.evaluate((element) => {
        ;(window as Window & { oldModuleInput?: Element }).oldModuleInput = element
      })
      await page.getByRole('button', { name: 'Mount', exact: true }).click()
      await page.evaluate(() => {
        const old = (window as Window & { oldModuleInput?: Element }).oldModuleInput
        old?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
        old?.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await page.getByRole('button', { name: 'Mount', exact: true }).click()
      await expect(lower).toHaveValue('20')
      await expect(page.locator('[data-values]')).toContainText('Changes[1]')
    })
  })
}

for (const target of ['react', 'vue'] as const)
  test(`${target} compiled FORM connects module page/document state, validates and resets without cross-endpoint writes`, async ({
    page
  }) => {
    await withFormModules(
      page,
      target,
      async () => {
        const form = page.locator('form'),
          range = page.getByRole('group', { name: 'Budget', exact: true }),
          lower = range.getByRole('slider').first(),
          upper = range.getByRole('slider').last(),
          rating = page.getByRole('slider', { name: 'Experience', exact: true }),
          dates = page.getByRole('group', { name: 'Travel dates', exact: true }),
          start = dates.getByLabel('Start date', { exact: true }),
          end = dates.getByLabel('End date', { exact: true })
        await expect(page.getByText('Values:20/80/0///0', { exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Submit', exact: true }).click()
        await expect(rating).toBeFocused()
        await lower.focus()
        await page.keyboard.press('ArrowRight')
        await expect(lower).toHaveValue('21')
        await expect(upper).toHaveValue('80')
        await rating.focus()
        await page.keyboard.press('ArrowRight')
        await expect(rating).toHaveAttribute('aria-valuenow', '1')
        await start.fill('2026-09-01')
        await end.fill('2026-09-05')
        await page.getByRole('combobox', { name: 'Destination', exact: true }).click()
        await page.getByRole('treeitem', { name: 'Asia', exact: true }).click()
        await page.getByRole('treeitem', { name: 'China', exact: true }).click()
        await page.getByRole('treeitem', { name: 'Xiamen', exact: true }).click()
        await expect(
          page.getByText('Values:21/80/1/2026-09-01/2026-09-05/0', { exact: true })
        ).toBeVisible()
        const entries = await form.evaluate((element) => [
          ...new FormData(element as HTMLFormElement)
        ])
        expect(entries).toEqual(
          expect.arrayContaining([
            ['amount', '21'],
            ['end', '80'],
            ['rating', '1'],
            ['startDate', '2026-09-01'],
            ['endDate', '2026-09-05']
          ])
        )
        expect(entries.filter((entry) => entry[0] === 'path').map((entry) => entry[1])).toEqual([
          'asia',
          'china',
          'xiamen'
        ])
        await page.getByRole('button', { name: 'Submit', exact: true }).click()
        await expect(
          page.getByText('Values:21/80/1/2026-09-01/2026-09-05/1', { exact: true })
        ).toBeVisible()
        await form.evaluate((element) => {
          element.addEventListener('reset', (event) => event.preventDefault(), { once: true })
          ;(element as HTMLFormElement).reset()
        })
        await expect(lower).toHaveValue('21')
        await expect(start).toHaveValue('2026-09-01')
        await form.evaluate((element) => (element as HTMLFormElement).reset())
        await expect(page.getByText('Values:20/80/0///1', { exact: true })).toBeVisible()
        await expect(lower).toHaveValue('20')
        await expect(upper).toHaveValue('80')
        await expect(start).toHaveValue('')
        await expect(end).toHaveValue('')
        await expect(page.locator('[data-module-field-error]')).toHaveCount(0)
      },
      true
    )
  })
