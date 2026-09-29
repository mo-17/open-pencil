import {
  AVATAR_MODULE_DEFINITION,
  BADGE_MODULE_DEFINITION,
  TIMELINE_MODULE_DEFINITION
} from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { TemplateContext } from './presentation'

type DisplayTemplateId = 'avatar' | 'badge' | 'dot-badge' | 'timeline'
const IDS: ReadonlySet<string> = new Set<DisplayTemplateId>([
  'avatar',
  'badge',
  'dot-badge',
  'timeline'
])

export function isDisplayTemplateId(id: string): id is DisplayTemplateId {
  return IDS.has(id)
}

function displayFrame(ctx: TemplateContext, id: DisplayTemplateId): Partial<SceneNode> {
  const { copy } = ctx
  if (id === 'avatar')
    return AVATAR_MODULE_DEFINITION.createFrameOverrides({
      name: copy('Lin Mei', '林梅'),
      fallbackText: copy('LM', '林'),
      size: 64,
      fontSize: 24
    })
  if (id === 'badge' || id === 'dot-badge')
    return BADGE_MODULE_DEFINITION.createFrameOverrides({
      mode: id === 'badge' ? 'count' : 'dot',
      hostLabel: copy('Messages', '消息'),
      label: copy('Example count', '示例数量'),
      count: 128,
      max: 99
    })
  return TIMELINE_MODULE_DEFINITION.createFrameOverrides({
    label: copy('Project timeline', '项目时间线'),
    emptyText: copy('No events yet', '暂无事件'),
    items: [
      {
        id: 'research',
        title: copy('Research complete', '调研完成'),
        description: copy('Requirements and scope reviewed.', '已确认需求与范围。'),
        time: '09:00',
        status: 'completed'
      },
      {
        id: 'design',
        title: copy('Design in progress', '正在设计'),
        description: copy('Review the canvas and editable components.', '检查画布与可编辑组件。'),
        time: '10:30',
        status: 'current'
      },
      {
        id: 'review',
        title: copy('Review next', '等待评审'),
        description: copy('Collect feedback before the next step.', '进入下一阶段前收集反馈。'),
        time: '',
        status: 'pending'
      }
    ]
  })
}

export function addDisplayTemplate(ctx: TemplateContext, parent: string, id: DisplayTemplateId) {
  const frame = displayFrame(ctx, id)
  ctx.node('FRAME', parent, frame.name ?? id, {
    ...frame,
    counterAxisSizing: id === 'timeline' ? 'FILL' : 'FIXED',
    interactiveProps: { ...frame.interactiveProps, lang: ctx.zh ? 'zh-CN' : 'en' }
  })
  if (id === 'avatar') ctx.text(parent, ctx.copy('Lin Mei · Designer', '林梅 · 设计师'))
}
