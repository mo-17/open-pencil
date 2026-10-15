import { execFileSync } from 'node:child_process'

import type { Page } from '@playwright/test'
import * as v from 'valibot'

import { withComponentTemplateFiles } from '../templates/browser'

export async function withMixedForm(page: Page, target: 'react' | 'vue', run: () => Promise<void>) {
  const source = `import {mixedFormFixture} from './tests/helpers/compiler/components/mixed-form/fixture';const output=mixedFormFixture(${JSON.stringify(target)});if(output.warnings.length)throw new Error(JSON.stringify(output.warnings));process.stdout.write(JSON.stringify([...output.files]));`
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
