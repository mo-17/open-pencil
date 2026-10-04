import { execFileSync } from 'node:child_process'

import { expect, type Page } from '@playwright/test'

import type { ApplicationBrowserOutput } from '../application-mode/browser'
import { withComponentTemplateFiles } from '../components/templates/browser'

export async function withApplicationNavigation(
  page: Page,
  target: 'react' | 'vue',
  run: () => Promise<void>
): Promise<void> {
  const result = JSON.parse(
    execFileSync(
      'bun',
      [
        '-e',
        `import {compileApplicationNavigationFixture} from './tests/helpers/compiler/application-navigation/fixture'; const result=compileApplicationNavigationFixture(${JSON.stringify(target)}); process.stdout.write(JSON.stringify({files:[...result.files],warnings:result.warnings}));`
      ],
      {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024
      }
    )
  ) as ApplicationBrowserOutput
  expect(result.warnings).toEqual([])
  await withComponentTemplateFiles(page, target, new Map(result.files), run)
}

export function applicationNavigationDocument(): number[] {
  return JSON.parse(
    execFileSync(
      'bun',
      [
        '-e',
        "import {exportFigFile} from '@open-pencil/core/io/formats/fig'; import {applicationNavigationFixture} from './tests/helpers/compiler/application-navigation/fixture'; process.stdout.write(JSON.stringify([...await exportFigFile(applicationNavigationFixture().graph)]));"
      ],
      {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024
      }
    )
  ) as number[]
}
