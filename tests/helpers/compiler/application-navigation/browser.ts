import { execFileSync } from 'node:child_process'

import { expect, type Page } from '@playwright/test'
import * as v from 'valibot'

import { parseCompilerBrowserOutput } from '#tests/helpers/compiler/output'

import { withComponentTemplateFiles } from '../components/templates/browser'

export async function withApplicationNavigation(
  page: Page,
  target: 'react' | 'vue',
  run: () => Promise<void>
): Promise<void> {
  const result = parseCompilerBrowserOutput(
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
  )
  expect(result.warnings).toEqual([])
  await withComponentTemplateFiles(page, target, new Map(result.files), run)
}

export function applicationNavigationDocument(): number[] {
  return v.parse(
    v.pipe(v.string(), v.parseJson(), v.array(v.number())),
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
  )
}
