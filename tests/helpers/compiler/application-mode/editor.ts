import { execFileSync } from 'node:child_process'

import { expect, type Page } from '@playwright/test'
import * as v from 'valibot'

/** Load a real exported design fixture; subsequent changes are ordinary user interactions. */
export async function openApplicationModeDocument(page: Page): Promise<void> {
  const bytes = v.parse(
    v.pipe(v.string(), v.parseJson(), v.array(v.number())),
    execFileSync(
      'bun',
      [
        '-e',
        "import {exportFigFile} from '@open-pencil/core/io/formats/fig'; import {applicationModeFixture} from './tests/helpers/compiler/application-mode/fixture'; process.stdout.write(JSON.stringify([...await exportFigFile(applicationModeFixture().graph)]));"
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    )
  )
  await page.evaluate(async (data) => {
    const api = window.openPencil
    if (!api) throw new Error('OpenPencil test host unavailable')

    const editor = api?.getStore?.()
    if (!editor) throw new Error('Editor not initialized')
    await editor.openFigFile(new File([new Uint8Array(data)], 'application-mode-acceptance.fig'))
    editor.clearSelection()
  }, bytes)
  await waitForApplicationDocument(page)
}

export async function reopenApplicationModeDocument(page: Page, bytes: number[]): Promise<void> {
  await page.evaluate(async (data) => {
    const api = window.openPencil
    if (!api) throw new Error('OpenPencil test host unavailable')

    const editor = api?.getStore?.()
    if (!editor) throw new Error('Editor not initialized')
    await editor.openFigFile(new File([new Uint8Array(data)], 'application-mode-reopened.fig'))
    editor.clearSelection()
  }, bytes)
  await waitForApplicationDocument(page)
}

export async function waitForApplicationDocument(page: Page): Promise<void> {
  await expect(
    page.getByRole('progressbar', { name: 'Preparing document', exact: true })
  ).toHaveCount(0, { timeout: 60_000 })
  await expect(page.getByRole('status', { name: 'Preparing canvas', exact: true })).not.toBeVisible(
    { timeout: 60_000 }
  )
}
