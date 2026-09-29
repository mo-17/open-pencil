import type { ActionDef } from '@open-pencil/scene-graph'

import type { BusinessPageDefinition } from '@/app/lowcode/backend/business/types'
import { groupTemplateNodes } from '@/app/lowcode/backend/responsive/structure'

import type { BusinessPageContext } from '../context'
import { businessMarkerData } from '../markers'
import type { BusinessNavigationEntry } from '../module-types'
import { FOOD_ORDERING_COLORS as colors, foodButton, foodSurface, foodText } from './style'

const subtitles: Record<string, { en: string; zh: string }> = {
  login: {
    en: 'A good meal starts here. Sign in to save your cart and place an order.',
    zh: '好好吃饭，从这里开始。登录后保存想吃的菜品，轻松下单。'
  },
  account: {
    en: 'Let us know what to call you. Your profile stays connected to your account.',
    zh: '留下你的称呼，让每一次点餐都更熟悉。'
  },
  'food-menu': {
    en: 'Find something delicious. Choose a dish and save the quantity you would like.',
    zh: '今天想吃点什么？选择心仪菜品，保存想要的份数。'
  },
  'food-cart': {
    en: 'Everything you are craving, in one place. Review your dishes before checkout.',
    zh: '想吃的都在这里。核对菜品和份数，再去确认下单。'
  },
  'food-checkout': {
    en: 'Review your meal and choose dine-in or pickup. No payment is collected.',
    zh: '核对这一餐，选择堂食或到店自取。本流程不收款。'
  },
  'food-orders': {
    en: 'Your meals, from the first order to the last bite. Refresh to see the latest progress.',
    zh: '从下单到出餐，每一步都在这里。刷新列表可查看最新进度。'
  },
  'food-kitchen': {
    en: 'Keep every meal moving. Refresh list for new orders; this is not a realtime feed.',
    zh: '照顾好每一份订单。刷新列表查看新订单和进度，当前不提供实时推送。'
  },
  'food-menu-management': {
    en: 'Make your menu shine. Keep dishes, prices and availability up to date.',
    zh: '把拿手好菜放进菜单，及时更新菜品、价格和售卖状态。'
  }
}

function renderJourney(ctx: BusinessPageContext, page: string, current: string): void {
  const steps = [
    ['food-menu', '01  Explore the menu', '01  浏览菜单'],
    ['food-cart', '02  Review your cart', '02  核对购物车'],
    ['food-checkout', '03  Place your order', '03  确认下单']
  ]
  if (!steps.some(([id]) => id === current)) return
  const nodes: string[] = []
  for (const [index, [id, en, zh]] of steps.entries())
    nodes.push(
      ctx.layout.text(
        page,
        ctx.label({ en, zh }),
        { x: 272 + index * 278, y: 154, width: 252, height: 24 },
        foodText(id === current ? colors.primary : colors.muted, 13, id === current ? 600 : 400)
      )
    )
  const journey = groupTemplateNodes(ctx.editor, page, nodes, 'Meal progress')
  ctx.editor.updateNodeWithUndo(
    journey,
    {
      responsiveOverrides: {
        compact: {
          layoutMode: 'GRID',
          gridTemplateColumns: [
            { sizing: 'FR', value: 1 },
            { sizing: 'FR', value: 1 },
            { sizing: 'FR', value: 1 }
          ],
          gridColumnGap: 8
        }
      }
    },
    'Arrange compact meal progress'
  )
}

/** Presentation only: navigation receives the caller's complete session-cleanup action list. */
export function createFoodOrderingShell(
  ctx: BusinessPageContext,
  page: string,
  definition: BusinessPageDefinition
) {
  const { layout } = ctx
  const sidebar = layout.shape('FRAME', 'Restaurant sidebar', page, 0, 0, 248, 1000, {
    ...foodSurface({ radius: 0, stroke: colors.border })
  })
  layout.shape('FRAME', 'Restaurant mark', sidebar, 24, 28, 44, 44, {
    ...foodSurface({ fill: colors.primary, radius: 14 })
  })
  layout.text(
    sidebar,
    ctx.label({ en: 'R', zh: '食' }),
    { x: 24, y: 35, width: 44, height: 30 },
    { ...foodText(colors.surface, 22, 600), textAlignHorizontal: 'CENTER' }
  )
  layout.text(
    sidebar,
    ctx.label({ en: 'Made with care', zh: '好好吃饭' }),
    { x: 80, y: 30, width: 144, height: 26 },
    foodText(colors.text, 17, 600)
  )
  layout.text(
    sidebar,
    'FRESHLY MADE',
    { x: 80, y: 58, width: 144, height: 20 },
    foodText(colors.muted, 10, 500)
  )
  layout.text(
    sidebar,
    ctx.label(ctx.definition.title),
    { x: 24, y: 99, width: 208, height: 30 },
    foodText(colors.text, 18, 600)
  )
  layout.text(
    sidebar,
    ctx.label({ en: 'Dine in · Pick up', zh: '堂食 · 到店自取' }),
    { x: 24, y: 133, width: 208, height: 22 },
    foodText(colors.muted, 12)
  )
  const eyebrow = layout.text(
    page,
    ctx.label({ en: 'GOOD FOOD, EVERY DAY', zh: '认真做饭，好好吃饭' }),
    { x: 272, y: 28, width: 650, height: 22 },
    foodText(colors.primary, 12, 600)
  )
  layout.text(
    page,
    ctx.label(definition.title),
    { x: 272, y: 64, width: 650, height: 42 },
    foodText(colors.text, 30, 600)
  )
  layout.text(
    page,
    ctx.label(subtitles[definition.id] ?? definition.description),
    { x: 272, y: 115, width: 880, height: 34 },
    foodText(colors.muted, 14)
  )
  renderJourney(ctx, page, definition.id)

  const navigation = (leave: (path: string) => ActionDef[]): number => {
    const container = layout.shape('FRAME', 'Business navigation', sidebar, 24, 183, 208, 480, {
      ...foodSurface({ radius: 0 }),
      pluginData: businessMarkerData({
        version: 1,
        role: 'navigation',
        applicationId: ctx.application.applicationId,
        knownKeys: ctx.navigation.map((entry) => entry.key)
      })
    })
    const customerPaths = new Set(
      ['food-menu', 'food-cart', 'food-checkout', 'food-orders'].map((id) => ctx.paths[id])
    )
    const staffPaths = new Set(['food-kitchen', 'food-menu-management'].map((id) => ctx.paths[id]))
    const groups = [
      {
        title: { en: 'YOUR MEAL', zh: '顾客点餐' },
        entries: ctx.navigation.filter((entry) => customerPaths.has(entry.path))
      },
      {
        title: { en: 'RESTAURANT', zh: '门店管理' },
        entries: ctx.navigation.filter((entry) => staffPaths.has(entry.path))
      },
      {
        title: { en: 'ACCOUNT & MORE', zh: '账号与更多' },
        entries: ctx.navigation.filter(
          (entry) => !customerPaths.has(entry.path) && !staffPaths.has(entry.path)
        )
      }
    ]
    let y = 0
    const renderEntry = (entry: BusinessNavigationEntry) => {
      layout.button(
        container,
        ctx.label(entry.label),
        { x: 0, y, width: 208, height: 44 },
        leave(entry.path),
        foodButton(entry.path === ctx.paths[definition.id] ? 'active' : 'quiet')
      )
      y += 52
    }
    for (const group of groups) {
      if (!group.entries.length) continue
      layout.text(
        container,
        ctx.label(group.title),
        { x: 12, y, width: 184, height: 24 },
        foodText(colors.muted, 11, 600)
      )
      y += 32
      for (const entry of group.entries) renderEntry(entry)
      y += 24
    }
    ctx.editor.updateNodeWithUndo(container, { height: y - 24 }, 'Size restaurant navigation')
    return y + 183
  }
  const finish = (height: number) =>
    ctx.editor.updateNodeWithUndo(sidebar, { height }, 'Size restaurant sidebar')
  return { navigation, finish, sidebar, eyebrow }
}
