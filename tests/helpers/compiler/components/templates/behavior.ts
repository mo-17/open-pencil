import { expect, type Page } from '@playwright/test'

import { exerciseAdvancedFieldTemplate } from './advanced-fields-behavior'
import { exerciseCascaderTemplate } from './cascader-behavior'
import { exerciseChartTemplate } from './charts-behavior'
import { exerciseCompositionTemplate } from './compositions-behavior'
import { exerciseContentTemplate } from './content-behavior'
import { exerciseControlTemplate } from './controls-behavior'
import { exerciseDisplayTemplate } from './display-behavior'
import { exerciseFeedbackTemplate } from './feedback-behavior'
import { exerciseFieldTemplate } from './fields-behavior'
import type { TemplateId } from './fixture'
import { exerciseFoundationTemplate } from './foundations-behavior'
import { exerciseInputTemplate } from './inputs-behavior'
import { exerciseOrgChartTemplate } from './org-chart-behavior'
import { exercisePaginationTemplate } from './pagination-behavior'
import { exercisePickerTemplate } from './pickers-behavior'
import { exerciseWalktourTemplate } from './walktour-behavior'

async function submitLocalForm(page: Page) {
  const save = page.getByRole('button', { name: '本地保存', exact: true })
  await save.click()
  await expect(page.getByText('状态: 尚未提交', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: '姓名', exact: true }).fill('李明')
  const email = page.getByRole('textbox', { name: '邮箱', exact: true })
  await email.fill('invalid')
  await email.blur()
  await expect(email).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByText('请输入有效邮箱', { exact: true })).toBeVisible()
  await email.fill('reader@example.com')
  await email.blur()
  await save.click()
  await expect(page.getByText('状态: 已保存到本次运行', { exact: true })).toBeVisible()
}

export async function exerciseTemplate(page: Page, id: TemplateId): Promise<void> {
  if (await exerciseCompositionTemplate(page, id)) return
  if (await exerciseCascaderTemplate(page, id)) return
  if (await exerciseWalktourTemplate(page, id)) return
  if (await exerciseOrgChartTemplate(page, id)) return
  if (await exercisePaginationTemplate(page, id)) return
  if (await exercisePickerTemplate(page, id)) return
  if (await exerciseAdvancedFieldTemplate(page, id)) return
  if (await exerciseFieldTemplate(page, id)) return
  if (await exerciseInputTemplate(page, id)) return
  if (await exerciseContentTemplate(page, id)) return
  if (await exerciseChartTemplate(page, id)) return
  if (await exerciseFeedbackTemplate(page, id)) return
  if (await exerciseDisplayTemplate(page, id)) return
  if (await exerciseFoundationTemplate(page, id)) return
  await exerciseExistingTemplate(page, id)
}

async function exerciseExistingTemplate(page: Page, id: TemplateId): Promise<void> {
  switch (id) {
    case 'accordion-faq': {
      const first = page.getByRole('button', { name: '如何编辑内容？', exact: true })
      const second = page.getByRole('button', { name: '能同时展开多个回答吗？', exact: true })
      await expect(first).toHaveAttribute('aria-expanded', 'true')
      await first.focus()
      await first.press('ArrowDown')
      await expect(second).toBeFocused()
      await second.press('Enter')
      await expect(first).toHaveAttribute('aria-expanded', 'false')
      await expect(second).toHaveAttribute('aria-expanded', 'true')
      break
    }
    case 'button':
      await page.getByRole('button', { name: '加一', exact: true }).click()
      await expect(page.getByText('点击次数: 1', { exact: true })).toBeVisible()
      break
    case 'input':
    case 'textarea':
      await page.getByRole('textbox', { name: '输入内容', exact: true }).fill('中文 and English')
      await expect(page.getByText('当前值: 中文 and English', { exact: true })).toBeVisible()
      break
    case 'select':
      await page.getByRole('combobox', { name: '配送方式' }).selectOption('express')
      await expect(page.getByText('当前值: express', { exact: true })).toBeVisible()
      await expect(page.getByRole('option', { name: '暂不可用' })).toBeDisabled()
      break
    case 'checkbox':
    case 'switch': {
      const field = page.getByRole(id === 'switch' ? 'switch' : 'checkbox', { name: '启用选项' })
      await field.check()
      await expect(page.getByText('当前值: 已启用', { exact: true })).toBeVisible()
      await field.uncheck()
      await expect(page.getByText('当前值: 未启用', { exact: true })).toBeVisible()
      break
    }
    case 'radio':
      await page.getByRole('radio', { name: '团队', exact: true }).check()
      await expect(page.getByText('当前值: 团队', { exact: true })).toBeVisible()
      await expect(page.getByRole('radio', { name: '个人', exact: true })).not.toBeChecked()
      break
    case 'datepicker':
      await page.getByLabel('日期', { exact: true }).fill('2026-10-02')
      await expect(page.getByText('当前值: 2026-10-02', { exact: true })).toBeVisible()
      break
    case 'search-toolbar': {
      const search = page.getByRole('textbox', { name: '搜索名称', exact: true })
      await search.fill('Alpha')
      await expect(page.getByText('Beta', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: '搜索', exact: true }).click()
      await expect(page.getByText('Alpha', { exact: true })).toBeVisible()
      await expect(page.getByText('Beta', { exact: true })).toHaveCount(0)
      await search.fill('alpha')
      await page.getByRole('button', { name: '搜索', exact: true }).click()
      await expect(
        page.getByText('没有匹配记录，请重置或输入 Alpha。', { exact: true })
      ).toBeVisible()
      await page.getByRole('button', { name: '重置搜索', exact: true }).click()
      await expect(search).toHaveValue('')
      for (const name of ['Alpha', 'Beta', 'Gamma'])
        await expect(page.getByText(name, { exact: true })).toBeVisible()
      break
    }
    case 'validated-form':
      await submitLocalForm(page)
      break
    case 'settings-card':
      await page.getByRole('switch', { name: '通知', exact: true }).uncheck()
      await page.getByRole('combobox', { name: '密度', exact: true }).selectOption('compact')
      await page.getByRole('button', { name: '应用偏好', exact: true }).click()
      await expect(page.getByText('状态: 已在本地应用：compact', { exact: true })).toBeVisible()
      await expect(page.getByRole('switch', { name: '通知', exact: true })).not.toBeChecked()
      break
    case 'dialog-form':
      await page.getByRole('button', { name: '编辑资料', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await submitLocalForm(page)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByRole('button', { name: '编辑资料', exact: true })).toBeFocused()
      await page.getByRole('button', { name: '编辑资料', exact: true }).click()
      await expect(page.getByRole('textbox', { name: '姓名', exact: true })).toHaveValue('李明')
      await page.getByRole('textbox', { name: '姓名', exact: true }).fill('陈宇')
      await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByRole('button', { name: '编辑资料', exact: true })).toBeFocused()
      await page.getByRole('button', { name: '编辑资料', exact: true }).click()
      await expect(page.getByRole('textbox', { name: '姓名', exact: true })).toHaveValue('陈宇')
      break
    case 'tabs-details': {
      const overview = page.getByRole('tab', { name: '概览', exact: true })
      const details = page.getByRole('tab', { name: '详情', exact: true })
      await overview.focus()
      await overview.press('ArrowRight')
      await expect(details).toBeFocused()
      await expect(overview).toHaveAttribute('aria-selected', 'true')
      await details.press('Enter')
      await expect(details).toHaveAttribute('aria-selected', 'true')
      await submitLocalForm(page)
      await overview.click()
      await expect(page.getByRole('textbox', { name: '姓名', exact: true })).toHaveCount(0)
      await details.click()
      await expect(page.getByRole('textbox', { name: '姓名', exact: true })).toHaveValue('李明')
      break
    }
    case 'upload': {
      const chooserPromise = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: '选择本地文件', exact: true }).click()
      await (
        await chooserPromise
      ).setFiles([
        { name: 'local-example.txt', mimeType: 'text/plain', buffer: Buffer.from('local only') }
      ])
      const selectedFile = page
        .getByRole('list', { name: 'Files selected locally', exact: true })
        .getByRole('listitem')
        .filter({ hasText: 'local-example.txt' })
      await expect(selectedFile).toBeVisible()
      await expect(
        selectedFile.getByRole('button', {
          name: 'Remove local-example.txt from local selection',
          exact: true
        })
      ).toBeVisible()
      await page.getByRole('switch', { name: '禁用文件选择' }).check()
      await expect(page.getByRole('button', { name: '选择本地文件', exact: true })).toBeDisabled()
      await page.getByRole('switch', { name: '禁用文件选择' }).uncheck()
      await page.getByRole('button', { name: 'Clear local selection', exact: true }).click()
      await expect(selectedFile).toHaveCount(0)
      break
    }
    case 'data-grid':
    case 'filterable-table': {
      const grid = page.locator('[data-openpencil-data-grid]')
      await grid
        .getByRole('checkbox', { name: /选择行 sample-0|Select row sample-0/, exact: true })
        .check()
      await expect(grid.getByRole('status')).toContainText(/已选择 1 行|1 selected/)
      await grid.getByRole('searchbox').first().fill('no matching record')
      await expect(grid.locator('tbody input[type="checkbox"]')).toHaveCount(0)
      await grid
        .getByRole('button', { name: /清空列筛选|Clear column filters/, exact: true })
        .click()
      await expect(grid.getByRole('searchbox').first()).toHaveValue('')
      await expect(grid.getByRole('status')).toContainText(/已选择 1 行|1 selected/)
      await grid.getByRole('button', { name: /清除选择|Clear selection/, exact: true }).click()
      await expect(grid.getByRole('status')).toContainText(/已选择 0 行|0 selected/)
      break
    }
    default:
      await exerciseControlTemplate(page, id)
      break
  }
}
