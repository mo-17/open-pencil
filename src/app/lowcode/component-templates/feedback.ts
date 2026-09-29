import {
  ALERT_MODULE_DEFINITION,
  CHIP_MODULE_DEFINITION,
  PROGRESS_MODULE_DEFINITION
} from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'

import { TEMPLATE_COLORS, type TemplateContext } from './presentation'

type FeedbackTemplateId = 'alert' | 'progress' | 'circular-progress' | 'chip'
const IDS: ReadonlySet<string> = new Set<FeedbackTemplateId>([
  'alert',
  'progress',
  'circular-progress',
  'chip'
])

export function isFeedbackTemplateId(id: string): id is FeedbackTemplateId {
  return IDS.has(id)
}

function feedbackFrame(ctx: TemplateContext, id: FeedbackTemplateId): Partial<SceneNode> {
  const { copy } = ctx
  switch (id) {
    case 'alert':
      return ALERT_MODULE_DEFINITION.createFrameOverrides({
        title: copy('A helpful reminder', '温馨提示'),
        description: copy('Review your details before continuing.', '继续之前，请检查填写的资料。'),
        closeLabel: copy('Dismiss reminder', '关闭提示'),
        announcement: 'polite'
      })
    case 'chip':
      return CHIP_MODULE_DEFINITION.createFrameOverrides({
        label: copy('Design', '设计'),
        selectable: true,
        initialSelected: true,
        deletable: true,
        deleteLabel: copy('Remove label', '移除标签'),
        removedLabel: copy('Label removed', '标签已移除'),
        color: TEMPLATE_COLORS.accent
      })
    case 'progress':
    case 'circular-progress':
      return {
        ...PROGRESS_MODULE_DEFINITION.createFrameOverrides({
          variant: id === 'progress' ? 'linear' : 'circular',
          label: copy('Example progress', '示例进度'),
          pendingLabel: copy('In progress', '正在进行'),
          value: 65,
          textColor: TEMPLATE_COLORS.ink,
          accentColor: TEMPLATE_COLORS.accent
        }),
        height: id === 'progress' ? 100 : 200
      }
  }
  throw new TypeError('Unsupported feedback template')
}

export function addFeedbackTemplate(ctx: TemplateContext, parent: string, id: FeedbackTemplateId) {
  const frame = feedbackFrame(ctx, id)
  ctx.node('FRAME', parent, frame.name ?? id, {
    ...frame,
    width: id === 'chip' ? 176 : 320,
    counterAxisSizing: id === 'chip' ? 'FIXED' : 'FILL',
    interactiveProps: { ...frame.interactiveProps, lang: ctx.zh ? 'zh-CN' : 'en' }
  })
  const isProgress = id === 'progress' || id === 'circular-progress'
  ctx.text(
    parent,
    isProgress
      ? ctx.copy('Configured example; not a live task progress.', '配置示例，未连接真实任务进度。')
      : ctx.copy(
          'Dismissal or selection is local to this instance.',
          '关闭或选择仅作用于当前实例。'
        ),
    { fontSize: 12 }
  )
}
