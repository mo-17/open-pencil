import { createCascaderModuleFrameOverrides } from '@open-pencil/core/plugins'

import { TEMPLATE_COLORS, type TemplateContext } from './presentation'

export function addCascaderTemplate(ctx: TemplateContext, parent: string): void {
  const path = ctx.localState('locationPath', 'array', ['asia', 'china', 'xiamen'])
  const frame = createCascaderModuleFrameOverrides({
    label: ctx.copy('Location', '地区'),
    placeholder: ctx.copy('Choose a city', '选择城市'),
    initialPath: ['asia', 'china', 'xiamen'],
    items: [
      { id: 'asia', label: ctx.copy('Asia', '亚洲'), parentId: '', disabled: false },
      { id: 'china', label: ctx.copy('China', '中国'), parentId: 'asia', disabled: false },
      { id: 'xiamen', label: ctx.copy('Xiamen', '厦门'), parentId: 'china', disabled: false },
      { id: 'shanghai', label: ctx.copy('Shanghai', '上海'), parentId: 'china', disabled: false },
      { id: 'europe', label: ctx.copy('Europe', '欧洲'), parentId: '', disabled: false },
      { id: 'france', label: ctx.copy('France', '法国'), parentId: 'europe', disabled: false },
      { id: 'paris', label: ctx.copy('Paris', '巴黎'), parentId: 'france', disabled: false },
      { id: 'archived', label: ctx.copy('Archived', '已归档'), parentId: '', disabled: true }
    ],
    backgroundColor: TEMPLATE_COLORS.paper,
    textColor: TEMPLATE_COLORS.ink,
    accentColor: TEMPLATE_COLORS.accent
  })
  ctx.node('FRAME', parent, ctx.copy('Location cascader', '地区级联选择'), {
    ...frame,
    width: 320,
    counterAxisSizing: 'FILL',
    interactiveProps: { ...frame.interactiveProps, lang: ctx.zh ? 'zh-CN' : 'en' },
    bindings: { value: { kind: 'ref', stateId: path } }
  })
  ctx.feedback(parent, path, ctx.copy('Selected path', '已选路径'))
  ctx.text(
    parent,
    ctx.copy(
      'Choose a leaf to update the complete path. Search and clear are local.',
      '选中叶节点后更新完整路径；搜索与清除仅作用于本地状态。'
    ),
    { fontSize: 12, minHeight: 44 }
  )
}
