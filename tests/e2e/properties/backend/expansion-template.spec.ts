import { expect, test } from '#tests/e2e/fixtures'
import { closeBackendPreviewIfOpen } from '#tests/helpers/backend-library'
import { CanvasHelper } from '#tests/helpers/canvas'
import {
  expansionDefinition,
  expansionKinds
} from '#tests/helpers/compiler/business/expansion/metadata'

for (const locale of ['en', 'zh-CN'] as const) {
  test.describe(locale + ' expansion library', () => {
    test.use({ locale })
    for (const kind of expansionKinds) {
      test(`creates ${kind} with role review and atomic undo and redo`, async ({ page }, info) => {
        test.setTimeout(100_000)
        const chinese = locale === 'zh-CN'
        const definition = expansionDefinition(kind)
        const label = (text: { en: string; zh: string }) => text[chinese ? 'zh' : 'en']
        await page.goto('/?test&navigation-benchmark')
        const canvas = new CanvasHelper(page)
        await canvas.waitForInit()
        await page
          .getByRole('button', {
            name: chinese ? '浏览后端库' : 'Browse backend library',
            exact: true
          })
          .click()
        const library = page.getByRole('dialog', {
          name: chinese ? '后端库' : 'Backend library',
          exact: true
        })
        await library.getByRole('button', { name: label(definition.title), exact: true }).click()
        const details = library.getByRole('region', { name: label(definition.title), exact: true })
        for (const role of definition.roles) await expect(details).toContainText(role)
        const titles = [
          chinese ? '业务系统登录' : 'Business sign in',
          ...definition.pages.map((screen) => label(screen.title))
        ]
        for (const title of titles) await expect(details).toContainText(title)
        await expect(details).toContainText(
          chinese ? '此模板不会授予角色、启动服务' : 'Creation does not grant roles, start services'
        )
        await page.screenshot({ path: info.outputPath('expansion-template-requirements.png') })
        await library
          .getByRole('button', { name: chinese ? '使用模板' : 'Use template', exact: true })
          .click()
        // The installer awaits activation of the generated page before the dialog closes.
        await expect(library).toBeHidden({ timeout: 30_000 })
        await closeBackendPreviewIfOpen(page)
        const pages = page.getByTestId('pages-panel').getByTestId('pages-item')
        await expect(pages).toHaveCount(titles.length + 1)
        for (const title of titles)
          await expect(pages.getByText(title, { exact: true })).toBeVisible()
        await page.evaluate(async () => {
          await window.openPencil?.test?.navigation?.waitForSettlement()
        })
        await canvas.canvas.click({ position: { x: 10, y: 10 } })
        await canvas.undo()
        await expect(pages).toHaveCount(1)
        await canvas.redo()
        await expect(pages).toHaveCount(titles.length + 1)
        for (const title of titles)
          await expect(pages.getByText(title, { exact: true })).toBeVisible()
        await page.evaluate(async () => {
          await window.openPencil?.test?.navigation?.waitForSettlement()
        })
        await page.screenshot({ path: info.outputPath('expansion-template-restored.png') })
        canvas.assertNoErrors()
      })
    }
  })
}
