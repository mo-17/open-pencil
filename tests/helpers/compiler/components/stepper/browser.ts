import { execFileSync } from 'node:child_process'

import { expect, type Page } from '@playwright/test'

import { withComponentTemplateFiles } from '../templates/browser'
import type { StepperBindingVariant } from './fixture'

export async function withStepperBinding(
  page: Page,
  target: 'react' | 'vue',
  variant: StepperBindingVariant,
  run: () => Promise<void>
): Promise<void> {
  const source = `import {stepperBindingFixture} from './tests/helpers/compiler/components/stepper/fixture';const result=stepperBindingFixture(${JSON.stringify(target)},${JSON.stringify(variant)});process.stdout.write(JSON.stringify({files:[...result.files],warnings:result.warnings}));`
  const result = JSON.parse(
    execFileSync('bun', ['-e', source], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
  ) as { files: [string, string][]; warnings: { code: string; nodeId?: string }[] }
  if (variant === 'invalid') {
    expect(result.warnings).toHaveLength(4)
    expect(result.warnings.every((warning) => warning.code === 'stepper-binding-invalid')).toBe(
      true
    )
    expect(new Set(result.warnings.map((warning) => warning.nodeId)).size).toBe(4)
  } else expect(result.warnings).toEqual([])
  await withComponentTemplateFiles(page, target, new Map(result.files), run)
}

export async function captureStepperChanges(page: Page): Promise<void> {
  await page.locator('[data-openpencil-stepper]').evaluateAll((elements) => {
    const events: { label: string | null; currentIndex: number; previousIndex: number }[] = []
    document.documentElement.dataset.stepperEvents = '[]'
    for (const element of elements)
      element.addEventListener('stepschange', (event) => {
        const detail = (event as CustomEvent<{ currentIndex: number; previousIndex: number }>)
          .detail
        events.push({ label: element.getAttribute('aria-label'), ...detail })
        document.documentElement.dataset.stepperEvents = JSON.stringify(events)
      })
  })
}

export function stepperChanges(
  page: Page
): Promise<{ label: string; currentIndex: number; previousIndex: number }[]> {
  return page.evaluate(() => JSON.parse(document.documentElement.dataset.stepperEvents ?? '[]'))
}
