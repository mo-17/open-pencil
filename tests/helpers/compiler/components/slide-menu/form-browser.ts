import { execFileSync } from 'node:child_process'

import type { Page } from '@playwright/test'

import { withComponentTemplateFiles } from '../templates/browser'

export async function withSlideMenuForm(
  page: Page,
  target: 'react' | 'vue',
  run: () => Promise<void>
) {
  const source = `import {slideMenuFormFixture} from './tests/helpers/compiler/components/slide-menu/form-fixture';const output=slideMenuFormFixture(${JSON.stringify(target)});if(output.warnings.length)throw new Error(JSON.stringify(output.warnings));process.stdout.write(JSON.stringify([...output.files]));`
  const files = new Map(
    JSON.parse(
      execFileSync('bun', ['-e', source], {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024
      })
    ) as [string, string][]
  )
  await withComponentTemplateFiles(page, target, files, run)
}
