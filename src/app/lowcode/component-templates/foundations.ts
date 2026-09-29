import {
  TOOLTIP_MODULE_DEFINITION,
  SKELETON_MODULE_DEFINITION,
  EMPTY_STATE_MODULE_DEFINITION
} from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { TemplateContext } from './presentation'

type FoundationTemplateId = 'tooltip' | 'skeleton' | 'empty-state' | 'empty-search'
const IDS: ReadonlySet<string> = new Set<FoundationTemplateId>([
  'tooltip',
  'skeleton',
  'empty-state',
  'empty-search'
])
export function isFoundationTemplateId(id: string): id is FoundationTemplateId {
  return IDS.has(id)
}

function foundationFrame(ctx: TemplateContext, id: FoundationTemplateId): Partial<SceneNode> {
  const { copy } = ctx
  if (id === 'tooltip')
    return TOOLTIP_MODULE_DEFINITION.createFrameOverrides({
      triggerLabel: copy('How this works', '查看使用说明'),
      content: copy(
        'This hint opens on hover or keyboard focus. Press Escape to close.',
        '悬停或键盘聚焦即可查看说明，按 Escape 关闭。'
      ),
      placement: 'top',
      maxWidth: 280
    })
  if (id === 'skeleton')
    return SKELETON_MODULE_DEFINITION.createFrameOverrides({
      label: copy('Loading content', '正在加载内容'),
      showLabel: true,
      rows: 3,
      lastLineWidth: 60
    })
  return EMPTY_STATE_MODULE_DEFINITION.createFrameOverrides({
    title:
      id === 'empty-search'
        ? copy('No matches found', '没有匹配结果')
        : copy('Nothing here yet', '这里还没有内容'),
    description:
      id === 'empty-search'
        ? copy(
            'Try a different keyword or adjust your filters.',
            '尝试其他关键词，或调整筛选条件。'
          )
        : copy('Your content will appear in this area.', '添加内容后，将显示在此区域。'),
    illustration: id === 'empty-search' ? 'search' : 'box',
    backgroundColor: '#F8FAFC'
  })
}

export function addFoundationTemplate(
  ctx: TemplateContext,
  parent: string,
  id: FoundationTemplateId
) {
  const frame = foundationFrame(ctx, id)
  ctx.node('FRAME', parent, frame.name ?? id, {
    ...frame,
    counterAxisSizing: id === 'tooltip' ? 'FIXED' : 'FILL',
    interactiveProps: { ...frame.interactiveProps, lang: ctx.zh ? 'zh-CN' : 'en' }
  })
}
