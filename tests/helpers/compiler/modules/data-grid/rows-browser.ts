import { execFileSync } from 'node:child_process'

import type { Page } from '@playwright/test'
import * as v from 'valibot'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'

export async function withDataGridRows(
  page: Page,
  target: 'react' | 'vue',
  document: boolean,
  run: () => Promise<void>
): Promise<void> {
  const source = `import {dataGridRowsFixture} from './tests/helpers/compiler/modules/data-grid/rows-fixture';const output=dataGridRowsFixture(${JSON.stringify(target)},${JSON.stringify(document)});if(output.warnings.length)throw new Error(JSON.stringify(output.warnings));process.stdout.write(JSON.stringify([...output.files]));`
  const files = new Map(
    v.parse(
      v.pipe(v.string(), v.parseJson(), v.array(v.tuple([v.string(), v.string()]))),
      execFileSync('bun', ['-e', source], {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024
      })
    )
  )
  await withComponentTemplateFiles(page, target, files, run)
}
