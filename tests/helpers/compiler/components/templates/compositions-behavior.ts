import { expect, type Page } from '@playwright/test'

import type { TemplateId } from './fixture'

export type CompositionLocale = 'en' | 'zh-CN'

function compositionCopy(locale: CompositionLocale) {
  return (en: string, zh: string) => (locale === 'zh-CN' ? zh : en)
}

async function exerciseStepperForm(page: Page, locale: CompositionLocale): Promise<void> {
  const copy = compositionCopy(locale)
  const name = page.getByRole('textbox', { name: copy('Name', '姓名'), exact: true })
  const email = page.getByRole('textbox', { name: copy('Email', '邮箱'), exact: true })
  const next = page.getByRole('button', {
    name: copy('Continue to preferences', '继续填写偏好'),
    exact: true
  })
  const previous = page.getByRole('button', { name: copy('Previous step', '上一步'), exact: true })
  const pending = page.getByText(copy('Status: Not completed', '状态: 尚未完成'), { exact: true })
  const stepper = page.locator('[data-openpencil-stepper]')
  await expect(previous).toBeDisabled()
  await expect(stepper.locator('button')).toHaveCount(0)
  await next.click()
  await expect(name).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByText(copy('Enter your name', '请输入姓名'), { exact: true })).toBeVisible()
  await expect(pending).toBeVisible()
  await name.fill(copy('Jordan Lee', '李明'))
  await email.fill('invalid')
  await email.blur()
  await next.click()
  await expect(email).toHaveAttribute('aria-invalid', 'true')
  await expect(
    page.getByText(copy('Enter a valid email', '请输入有效邮箱'), { exact: true })
  ).toBeVisible()
  await expect(next).toBeVisible()
  await email.fill('reader@example.com')
  await email.blur()
  await next.click()

  const direction = page.getByRole('combobox', {
    name: copy('Project direction', '项目方向'),
    exact: true
  })
  const review = page.getByRole('button', {
    name: copy('Continue to review', '继续检查内容'),
    exact: true
  })
  await expect(direction).toBeVisible()
  await expect(name).toHaveCount(0)
  await review.click()
  await expect(direction).toHaveAttribute('aria-invalid', 'true')
  await expect(
    page.getByText(copy('Choose a project direction', '请选择项目方向'), { exact: true })
  ).toBeVisible()
  await direction.selectOption('design')
  await previous.click()
  await expect(name).toHaveValue(copy('Jordan Lee', '李明'))
  await expect(email).toHaveValue('reader@example.com')
  await next.click()
  await expect(direction).toHaveValue('design')
  await review.click()
  await expect(
    page.getByText(copy('Name: Jordan Lee', '姓名: 李明'), { exact: true })
  ).toBeVisible()
  await expect(
    page.getByText(copy('Email: reader@example.com', '邮箱: reader@example.com'), { exact: true })
  ).toBeVisible()
  await expect(
    page.getByText(copy('Project direction: Design', '项目方向: 设计'), { exact: true })
  ).toBeVisible()
  const complete = page.getByRole('button', {
    name: copy('Complete locally', '在本地完成'),
    exact: true
  })
  await complete.click()
  await expect(
    page.getByText(copy('Status: Completed for this run', '状态: 已在本次运行中完成'), {
      exact: true
    })
  ).toBeVisible()
  await page.getByRole('button', { name: copy('Start again', '开始重填'), exact: true }).click()
  await expect(name).toHaveValue('')
  await expect(email).toHaveValue('')
  await expect(previous).toBeDisabled()
  await expect(pending).toBeVisible()
  await name.fill(copy('Taylor Wu', '陈宇'))
  await email.fill('second@example.com')
  await next.click()
  await expect(direction).toHaveValue('')
  await direction.selectOption('development')
  await review.click()
  await complete.click()
  await expect(page.getByText(copy('Name: Taylor Wu', '姓名: 陈宇'), { exact: true })).toBeVisible()
  await expect(
    page.getByText(copy('Project direction: Development', '项目方向: 开发'), { exact: true })
  ).toBeVisible()
  await expect(stepper.locator('[aria-current="step"]')).toHaveCount(1)
}

async function exerciseTreeDetails(page: Page, locale: CompositionLocale): Promise<void> {
  const copy = compositionCopy(locale)
  const tree = page.getByRole('tree', { name: copy('Project categories', '项目分类'), exact: true })
  const development = tree.getByRole('treeitem', { name: copy('Development', '开发'), exact: true })
  const research = tree.getByRole('treeitem', { name: copy('Research', '研究'), exact: true })
  const archive = tree.getByRole('treeitem', { name: copy('Archive', '归档'), exact: true })
  await expect(
    tree.getByRole('treeitem', { name: copy('Design', '设计'), exact: true })
  ).toHaveAttribute('aria-selected', 'true')
  await expect(
    page.getByText(copy('Category ID: design', '分类 ID: design'), { exact: true })
  ).toBeVisible()
  await development.click()
  await expect(development).toHaveAttribute('aria-selected', 'true')
  await expect(
    page.getByText(
      copy('Review implementation tasks and integration notes.', '查看实现任务与集成说明。'),
      { exact: true }
    )
  ).toBeVisible()
  await expect(archive).toHaveAttribute('aria-disabled', 'true')
  await archive.focus()
  await archive.press('Enter')
  await expect(development).toHaveAttribute('aria-selected', 'true')
  await expect(archive).toHaveAttribute('aria-selected', 'false')
  await page.getByRole('button', { name: copy('Clear selection', '清空选择'), exact: true }).click()
  await expect(
    page.getByText(copy('Choose a category to view details.', '选择分类后查看详情。'), {
      exact: true
    })
  ).toBeVisible()
  await expect(tree.locator('[aria-selected="true"]')).toHaveCount(0)

  const search = page.getByRole('searchbox', {
    name: copy('Search tree items', '搜索树节点'),
    exact: true
  })
  await search.fill('no matching category')
  await expect(tree.getByRole('treeitem')).toHaveCount(0)
  await expect(
    page.getByText(copy('No matching items', '没有匹配节点'), { exact: true })
  ).toBeVisible()
  await search.fill(copy('Research', '研究'))
  await expect(tree.getByRole('treeitem')).toHaveCount(2)
  await research.click()
  await expect(
    page.getByText(copy('Category ID: research', '分类 ID: research'), { exact: true })
  ).toBeVisible()
  await search.fill('')
  await expect(tree.getByRole('treeitem')).toHaveCount(5)
  await tree
    .getByRole('button', { name: copy('Collapse Project', '收起 项目'), exact: true })
    .click()
  await expect(research).toHaveCount(0)
  await expect(
    page.getByText(copy('Category ID: research', '分类 ID: research'), { exact: true })
  ).toBeVisible()
  await tree.getByRole('button', { name: copy('Expand Project', '展开 项目'), exact: true }).click()
  await expect(research).toHaveAttribute('aria-selected', 'true')
  await expect(
    page.getByText(
      copy('Review interview notes and product questions.', '查看访谈记录与产品问题。'),
      { exact: true }
    )
  ).toBeVisible()
}

async function exerciseDrawerDetails(page: Page, locale: CompositionLocale): Promise<void> {
  const copy = compositionCopy(locale)
  const trigger = page.getByRole('button', { name: copy('Edit details', '编辑详情'), exact: true })
  const dialog = page.getByRole('dialog', {
    name: copy('Profile details', '资料详情'),
    exact: true
  })
  await trigger.click()
  await expect(dialog).toBeVisible()
  await expect
    .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true)
  const name = dialog.getByRole('textbox', { name: copy('Name', '姓名'), exact: true })
  const email = dialog.getByRole('textbox', { name: copy('Email', '邮箱'), exact: true })
  const save = dialog.getByRole('button', { name: copy('Save locally', '本地保存'), exact: true })
  await expect(name).toHaveValue(copy('Alex Chen', '陈明'))
  await expect(email).toHaveValue('alex@example.com')
  await name.fill('')
  await email.fill('')
  await save.click()
  await expect(name).toHaveAttribute('aria-invalid', 'true')
  await expect(
    dialog.getByText(copy('Enter your name', '请输入姓名'), { exact: true })
  ).toBeVisible()
  await expect(
    dialog.getByText(copy('Last submit: Not submitted', '上次提交: 尚未提交'), { exact: true })
  ).toBeVisible()
  await name.fill(copy('Jordan Lee', '李明'))
  await email.fill('invalid')
  await email.blur()
  await save.click()
  await expect(email).toHaveAttribute('aria-invalid', 'true')
  await expect(
    dialog.getByText(copy('Enter a valid email', '请输入有效邮箱'), { exact: true })
  ).toBeVisible()
  await email.fill('reader@example.com')
  await email.blur()
  await save.click()
  await expect(
    dialog.getByText(
      copy('Last submit: Saved locally for this run', '上次提交: 已保存到本次运行'),
      {
        exact: true
      }
    )
  ).toBeVisible()
  const reset = dialog.getByRole('button', { name: copy('Reset draft', '重置草稿'), exact: true })
  await dialog.locator('form').evaluate((form) => {
    form.addEventListener('reset', (event) => event.preventDefault(), { once: true })
  })
  await reset.click()
  await expect(name).toHaveValue(copy('Jordan Lee', '李明'))
  await expect(email).toHaveValue('reader@example.com')
  await reset.click()
  await expect(name).toHaveValue(copy('Alex Chen', '陈明'))
  await expect(email).toHaveValue('alex@example.com')
  await expect(
    dialog.getByText(
      copy('Last submit: Saved locally for this run', '上次提交: 已保存到本次运行'),
      { exact: true }
    )
  ).toBeVisible()
  await expect(name).not.toHaveAttribute('aria-invalid', 'true')
  await expect(email).not.toHaveAttribute('aria-invalid', 'true')
  await name.fill(copy('Taylor Wu', '陈宇'))
  await email.fill('draft@example.com')
  await dialog.getByRole('button', { name: /^Close(?: menu)?$/, exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await trigger.click()
  await expect(name).toHaveValue(copy('Taylor Wu', '陈宇'))
  await expect(email).toHaveValue('draft@example.com')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(
    page.getByText(copy('Draft name: Taylor Wu', '草稿姓名: 陈宇'), { exact: true })
  ).toBeVisible()
  await trigger.click()
  await expect(name).toHaveValue(copy('Taylor Wu', '陈宇'))
  await expect(email).toHaveValue('draft@example.com')
  await expect(dialog).toBeVisible()
  await expect
    .poll(() =>
      dialog.evaluate((element) => {
        const style = getComputedStyle(element)
        return (
          style.opacity === '1' &&
          (style.transform === 'none' || new DOMMatrixReadOnly(style.transform).isIdentity)
        )
      })
    )
    .toBe(true)
}

async function expectAdminViewport(
  page: Page,
  locale: CompositionLocale,
  width: number
): Promise<void> {
  await page.setViewportSize({ width, height: 1000 })
  const copy = compositionCopy(locale)
  const measurement = await page
    .getByRole('button', { name: copy('Overview', '概览'), exact: true })
    .evaluate((element) => {
      const navigation = element.parentElement
      const body = navigation?.parentElement
      const content = navigation?.nextElementSibling
      if (!navigation || !body || !(content instanceof HTMLElement)) return null
      const navRect = navigation.getBoundingClientRect()
      const contentRect = content.getBoundingClientRect()
      return {
        direction: getComputedStyle(body).flexDirection,
        nav: {
          left: navRect.left,
          right: navRect.right,
          top: navRect.top,
          bottom: navRect.bottom,
          width: navRect.width
        },
        content: {
          left: contentRect.left,
          right: contentRect.right,
          top: contentRect.top,
          width: contentRect.width
        }
      }
    })
  if (!measurement) throw new Error('Workspace navigation requires its editable layout containers')
  expect(measurement.direction).toBe(width === 1440 ? 'row' : 'column')
  expect(measurement.nav.left).toBeGreaterThanOrEqual(0)
  expect(measurement.content.right).toBeLessThanOrEqual(width + 1)
  if (width === 1440) {
    expect(measurement.nav.width).toBeCloseTo(180, 0)
    expect(measurement.content.left).toBeGreaterThanOrEqual(measurement.nav.right + 19)
    expect(measurement.content.top).toBeCloseTo(measurement.nav.top, 0)
  } else {
    expect(measurement.content.left).toBeCloseTo(measurement.nav.left, 0)
    expect(measurement.content.width).toBeCloseTo(measurement.nav.width, 0)
    expect(measurement.content.top).toBeGreaterThanOrEqual(measurement.nav.bottom + 11)
  }
}

async function exerciseAdminShell(page: Page, locale: CompositionLocale): Promise<void> {
  const copy = compositionCopy(locale)
  const overview = page.getByRole('button', { name: copy('Overview', '概览'), exact: true })
  const members = page.getByRole('button', { name: copy('Members', '成员'), exact: true })
  const preferences = page.getByRole('button', { name: copy('Preferences', '偏好'), exact: true })
  const handles = await Promise.all([
    overview.elementHandle(),
    members.elementHandle(),
    preferences.elementHandle()
  ])
  try {
    await expect(overview).toHaveText(copy('Overview · Current', '概览 · 当前'))
    await members.click()
    await expect(members).toBeFocused()
    await expect(members).toHaveText(copy('Members · Current', '成员 · 当前'))
    await expect(overview).toHaveText(copy('Overview', '概览'))
    await expect(
      page.getByText(copy('Workspace / Members', '工作区 / 成员'), { exact: true })
    ).toBeVisible()
    await expect(page.getByText(copy('Members panel', '成员面板'), { exact: true })).toBeVisible()
    await expect(page.getByText(copy('Overview panel', '概览面板'), { exact: true })).toHaveCount(0)
    for (const label of [
      copy('Alex Chen', '陈晓'),
      copy('Taylor Lin', '林雨'),
      copy('Morgan Wu', '吴晨')
    ])
      await expect(page.getByText(label, { exact: true })).toBeVisible()
    await preferences.click()
    const notifications = page.getByRole('switch', {
      name: copy('Show notifications', '显示通知'),
      exact: true
    })
    await expect(notifications).toBeChecked()
    await notifications.uncheck()
    await expect(
      page.getByText(copy('Notifications: Off', '通知: 关闭'), { exact: true })
    ).toBeVisible()
    await overview.click()
    await expect(page.getByText(copy('Overview panel', '概览面板'), { exact: true })).toBeVisible()
    await expect(notifications).toHaveCount(0)
    await preferences.click()
    await expect(notifications).not.toBeChecked()
    await expect(preferences).toHaveText(copy('Preferences · Current', '偏好 · 当前'))
    for (const handle of handles) {
      if (!handle) throw new Error('Workspace navigation button was unavailable')
      expect(await handle.evaluate((element) => element.isConnected)).toBe(true)
    }
    for (const width of [1440, 375]) await expectAdminViewport(page, locale, width)
  } finally {
    for (const handle of handles) await handle?.dispose()
  }
}

export async function exerciseCompositionTemplate(
  page: Page,
  id: TemplateId,
  locale: CompositionLocale = 'zh-CN'
): Promise<boolean> {
  switch (id) {
    case 'stepper-form':
      await exerciseStepperForm(page, locale)
      return true
    case 'tree-details':
      await exerciseTreeDetails(page, locale)
      return true
    case 'drawer-details':
      await exerciseDrawerDetails(page, locale)
      return true
    case 'admin-shell':
      await exerciseAdminShell(page, locale)
      return true
    default:
      return false
  }
}
