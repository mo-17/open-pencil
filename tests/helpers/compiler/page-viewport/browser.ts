import { execFileSync } from 'node:child_process'

import { expect, type Page } from '@playwright/test'
import * as v from 'valibot'

import { withComponentTemplateFiles } from '../components/templates/browser'

declare global {
  interface Window {
    __openPencilViewportErrors?: string[]
  }
}

export async function withPageViewport(
  page: Page,
  target: 'react' | 'vue',
  mode: 'responsive' | 'fit-width' | 'bands',
  run: () => Promise<void>
) {
  const call =
    mode === 'bands'
      ? `pageViewportBandsFixture(${JSON.stringify(target)})`
      : `pageViewportFixture(${JSON.stringify(target)},${JSON.stringify(mode)})`
  const source = `import {pageViewportFixture,pageViewportBandsFixture} from './tests/helpers/compiler/page-viewport/fixture';const output=${call};if(output.warnings.length)throw new Error(JSON.stringify(output.warnings));process.stdout.write(JSON.stringify([...output.files]));`
  const files = v.parse(
    v.pipe(v.string(), v.parseJson(), v.array(v.tuple([v.string(), v.string()]))),
    execFileSync('bun', ['-e', source], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
  )
  // Vite can catch/report ErrorEvents without emitting Playwright's pageerror event.
  await page.addInitScript(() => {
    const errors: string[] = []
    window.__openPencilViewportErrors = errors
    window.addEventListener('error', (event) => errors.push(event.message), true)
    window.addEventListener('unhandledrejection', (event) => {
      const reason: unknown = event.reason
      errors.push(reason instanceof Error ? reason.message : String(reason))
    })
  })
  await withComponentTemplateFiles(page, target, new Map(files), async () => {
    await run()
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        })
    )
    expect(await page.evaluate(() => window.__openPencilViewportErrors ?? [])).toEqual([])
  })
}
