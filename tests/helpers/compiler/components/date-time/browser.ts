import { execFileSync } from 'node:child_process'

import type { Locator, Page } from '@playwright/test'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'

export async function withDateTimeInputs(
  page: Page,
  target: 'react' | 'vue',
  run: () => Promise<void>
) {
  const fixture: { files: [string, string][] } = JSON.parse(
    execFileSync(
      'bun',
      [
        '-e',
        `import {dateTimeInputFixture} from './tests/helpers/compiler/components/date-time/fixture'; process.stdout.write(JSON.stringify(dateTimeInputFixture(${JSON.stringify(target)})))`
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    )
  )
  await withComponentTemplateFiles(page, target, new Map(fixture.files), run)
}
export function dateTimeValidity(input: Locator) {
  return input.evaluate((element: HTMLInputElement) => ({
    valid: element.validity.valid,
    rangeUnderflow: element.validity.rangeUnderflow,
    rangeOverflow: element.validity.rangeOverflow,
    stepMismatch: element.validity.stepMismatch
  }))
}
