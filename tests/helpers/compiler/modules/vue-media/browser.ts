import { execFileSync } from 'node:child_process'

import type { Page } from '@playwright/test'
import * as v from 'valibot'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'

export async function withVueMedia(page: Page, run: () => Promise<void>, devMode = true) {
  const source = `import {vueMediaBrowserFixture} from './tests/helpers/compiler/modules/vue-media/fixture';const output=vueMediaBrowserFixture(${devMode});if(output.warnings.length)throw new Error(JSON.stringify(output.warnings));process.stdout.write(JSON.stringify([...output.files]));`
  const files = v.parse(
    v.pipe(v.string(), v.parseJson(), v.array(v.tuple([v.string(), v.string()]))),
    execFileSync('bun', ['-e', source], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
  )
  await withComponentTemplateFiles(page, 'vue', new Map(files), run)
}
