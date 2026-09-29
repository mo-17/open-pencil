const EN = {
  title: 'Title',
  description: 'Description',
  label: 'Label',
  href: 'Link',
  current: 'Initial step',
  status: 'Step status',
  auto: 'Automatic',
  completed: 'Completed',
  error: 'Error',
  disabled: 'Disabled',
  newItem: 'New item',
  invalid: 'Check item titles, lengths and links before applying.',
  restore: 'Restore saved items',
  breadcrumbHint:
    'The last item is the current page. Earlier items may link to a route, anchor or HTTPS page.',
  stepperHint:
    'Reordering preserves the initial step. Clicking steps changes local progress only; it does not submit a form.',
  localState:
    'Initial values are saved in the document. Interactions stay in this preview session; form submission and data binding are not connected.'
}
export function navigationEditorCopy(locale: string): typeof EN {
  return locale.startsWith('zh')
    ? {
        title: '标题',
        description: '说明',
        label: '名称',
        href: '链接',
        current: '初始步骤',
        status: '步骤状态',
        auto: '自动',
        completed: '已完成',
        error: '错误',
        disabled: '禁用',
        newItem: '新项目',
        invalid: '请检查项目标题、长度和链接后再应用。',
        restore: '恢复已保存项目',
        breadcrumbHint: '最后一项代表当前页面；前面的项目可链接至站内路径、锚点或 HTTPS 页面。',
        stepperHint: '调整顺序会保留初始步骤。点击步骤仅切换本地进度，不会提交表单。',
        localState: '初值保存在文档中，交互结果仅保留在本次预览；尚未接入表单提交和数据绑定。'
      }
    : EN
}
