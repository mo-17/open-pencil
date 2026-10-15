import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import {
  reopenApplicationModeDocument,
  waitForApplicationDocument
} from '#tests/helpers/compiler/application-mode/editor'
import { chooseAppSelect } from '#tests/helpers/properties'
import { parseJSONBytes } from '#tests/helpers/serialization'

const editor = useEditorSetup()
test.setTimeout(180_000)

// eslint-disable-next-line no-empty-pattern -- useEditorSetup owns the editor lifecycle.
test('page recovery preference, undo, automatic recompilation, restart and real FIG save/reopen', async ({}, info) => {
  await editor.page.setViewportSize({ width: 2200, height: 1100 })
  const bytes = parseJSONBytes(
    execFileSync(
      'bun',
      [
        '-e',
        "import {exportFigFile} from '@open-pencil/core/io/formats/fig';import {applicationSessionFixture} from './tests/helpers/compiler/application-session/fixture';const fixture=applicationSessionFixture('preserve');const policy=structuredClone(fixture.home.lowcodeApplicationPage);if(!policy)throw new Error('Missing page policy');delete policy.stateRetention;fixture.graph.updateNode(fixture.home.id,{lowcodeApplicationPage:policy});process.stdout.write(JSON.stringify([...await exportFigFile(fixture.graph)]));"
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    )
  )
  await reopenApplicationModeDocument(editor.page, bytes)
  const panel = editor.page.getByTestId('application-mode-panel')
  const preview = editor.page.locator('iframe[aria-label="lowcode preview"]')
  const runtime = editor.page.frameLocator('iframe[aria-label="lowcode preview"]')
  await expect(runtime.getByText('Home screen', { exact: true })).toBeVisible({ timeout: 60_000 })
  await editor.page
    .getByTestId('pages-item')
    .filter({ hasText: /^Home$/ })
    .click()
  await waitForApplicationDocument(editor.page)
  const retention = panel.getByRole('combobox', { name: 'Page state on return', exact: true })
  await expect(retention).toContainText('Not set (original behavior)')
  let before = await preview.getAttribute('src')
  await chooseAppSelect(editor.page, retention, 'Reset on each visit')
  await expect(retention).toContainText('Reset on each visit')
  await expect.poll(() => preview.getAttribute('src'), { timeout: 60_000 }).not.toBe(before)
  await expect(runtime.getByPlaceholder('Filter products')).toBeVisible({ timeout: 60_000 })
  expect(
    await editor.page.evaluate(() => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const store = window.openPencil?.getStore?.()
      return store?.graph.getPages().find((page) => page.name === 'Home')?.lowcodeApplicationPage
        ?.stateRetention
    })
  ).toBe('reset')
  before = await preview.getAttribute('src')
  await editor.page.getByTestId('toolbar').getByRole('button').first().focus()
  await editor.canvas.undo()
  await expect(retention).toContainText('Not set (original behavior)')
  await expect.poll(() => preview.getAttribute('src'), { timeout: 60_000 }).not.toBe(before)
  await expect(runtime.getByPlaceholder('Filter products')).toBeVisible({ timeout: 60_000 })
  before = await preview.getAttribute('src')
  await chooseAppSelect(editor.page, retention, 'Preserve during this session')
  await expect(retention).toContainText('Preserve during this session')
  await expect.poll(() => preview.getAttribute('src'), { timeout: 60_000 }).not.toBe(before)
  await expect(runtime.getByPlaceholder('Filter products')).toBeVisible({ timeout: 60_000 })
  before = await preview.getAttribute('src')
  await chooseAppSelect(editor.page, retention, 'Reset on each visit')
  await expect(retention).toContainText('Reset on each visit')
  await expect.poll(() => preview.getAttribute('src'), { timeout: 60_000 }).not.toBe(before)
  await expect(runtime.getByPlaceholder('Filter products')).toBeVisible({ timeout: 60_000 })
  await runtime.getByPlaceholder('Filter products').fill('discarded after explicit reset')
  await runtime.getByRole('button', { name: 'Next list page', exact: true }).click()
  await runtime.getByRole('button', { name: 'Open second query', exact: true }).click()
  await expect(runtime.getByPlaceholder('Filter products')).toHaveValue('')
  await expect(runtime.getByText('Page: 1', { exact: true })).toBeVisible()
  await runtime.getByPlaceholder('Filter products').fill('second discarded draft')
  await runtime.getByRole('button', { name: 'Open first query', exact: true }).click()
  await expect(runtime.getByPlaceholder('Filter products')).toHaveValue('')
  await waitForApplicationDocument(editor.page)
  before = await preview.getAttribute('src')
  await editor.page.getByTestId('toolbar').getByRole('button').first().focus()
  await editor.canvas.undo()
  await expect(retention).toContainText('Preserve during this session')
  await expect.poll(() => preview.getAttribute('src'), { timeout: 60_000 }).not.toBe(before)
  await expect(runtime.getByPlaceholder('Filter products')).toBeVisible({ timeout: 60_000 })
  await runtime.getByPlaceholder('Filter products').fill('pending order')
  await runtime.getByRole('button', { name: 'Next list page', exact: true }).click()
  await expect(runtime.getByText('Page: 2', { exact: true })).toBeVisible()
  await runtime.getByRole('button', { name: 'Open products', exact: true }).click()
  await expect(runtime.getByPlaceholder('Detail draft')).toBeVisible()
  await runtime.getByPlaceholder('Detail draft').fill('product 42 draft')
  await waitForApplicationDocument(editor.page)
  before = await preview.getAttribute('src')
  // Edit the authored document through the same undo action used by property controls.
  await editor.page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const store = window.openPencil?.getStore?.()
    const title = [...(store?.graph.getAllNodes() ?? [])].find(
      (node) => node.name === 'Products title'
    )
    if (!store || !title) throw new Error('Product title unavailable')
    store.updateNodeWithUndo(title.id, { text: 'Products screen updated' })
  })
  await expect.poll(() => preview.getAttribute('src'), { timeout: 60_000 }).not.toBe(before)
  await expect(runtime.getByText('Products screen updated', { exact: true })).toBeVisible({
    timeout: 60_000
  })
  await expect(runtime.getByPlaceholder('Detail draft')).toHaveValue('product 42 draft')
  await runtime.getByRole('button', { name: 'Back to previous page', exact: true }).click()
  await expect(runtime.getByPlaceholder('Filter products')).toHaveValue('pending order')
  await expect(runtime.getByText('Page: 2', { exact: true })).toBeVisible()
  await waitForApplicationDocument(editor.page)
  const downloading = editor.page.waitForEvent('download')
  await editor.page.getByTestId('toolbar').getByRole('button').first().focus()
  await editor.page.keyboard.press('Meta+s')
  const file = info.outputPath('application-session.fig')
  const download = await downloading
  await download.saveAs(file)
  expect(await download.failure()).toBeNull()
  await editor.page.getByRole('button', { name: '↻', exact: true }).click()
  await expect(runtime.getByPlaceholder('Filter products')).toHaveValue('', { timeout: 60_000 })
  await expect(runtime.getByText('Page: 1', { exact: true })).toBeVisible()
  await reopenApplicationModeDocument(editor.page, [...(await readFile(file))])
  await expect(runtime.getByText('Home screen', { exact: true })).toBeVisible({ timeout: 60_000 })
  await editor.page
    .getByTestId('pages-item')
    .filter({ hasText: /^Home$/ })
    .click()
  await waitForApplicationDocument(editor.page)
  await expect(retention).toContainText('Preserve during this session')
  await expect(runtime.getByPlaceholder('Filter products')).toHaveValue('')
  await editor.page.screenshot({
    path: info.outputPath('application-session-editor.png'),
    fullPage: true
  })
  editor.canvas.assertNoErrors()
})
