import { execFileSync } from 'node:child_process'

import { expect, test, type Page } from '@playwright/test'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'
import { parseCompilerFiles } from '#tests/helpers/compiler/output'

type Target = 'react' | 'vue'

async function withNumberBinding(
  page: Page,
  target: Target,
  required: boolean,
  run: () => Promise<void>,
  remote = false
): Promise<void> {
  const script = `import {numberBindingFixture} from './tests/helpers/compiler/components/input-control/number-binding'; const result=numberBindingFixture(${JSON.stringify(target)}, ${required}, undefined, ${remote}); if(result.warnings.length) throw new Error(JSON.stringify(result.warnings)); process.stdout.write(JSON.stringify([...result.files]));`
  const files = parseCompilerFiles(
    execFileSync('bun', ['-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
  )
  await withComponentTemplateFiles(page, target, new Map(files), run)
}

for (const target of ['react', 'vue'] as const) {
  test(`${target} compiled number bindings keep required drafts invalid and reset both state scopes`, async ({
    page
  }) => {
    await withNumberBinding(page, target, true, async () => {
      const pageInput = page.getByRole('spinbutton', { name: 'Page number' })
      const documentInput = page.getByRole('spinbutton', { name: 'Document number' })
      const submit = page.getByRole('button', { name: 'Submit numbers' })
      const state = (pageValue: number, documentValue: number, count = 0) =>
        page.getByText(`Page[${pageValue}] Doc[${documentValue}] Submitted[${count}]`, {
          exact: true
        })

      await expect(state(2, 4)).toBeVisible()
      await pageInput.fill('')
      await submit.click()
      await expect(pageInput).toHaveValue('')
      await expect(state(2, 4)).toBeVisible()
      expect(
        await pageInput.evaluate((input: HTMLInputElement) => input.validity.valueMissing)
      ).toBe(true)

      await pageInput.fill('0')
      await documentInput.fill('')
      await submit.click()
      await expect(documentInput).toHaveValue('')
      await expect(state(0, 4)).toBeVisible()
      expect(await documentInput.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(
        false
      )

      await documentInput.fill('0')
      await expect(state(0, 0)).toBeVisible()
      await pageInput.fill('1.')
      await expect(state(0, 0)).toBeVisible()
      expect(
        await pageInput.evaluate((input: HTMLInputElement) => input.validity.customError)
      ).toBe(true)
      expect(await pageInput.evaluate((input: HTMLInputElement) => input.validationMessage)).toBe(
        'Please enter a complete number.'
      )
      await page.evaluate(() => {
        document.documentElement.lang = 'zh-CN'
      })
      await pageInput.fill('0')
      await pageInput.fill('1.')
      expect(await pageInput.evaluate((input: HTMLInputElement) => input.validationMessage)).toBe(
        '请输入完整的数字。'
      )
      await pageInput.blur()
      await expect(pageInput).toHaveAttribute('aria-invalid', 'true')
      await submit.click()
      await expect(state(0, 0)).toBeVisible()

      await pageInput.fill('')
      await pageInput.pressSequentially('-')
      expect(await pageInput.evaluate((input: HTMLInputElement) => input.validity.badInput)).toBe(
        true
      )
      await expect(state(0, 0)).toBeVisible()
      await pageInput.fill('-0.5')
      await documentInput.fill('-0.5')
      await expect(pageInput).toHaveValue('-0.5')
      await expect(documentInput).toHaveValue('-0.5')
      await expect(state(-0.5, -0.5)).toBeVisible()

      await page.locator('form').evaluate((form: HTMLFormElement) => form.reset())
      await expect(pageInput).toHaveValue('2')
      await expect(documentInput).toHaveValue('4')
      await expect(state(2, 4)).toBeVisible()

      await pageInput.fill('')
      await page.getByRole('button', { name: 'Set page externally' }).click()
      await expect(pageInput).toHaveValue('7')
      await expect(state(7, 4)).toBeVisible()
      await expect(page.getByText('Page number required', { exact: true })).toHaveCount(0)
    })
  })

  test(`${target} compiled optional numbers rebase drafts before submit and respect native constraints`, async ({
    page
  }) => {
    await withNumberBinding(page, target, false, async () => {
      const pageInput = page.getByRole('spinbutton', { name: 'Page number' })
      const documentInput = page.getByRole('spinbutton', { name: 'Document number' })
      const submit = page.getByRole('button', { name: 'Submit numbers' })
      const state = (pageValue: number, documentValue: number, count: number) =>
        page.getByText(`Page[${pageValue}] Doc[${documentValue}] Submitted[${count}]`, {
          exact: true
        })

      await pageInput.fill('')
      await expect(pageInput).toHaveValue('')
      await expect(state(2, 4, 0)).toBeVisible()
      await submit.click()
      await expect(pageInput).toHaveValue('2')
      await expect(state(2, 4, 1)).toBeVisible()

      await documentInput.fill('')
      await submit.click()
      await expect(documentInput).toHaveValue('4')
      await expect(state(2, 4, 2)).toBeVisible()

      await pageInput.fill('0')
      await documentInput.fill('0')
      await expect(state(0, 0, 2)).toBeVisible()
      await pageInput.fill('1.')
      await expect(state(0, 0, 2)).toBeVisible()
      await pageInput.blur()
      await expect(pageInput).toHaveValue('0')

      await pageInput.fill('11')
      expect(
        await pageInput.evaluate((input: HTMLInputElement) => input.validity.rangeOverflow)
      ).toBe(true)
      await submit.click()
      await expect(state(11, 0, 2)).toBeVisible()
      await pageInput.fill('0.3')
      expect(
        await pageInput.evaluate((input: HTMLInputElement) => input.validity.stepMismatch)
      ).toBe(true)
      await submit.click()
      await expect(state(0.3, 0, 2)).toBeVisible()

      await pageInput.fill('0')
      await pageInput.press('ArrowUp')
      await expect(pageInput).toHaveValue('0.5')
      await expect(state(0.5, 0, 2)).toBeVisible()
      await page.getByRole('button', { name: 'Increase value' }).click()
      await expect(documentInput).toHaveValue('0.5')
      await expect(state(0.5, 0.5, 2)).toBeVisible()

      await page.locator('form').evaluate((form: HTMLFormElement) => {
        form.addEventListener('reset', (event) => event.preventDefault(), { once: true })
        form.reset()
      })
      await page.waitForTimeout(30)
      await expect(pageInput).toHaveValue('0.5')
      await expect(documentInput).toHaveValue('0.5')
      await expect(state(0.5, 0.5, 2)).toBeVisible()
    })
  })
}

test('React incomplete number draft remains invalid on blur without remote validation', async ({
  page
}) => {
  let requests = 0
  await page.route('https://validation.example.test/number', async (route) => {
    requests++
    await route.fulfill({ json: { valid: true } })
  })
  await withNumberBinding(
    page,
    'react',
    true,
    async () => {
      const input = page.getByRole('spinbutton', { name: 'Page number' })
      await input.fill('1.')
      await input.blur()
      await expect(input).toHaveAttribute('aria-invalid', 'true')
      await expect(page.getByText('Please enter a complete number.')).toBeVisible()
      await page.waitForTimeout(300)
      expect(requests).toBe(0)
      await input.fill('2')
      await input.blur()
      await expect.poll(() => requests).toBe(1)
      await expect(input).toHaveAttribute('aria-invalid', 'false')
    },
    true
  )
})
