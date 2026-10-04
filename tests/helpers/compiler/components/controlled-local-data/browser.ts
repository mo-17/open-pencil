import { execFileSync } from 'node:child_process'

import type { Page } from '@playwright/test'

import { withComponentTemplateFiles } from '../templates/browser'

export async function withControlledLocalData(
  page: Page,
  target: 'react' | 'vue',
  module: 'upload' | 'rich-text',
  run: () => Promise<void>
) {
  const source = `import {controlledLocalDataFixture} from './tests/helpers/compiler/components/controlled-local-data/fixture'; process.stdout.write(JSON.stringify([...controlledLocalDataFixture(${JSON.stringify(target)},${JSON.stringify(module)})]));`
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
