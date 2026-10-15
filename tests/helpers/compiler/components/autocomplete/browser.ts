import { execFileSync } from 'node:child_process'

import { expect, type Locator, type Page } from '@playwright/test'
import * as v from 'valibot'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'

export async function withAutocomplete(
  page: Page,
  target: 'react' | 'vue',
  runtime: boolean,
  run: () => Promise<void>
) {
  const name = runtime ? 'autocompleteRuntimeFixture' : 'autocompleteFixture',
    file = runtime ? 'runtime' : 'model'
  const script = `import {${name}} from './tests/helpers/compiler/components/autocomplete/${file}';const result=${name}(${JSON.stringify(target)});if(result.warnings.length)throw new Error(JSON.stringify(result.warnings));process.stdout.write(JSON.stringify(result.files));`
  const files = v.parse(
    v.pipe(v.string(), v.parseJson(), v.array(v.tuple([v.string(), v.string()]))),
    execFileSync('bun', ['-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
  )
  await withComponentTemplateFiles(page, target, new Map(files), run)
}
export async function composedInput(input: Locator, value: string) {
  await input.dispatchEvent('compositionstart')
  await input.evaluate((element, text) => {
    const win = element.ownerDocument.defaultView
    if (!win || !(element instanceof win.HTMLInputElement)) throw new Error('Expected a live input')
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set?.call(
      element,
      text
    )
    element.dispatchEvent(
      new win.InputEvent('input', {
        bubbles: true,
        isComposing: true,
        inputType: 'insertCompositionText',
        data: text
      })
    )
  }, value)
  await input.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    isComposing: true,
    keyCode: 229
  })
  await expect(input).toHaveValue(value)
}
export async function popupFits(page: Page) {
  const popup = page.locator('[data-op-autocomplete-popup]')
  await expect(popup).toBeVisible()
  const box = await popup.boundingBox()
  expect(box).not.toBeNull()
  if (!box) throw new Error('Expected visible suggestion popup')
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(375)
  expect(await popup.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true
  )
}

export async function nativeFormValue(input: Locator, name: string) {
  return input.evaluate((element, key) => {
    const win = element.ownerDocument.defaultView
    if (!win || !(element instanceof win.HTMLInputElement) || !element.form)
      throw new Error('Expected input within form')
    return new win.FormData(element.form).getAll(key)
  }, name)
}
