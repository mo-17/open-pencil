import { execFileSync } from 'node:child_process'

import type { Page } from '@playwright/test'
import * as v from 'valibot'

import { withComponentTemplateFiles } from '../templates/browser'

export async function withFormModules(
  page: Page,
  target: 'react' | 'vue',
  run: () => Promise<void>,
  compiled = false
) {
  const name = compiled ? 'moduleValuesFixture' : 'formModulesFixture',
    directory = compiled ? 'module-values' : 'form-modules'
  const source = `import {${name}} from './tests/helpers/compiler/components/${directory}/fixture';const result=${name}(${JSON.stringify(target)});if(result.warnings.length)throw new Error(JSON.stringify(result.warnings));process.stdout.write(JSON.stringify([...result.files]));`
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
