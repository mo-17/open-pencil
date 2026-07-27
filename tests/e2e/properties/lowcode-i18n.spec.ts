import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup()

async function switchToSimplifiedChinese(): Promise<void> {
  if ((await editor.page.getByTestId('properties-tab-design').textContent())?.trim() === '设计') {
    return
  }
  await editor.page.getByRole('menuitem', { name: 'View', exact: true }).click()
  await editor.page.getByRole('menuitem', { name: 'Language' }).hover()
  await editor.page.getByRole('menuitemcheckbox', { name: '中文（简体）' }).click()
}

test('document control panels render fields and feedback in Simplified Chinese', async () => {
  await switchToSimplifiedChinese()
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.clearSelection()
  })
  await editor.canvas.waitForRender()

  await expect(editor.page.getByTestId('properties-tab-design')).toHaveText('设计')

  const analytics = editor.page.getByTestId('lowcode-analytics-config-section')
  await expect(analytics.getByText('数据分析', { exact: true })).toBeVisible()
  await expect(analytics.getByLabel('启用数据分析')).toBeChecked()
  await expect(analytics.getByText('跟踪页面浏览', { exact: true })).toBeVisible()
  await expect(analytics.getByLabel('同意预设')).toHaveValue('')
  await expect(analytics.getByLabel('数据分析服务商')).toHaveValue('ga4')
  await expect(analytics).toContainText('请输入 GA4 网页数据流的衡量 ID')
  await expect(analytics).toContainText('GA4 通过 Google Tag Manager 加载')

  const analyticsId = analytics.getByLabel('衡量 ID')
  await analyticsId.fill('invalid')
  await analyticsId.blur()
  await expect(analytics.getByTestId('lowcode-analytics-id-error')).toHaveText(
    'GA4 衡量 ID 应类似 G-...'
  )

  await analytics.getByTestId('lowcode-analytics-consent-required').click()
  await expect(analytics.getByLabel('数据分析同意横幅文本')).toBeVisible()
  await expect(analytics.getByLabel('数据分析用途说明')).toBeVisible()
  await expect(analytics.getByLabel('隐私政策 URL')).toBeVisible()

  const customCode = editor.page.getByTestId('lowcode-custom-code-section')
  await expect(customCode.getByText('自定义页头与 CSS', { exact: true })).toBeVisible()
  await expect(customCode).toContainText('添加用于 SEO、CSP 或社交预览的结构化元数据标签')
  await expect(customCode.getByLabel('页头样式')).toBeVisible()
  await expect(customCode.getByLabel('应用 CSS')).toBeVisible()

  await customCode.getByTestId('lowcode-custom-head-meta-add').click()
  await expect(customCode.getByLabel('元数据类型')).toBeVisible()
  await expect(customCode.getByLabel('元数据键')).toBeVisible()
  await expect(customCode.getByLabel('元数据内容')).toBeVisible()

  await customCode.getByTestId('lowcode-custom-head-link-add').click()
  await expect(customCode.getByLabel('链接 rel 属性')).toBeVisible()
  await expect(customCode.getByLabel('链接地址')).toBeVisible()
  await expect(customCode.getByLabel('链接跨域模式')).toBeVisible()

  const headStyles = customCode.getByLabel('页头样式')
  await headStyles.fill(':root { color-scheme: light; }')
  await headStyles.blur()
  await expect(customCode.getByText('部署 CSP 检查', { exact: true })).toBeVisible()
  await expect(customCode).toContainText('内联页头样式可能需要 CSP 放行')
})

test('workflow, translation, and library controls render dynamic content in Simplified Chinese', async () => {
  await switchToSimplifiedChinese()
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const page = store.graph.getNode(store.state.currentPageId)
    if (!page) throw new Error('Current page not found')

    store.graph.createNode('TEXT', page.id, {
      name: 'TranslationSource',
      text: '测试文案',
      x: 24,
      y: 24,
      width: 120,
      height: 24
    })
    store.graph.updateNode(store.graph.rootId, {
      lowcodeWorkflows: [
        {
          id: 'wf-notify',
          name: '通知',
          params: ['message'],
          actions: [{ id: 'call-missing', kind: 'callWorkflow', workflowId: 'wf-missing' }]
        }
      ],
      lowcodeTranslations: {},
      lowcodeLibraries: [
        {
          libraryId: 'design-system',
          name: '设计系统',
          source: { kind: 'file', ref: 'design-system.fig' },
          importedComponents: [{ key: 'component-card', version: 'v1' }]
        }
      ]
    })
    store.clearSelection()
    store.requestRender()
  })
  await editor.canvas.waitForRender()

  const workflows = editor.page.getByTestId('lowcode-workflows-section')
  await workflows.scrollIntoViewIfNeeded()
  await expect(workflows.getByText('工作流', { exact: true })).toBeVisible()
  await expect(workflows.getByLabel('工作流名称')).toHaveValue('通知')
  await expect(workflows.getByLabel('工作流页面范围')).toBeVisible()
  await expect(workflows.getByLabel('参数名称')).toHaveValue('message')
  await expect(workflows.getByLabel('参数默认表达式')).toHaveAttribute(
    'placeholder',
    '默认值（可选）'
  )
  await expect(workflows.getByTestId('lowcode-workflow-graph-summary')).toContainText(
    '1 个工作流，1 个操作，1 个调用，0 个入口'
  )
  await expect(workflows.getByTestId('lowcode-workflow-graph-issue')).toContainText(
    '通知 调用了缺失的工作流（wf-missing）'
  )
  await expect(workflows.getByTestId('lowcode-workflow-graph-entrypoint')).toContainText(
    '无事件入口：通知'
  )

  await workflows.getByTestId('lowcode-workflow-graph-toggle').click()
  await expect(workflows.getByTestId('lowcode-workflow-graph-map-filter-all')).toHaveText('全部')
  await expect(workflows.getByTestId('lowcode-workflow-graph-map-filter-issues')).toHaveText('问题')
  await expect(workflows.getByTestId('lowcode-workflow-graph-map-filter-entries')).toHaveText(
    '入口'
  )
  await expect(workflows.getByTestId('lowcode-workflow-graph-map-summary')).toContainText(
    '1 个节点，1 条连线'
  )
  await expect(workflows.getByTestId('lowcode-workflow-graph-map-issue-type')).toHaveText('缺失')
  await expect(workflows.getByTestId('lowcode-workflow-graph-map-edge-missing')).toHaveText('缺失')
  await expect(workflows.getByTestId('lowcode-workflow-graph-map-edge-branch')).toHaveText('根')
  await workflows.getByTestId('lowcode-workflow-graph-map-search').fill('根')
  await expect(workflows.getByTestId('lowcode-workflow-graph-map-search-summary')).toContainText(
    '匹配“根”：1 个节点，1 条连线'
  )

  const translations = editor.page.getByTestId('lowcode-translations-section')
  await translations.scrollIntoViewIfNeeded()
  await expect(translations.getByText('翻译', { exact: true })).toBeVisible()
  await translations.getByLabel('新目标语言').fill('zh-Hant')
  await translations.getByTestId('lowcode-translations-add-locale').click()
  await expect(translations.getByLabel('要编辑的语言')).toHaveValue('zh-Hant')
  await expect(translations.getByLabel('“测试文案”的译文')).toBeVisible()
  await expect(translations.getByLabel('删除语言 zh-Hant')).toBeVisible()

  const libraries = editor.page.getByTestId('lowcode-libraries-section')
  await libraries.scrollIntoViewIfNeeded()
  await expect(libraries.getByText('组件库', { exact: true })).toBeVisible()
  await expect(libraries).toContainText('1 个导入组件')
  await expect(libraries.getByLabel('选择组件库清单文件')).toBeAttached()
  await expect(libraries.getByLabel('选择组件库源文件')).toBeAttached()
  await expect(libraries.getByTestId('lowcode-library-status')).toHaveText('未知')
  await expect(libraries).toContainText('当前版本')
  await expect(libraries).toContainText('最新版本')
  await expect(libraries.getByLabel('接受 component-card 的更新')).toHaveText('接受更新')
})
