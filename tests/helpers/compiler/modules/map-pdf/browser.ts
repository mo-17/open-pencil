import { execFileSync } from 'node:child_process'

import type { Page } from '@playwright/test'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'

import type { MapPDFFixtureKind } from './fixture'

export async function withMapPDFModule(
  page: Page,
  kind: MapPDFFixtureKind,
  devMode: boolean,
  run: () => Promise<void>
): Promise<void> {
  const source = `import {mapPDFFixture} from './tests/helpers/compiler/modules/map-pdf/fixture';const output=mapPDFFixture(${JSON.stringify(kind)},${devMode},true);if(output.warnings.length)throw new Error(JSON.stringify(output.warnings));process.stdout.write(JSON.stringify([...output.files]));`
  const files = new Map(
    JSON.parse(
      execFileSync('bun', ['-e', source], {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024
      })
    ) as [string, string][]
  )
  await withComponentTemplateFiles(page, 'vue', files, run)
}
