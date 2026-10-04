import { TEMPLATE_COLORS, templateSurface, type TemplateContext } from '../presentation'

function addNavigation(ctx: TemplateContext, parent: string, section: string) {
  const { copy } = ctx
  const navigation = ctx.stack(parent, copy('Workspace navigation', '工作区导航'), {
    ...templateSurface(TEMPLATE_COLORS.tint, true),
    width: 180,
    counterAxisSizing: 'FIXED',
    paddingTop: 12,
    paddingRight: 12,
    paddingBottom: 12,
    paddingLeft: 12,
    itemSpacing: 8,
    responsiveOverrides: { compact: { counterAxisSizing: 'FILL', minWidth: 0 } }
  })
  ctx.text(navigation, copy('Workspace', '工作区'), { fontWeight: 600 })
  for (const [id, en, cn] of [
    ['overview', 'Overview', '概览'],
    ['members', 'Members', '成员'],
    ['preferences', 'Preferences', '偏好']
  ]) {
    const label = copy(en, cn)
    const button = ctx.button(navigation, label, [ctx.set(section, JSON.stringify(id))], true)
    ctx.editor.updateNodeWithUndo(
      button,
      {
        height: 48,
        fontSize: 13,
        lineHeight: 20,
        bindings: {
          text: {
            kind: 'expr',
            expr: `${section} === ${JSON.stringify(id)} ? ${JSON.stringify(label + copy(' · Current', ' · 当前'))} : ${JSON.stringify(label)}`
          }
        }
      },
      copy('Mark current workspace section', '标记当前工作区栏目')
    )
  }
  ctx.text(navigation, copy('Local demo', '本地示例'), { fontSize: 12 })
}

function addPanel(
  ctx: TemplateContext,
  parent: string,
  section: string,
  id: string,
  label: string
) {
  const panel = ctx.stack(parent, label, {
    ...templateSurface(TEMPLATE_COLORS.paper, true),
    paddingTop: 16,
    paddingRight: 16,
    paddingBottom: 16,
    paddingLeft: 16,
    itemSpacing: 10,
    renderCondition: `${section} === ${JSON.stringify(id)}`
  })
  ctx.text(panel, label, { fontSize: 20, lineHeight: 28, fontWeight: 600 })
  return panel
}

/** Ordinary editable nodes form a local workspace; section changes keep navigation mounted. */
export function addAdminShellTemplate(ctx: TemplateContext, root: string): void {
  const { copy } = ctx
  const section = ctx.localState('section', 'string', 'overview')
  const notifications = ctx.localState('notifications', 'boolean', true)
  const body = ctx.stack(root, copy('Workspace layout', '工作区布局'), {
    layoutMode: 'HORIZONTAL',
    width: 820,
    primaryAxisSizing: 'FILL',
    counterAxisSizing: 'HUG',
    counterAxisAlign: 'MIN',
    itemSpacing: 20,
    responsiveOverrides: {
      compact: {
        layoutMode: 'VERTICAL',
        primaryAxisSizing: 'HUG',
        counterAxisSizing: 'FILL',
        counterAxisAlign: 'STRETCH',
        minWidth: 0,
        itemSpacing: 12
      }
    }
  })
  addNavigation(ctx, body, section)
  const content = ctx.stack(body, copy('Workspace content', '工作区内容'), {
    width: 620,
    counterAxisSizing: 'FIXED',
    layoutGrow: 1,
    responsiveOverrides: {
      compact: { counterAxisSizing: 'FILL', minWidth: 0, layoutGrow: 0 }
    }
  })
  const labels = [copy('Overview', '概览'), copy('Members', '成员'), copy('Preferences', '偏好')]
  ctx.text(content, copy('Workspace / Overview', '工作区 / 概览'), {
    fontSize: 13,
    fills: templateSurface(TEMPLATE_COLORS.muted).fills,
    bindings: {
      text: {
        kind: 'expr',
        expr: `${JSON.stringify(copy('Workspace / ', '工作区 / '))} + (${section} === "members" ? ${JSON.stringify(labels[1])} : ${section} === "preferences" ? ${JSON.stringify(labels[2])} : ${JSON.stringify(labels[0])})`
      }
    }
  })
  const overview = addPanel(ctx, content, section, 'overview', copy('Overview panel', '概览面板'))
  ctx.text(overview, copy('A place for your daily work', '日常工作的起点'), { fontWeight: 600 })
  ctx.text(
    overview,
    copy(
      'Edit these cards directly on the canvas. Choose Members or Preferences to view the other local panels.',
      '在画布中直接编辑这些卡片。选择“成员”或“偏好”，查看其他本地内容面板。'
    )
  )
  const summary = ctx.stack(overview, copy('Editable summary card', '可编辑摘要卡片'), {
    ...templateSurface(TEMPLATE_COLORS.tint),
    paddingTop: 12,
    paddingRight: 12,
    paddingBottom: 12,
    paddingLeft: 12,
    itemSpacing: 6
  })
  ctx.text(summary, copy('3 sample members', '3 位示例成员'), { fontWeight: 600 })
  ctx.text(summary, copy('Ready for your own content', '可以替换成你的内容'), { fontSize: 13 })

  const members = addPanel(ctx, content, section, 'members', copy('Members panel', '成员面板'))
  for (const [name, role] of [
    [copy('Alex Chen', '陈晓'), copy('Design', '设计')],
    [copy('Taylor Lin', '林雨'), copy('Engineering', '开发')],
    [copy('Morgan Wu', '吴晨'), copy('Operations', '运营')]
  ]) {
    const card = ctx.stack(members, name + copy(' card', '卡片'), {
      ...templateSurface(TEMPLATE_COLORS.tint),
      paddingTop: 12,
      paddingRight: 12,
      paddingBottom: 12,
      paddingLeft: 12,
      itemSpacing: 4
    })
    ctx.text(card, name, { fontWeight: 600 })
    ctx.text(card, role, { fontSize: 13 })
  }

  const preferences = addPanel(
    ctx,
    content,
    section,
    'preferences',
    copy('Preferences panel', '偏好面板')
  )
  const notificationSwitch = ctx.field(
    preferences,
    'SWITCH',
    copy('Show notifications', '显示通知'),
    notifications
  )
  ctx.editor.updateNodeWithUndo(
    notificationSwitch,
    {
      width: 44,
      height: 24,
      layoutAlignSelf: 'MIN',
      responsiveOverrides: {
        compact: { width: 44, minWidth: 0, counterAxisSizing: 'FIXED' },
        xl: { width: 44, minWidth: 0, counterAxisSizing: 'FIXED' }
      }
    },
    copy('Keep notification switch at its authored width', '保持通知开关的创作宽度')
  )
  ctx.feedback(
    preferences,
    `${notifications} ? ${JSON.stringify(copy('On', '开启'))} : ${JSON.stringify(copy('Off', '关闭'))}`,
    copy('Notifications', '通知')
  )
  ctx.text(
    root,
    copy(
      'The current section and preferences stay in this run. Replace the editable sample panels with your own page content.',
      '当前栏目与偏好仅在本次运行中保留。可以将可编辑的示例面板替换成你的页面内容。'
    ),
    { fontSize: 12 }
  )
}
