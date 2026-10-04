import { expect, test } from '@playwright/test'

import { withComponentTemplate } from '#tests/helpers/compiler/components/templates/browser'
import {
  exerciseCompositionTemplate,
  type CompositionLocale
} from '#tests/helpers/compiler/components/templates/compositions-behavior'
import { recordTemplateLayout } from '#tests/helpers/compiler/components/templates/evidence'

const compositions = ['stepper-form', 'tree-details', 'drawer-details', 'admin-shell'] as const
const locales: readonly CompositionLocale[] = ['en', 'zh-CN']

for (const target of ['react', 'vue'] as const)
  for (const locale of locales)
    for (const id of compositions)
      test(`${target} ${locale} ${id} preserves composed behavior and responsive content`, async ({
        page
      }, info) => {
        test.setTimeout(90000)
        await withComponentTemplate(
          page,
          target,
          id,
          async () => {
            await recordTemplateLayout(page, info, id, target, locale)
            expect(await exerciseCompositionTemplate(page, id, locale)).toBe(true)
            await recordTemplateLayout(page, info, id, target, locale, 'active')
          },
          locale
        )
      })
