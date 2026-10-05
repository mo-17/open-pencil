import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import {
  reopenApplicationModeDocument,
  waitForApplicationDocument
} from '#tests/helpers/compiler/application-mode/editor'

const editor = useEditorSetup()
test.setTimeout(180_000)

// eslint-disable-next-line no-empty-pattern -- useEditorSetup owns the editor lifecycle.
test('guard drafts apply atomically, undo, reject unsafe fallback, block preview navigation and persist in FIG', async ({}, info) => {
  await editor.page.setViewportSize({ width: 2200, height: 1100 })
  const bytes = JSON.parse(
    execFileSync(
      'bun',
      [
        '-e',
        "import {exportFigFile} from '@open-pencil/core/io/formats/fig';import {applicationGuardsFixture} from './tests/helpers/compiler/application-guards/fixture';const f=applicationGuardsFixture();const policy=structuredClone(f.products.lowcodeApplicationPage);if(!policy)throw new Error('Missing policy');delete policy.enterGuard;delete policy.leaveConfirm;f.graph.updateNode(f.products.id,{lowcodeApplicationPage:policy});process.stdout.write(JSON.stringify([...await exportFigFile(f.graph)]));"
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    )
  ) as number[]
  await reopenApplicationModeDocument(editor.page, bytes)
  const preview = editor.page.locator('iframe[aria-label="lowcode preview"]')
  const runtime = editor.page.frameLocator('iframe[aria-label="lowcode preview"]')
  await expect(runtime.getByText('Home screen', { exact: true })).toBeVisible({ timeout: 60_000 })
  await editor.page
    .getByTestId('pages-item')
    .filter({ hasText: /^Products$/ })
    .click()
  await waitForApplicationDocument(editor.page)
  const panel = editor.page.getByTestId('application-mode-panel')
  const entry = panel.locator('[data-application-guard="enter"]')
  const leave = panel.locator('[data-application-guard="leave"]')
  const expression = entry.getByRole('textbox', { name: 'Allow entry when', exact: true })
  const fallback = entry.getByRole('textbox', { name: 'Denied entry route', exact: true })
  await expression.fill('hasAccess')
  await fallback.fill('/products/42')
  await expect(entry.getByRole('button', { name: 'Apply rule', exact: true })).toBeDisabled()
  await expect(entry.getByRole('alert')).toBeVisible()
  await fallback.fill('/home')
  expect(
    await editor.page.evaluate(
      () =>
        window.openPencil
          ?.getStore?.()
          .graph.getPages()
          .find((page) => page.name === 'Products')?.lowcodeApplicationPage?.enterGuard
    )
  ).toBeUndefined()
  let previousFrame = await preview.getAttribute('src')
  await entry.getByRole('button', { name: 'Apply rule', exact: true }).click()
  await expect(expression).toHaveValue('hasAccess')
  await expect.poll(() => preview.getAttribute('src'), { timeout: 60_000 }).not.toBe(previousFrame)
  previousFrame = await preview.getAttribute('src')
  await editor.page.getByTestId('toolbar').getByRole('button').first().focus()
  await editor.canvas.undo()
  await expect(expression).toHaveValue('')
  await expect.poll(() => preview.getAttribute('src'), { timeout: 60_000 }).not.toBe(previousFrame)
  previousFrame = await preview.getAttribute('src')
  await editor.canvas.redo()
  await expect(expression).toHaveValue('hasAccess')
  await expect.poll(() => preview.getAttribute('src'), { timeout: 60_000 }).not.toBe(previousFrame)
  await leave
    .getByRole('textbox', { name: 'Unsaved changes when', exact: true })
    .fill('detailDraft !== ""')
  await leave
    .getByRole('textbox', { name: 'Confirmation message', exact: true })
    .fill('Leave without saving this draft?')
  previousFrame = await preview.getAttribute('src')
  await leave.getByRole('button', { name: 'Apply rule', exact: true }).click()
  await expect.poll(() => preview.getAttribute('src'), { timeout: 60_000 }).not.toBe(previousFrame)
  await expect(runtime.getByRole('button', { name: 'Open products', exact: true })).toBeVisible({
    timeout: 60_000
  })
  await runtime.getByRole('button', { name: 'Open products', exact: true }).click()
  await expect
    .poll(() =>
      editor.page.evaluate(() => {
        const store = window.openPencil?.getStore?.()
        return store?.graph.getNode(store.state.currentPageId)?.name
      })
    )
    .toBe('Products')
  await expect
    .poll(() => runtime.getByPlaceholder('Detail draft').evaluate(() => location.hash))
    .toBe('#/products/42')
  await waitForApplicationDocument(editor.page)
  await runtime.getByPlaceholder('Detail draft').fill('editor preview draft')
  await expect(runtime.getByPlaceholder('Detail draft')).toHaveValue('editor preview draft')
  previousFrame = await preview.getAttribute('src')
  const dialog = runtime.getByRole('dialog', { name: 'Leave this page?', exact: true })
  await waitForApplicationDocument(editor.page)
  await editor.page
    .getByTestId('pages-item')
    .filter({ hasText: /^Home$/ })
    .click()
  await waitForApplicationDocument(editor.page)
  await expect(dialog).toBeVisible()
  await expect(preview).toHaveAttribute('src', previousFrame ?? '')
  await dialog.getByRole('button', { name: 'Stay', exact: true }).click()
  await expect(runtime.getByPlaceholder('Detail draft')).toHaveValue('editor preview draft')
  await expect
    .poll(() =>
      editor.page.evaluate(() => {
        const store = window.openPencil?.getStore?.()
        return store?.graph.getNode(store.state.currentPageId)?.name
      })
    )
    .toBe('Products')
  await runtime.getByRole('button', { name: 'Back to previous page', exact: true }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Stay', exact: true }).click()
  await expect(runtime.getByPlaceholder('Detail draft')).toHaveValue('editor preview draft')
  await runtime.getByRole('button', { name: 'Back to previous page', exact: true }).click()
  await dialog.getByRole('button', { name: 'Leave page', exact: true }).click()
  await expect(runtime.getByPlaceholder('Filter products')).toBeVisible()
  await waitForApplicationDocument(editor.page)
  const downloading = editor.page.waitForEvent('download')
  await editor.page.getByTestId('toolbar').getByRole('button').first().focus()
  await editor.page.keyboard.press('Meta+s')
  const file = info.outputPath('application-guards.fig')
  const download = await downloading
  await download.saveAs(file)
  expect(await download.failure()).toBeNull()
  await reopenApplicationModeDocument(editor.page, [...(await readFile(file))])
  await expect(runtime.getByText('Home screen', { exact: true })).toBeVisible({ timeout: 60_000 })
  await editor.page
    .getByTestId('pages-item')
    .filter({ hasText: /^Products$/ })
    .click()
  await waitForApplicationDocument(editor.page)
  await expect(expression).toHaveValue('hasAccess')
  await expect(
    leave.getByRole('textbox', { name: 'Unsaved changes when', exact: true })
  ).toHaveValue('detailDraft !== ""')
  await editor.page
    .locator('iframe[aria-label="lowcode preview"]')
    .screenshot({ path: info.outputPath('application-guards-preview.png') })
  editor.canvas.assertNoErrors()
})
