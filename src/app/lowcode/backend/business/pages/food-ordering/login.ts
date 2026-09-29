import type { BusinessPageContext } from '../context'
import { FOOD_ORDERING_COLORS as colors, foodSurface, foodText } from './style'

export const FOOD_LOGIN_CONTENT_HEIGHT = 464

/** A fully editable restaurant illustration and sign-in introduction; the caller owns auth. */
export function renderFoodOrderingLogin(ctx: BusinessPageContext, page: string) {
  const { layout } = ctx
  const hero = layout.shape('FRAME', 'Restaurant welcome', page, 272, 196, 880, 440, {
    ...foodSurface({ stroke: colors.border, radius: 22 })
  })
  layout.shape('FRAME', 'Warm welcome illustration', hero, 0, 0, 416, 440, {
    ...foodSurface({ fill: '#F2E9DE', radius: 22 })
  })
  layout.text(
    hero,
    ctx.label({ en: 'A meal to slow down for.', zh: '一餐好饭，\n一天好心情。' }),
    { x: 36, y: 34, width: 344, height: 96 },
    foodText(colors.text, 30, 600)
  )
  layout.text(
    hero,
    ctx.label({ en: 'Good food. Your own pace.', zh: '认真做饭，慢慢享用。' }),
    { x: 36, y: 136, width: 344, height: 28 },
    foodText(colors.muted, 14)
  )
  layout.shape('ELLIPSE', 'Ceramic plate shadow', hero, 77, 212, 254, 194, {
    ...foodSurface({ fill: '#DFD2C2' })
  })
  layout.shape('ELLIPSE', 'Ceramic plate', hero, 70, 200, 254, 194, {
    ...foodSurface({ fill: '#FFFDF9', stroke: '#D5C6B3' })
  })
  layout.shape('ELLIPSE', 'Plate centre', hero, 102, 226, 190, 142, {
    ...foodSurface({ fill: '#F6F0E5', stroke: '#E9DFD0' })
  })
  for (const [index, position] of [
    [137, 251],
    [182, 261],
    [163, 292],
    [212, 296]
  ].entries())
    layout.shape('ELLIPSE', 'Seasonal garnish ' + index, hero, position[0], position[1], 42, 30, {
      ...foodSurface({ fill: index % 2 === 0 ? '#9BA879' : '#7D9065' })
    })
  layout.shape('ELLIPSE', 'Tomato accent', hero, 212, 244, 34, 34, {
    ...foodSurface({ fill: '#C55F43' })
  })
  layout.shape('FRAME', 'Napkin', hero, 342, 228, 28, 156, {
    ...foodSurface({ fill: '#E1CBB2', radius: 6 })
  })
  layout.shape('FRAME', 'Chopstick one', hero, 349, 220, 4, 148, {
    ...foodSurface({ fill: '#8B674D', radius: 2 })
  })
  layout.shape('FRAME', 'Chopstick two', hero, 358, 220, 4, 148, {
    ...foodSurface({ fill: '#8B674D', radius: 2 })
  })
  layout.text(
    hero,
    ctx.label({ en: 'WELCOME TO THE TABLE', zh: '欢迎来到我们的餐桌' }),
    { x: 476, y: 62, width: 340, height: 22 },
    foodText(colors.primary, 12, 600)
  )
  layout.text(
    hero,
    ctx.label({ en: 'Your next good meal\nstarts here.', zh: '登录，\n开始今天的好滋味。' }),
    { x: 476, y: 98, width: 340, height: 92 },
    foodText(colors.text, 28, 600)
  )
  layout.text(
    hero,
    ctx.label({
      en: 'Save your cart, place an order and follow its progress.',
      zh: '保存购物车，轻松下单，随时查看出餐进度。'
    }),
    { x: 476, y: 198, width: 340, height: 44 },
    foodText(colors.muted, 14)
  )
  layout.text(
    hero,
    ctx.label({ en: 'Continue to your account to sign in.', zh: '继续后将前往账号登录页面。' }),
    { x: 476, y: 316, width: 340, height: 44 },
    foodText(colors.muted, 12)
  )
  const children = ctx.editor.graph.getChildren(hero)
  groupTemplateNodes(
    ctx.editor,
    hero,
    children.filter((node) => node.x < 416).map((node) => node.id),
    'Restaurant introduction content'
  )
  const content = groupTemplateNodes(
    ctx.editor,
    hero,
    children.filter((node) => node.x >= 416).map((node) => node.id),
    'Restaurant sign-in content'
  )
  return { parent: content, rect: { x: 0, y: 186, width: 340, height: 48 } }
}
import { groupTemplateNodes } from '@/app/lowcode/backend/responsive/structure'
