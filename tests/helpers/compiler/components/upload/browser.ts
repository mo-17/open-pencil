import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, type Page } from '@playwright/test'

import type { PreviewServer } from '@open-pencil/compiler/dev-server'

import type { UploadScenario } from './fixtures'

export async function withLocalUpload(
  page: Page,
  target: 'react' | 'vue',
  scenario: UploadScenario,
  run: () => Promise<void>
): Promise<void> {
  const source = `import {localUploadFixture} from './tests/helpers/compiler/components/upload/fixtures'; const output = localUploadFixture(${JSON.stringify(target)}, ${JSON.stringify(scenario)}); if(output.warnings.length) throw new Error(JSON.stringify(output.warnings)); process.stdout.write(JSON.stringify([...output.files]));`
  const files = JSON.parse(
    execFileSync('bun', ['-e', source], { cwd: process.cwd(), encoding: 'utf8' })
  ) as [string, string][]
  const { createPreviewServer } = await import(
    pathToFileURL(join(process.cwd(), 'packages/compiler/dist/dev-server.mjs')).href
  )
  const server: PreviewServer = await createPreviewServer({ target, initialFiles: new Map(files) })
  const errors: string[] = []
  const capture = (error: Error) => errors.push(error.message)
  page.on('pageerror', capture)
  try {
    await page.goto(server.url, { waitUntil: 'networkidle' })
    await run()
    expect(errors).toEqual([])
  } finally {
    page.off('pageerror', capture)
    await page.goto('about:blank')
    await server.close()
  }
}

export async function chooseLocalFiles(page: Page, names: string[]): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Choose local files', exact: true }).click()
  const chooser = await chooserPromise
  await chooser.setFiles(
    names.map((name) => ({
      name,
      mimeType: name.endsWith('.txt') ? 'text/plain' : 'image/png',
      buffer: Buffer.from(name.startsWith('large') ? '123456789' : '123')
    }))
  )
}

/** Stable metadata mirrors reselecting the same on-disk file without reading it. */
export async function changeLocalFiles(page: Page, names: string[]): Promise<void> {
  await page.locator('input[type="file"]').evaluate((element, values) => {
    const transfer = new DataTransfer()
    for (const name of values) {
      transfer.items.add(new File(['123'], name, { type: 'text/plain', lastModified: 1000 }))
    }
    const input = element as HTMLInputElement
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, names)
}

export async function dragLocalFile(page: Page, kind: 'dragenter' | 'dragover' | 'drop') {
  return page.locator('[data-openpencil-upload-root]').evaluate((element, eventName) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['123'], 'dropped.txt', { type: 'text/plain', lastModified: 1000 }))
    const event = new DragEvent(eventName, {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer
    })
    element.dispatchEvent(event)
    return { prevented: event.defaultPrevented, dropEffect: transfer.dropEffect }
  }, kind)
}
