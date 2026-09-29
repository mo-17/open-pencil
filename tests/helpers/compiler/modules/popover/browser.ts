import { execFileSync } from 'node:child_process'

import type { Page } from '@playwright/test'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'

export async function withPopover(
  page: Page,
  target: 'react' | 'vue',
  run: () => Promise<void>,
  dynamic = false
) {
  const source = `import {popoverFixture} from './tests/helpers/compiler/modules/popover/fixture';const result=popoverFixture(${JSON.stringify(target)},${dynamic});if(result.warnings.length)throw new Error(JSON.stringify(result.warnings));process.stdout.write(JSON.stringify([...result.files]));`
  const entries = JSON.parse(
    execFileSync('bun', ['-e', source], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
  ) as [string, string][]
  await withComponentTemplateFiles(page, target, new Map(entries), run)
}
