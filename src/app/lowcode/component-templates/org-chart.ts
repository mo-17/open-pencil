import {
  createOrgChartModuleFrameOverrides,
  resolveOrgChartModule,
  orgChartLayout
} from '@open-pencil/core/plugins'

import { TEMPLATE_COLORS, type TemplateContext } from './presentation'

export function addOrgChartTemplate(ctx: TemplateContext, root: string): void {
  const copy = ctx.copy
  const overrides = createOrgChartModuleFrameOverrides({
    label: copy('Team structure', '团队架构'),
    items: [
      {
        id: 'team',
        parentId: '',
        label: copy('Product team', '产品团队'),
        description: copy('Local editable sample', '本地可编辑示例')
      },
      {
        id: 'design',
        parentId: 'team',
        label: copy('Design', '设计'),
        description: copy('Experience and visuals', '体验与视觉')
      },
      {
        id: 'engineering',
        parentId: 'team',
        label: copy('Engineering', '研发'),
        description: copy('Build and maintain', '开发与维护')
      },
      {
        id: 'frontend',
        parentId: 'engineering',
        label: copy('Frontend', '前端'),
        description: copy('Interface implementation', '界面实现')
      },
      {
        id: 'backend',
        parentId: 'engineering',
        label: copy('Backend', '后端'),
        description: copy('Service implementation', '服务实现')
      }
    ],
    initialCollapsedIds: [],
    collapsible: true,
    textColor: TEMPLATE_COLORS.ink,
    mutedColor: TEMPLATE_COLORS.muted,
    accentColor: TEMPLATE_COLORS.accent,
    borderColor: TEMPLATE_COLORS.border
  })
  const resolved = resolveOrgChartModule(overrides.interactiveProps?.module)
  if (!resolved?.ok) throw new Error(resolved?.reason ?? 'Invalid organization chart')
  ctx.node('FRAME', root, copy('Team structure', '团队架构'), {
    ...overrides,
    width: 320,
    height: orgChartLayout(320, resolved.config).height,
    counterAxisSizing: 'FILL'
  })
  ctx.text(
    root,
    copy(
      'Fold branches in preview. Changes last only for this runtime.',
      '在预览中折叠分支；变化仅保留在本次运行。'
    ),
    { fontSize: 12 }
  )
}
