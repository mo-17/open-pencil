import { execFileSync } from 'node:child_process'

import type { Locator, Page } from '@playwright/test'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'

export async function withColorInputs(
  page: Page,
  target: 'react' | 'vue',
  runtime: boolean,
  run: () => Promise<void>
) {
  const module = runtime ? 'runtime' : 'fixture',
    name = runtime ? 'colorInputRuntimeFixture' : 'colorInputFixture'
  const fixture: { files: [string, string][] } = JSON.parse(
    execFileSync(
      'bun',
      [
        '-e',
        `import {${name}} from './tests/helpers/compiler/components/color/${module}';process.stdout.write(JSON.stringify(${name}(${JSON.stringify(target)})))`
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    )
  )
  await withComponentTemplateFiles(page, target, new Map(fixture.files), run)
}
/** Simulates the native chooser's two events; the actual OS popup is a manual gate. */
export async function chooseColor(picker: Locator, value: string) {
  await picker.evaluate((element, value) => {
    const input = element as HTMLInputElement
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}
