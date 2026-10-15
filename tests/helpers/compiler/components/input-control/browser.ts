import { execFileSync } from 'node:child_process'

import type { Page } from '@playwright/test'
import * as v from 'valibot'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'

export async function withInputControl(
  page: Page,
  target: 'react' | 'vue',
  run: () => Promise<void>
) {
  const script = `import {inputControlRuntimeFixture} from './tests/helpers/compiler/components/input-control/runtime';const result=inputControlRuntimeFixture(${JSON.stringify(target)});if(result.warnings.length)throw new Error(JSON.stringify(result.warnings));process.stdout.write(JSON.stringify(result.files));`
  const files = v.parse(
    v.pipe(v.string(), v.parseJson(), v.array(v.tuple([v.string(), v.string()]))),
    execFileSync('bun', ['-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
  )
  await withComponentTemplateFiles(page, target, new Map(files), run)
}
