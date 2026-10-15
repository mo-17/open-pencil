import { execFileSync } from 'node:child_process'

import type { Page } from '@playwright/test'
import * as v from 'valibot'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'

export async function withAccordion(
  page: Page,
  target: 'react' | 'vue',
  run: () => Promise<void>,
  lifecycle = false
): Promise<void> {
  const source = `import {accordionFixture} from './tests/helpers/compiler/modules/accordion/fixture'; const result=accordionFixture(${JSON.stringify(target)},${lifecycle}); if(result.warnings.length)throw new Error(JSON.stringify(result.warnings)); process.stdout.write(JSON.stringify([...result.files]));`
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
