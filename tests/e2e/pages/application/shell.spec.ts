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
test.setTimeout(120_000)

// eslint-disable-next-line no-empty-pattern -- useEditorSetup owns the persistent editor.
test('shared layout drafts, atomic undo, navigation and real FIG save/reopen', async ({}, info) => {
  await editor.page.setViewportSize({ width: 2200, height: 1100 })
  const bytes = parseJSONBytes(
    execFileSync(
      'bun',
      [
        '-e',
        "import {exportFigFile} from '@open-pencil/core/io/formats/fig';import {applicationShellFixture} from './tests/helpers/compiler/application-shell/fixture';process.stdout.write(JSON.stringify([...await exportFigFile(applicationShellFixture('desktop',false).graph)]));"
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    )
  )
  await reopenApplicationModeDocument(editor.page, bytes)
  const settings = editor.page.getByTestId('application-shell-settings')
  const frame = settings.getByRole('combobox', { name: 'Shared shell frame', exact: true })
  const slot = settings.getByRole('combobox', { name: 'Content slot', exact: true })
  const apply = settings.getByRole('button', { name: 'Apply shell', exact: true })
  const remove = settings.getByRole('button', { name: 'Remove shell', exact: true })
  const runtime = editor.page.frameLocator('iframe[aria-label="lowcode preview"]')
  await expect(runtime.getByText('Home screen', { exact: true })).toBeVisible({ timeout: 60_000 })
  await chooseAppSelect(editor.page, frame, 'Reference / Desktop shared layout')
  await chooseAppSelect(editor.page, slot, 'Page column / Page content')
  await expect(apply).toBeEnabled()
  await expect(runtime.getByRole('button', { name: 'Products', exact: true })).toHaveCount(0)
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(apply).toBeDisabled()
  await chooseAppSelect(editor.page, frame, 'Reference / Desktop shared layout')
  await chooseAppSelect(editor.page, slot, 'Page column / Page content')
  await apply.click()
  await expect(runtime.getByRole('button', { name: 'Products', exact: true })).toBeVisible({
    timeout: 60_000
  })
  await editor.page.getByTestId('toolbar').getByRole('button').first().focus()
  await editor.canvas.undo()
  await expect(remove).toHaveCount(0)
  // Observe the completed preview change before redo replaces its frame again.
  await expect(runtime.getByRole('button', { name: 'Products', exact: true })).toHaveCount(0, {
    timeout: 60_000
  })
  await editor.canvas.redo()
  await expect(remove).toBeVisible()
  await expect(runtime.getByRole('button', { name: 'Products', exact: true })).toBeVisible({
    timeout: 60_000
  })
  await runtime.getByRole('button', { name: 'Products', exact: true }).click()
  await expect(runtime.getByText('Products screen', { exact: true })).toBeVisible({
    timeout: 60_000
  })
  await waitForApplicationDocument(editor.page)
  await expect(frame).toContainText('Desktop shared layout')
  const downloading = editor.page.waitForEvent('download')
  await editor.page.getByTestId('toolbar').getByRole('button').first().focus()
  await editor.page.keyboard.press('Meta+s')
  const file = info.outputPath('application-shell.fig')
  const download = await downloading
  await download.saveAs(file)
  expect(await download.failure()).toBeNull()
  await remove.click()
  await expect(runtime.getByRole('button', { name: 'Products', exact: true })).toHaveCount(0, {
    timeout: 60_000
  })
  await reopenApplicationModeDocument(editor.page, [...(await readFile(file))])
  await expect(frame).toContainText('Desktop shared layout')
  await expect(slot).toContainText('Page content')
  await expect(runtime.getByText('Home screen', { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(runtime.getByRole('button', { name: 'Products', exact: true })).toBeVisible()
  const slotChildren = await editor.page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return [...(window.openPencil?.getStore?.().graph.getAllNodes() ?? [])].find(
      (node) => node.name === 'Page content'
    )?.childIds.length
  })
  expect(slotChildren).toBe(0)
  await editor.page.screenshot({
    path: info.outputPath('application-shell-editor.png'),
    fullPage: true
  })
  editor.canvas.assertNoErrors()
})
