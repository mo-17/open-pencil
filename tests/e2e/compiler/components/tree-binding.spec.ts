import { execFileSync } from 'node:child_process'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'
import type { TreeBindingVariant } from '#tests/helpers/compiler/components/tree-binding/fixture'
import { parseCompilerFiles } from '#tests/helpers/compiler/output'

async function withTreeBinding(
  page: Page,
  target: 'react' | 'vue',
  variant: TreeBindingVariant,
  run: () => Promise<void>
) {
  const source = `import {treeBindingFixture} from './tests/helpers/compiler/components/tree-binding/fixture';const result=treeBindingFixture(${JSON.stringify(target)},${JSON.stringify(variant)});if(result.warnings.length)throw new Error(JSON.stringify(result.warnings));process.stdout.write(JSON.stringify([...result.files]));`
  const files = parseCompilerFiles(
    execFileSync('bun', ['-e', source], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
  )
  await withComponentTemplateFiles(page, target, new Map(files), run)
}

function submittedValues(form: Locator, name: string): Promise<string[]> {
  return form.evaluate(
    (element, key) => new FormData(element as HTMLFormElement).getAll(key) as string[],
    name
  )
}

async function expectValues(form: Locator, name: string, values: string[]): Promise<void> {
  await expect.poll(() => submittedValues(form, name)).toEqual(values)
}

test.setTimeout(120_000)
test.use({ viewport: { width: 1440, height: 1000 } })

for (const target of ['react', 'vue'] as const) {
  test(`${target} force-focused disabled Archive Enter and Space preserve bound Development`, async ({
    page
  }) => {
    await withTreeBinding(page, target, 'state-flags', async () => {
      const form = page.getByRole('form', { name: 'Flag form' }),
        tree = form.getByRole('tree', { name: 'Flag tree' }),
        development = tree.getByRole('treeitem', { name: 'Development', exact: true }),
        archive = tree.getByRole('treeitem', { name: 'Archive', exact: true }),
        business = form.getByRole('status', { name: 'Business selection' })
      await development.click()
      await expect(development).toHaveAttribute('aria-selected', 'true')
      await expect(business).toHaveText('development')
      for (const key of ['Enter', 'Space']) {
        await archive.focus()
        await expect(archive).toBeFocused()
        await archive.press(key)
        await expect(archive).toHaveAttribute('aria-disabled', 'true')
        await expect(archive).toHaveAttribute('aria-selected', 'false')
        await expect(development).toHaveAttribute('aria-selected', 'true')
        await expect(business).toHaveText('development')
        await expectValues(form, 'category', ['development'])
      }
    })
  })

  test(`${target} Tree outer disabled closes active TreeSelect and readonly still permits hierarchy navigation`, async ({
    page
  }) => {
    await withTreeBinding(page, target, 'state-flags', async () => {
      const form = page.getByRole('form', { name: 'Flag form' }),
        tree = form.locator('[data-openpencil-tree]'),
        root = tree.getByRole('treeitem', { name: 'Project', exact: true }),
        business = form.getByRole('status', { name: 'Business selection' })
      await expectValues(form, 'category', ['design'])
      await tree.getByRole('button', { name: 'Collapse Project' }).click()
      await expect(root).toHaveAttribute('aria-expanded', 'false')
      await page.getByRole('button', { name: 'Outer readonly', exact: true }).click()
      await expect(tree.getByRole('tree')).toHaveAttribute('aria-readonly', 'true')
      await tree.getByRole('button', { name: 'Expand Project' }).click()
      await root.press('ArrowRight')
      await expect(tree.getByRole('treeitem', { name: 'Design', exact: true })).toBeFocused()
      await page.keyboard.press('End')
      await expect(tree.getByRole('treeitem', { name: 'Development', exact: true })).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(business).toHaveText('design')
      await expectValues(form, 'category', ['design'])
      await page.getByRole('button', { name: 'Outer disabled', exact: true }).click()
      await expect(tree.getByRole('tree')).toHaveAttribute('tabindex', '-1')
      for (const row of await tree.getByRole('treeitem').all()) {
        await expect(row).toHaveAttribute('aria-disabled', 'true')
        await expect(row).toHaveAttribute('tabindex', '-1')
      }
      await expect(tree.getByRole('button', { name: 'Collapse Project' })).toBeDisabled()
      await root.press('ArrowLeft')
      await expect(root).toHaveAttribute('aria-expanded', 'true')
      await expect(business).toHaveText('design')
      await expectValues(form, 'category', [])
      await page.getByRole('button', { name: 'Outer disabled', exact: true }).click()
      await expectValues(form, 'category', ['design'])
      await page.getByRole('button', { name: 'Presentation', exact: true }).click()
      const trigger = tree.getByRole('combobox', { name: 'Flag tree' })
      await trigger.press('ArrowDown')
      await expect(tree.getByRole('tree')).toBeVisible()
      await expect(tree.getByRole('treeitem', { name: 'Project', exact: true })).toBeFocused()
      await page.getByRole('button', { name: 'Outer disabled', exact: true }).click()
      await expect(trigger).toBeDisabled()
      await expect(trigger).toHaveAttribute('aria-expanded', 'false')
      await expect(tree.getByRole('tree')).toHaveCount(0)
      await trigger.press('ArrowDown')
      await expect(tree.getByRole('tree')).toHaveCount(0)
      await page.getByRole('button', { name: 'Outer disabled', exact: true }).click()
      await expect(trigger).toBeEnabled()
      await expect(trigger).toHaveAttribute('aria-expanded', 'false')
      await expect(tree.getByRole('tree')).toHaveCount(0)
      await expectValues(form, 'category', ['design'])
    })
  })

  test(`${target} compiled Tree fields keep page and document state, FormData, reset and two FORM owners in sync`, async ({
    page
  }) => {
    await withTreeBinding(page, target, 'base', async () => {
      const first = page.locator('form').first(),
        second = page.locator('form').nth(1),
        firstTree = first.locator('[data-openpencil-tree]').first(),
        firstSelect = first.locator('[data-openpencil-tree]').nth(1),
        secondSelect = second.locator('[data-openpencil-tree]').first()
      await expect(page.locator('form')).toHaveCount(2)
      await expectValues(first, 'categories', ['design'])
      await expectValues(first, 'oneDoc', ['project'])
      await expectValues(second, 'onePage', ['design'])
      await expectValues(second, 'manyDoc', ['project'])
      await expect(firstTree.getByRole('treeitem', { name: 'Design' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
      const design = firstTree.getByRole('treeitem', { name: 'Design' }),
        development = firstTree.getByRole('treeitem', { name: 'Development' })
      await design.click()
      await expectValues(first, 'categories', [])
      await expect(design).toBeFocused()
      await page.keyboard.press('ArrowDown')
      await expect(development).toBeFocused()
      await page.keyboard.press('Space')
      await expectValues(first, 'categories', ['development'])
      await expect(development).toBeFocused()
      await first.evaluate((element) => (element as HTMLFormElement).reset())
      await expectValues(first, 'categories', ['design'])
      await firstTree.getByRole('treeitem', { name: 'Development' }).focus()
      await page.keyboard.press('Space')
      await expectValues(first, 'categories', ['design', 'development'])
      await expectValues(second, 'manyDoc', ['project'])
      await firstSelect.getByRole('button', { name: 'Clear selection' }).click()
      await expectValues(first, 'oneDoc', [''])
      expect(await first.evaluate((element) => (element as HTMLFormElement).checkValidity())).toBe(
        false
      )
      await first.getByRole('button', { name: 'Submit first' }).click()
      await expect(page.getByText('First:/0', { exact: true })).toBeVisible()
      await firstSelect.getByRole('combobox', { name: 'Document tree select' }).click()
      await firstSelect.getByRole('treeitem', { name: 'Development' }).click()
      await expectValues(first, 'oneDoc', ['development'])
      await first.getByRole('button', { name: 'Submit first' }).click()
      await expect(page.getByText('First:development/1', { exact: true })).toBeVisible()
      await first.evaluate((element) => {
        element.addEventListener('reset', (event) => event.preventDefault(), { once: true })
        ;(element as HTMLFormElement).reset()
      })
      await expectValues(first, 'categories', ['design', 'development'])
      await expectValues(first, 'oneDoc', ['development'])
      await first.evaluate((element) => (element as HTMLFormElement).reset())
      await expectValues(first, 'categories', ['design'])
      await expectValues(first, 'oneDoc', ['project'])
      await expectValues(second, 'onePage', ['design'])
      await page.getByRole('button', { name: 'External page value' }).click()
      await expect(secondSelect.getByRole('combobox', { name: 'Page tree select' })).toContainText(
        'Development'
      )
      await expectValues(second, 'onePage', ['development'])
      await expectValues(first, 'categories', ['design'])
    })
  })

  test(`${target} compiled Tree rejects unknown keys without showing authored defaults, then allows user repair`, async ({
    page
  }) => {
    await withTreeBinding(page, target, 'invalid', async () => {
      const first = page.locator('form').first(),
        tree = first.locator('[data-openpencil-tree]').first(),
        select = first.locator('[data-openpencil-tree]').nth(1)
      await expect(tree.locator('[data-tree-output]')).toContainText('—')
      await expect(select.locator('[data-tree-output]')).toContainText('—')
      await expectValues(first, 'categories', [])
      await expectValues(first, 'oneDoc', [])
      expect(await first.evaluate((element) => (element as HTMLFormElement).checkValidity())).toBe(
        false
      )
      await first.getByRole('button', { name: 'Submit first' }).click()
      await expect(page.getByText('First:missing/0', { exact: true })).toBeVisible()
      await tree.getByRole('treeitem', { name: 'Design' }).click()
      await select.getByRole('combobox', { name: 'Document tree select' }).click()
      await select.getByRole('treeitem', { name: 'Development' }).click()
      await expectValues(first, 'categories', ['design'])
      await expectValues(first, 'oneDoc', ['development'])
      await first.getByRole('button', { name: 'Submit first' }).click()
      await expect(page.getByText('First:development/1', { exact: true })).toBeVisible()
    })
  })

  test(`${target} controlled multiple TreeSelect keeps its popup and keyboard focus after a value write`, async ({
    page
  }) => {
    await withTreeBinding(page, target, 'multi-select', async () => {
      const second = page.locator('form').nth(1),
        select = second.locator('[data-openpencil-tree]').nth(1),
        trigger = select.getByRole('combobox', { name: 'Document tree' })
      await expectValues(second, 'manyDoc', ['project'])
      await trigger.click()
      const design = select.getByRole('treeitem', { name: 'Design' }),
        development = select.getByRole('treeitem', { name: 'Development' })
      await design.click()
      await expectValues(second, 'manyDoc', ['project', 'design'])
      await expect(select.getByRole('tree')).toBeVisible()
      await expect(design).toBeFocused()
      await page.keyboard.press('ArrowDown')
      await expect(development).toBeFocused()
      await page.keyboard.press('Space')
      await expectValues(second, 'manyDoc', ['project', 'design', 'development'])
      await expect(select.getByRole('tree')).toBeVisible()
    })
  })

  test(`${target} readonly TreeSelect serializes while disabled Tree is omitted and neither writes`, async ({
    page
  }) => {
    await withTreeBinding(page, target, 'flags', async () => {
      const second = page.locator('form').nth(1),
        select = second.locator('[data-openpencil-tree]').first(),
        tree = second.locator('[data-openpencil-tree]').nth(1)
      await expectValues(second, 'onePage', ['design'])
      await expectValues(second, 'manyDoc', [])
      const trigger = select.getByRole('combobox', { name: 'Page tree select' })
      await expect(trigger).toHaveAttribute('aria-readonly', 'true')
      await trigger.click()
      await select.getByRole('treeitem', { name: 'Development' }).click()
      await expectValues(second, 'onePage', ['design'])
      await expect(tree.getByRole('tree')).toHaveAttribute('aria-disabled', 'true')
      await tree
        .getByRole('treeitem', { name: 'Project' })
        .evaluate((element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
      await expectValues(second, 'manyDoc', [])
      await second.getByRole('button', { name: 'Submit second' }).click()
      await expect(page.getByText('Second:design/1', { exact: true })).toBeVisible()
    })
  })
}
