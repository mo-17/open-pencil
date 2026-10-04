import { execFileSync } from 'node:child_process'

import type { Page } from '@playwright/test'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'

export async function withDataGridRows(
  page: Page,
  target: 'react' | 'vue',
  document: boolean,
  run: () => Promise<void>
): Promise<void> {
  const source = `import {dataGridRowsFixture} from './tests/helpers/compiler/modules/data-grid/rows-fixture';const output=dataGridRowsFixture(${JSON.stringify(target)},${JSON.stringify(document)});if(output.warnings.length)throw new Error(JSON.stringify(output.warnings));process.stdout.write(JSON.stringify([...output.files]));`
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
