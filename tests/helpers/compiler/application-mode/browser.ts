import { execFileSync } from 'node:child_process'

import { expect, type Page } from '@playwright/test'

import type { CompileWarning } from '@open-pencil/compiler'

import { withComponentTemplateFiles } from '../components/templates/browser'

export interface ApplicationBrowserOutput {
  files: [string, string][]
  warnings: CompileWarning[]
}

export async function withApplicationMode(
  page: Page,
  target: 'react' | 'vue',
  run: () => Promise<void>
): Promise<void> {
  const result = JSON.parse(
    execFileSync(
      'bun',
      [
        '-e',
        `import {compileApplicationModeFixture} from './tests/helpers/compiler/application-mode/fixture'; const result=compileApplicationModeFixture(${JSON.stringify(target)}); process.stdout.write(JSON.stringify({files:[...result.files],warnings:result.warnings}));`
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    )
  ) as ApplicationBrowserOutput
  expect(result.warnings).toEqual([])
  await withComponentTemplateFiles(page, target, new Map(result.files), run)
}
