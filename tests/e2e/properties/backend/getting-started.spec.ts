import type { Page } from '@playwright/test'

import type * as BackendDocumentModule from '@/app/lowcode/backend/document'

import { expect, test } from '#tests/e2e/fixtures'
import { closeBackendPreviewIfOpen } from '#tests/helpers/backend-library'
import { CanvasHelper } from '#tests/helpers/canvas'

async function savedApplication(page: Page) {
  return page.evaluate(async () => {
    const { readBackendProviderDocumentRequest } = (await import(
      /* @vite-ignore */ new URL('/src/app/lowcode/backend/document.ts', location.origin).href
    )) as typeof BackendDocumentModule
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Missing editor')
    return JSON.stringify(readBackendProviderDocumentRequest(editor.graph))
  })
}

for (const locale of ['en', 'zh-CN'] as const) {
  test.describe(locale + ' getting started', () => {
    test.use({ locale })
    test('follows saved modules, actual routes and undo without granting roles or saving drafts', async ({
      page
    }, info) => {
      test.setTimeout(150_000)
      const chinese = locale === 'zh-CN'
      const text = (en: string, zh: string) => (chinese ? zh : en)
      const canvas = new CanvasHelper(page)
      await page.goto('/?test&navigation-benchmark')
      await canvas.waitForInit()
      const card = page.locator('[data-property="backend-getting-started"]')
      await expect(card).toHaveCount(0)
      await page
        .getByRole('button', { name: text('Browse backend library', '浏览后端库'), exact: true })
        .click()
      const library = page.getByRole('dialog', {
        name: text('Backend library', '后端库'),
        exact: true
      })
      await library
        .getByRole('button', { name: text('Customer CRM', '客户与跟进'), exact: true })
        .click()
      await library
        .getByRole('button', { name: text('Use template', '使用模板'), exact: true })
        .click()
      await expect(library).toBeHidden({ timeout: 30_000 })
      await closeBackendPreviewIfOpen(page)
      await expect(card).toBeVisible()

      const modules = [
        { name: text('Asset management', '资产管理'), role: 'asset-manager' },
        {
          name: text('Quotations and contract fulfillment', '报价与合同履约'),
          role: 'contract-manager'
        },
        {
          name: text('Recruitment and employee lifecycle', '招聘与员工入离职'),
          role: 'recruitment-hr'
        }
      ]
      for (const module of modules) {
        await page
          .getByRole('button', { name: text('Browse backend library', '浏览后端库'), exact: true })
          .click()
        await library.getByRole('button', { name: module.name, exact: true }).click()
        await library
          .getByRole('button', { name: text('Add module', '添加模块'), exact: true })
          .click()
        await expect(library).toBeHidden({ timeout: 30_000 })
        await closeBackendPreviewIfOpen(page)
      }
      const before = await savedApplication(page)
      await card
        .getByRole('button', { name: text('Getting started', '开始使用'), exact: true })
        .click()
      const guide = page.getByRole('dialog', {
        name: text('Start using your application', '开始使用应用'),
        exact: true
      })
      await expect(guide).toBeVisible()
      await expect(guide).toContainText('http://127.0.0.1:18080/realms/openpencil')
      await expect(guide).toContainText('notes-public-client')
      await expect(guide).toContainText(
        text('have not been checked here', '尚未检查服务连接和真实登录')
      )
      for (const module of modules) {
        await expect(guide).toContainText(module.role)
        await guide.locator('summary').filter({ hasText: module.name }).click()
      }
      await expect(guide).toContainText('LOCAL-RUN.md')
      await expect(guide).toContainText(text('one NestJS backend', '一个 NestJS 后端'))
      expect(await savedApplication(page)).toBe(before)
      await page.screenshot({ path: info.outputPath('business-getting-started.png') })

      // Page links reflect edited routes, rather than the template's default entry path.
      const renamedPage = await page.evaluate(() => {
        const editor = window.openPencil?.getStore?.()
        const candidate = editor?.graph
          .getPages()
          .find((item) => item.lowcodeRoutePattern === '/contracts/quotes')
        if (!editor || !candidate) throw new Error('Missing quote page')
        editor.graph.updateNode(candidate.id, { lowcodeRoutePattern: '/my-renamed-quotes' })
        return { id: candidate.id, name: candidate.name }
      })
      const renamedLink = guide.getByRole('button', {
        name: renamedPage.name + ' /my-renamed-quotes',
        exact: true
      })
      await expect(renamedLink).toBeVisible()
      await renamedLink.click()
      await expect(guide).toBeHidden()
      await expect
        .poll(() => page.evaluate(() => window.openPencil?.getStore?.().state.currentPageId))
        .toBe(renamedPage.id)

      const panel = page.getByTestId('lowcode-backend-editor')
      await panel
        .locator('summary')
        .filter({ hasText: text('Advanced provider settings', '高级提供方设置') })
        .click()
      const appId = panel.getByTestId('lowcode-backend-application-id')
      const originalId = await appId.inputValue()
      await appId.fill('invalid draft with spaces')
      await appId.blur()
      await card
        .getByRole('button', { name: text('Getting started', '开始使用'), exact: true })
        .click()
      await expect(guide).toContainText(text('draft has unsaved changes', '草稿有未保存的修改'))
      await expect(
        guide.getByRole('button', {
          name: text('Add business modules', '添加业务模块'),
          exact: true
        })
      ).toBeDisabled()
      expect(await savedApplication(page)).toBe(before)
      await guide
        .getByRole('button', {
          name: text('Edit sign-in configuration', '编辑登录配置'),
          exact: true
        })
        .click()
      await expect(guide).toBeHidden()
      await expect(appId).toHaveValue('invalid draft with spaces')
      await appId.fill(originalId)
      await appId.blur()

      // The guide recomputes from saved metadata after the last module is undone/redone.
      await page.evaluate(async () => {
        await window.openPencil?.test?.navigation?.waitForSettlement()
      })
      await canvas.canvas.click({ position: { x: 10, y: 10 } })
      await canvas.undo()
      await card
        .getByRole('button', { name: text('Getting started', '开始使用'), exact: true })
        .click()
      await expect(guide).not.toContainText('recruitment-hr')
      await guide
        .getByRole('button', { name: text('Close getting started', '关闭使用指南'), exact: true })
        .click()
      await canvas.canvas.click({ position: { x: 10, y: 10 } })
      await canvas.redo()
      await card
        .getByRole('button', { name: text('Getting started', '开始使用'), exact: true })
        .click()
      await expect(guide).toContainText('recruitment-hr')
      await guide
        .getByRole('button', { name: text('Add business modules', '添加业务模块'), exact: true })
        .click()
      await expect(guide).toBeHidden()
      await expect(library).toBeVisible()
      canvas.assertNoErrors()
    })
  })
}
