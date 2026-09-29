import { execFileSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'

for (const variant of ['react', 'vue', 'shadcn'] as const) {
  const target = variant === 'vue' ? 'vue' : 'react'
  test(`${variant} multiple SELECT preserves arrays through search, validation, reset and external updates`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    const fixture: { files: [string, string][] } = JSON.parse(
      execFileSync(
        'bun',
        [
          '-e',
          `import { selectMultipleFixture } from './tests/helpers/compiler/components/select/multiple'; process.stdout.write(JSON.stringify(selectMultipleFixture('${target}', ${variant === 'shadcn'})))`
        ],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
      )
    )
    await withComponentTemplateFiles(page, target, new Map(fixture.files), async () => {
      const topics = page.getByRole('combobox', { name: 'Topics', exact: true })
      const native = page.locator('select').first()
      await native.evaluate((el) => el.setAttribute('name', 'topics'))
      const values = () =>
        native.evaluate((el: HTMLSelectElement) =>
          Array.from(el.selectedOptions, (option) => option.value)
        )
      await expect(topics).toContainText('Alpha')
      await topics.click()
      await page.getByRole('button', { name: 'Outside', exact: true }).focus()
      await expect(topics).toHaveAttribute('aria-expanded', 'false')
      await expect(page.getByText('Blurs[1]', { exact: true })).toBeVisible()
      await expect(page.getByRole('alert')).toHaveText('Choose at least two topics')
      await topics.click()
      await expect(page.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true')
      await page.getByRole('searchbox').fill('北京')
      await page.getByRole('option', { name: '北京 Beijing', exact: true }).click()
      await expect(topics).toHaveAttribute('aria-expanded', 'true')
      await expect.poll(values).toEqual(['a', 'b'])
      await page.getByRole('searchbox').fill('')
      await expect(page.getByRole('option', { name: 'Disabled topic' })).toHaveAttribute(
        'aria-disabled',
        'true'
      )
      await page.getByRole('option', { name: 'Empty business value', exact: true }).click()
      await expect.poll(values).toEqual(['', 'a', 'b'])
      await page.getByRole('searchbox').press('Escape')
      await page.getByRole('button', { name: 'Outside', exact: true }).click()
      await expect(page.getByRole('alert')).toHaveCount(0)
      await topics.click()
      await page.getByRole('button', { name: 'Clear selection', exact: true }).click()
      await expect.poll(values).toEqual([])
      await page.getByRole('searchbox').press('Escape')
      await page.getByRole('button', { name: 'Outside', exact: true }).click()
      await expect(page.getByRole('alert')).toContainText('Choose topics')
      await page.getByRole('button', { name: 'External selection', exact: true }).click()
      await expect.poll(values).toEqual(['', 'b'])
      await topics.focus()
      await topics.press('Backspace')
      await expect.poll(values).toEqual(['b'])
      await topics.click()
      await page.getByRole('option', { name: 'Alpha', exact: true }).click()
      await page.getByRole('searchbox').press('Escape')
      await page.getByRole('button', { name: 'Outside', exact: true }).click()
      await expect(page.getByRole('alert')).toHaveCount(0)
      const formValues = await native.evaluate((el: HTMLSelectElement) =>
        el.form ? new FormData(el.form).getAll('topics') : []
      )
      expect(formValues).toEqual(['a', 'b'])
      const local = page.getByRole('combobox', { name: 'Uncontrolled topics', exact: true })
      await local.click()
      await page.getByRole('option', { name: 'Alpha', exact: true }).click()
      await local.press('Escape')
      await expect(local).toContainText('Alpha')
      await native.evaluate((el: HTMLSelectElement) => el.form?.reset())
      await expect(local).toContainText('Beta')
      await expect(local).not.toContainText('Alpha')
      await expect.poll(values).toEqual(['a', 'b'])
      await expect(
        page.getByRole('combobox', { name: 'Disabled topics', exact: true })
      ).toBeDisabled()
      const dynamic = page.getByRole('combobox', { name: 'Dynamic topics', exact: true })
      await expect(dynamic).toContainText('Dynamic Alpha')
      await page.getByRole('button', { name: 'Remove dynamic Alpha', exact: true }).click()
      await expect(dynamic).not.toContainText('Dynamic Alpha')
      await page.getByRole('button', { name: 'Restore dynamic Alpha', exact: true }).click()
      await expect(dynamic).not.toContainText('Dynamic Alpha')
      await dynamic.click()
      await expect(
        page.getByRole('option', { name: 'Dynamic Alpha', exact: true })
      ).toHaveAttribute('aria-selected', 'false')
      await dynamic.press('Escape')
      await page.screenshot({ path: info.outputPath('select-multiple.png'), fullPage: true })
    })
  })
}
