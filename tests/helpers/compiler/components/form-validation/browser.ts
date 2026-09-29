import { execFileSync } from 'node:child_process'

import type { Page } from '@playwright/test'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'

export async function withFormFeedback(
  page: Page,
  target: 'react' | 'vue',
  run: () => Promise<void>,
  kit = false
) {
  const source = `import {formFeedbackFixture} from './tests/helpers/compiler/components/form-validation/fixture'; const result=formFeedbackFixture(${JSON.stringify(target)},${kit}); if(result.warnings.some(warning => warning.code !== 'ui-kit-native-control-fallback')) throw new Error(JSON.stringify(result.warnings)); process.stdout.write(JSON.stringify([...result.files]));`
  const files = JSON.parse(
    execFileSync('bun', ['-e', source], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
  ) as [string, string][]
  await withComponentTemplateFiles(page, target, new Map(files), run)
}

export async function withValidationIdentity(
  page: Page,
  target: 'react' | 'vue',
  run: () => Promise<void>,
  kit = false
) {
  const source = `import {validationIdentityFixture} from './tests/helpers/compiler/components/form-validation/identity'; const result=validationIdentityFixture(${JSON.stringify(target)},${kit}); if(result.warnings.length) throw new Error(JSON.stringify(result.warnings)); process.stdout.write(JSON.stringify([...result.files]));`
  const files = JSON.parse(
    execFileSync('bun', ['-e', source], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
  ) as [string, string][]
  await withComponentTemplateFiles(page, target, new Map(files), run)
}
