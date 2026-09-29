import { createWalktourModuleFrameOverrides } from '@open-pencil/core/plugins'

import { TEMPLATE_COLORS, templateSurface, type TemplateContext } from './presentation'

export function addWalktourTemplate(ctx: TemplateContext, parent: string): void {
  const names = [
    ctx.copy('Overview card', '概览卡片'),
    ctx.copy('Preferences card', '偏好卡片'),
    ctx.copy('Finish card', '完成卡片')
  ]
  const titles = [
    ctx.copy('Explore the page', '了解页面'),
    ctx.copy('Adjust preferences', '调整偏好'),
    ctx.copy('You are ready', '准备完成')
  ]
  const content = [
    ctx.copy(
      'This is ordinary editable content beneath the tour button.',
      '这是引导按钮下方可正常编辑的内容。'
    ),
    ctx.copy(
      'Replace this card with your own settings or explanation.',
      '可以替换成自己的设置或说明。'
    ),
    ctx.copy(
      'Finish closes the tour without changing business data.',
      '完成只会关闭引导，不会改写业务数据。'
    )
  ]
  const module = ctx.node('FRAME', parent, ctx.copy('Guided walkthrough', '操作引导'), {
    ...createWalktourModuleFrameOverrides({
      triggerLabel: ctx.copy('Start tour', '开始引导'),
      steps: names.map((name, index) => ({
        id: `step${index + 1}`,
        title: titles[index],
        content: content[index],
        targetChildName: name,
        placement: 'bottom'
      })),
      triggerBackground: TEMPLATE_COLORS.accent,
      textColor: TEMPLATE_COLORS.ink,
      borderColor: TEMPLATE_COLORS.border
    }),
    width: 320,
    height: 310,
    counterAxisSizing: 'FILL'
  })
  for (const [index, name] of names.entries()) {
    const card = ctx.stack(module, name, {
      ...templateSurface(TEMPLATE_COLORS.tint, true),
      x: 12,
      y: 60 + index * 80,
      width: 296,
      height: 64,
      layoutPositioning: 'ABSOLUTE',
      counterAxisSizing: 'FIXED',
      primaryAxisSizing: 'FIXED',
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 8,
      paddingBottom: 8,
      itemSpacing: 2
    })
    ctx.text(card, titles[index], { fontSize: 15, fontWeight: 600, lineHeight: 20 })
    ctx.text(card, ctx.copy('Editable local content', '可编辑的本地内容'), {
      fontSize: 12,
      lineHeight: 18,
      fills: templateSurface(TEMPLATE_COLORS.muted).fills
    })
  }
}
