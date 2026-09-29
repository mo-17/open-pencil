import { execFileSync } from 'node:child_process'

import type { Page } from '@playwright/test'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'

export async function withProgress(
  page: Page,
  target: 'react' | 'vue',
  run: () => Promise<void>,
  updates = false
): Promise<void> {
  const source = `import {progressFixture} from './tests/helpers/compiler/modules/progress/fixture';const result=progressFixture(${JSON.stringify(target)},${updates});if(result.warnings.length)throw new Error(JSON.stringify(result.warnings));process.stdout.write(JSON.stringify([...result.files]));`
  const files = JSON.parse(
    execFileSync('bun', ['-e', source], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
  ) as [string, string][]
  await withComponentTemplateFiles(page, target, new Map(files), run)
}
