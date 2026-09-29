import { DESCRIPTIONS_MODULE_DEFINITION } from '@open-pencil/core/plugins'

import type { TemplateContext } from './presentation'

export function addPickerTemplate(
  ctx: TemplateContext,
  root: string,
  id: 'color-picker' | 'descriptions'
): void {
  if (id === 'color-picker') {
    const value = ctx.localState('color', 'string', '#2563eb')
    ctx.field(root, 'INPUT', ctx.copy('Accent color', '主题颜色'), value, { inputType: 'color' })
    ctx.feedback(root, value, ctx.copy('Color value', '颜色值'))
    return
  }
  const frame = DESCRIPTIONS_MODULE_DEFINITION.createFrameOverrides({
    label: ctx.copy('Project details', '项目详情'),
    columns: 2,
    items: [
      {
        id: 'name',
        label: ctx.copy('Project', '项目'),
        value: ctx.copy('Design workspace', '设计工作区')
      },
      { id: 'status', label: ctx.copy('Status', '状态'), value: ctx.copy('Draft', '草稿') },
      {
        id: 'owner',
        label: ctx.copy('Owner', '负责人'),
        value: ctx.copy('Design team', '设计团队')
      },
      { id: 'updated', label: ctx.copy('Updated', '更新日期'), value: '2026-09-28' },
      {
        id: 'category',
        label: ctx.copy('Category', '分类'),
        value: ctx.copy('Local example', '本地示例')
      },
      {
        id: 'notes',
        label: ctx.copy('Notes', '说明'),
        value: ctx.copy('Edit labels and values in the panel.', '在设计面板编辑标签和内容。')
      }
    ]
  })
  ctx.node('FRAME', root, frame.name ?? 'Descriptions', {
    ...frame,
    counterAxisSizing: 'FILL',
    interactiveProps: { ...frame.interactiveProps, lang: ctx.zh ? 'zh-CN' : 'en' }
  })
}
