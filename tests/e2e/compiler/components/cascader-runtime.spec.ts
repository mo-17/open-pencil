import { execFileSync } from 'node:child_process'

import { expect, test, type Page } from '@playwright/test'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'
import { parseCompilerFiles } from '#tests/helpers/compiler/output'

async function withCascader(page: Page, target: 'react' | 'vue', run: () => Promise<void>) {
  const source = `import {cascaderRuntimeFixture} from './tests/helpers/compiler/components/cascader/runtime';const result=cascaderRuntimeFixture(${JSON.stringify(target)});if(result.warnings.length)throw new Error(JSON.stringify(result.warnings));process.stdout.write(JSON.stringify([...result.files]));`
  const files = parseCompilerFiles(
    execFileSync('bun', ['-e', source], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
  )
  await withComponentTemplateFiles(page, target, new Map(files), run)
}
async function formValues(page: Page) {
  return page
    .locator('#destination-form')
    .evaluate((element: HTMLFormElement) => new FormData(element).getAll('location'))
}
test.use({ viewport: { width: 375, height: 900 } })
for (const target of ['react', 'vue'] as const) {
  test(`${target} Cascader keyboard and search commit only enabled leaf paths, clear and restore focus without implicit submit`, async ({
    page
  }) => {
    await withCascader(page, target, async () => {
      const host = page.locator('[data-openpencil-cascader]').first(),
        trigger = host.getByRole('combobox', { name: 'Destination', exact: true })
      await expect(trigger).toContainText('Choose a location')
      await expect(host.getByRole('tree')).toHaveCount(0)
      await trigger.focus()
      await page.keyboard.press('ArrowDown')
      await expect(host.getByRole('treeitem', { name: 'Asia', exact: true })).toBeFocused()
      await page.keyboard.press('ArrowRight')
      await expect(host.getByRole('treeitem', { name: 'China', exact: true })).toBeFocused()
      await page.keyboard.press('ArrowRight')
      await expect(host.getByRole('treeitem', { name: 'Xiamen', exact: true })).toBeFocused()
      await expect(page.locator('[data-cascader-state]')).toContainText('"writes":0')
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await expect(trigger).toBeFocused()
      await expect(trigger).toContainText('Asia / China / Shanghai')
      expect(await formValues(page)).toEqual(['asia', 'china', 'shanghai'])
      await expect(page.locator('[data-cascader-state]')).toContainText('"submits":0')
      await trigger.click()
      await host.getByRole('searchbox').fill('europe / france')
      await expect(host.getByRole('treeitem')).toHaveCount(1)
      await host.getByRole('searchbox').press('Enter')
      expect(await formValues(page)).toEqual(['europe', 'france'])
      await expect(trigger).toBeFocused()
      await host.getByRole('button', { name: 'Clear selection' }).click()
      expect(await formValues(page)).toEqual([])
      await expect(trigger).toBeFocused()
      await page.getByRole('button', { name: 'Submit destination' }).click()
      await expect(page.locator('[data-cascader-state]')).toContainText('"submits":0')
      await expect(trigger).toBeFocused()
      await page.setViewportSize({ width: 180, height: 600 })
      await trigger.click()
      await host.getByRole('treeitem', { name: 'Asia', exact: true }).click()
      await host.getByRole('treeitem', { name: 'China', exact: true }).click()
      const geometry = await host.evaluate((element) => ({
        viewport: window.innerWidth,
        page: document.documentElement.scrollWidth,
        control: element.getBoundingClientRect().width,
        popup: element.querySelector('[data-cascader-panel]')?.getBoundingClientRect().width
      }))
      expect(geometry.page, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.viewport)
      expect(geometry.popup).toBe(geometry.control)
      await page.keyboard.press('Escape')
      await expect(trigger).toBeFocused()
    })
  })
  test(`${target} Cascader reset, invalid values, readonly/disabled and late detached option events preserve authority`, async ({
    page
  }) => {
    await withCascader(page, target, async () => {
      const host = page.locator('[data-openpencil-cascader]').first(),
        trigger = host.getByRole('combobox', { name: 'Destination', exact: true })
      await trigger.click()
      await host.getByRole('searchbox').fill('xiamen')
      await host.getByRole('treeitem').click()
      await page.getByRole('button', { name: 'Toggle readonly' }).click()
      await trigger.click()
      await expect(host.getByRole('tree')).toHaveCount(0)
      expect(await formValues(page)).toEqual(['asia', 'china', 'xiamen'])
      await page.getByRole('button', { name: 'Toggle readonly' }).click()
      await page.getByRole('button', { name: 'Toggle disabled' }).click()
      await expect(trigger).toBeDisabled()
      expect(await formValues(page)).toEqual([])
      await page.getByRole('button', { name: 'Toggle disabled' }).click()
      await page.getByRole('button', { name: 'Toggle cancel reset' }).click()
      await page.getByRole('button', { name: 'Reset destination' }).click()
      expect(await formValues(page)).toEqual(['asia', 'china', 'xiamen'])
      await page.getByRole('button', { name: 'Toggle cancel reset' }).click()
      await page.getByRole('button', { name: 'Reset destination' }).click()
      await expect(trigger).toContainText('Choose a location')
      expect(await formValues(page)).toEqual([])
      await page.getByRole('button', { name: 'Toggle readonly' }).click()
      expect(
        await page
          .locator('#destination-form')
          .evaluate((element: HTMLFormElement) => element.checkValidity())
      ).toBe(true)
      expect(await formValues(page)).toEqual([])
      await trigger.click()
      await expect(host.getByRole('tree')).toHaveCount(0)
      await page.getByRole('button', { name: 'Toggle readonly' }).click()
      expect(
        await page
          .locator('#destination-form')
          .evaluate((element: HTMLFormElement) => element.checkValidity())
      ).toBe(false)
      await page.getByRole('button', { name: 'Malformed value' }).click()
      await expect(trigger).toContainText('—')
      await expect(trigger).toHaveAttribute('aria-invalid', 'true')
      expect(await formValues(page)).toEqual([])
      await trigger.click()
      const stale = await host.getByRole('treeitem', { name: 'Asia', exact: true }).elementHandle()
      await page
        .getByRole('button', { name: 'Replace options' })
        .evaluate((element: HTMLButtonElement) => element.click())
      await stale?.evaluate((element) =>
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      )
      await expect(host.getByRole('tree')).toHaveCount(0)
      await expect(trigger).toBeFocused()
      await expect(page.locator('[data-cascader-state]')).toContainText('"value":["invalid"]')
      await trigger.click()
      await host.getByRole('treeitem', { name: 'New destination', exact: true }).click()
      expect(await formValues(page)).toEqual(['newRoot'])
      await page.getByRole('button', { name: 'Toggle mount' }).click()
      await stale?.evaluate((element) =>
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      )
      await page.getByRole('button', { name: 'Toggle mount' }).click()
      await expect(trigger).toContainText('New destination')
      await expect(page.locator('[data-cascader-state]')).toContainText('"submits":0')
    })
  })
}
