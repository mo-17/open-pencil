import { execFileSync } from 'node:child_process'

import { expect, type Page } from '@playwright/test'

import { parseCompilerBrowserOutput } from '#tests/helpers/compiler/output'

import { withComponentTemplateFiles } from '../templates/browser'
import type { CanvasStateFamily, StateFamily, StateLocale } from './types'

export async function withComponentStates(
  page: Page,
  target: 'react' | 'vue',
  family: CanvasStateFamily,
  locale: StateLocale,
  run: () => Promise<void>
) {
  const source = `import {compileComponentStates} from './tests/helpers/compiler/components/states/fixture';const result=compileComponentStates(${JSON.stringify(target)},${JSON.stringify(family)},${JSON.stringify(locale)});process.stdout.write(JSON.stringify({files:[...result.files],warnings:result.warnings}));`
  const result = parseCompilerBrowserOutput(
    execFileSync('bun', ['-e', source], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
  )
  expect(result.warnings).toEqual([])
  await withComponentTemplateFiles(page, target, new Map(result.files), run)
}

export function stateModuleSelector(family: StateFamily): string {
  if (family === 'range') return '[data-openpencil-slider]'
  if (family === 'tree-select') return '[data-openpencil-tree]'
  return `[data-openpencil-${family}]`
}
