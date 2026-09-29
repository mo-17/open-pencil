import {
  createAccordionModuleFrameOverrides,
  createModalModuleFrameOverrides,
  createTabsModuleFrameOverrides
} from '@open-pencil/core/plugins'

import type { ComponentTemplateId } from './catalog'
import { addTemplateGrid } from './modules'
import { addPaginatedListTemplate } from './pagination'
import { TEMPLATE_COLORS, templateSurface, type TemplateContext } from './presentation'

function addForm(ctx: TemplateContext, parent: string, contentName?: string) {
  const { copy } = ctx
  const name = ctx.state('name', 'string', '')
  const email = ctx.state('email', 'string', '')
  const result = ctx.state('result', 'string', copy('Not submitted', '尚未提交'))
  const form = ctx.node('FORM', parent, contentName ?? copy('Profile form', '资料表单'), {
    fills: [],
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    itemSpacing: 12,
    counterAxisAlign: 'STRETCH',
    events: {
      onSubmit: [
        ctx.set(result, JSON.stringify(copy('Saved locally for this run', '已保存到本次运行')))
      ]
    }
  })
  ctx.field(form, 'INPUT', copy('Name', '姓名'), name, {
    autoComplete: 'name',
    maxLength: 80,
    validation: { required: true, messages: { required: copy('Enter your name', '请输入姓名') } }
  })
  ctx.field(form, 'INPUT', copy('Email', '邮箱'), email, {
    inputType: 'email',
    autoComplete: 'email',
    maxLength: 120,
    validation: {
      required: true,
      pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
      messages: {
        required: copy('Enter your email', '请输入邮箱'),
        pattern: copy('Enter a valid email', '请输入有效邮箱')
      }
    }
  })
  ctx.button(form, copy('Save locally', '本地保存'), [], false, true)
  ctx.feedback(form, result, copy('Status', '状态'))
  return form
}

function addSearch(ctx: TemplateContext, root: string) {
  const { copy } = ctx
  const draft = ctx.localState('query', 'string', '')
  const applied = ctx.state('search', 'string', '')
  ctx.field(root, 'INPUT', copy('Search name', '搜索名称'), draft, {
    placeholder: 'Alpha / Beta / Gamma',
    maxLength: 80
  })
  ctx.text(
    root,
    copy(
      'Exact-name matching, including letter case. Search is local.',
      '按完整名称精确匹配，区分大小写；搜索仅在本地进行。'
    ),
    { fontSize: 12 }
  )
  ctx.button(root, copy('Search', '搜索'), [ctx.set(applied, draft)])
  ctx.button(
    root,
    copy('Reset search', '重置搜索'),
    [ctx.set(draft, '""'), ctx.set(applied, '""')],
    true
  )
  for (const label of ['Alpha', 'Beta', 'Gamma']) {
    const row = ctx.stack(root, label + ' result', {
      ...templateSurface(TEMPLATE_COLORS.tint),
      paddingTop: 12,
      paddingBottom: 12,
      paddingLeft: 12,
      paddingRight: 12,
      renderCondition: `${applied} === "" || ${applied} === ${JSON.stringify(label)}`
    })
    ctx.text(row, label, { fontWeight: 600 })
    ctx.text(row, copy('Local sample record', '本地示例记录'), { fontSize: 12 })
  }
  ctx.text(
    root,
    copy('No matching records. Reset or try Alpha.', '没有匹配记录，请重置或输入 Alpha。'),
    {
      renderCondition: `${applied} !== "" && ${applied} !== "Alpha" && ${applied} !== "Beta" && ${applied} !== "Gamma"`
    }
  )
}

function addSettings(ctx: TemplateContext, root: string) {
  const { copy } = ctx
  const notifications = ctx.state('notifications', 'boolean', true)
  const density = ctx.localState('density', 'string', 'comfortable')
  const status = ctx.state(
    'status',
    'string',
    copy('Unsaved changes stay in this run', '未保存更改仅在本次运行中保留')
  )
  ctx.field(root, 'SWITCH', copy('Notifications', '通知'), notifications)
  ctx.field(root, 'SELECT', copy('Density', '密度'), density, {
    options: [
      { label: copy('Comfortable', '舒适'), value: 'comfortable' },
      { label: copy('Compact', '紧凑'), value: 'compact' }
    ]
  })
  ctx.button(root, copy('Apply preferences', '应用偏好'), [
    ctx.set(status, `${JSON.stringify(copy('Applied locally: ', '已在本地应用：'))} + ${density}`)
  ])
  ctx.feedback(root, status, copy('Status', '状态'))
}

export function buildCombinationTemplate(
  ctx: TemplateContext,
  root: string,
  id: ComponentTemplateId
): void {
  const { copy } = ctx
  switch (id) {
    case 'paginated-list':
      addPaginatedListTemplate(ctx, root)
      break
    case 'accordion-faq':
      ctx.node('FRAME', root, copy('Questions and answers', '问题与答案'), {
        ...createAccordionModuleFrameOverrides({
          label: copy('Frequently asked questions', '常见问题'),
          items: [
            {
              id: 'getting-started',
              title: copy('How do I edit the content?', '如何编辑内容？'),
              content: copy(
                'Select this accordion and edit each title and answer in the design panel.\nYou can reorder sections and choose which answers start expanded.',
                '选中此折叠面板，在设计面板编辑每项标题和回答。\n可以调整顺序，并选择初始展开的内容。'
              )
            },
            {
              id: 'interaction',
              title: copy('Can several answers stay open?', '能同时展开多个回答吗？'),
              content: copy(
                'Enable Allow multiple open in the design panel. In preview, use Enter or Space to expand an answer and arrow keys to move between headings.',
                '在设计面板开启“允许同时展开多项”。预览中可用回车或空格展开回答，用方向键切换标题焦点。'
              )
            },
            {
              id: 'privacy',
              title: copy('Does this connect to a service?', '是否会连接外部服务？'),
              content: copy(
                'These answers are plain text stored in this document. This example does not send requests or require an account.',
                '回答是保存在当前文档中的纯文本。此示例不会发送网络请求，也不需要账户。'
              )
            }
          ],
          initialOpenIds: ['getting-started'],
          allowMultiple: false,
          textColor: TEMPLATE_COLORS.ink,
          accentColor: TEMPLATE_COLORS.accent
        }),
        width: 320,
        height: 360,
        counterAxisSizing: 'FILL'
      })
      break
    case 'search-toolbar':
      addSearch(ctx, root)
      break
    case 'validated-form':
      addForm(ctx, root)
      break
    case 'settings-card':
      addSettings(ctx, root)
      break
    case 'dialog-form': {
      const contentName = copy('Dialog form content', '弹窗表单内容')
      const modal = ctx.node('FRAME', root, copy('Profile dialog', '资料弹窗'), {
        ...createModalModuleFrameOverrides({
          triggerLabel: copy('Edit profile', '编辑资料'),
          title: copy('Profile', '资料'),
          contentChildName: contentName,
          showConfirmButton: false,
          cancelLabel: copy('Close', '关闭')
        }),
        width: 320,
        height: 52,
        counterAxisSizing: 'FILL'
      })
      addForm(ctx, modal, contentName)
      break
    }
    case 'tabs-details': {
      const overview = copy('Overview content', '概览内容')
      const details = copy('Details form content', '详情表单内容')
      const tabs = ctx.node('FRAME', root, copy('Profile tabs', '资料标签页'), {
        ...createTabsModuleFrameOverrides({
          tabs: [
            {
              id: 'overview',
              label: copy('Overview', '概览'),
              content: '',
              contentChildName: overview
            },
            {
              id: 'details',
              label: copy('Details', '详情'),
              content: '',
              contentChildName: details
            }
          ],
          initialTabId: 'overview',
          activationMode: 'manual'
        }),
        width: 320,
        height: 550,
        counterAxisSizing: 'FILL'
      })
      const body = ctx.stack(tabs, overview)
      ctx.text(body, copy('Everything has a place', '信息各就其位'), {
        fontSize: 20,
        fontWeight: 600
      })
      ctx.text(
        body,
        copy(
          'Open Details to edit a local profile. Keyboard arrows move between tabs.',
          '打开“详情”编辑本地资料，可用方向键切换标签焦点。'
        )
      )
      addForm(ctx, tabs, details)
      break
    }
    case 'filterable-table':
      ctx.text(
        root,
        copy(
          'Filter columns, select across pages, then clear deliberately.',
          '按列筛选、跨页选择，并通过明确操作清除。'
        )
      )
      addTemplateGrid(ctx, root, true)
      ctx.text(
        root,
        copy(
          'CSV and selection remain local. This is not a backend list.',
          'CSV 与选择仅保留在本地，这不是后端列表。'
        ),
        { fontSize: 12 }
      )
      break
  }
}
