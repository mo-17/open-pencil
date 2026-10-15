import { expect, test } from '@playwright/test'

import { COMPONENT_TEMPLATE_IDS } from '@/app/lowcode/component-templates/catalog'

import { exerciseTemplate } from '#tests/helpers/compiler/components/templates/behavior'
import { withComponentTemplate } from '#tests/helpers/compiler/components/templates/browser'
import { recordTemplateLayout } from '#tests/helpers/compiler/components/templates/evidence'
import { prepareFieldTemplateEvidence } from '#tests/helpers/compiler/components/templates/fields-behavior'
import { prepareInputTemplateEvidence } from '#tests/helpers/compiler/components/templates/inputs-evidence'

for (const target of ['react', 'vue'] as const) {
  test(`${target} repeated input templates keep their runtime values independent`, async ({
    page
  }) => {
    test.setTimeout(90000)
    await withComponentTemplate(
      page,
      target,
      ['input', 'input'],
      async () => {
        const fields = page.getByRole('textbox', { name: '输入内容', exact: true })
        await expect(fields).toHaveCount(2)
        await fields.nth(0).fill('first instance')
        await expect(fields.nth(1)).toHaveValue('')
        await fields.nth(1).fill('second instance')
        await expect(fields.nth(0)).toHaveValue('first instance')
        await expect(page.getByText('当前值: first instance', { exact: true })).toBeVisible()
        await expect(page.getByText('当前值: second instance', { exact: true })).toBeVisible()
      },
      'zh-CN'
    )
  })
  for (const id of COMPONENT_TEMPLATE_IDS) {
    test(`${target} ${id} preserves local behavior and fits desktop and compact viewports`, async ({
      page
    }, info) => {
      test.setTimeout(90000)
      await test.step('English template copy', async () => {
        await withComponentTemplate(
          page,
          target,
          id,
          async () => {
            await recordTemplateLayout(page, info, id, target, 'en')
            if (id === 'dialog-form') {
              await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
              await expect(page.getByRole('dialog')).toBeVisible()
              await recordTemplateLayout(page, info, id, target, 'en', 'dialog')
            }
            if (id === 'tabs-details') {
              await page.getByRole('tab', { name: 'Details', exact: true }).click()
              await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeVisible()
              await recordTemplateLayout(page, info, id, target, 'en', 'details')
            }
          },
          'en'
        )
      })
      await test.step('Chinese template behavior', async () => {
        await withComponentTemplate(
          page,
          target,
          id,
          async () => {
            await page.setViewportSize({ width: 375, height: 1000 })
            await exerciseTemplate(page, id)
            await recordTemplateLayout(page, info, id, target)
            if (
              (await prepareInputTemplateEvidence(page, id)) ||
              (await prepareFieldTemplateEvidence(page, id))
            )
              await recordTemplateLayout(page, info, id, target, 'zh-CN', 'active')
          },
          'zh-CN'
        )
      })
    })
  }
}
