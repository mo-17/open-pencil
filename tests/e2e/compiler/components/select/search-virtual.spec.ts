import { execFileSync } from 'node:child_process'

import { expect, test, type Page, type TestInfo } from '@playwright/test'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'

async function expectCityState(page: Page, value: string, changes: number, lastValue = value) {
  await expect(
    page.getByText(`Selected[${value}] Changes[${changes}] Last[${lastValue}]`, { exact: true })
  ).toBeVisible()
}

async function expectBoundedRows(page: Page) {
  await expect.poll(() => page.locator('[role="option"]').count()).toBeGreaterThan(0)
  await expect.poll(() => page.locator('[role="option"]').count()).toBeLessThanOrEqual(20)
}

async function exerciseLargeList(page: Page, info: TestInfo) {
  const cities = page.getByRole('combobox', { name: 'Searchable cities', exact: true })
  await expect(cities).toContainText('City 08765')
  await expectCityState(page, 'city-8765', 0, '')
  await cities.click()
  const list = page.getByRole('listbox', { name: 'Searchable cities', exact: true })
  const search = page.getByRole('searchbox')
  await expect(search).toBeFocused()
  const selected = list.getByRole('option', { name: 'City 08765', exact: true })
  await expect(selected).toHaveAttribute('aria-selected', 'true')
  await expect(selected).toBeInViewport()
  await expectBoundedRows(page)
  await info.attach('virtual-list-metrics', {
    body: JSON.stringify({
      totalOptions: 10_000,
      optionDOMCount: await list.getByRole('option').count()
    }),
    contentType: 'application/json'
  })
  await page.screenshot({ path: info.outputPath('virtual-list-open.png') })
  await expect(list).toHaveCSS('height', '240px')
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight
    element.dispatchEvent(new Event('scroll'))
  })
  await expect(list.getByRole('option', { name: 'City 09999', exact: true })).toBeInViewport()
  await expectBoundedRows(page)

  // Searching labels changes only the popup. Stored IDs are deliberately different.
  await search.fill('city-42')
  await expect(page.getByRole('status')).toHaveText('No matching options')
  await expect(list.getByRole('option')).toHaveCount(0)
  await expectCityState(page, 'city-8765', 0, '')
  // Synthetic IME composition defers filtering and protects business Enter until commit.
  await search.dispatchEvent('compositionstart')
  await search.fill('北京')
  await search.press('Enter')
  await expect(list.getByRole('option')).toHaveCount(0)
  await expectCityState(page, 'city-8765', 0, '')
  await search.dispatchEvent('compositionend')
  await expect(list.getByRole('option')).toHaveCount(1)
  await expect(list.getByRole('option')).toHaveText('北京 Beijing')
  await expectCityState(page, 'city-8765', 0, '')
  await page.screenshot({ path: info.outputPath('virtual-list-chinese-search.png') })
  await search.fill('bEiJiNg')
  await expect(list.getByRole('option')).toHaveCount(1)
  await search.press('Enter')
  await expect(cities).toContainText('北京 Beijing')
  await expect(cities).toHaveAttribute('aria-expanded', 'false')
  await expect(cities).toBeFocused()
  await expectCityState(page, 'city-42', 1)

  // Selecting an already selected item and cancelling are not business changes.
  await cities.click()
  await expect(search).toHaveValue('')
  await list.getByRole('option', { name: '北京 Beijing', exact: true }).click()
  await expectCityState(page, 'city-42', 1)
  await cities.click()
  await search.fill('Xiamen')
  await search.press('Escape')
  await expect(cities).toBeFocused()
  await expectCityState(page, 'city-42', 1)
  await cities.click()
  await expect(search).toHaveValue('')
  await expectBoundedRows(page)
  await search.press('Tab')
  await expect(cities).toHaveAttribute('aria-expanded', 'false')
  await expect(
    page.getByRole('combobox', { name: 'Search without virtualization', exact: true })
  ).toBeFocused()

  // Existing SELECT authoring has no name field. Set the standard native attribute
  // only to probe that enhancement retains real FormData rather than a fake value.
  const nativeCity = page.locator('form select').first()
  await nativeCity.evaluate((element) => element.setAttribute('name', 'destination'))
  await expect
    .poll(() =>
      page
        .locator('form')
        .evaluate((element) => new FormData(element as HTMLFormElement).get('destination'))
    )
    .toBe('city-42')
  await page.getByRole('button', { name: 'Choose Xiamen externally', exact: true }).click()
  await expect(cities).toContainText('厦门 Xiamen')
  await expectCityState(page, 'city-314', 1, 'city-42')
  await cities.click()
  await expect(list.getByRole('option', { name: '厦门 Xiamen', exact: true })).toBeInViewport()
  await search.press('Escape')
  await page.getByRole('button', { name: 'Replace city options', exact: true }).click()
  await expect(cities).toContainText('厦门 New Xiamen')
  await cities.click()
  await expect(list.getByRole('option')).toHaveCount(2)
  await expect(list.getByRole('option', { name: 'City 08765', exact: true })).toHaveCount(0)
  await list.getByRole('option', { name: 'Replacement destination', exact: true }).click()
  await expectCityState(page, 'city-9999', 2)
  const disabled = page.getByRole('combobox', { name: 'Disabled search choice', exact: true })
  await expect(disabled).toBeDisabled()
  await expect(disabled).toContainText('Saved disabled choice')
  await disabled.dispatchEvent('click')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  const nativeDisabled = page.locator('form select').last()
  await expect(nativeDisabled).toBeDisabled()
  await nativeDisabled.evaluate((element) => element.setAttribute('name', 'disabledDestination'))
  await expect
    .poll(() =>
      page
        .locator('form')
        .evaluate((element) => new FormData(element as HTMLFormElement).has('disabledDestination'))
    )
    .toBe(false)
  await expectCityState(page, 'city-9999', 2)
}

async function exerciseSmallLists(page: Page) {
  const category = page.getByRole('combobox', {
    name: 'Search without virtualization',
    exact: true
  })
  const search = page.getByRole('searchbox')
  const list = page.getByRole('listbox')
  await expect(category).toContainText('All categories')
  await category.click()
  await expect(list.getByRole('option')).toHaveCount(4)
  await expect(list.getByRole('option', { name: 'All categories', exact: true })).toHaveCount(1)
  const disabled = list.getByRole('option', { name: 'Unavailable category', exact: true })
  await expect(disabled).toHaveAttribute('aria-disabled', 'true')
  await disabled.dispatchEvent('click')
  await expect(category).toContainText('All categories')
  await expect(category).toHaveAttribute('aria-expanded', 'true')
  await search.fill('BETA')
  await expect(list.getByRole('option')).toHaveCount(1)
  await search.press('Enter')
  await expect(category).toContainText('Beta category')
  await expect(page.getByText('Category[b] Clearable[]', { exact: true })).toBeVisible()
  await category.click()
  await list.getByRole('option', { name: 'All categories', exact: true }).click()
  await expect(page.getByText('Category[] Clearable[]', { exact: true })).toBeVisible()

  const clearable = page.getByRole('combobox', { name: 'Clearable required choice', exact: true })
  await expect(clearable).toContainText('Choose or clear')
  await clearable.click()
  // Focusing the search field is still inside this field; it is not a validation blur.
  await expect(page.getByRole('alert')).toHaveCount(0)
  await list.getByRole('option', { name: 'Ready', exact: true }).click()
  await expect(page.getByText('Category[] Clearable[ready]', { exact: true })).toBeVisible()
  await clearable.click()
  await list.getByRole('option', { name: 'Choose or clear', exact: true }).click()
  await page.getByRole('button', { name: 'Focus outside selectors', exact: true }).focus()
  await expect(page.getByRole('alert')).toHaveText('Choose a status')
  await expect(page.getByText('Category[] Clearable[]', { exact: true })).toBeVisible()
  await clearable.click()
  await search.fill('Ready')
  await search.press('Enter')
  await page.getByRole('button', { name: 'Focus outside selectors', exact: true }).focus()
  await expect(page.getByRole('alert')).toHaveCount(0)

  const keyboard = page.getByRole('combobox', { name: 'Virtual keyboard choices', exact: true })
  await keyboard.focus()
  await keyboard.press('ArrowDown')
  await expect(page.getByRole('searchbox')).toHaveCount(0)
  await expectBoundedRows(page)
  await keyboard.press('End')
  const lastEnabled = list.getByRole('option', { name: 'Keyboard 098', exact: true })
  await expect(lastEnabled).toBeInViewport()
  await keyboard.press('Enter')
  await expect(keyboard).toContainText('Keyboard 098')
  await page.locator('form').evaluate((element) => (element as HTMLFormElement).reset())
  await expect(keyboard).toContainText('Keyboard 000')
  await expectCityState(page, 'city-9999', 2)
  await expect(page.getByText('Category[] Clearable[ready]', { exact: true })).toBeVisible()
}

for (const variant of ['react', 'vue', 'shadcn'] as const) {
  const target = variant === 'vue' ? 'vue' : 'react'
  test(`${variant} SELECT searches labels, virtualizes 10000 choices, and preserves form semantics`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    const fixture: { files: [string, string][] } = JSON.parse(
      execFileSync(
        'bun',
        [
          '-e',
          `import { selectSearchVirtualFixture } from './tests/helpers/compiler/components/select/search-virtual'; process.stdout.write(JSON.stringify(selectSearchVirtualFixture(${JSON.stringify(target)}, ${variant === 'shadcn'})))`
        ],
        { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
      )
    )
    await withComponentTemplateFiles(page, target, new Map(fixture.files), async () => {
      await exerciseLargeList(page, info)
      await exerciseSmallLists(page)
      await page.screenshot({
        path: info.outputPath(`select-search-virtual-${variant}.png`),
        fullPage: true
      })
    })
  })
}

for (const target of ['react', 'vue'] as const) {
  test(`${target} SELECT runtime props close disabled popups and preserve native form data`, async ({
    page
  }) => {
    test.setTimeout(90_000)
    const fixture: { files: [string, string][] } = JSON.parse(
      execFileSync(
        'bun',
        [
          '-e',
          `import { selectRuntimePropsFixture } from './tests/helpers/compiler/components/select/search-virtual'; process.stdout.write(JSON.stringify(selectRuntimePropsFixture(${JSON.stringify(target)})))`
        ],
        { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
      )
    )
    await withComponentTemplateFiles(page, target, new Map(fixture.files), async () => {
      const control = page.getByRole('combobox', { name: 'Runtime destination', exact: true })
      const formData = () =>
        page
          .locator('form')
          .evaluate((element) => new FormData(element as HTMLFormElement).get('destination'))
      await expect(control).toContainText('Saved destination')
      await expect.poll(formData).toBe('saved')
      await control.click()
      await expect(page.getByRole('listbox')).toBeVisible()
      await expect(page.getByText('Focus[1] Blur[0]', { exact: true })).toBeVisible()
      // No pointer/focus event closes the popup first: this directly exercises a prop update.
      await page
        .getByRole('button', { name: 'Disable runtime control', exact: true })
        .dispatchEvent('click')
      await expect(control).toBeDisabled()
      await expect(page.getByRole('listbox')).toHaveCount(0)
      await expect(page.locator('select[name="destination"]')).toBeDisabled()
      await expect.poll(formData).toBeNull()
      await expect(page.getByText('Runtime[saved] Changes[0]', { exact: true })).toBeVisible()
      await expect(page.getByText('Focus[1] Blur[1]', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Enable runtime control', exact: true }).click()
      await control.click()
      await page.getByRole('option', { name: 'Other destination', exact: true }).click()
      await expect.poll(formData).toBe('other')
      await expect(page.getByText('Runtime[other] Changes[1]', { exact: true })).toBeVisible()
      await expect(page.getByText('Focus[2] Blur[1]', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Disable runtime control', exact: true }).click()
      await expect(page.getByText('Focus[2] Blur[2]', { exact: true })).toBeVisible()
    })
  })
}
