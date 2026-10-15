import { execFileSync } from 'node:child_process'

import type { Page } from '@playwright/test'
import * as v from 'valibot'

import { withComponentTemplateFiles } from '../templates/browser'

export async function withWalktour(
  page: Page,
  target: 'react' | 'vue',
  runtime: boolean | 'form',
  run: () => Promise<void>
) {
  let method = 'walktourFixture'
  if (runtime === 'form') method = 'walktourFormFixture'
  else if (runtime) method = 'walktourRuntimeFixture'
  const file = runtime === true ? 'runtime' : 'fixture'
  const source = `import {${method}} from './tests/helpers/compiler/components/walktour/${file}';const result=${method}(${JSON.stringify(target)});if(result.warnings.length)throw new Error(JSON.stringify(result.warnings));process.stdout.write(JSON.stringify([...result.files]));`
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
