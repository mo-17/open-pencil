import { execFileSync } from 'node:child_process'

import type { Locator, Page } from '@playwright/test'
import * as v from 'valibot'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'

export async function withDateRangeModules(
  page: Page,
  target: 'react' | 'vue',
  run: () => Promise<void>,
  lifecycle = false
) {
  const source = `import {dateRangeFixture} from './tests/helpers/compiler/modules/date-range/fixture';const result=dateRangeFixture(${JSON.stringify(target)},${lifecycle});if(result.warnings.length)throw new Error(JSON.stringify(result.warnings));process.stdout.write(JSON.stringify([...result.files]));`
  const files = v.parse(
    v.pipe(v.string(), v.parseJson(), v.array(v.tuple([v.string(), v.string()]))),
    execFileSync('bun', ['-e', source], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
  )
  await withComponentTemplateFiles(page, target, new Map(files), run)
}
export async function dateRangeLocalInputOwnership(group: Locator): Promise<boolean> {
  return group
    .locator('input')
    .evaluateAll((inputs) =>
      inputs.every(
        (input) => input instanceof HTMLInputElement && input.form === null && !input.name
      )
    )
}
export async function dateRangeFitsWidth(group: Locator): Promise<boolean> {
  return group.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
}
