import { execFileSync } from 'node:child_process'

import type { Page } from '@playwright/test'
import * as v from 'valibot'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'

export async function withCarouselRuntime(
  page: Page,
  target: 'react' | 'vue',
  run: () => Promise<void>,
  styles: boolean | 'navigation' = false
) {
  let fixture = styles ? 'carouselStylesFixture' : 'carouselRuntimeFixture'
  let path = styles ? 'styles-fixture' : 'fixture'
  if (styles === 'navigation') {
    fixture = 'carouselNavigationFixture'
    path = 'navigation-fixture'
  }
  const source = `import {${fixture}} from './tests/helpers/compiler/modules/carousel/${path}'; const result=${fixture}(${JSON.stringify(target)}); if(result.warnings.length)throw new Error(JSON.stringify(result.warnings)); process.stdout.write(JSON.stringify([...result.files]));`
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
