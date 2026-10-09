import { execFileSync } from 'node:child_process'

import type { Page } from '@playwright/test'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'

/** Reuse the canonical compiler fixture/preview helper; Bun handles existing compiler JSON imports. */
export async function withEffectPickExport(
  page: Page,
  target: 'react' | 'vue',
  run: () => Promise<void>
): Promise<void> {
  const source = `import { effectPickExportFixture } from './tests/helpers/compiler/modules/effect-pick/fixture'; const result = effectPickExportFixture(${JSON.stringify(target)}); if (result.warnings.length) throw new Error(JSON.stringify(result.warnings)); process.stdout.write(JSON.stringify([...result.files]));`
  const files = JSON.parse(
    execFileSync('bun', ['-e', source], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
  ) as [string, string][]
  await withComponentTemplateFiles(page, target, new Map(files), run)
}
