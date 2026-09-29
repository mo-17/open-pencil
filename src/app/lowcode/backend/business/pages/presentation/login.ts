import type { BusinessPageContext } from '../context'
import { BUSINESS_CONTENT_WIDTH, BUSINESS_CONTENT_X, type BusinessRect } from '../layout'
import type { BusinessScreen } from '../screen'
import { businessSurface, businessText } from './style'

export const BUSINESS_LOGIN_CONTENT_HEIGHT = 520

/** Keep authored line breaks as editable text nodes across both static web emitters. */
function renderLoginTitle(
  ctx: BusinessPageContext,
  parent: string,
  value: string,
  rect: BusinessRect,
  size: number
): void {
  const lines = value.split('\n')
  for (const [index, line] of lines.entries())
    ctx.layout.text(
      parent,
      line,
      {
        ...rect,
        y: rect.y + index * 44,
        height: lines.length > 1 ? 44 : rect.height
      },
      {
        ...businessText(ctx.presentation, { size, weight: 600 }),
        lineHeight: 44
      }
    )
}

/** Decorative cards are labelled navigation subjects, never invented records or metrics. */
function renderWorkspaceIntroduction(ctx: BusinessPageContext, hero: string): void {
  const { layout, presentation: profile } = ctx
  layout.shape(
    'FRAME',
    'Workspace introduction',
    hero,
    0,
    0,
    404,
    496,
    businessSurface(profile, { fill: profile.colors.tint, radius: 20 })
  )
  layout.text(
    hero,
    ctx.label(profile.eyebrow),
    { x: 32, y: 36, width: 338, height: 24 },
    businessText(profile, { color: profile.colors.primary, size: 11, weight: 600 })
  )
  renderLoginTitle(
    ctx,
    hero,
    ctx.label(profile.welcome),
    { x: 32, y: 84, width: 338, height: 130 },
    28
  )
  layout.text(
    hero,
    ctx.label(profile.introduction),
    { x: 32, y: 224, width: 338, height: 84 },
    businessText(profile, { color: profile.colors.muted, size: 14 })
  )
  const subjects = ctx.definition.pages.filter((entry) => entry.id !== 'account').slice(0, 2)
  for (const [index, subject] of subjects.entries()) {
    const card = layout.shape(
      'FRAME',
      'Workspace subject',
      hero,
      32,
      342 + index * 58,
      338,
      46,
      businessSurface(profile, { radius: 10 })
    )
    layout.shape(
      'FRAME',
      'Subject accent',
      card,
      0,
      12,
      3,
      22,
      businessSurface(profile, { fill: profile.colors.primary, radius: 2 })
    )
    layout.text(
      card,
      ctx.label(subject.title),
      { x: 18, y: 12, width: 304, height: 24 },
      businessText(profile, { size: 13, weight: 500 })
    )
  }
}

/** The screen retains authority over the actual sign-in action and its return route. */
export function renderBusinessLogin(screen: BusinessScreen) {
  const { ctx, page } = screen
  const { layout, presentation: profile } = ctx
  const y = screen.reserve(BUSINESS_LOGIN_CONTENT_HEIGHT)
  const hero = layout.shape(
    'FRAME',
    'Welcome to your workspace',
    page,
    BUSINESS_CONTENT_X,
    y,
    BUSINESS_CONTENT_WIDTH,
    496,
    businessSurface(profile, { stroke: profile.colors.border, radius: 20 })
  )
  renderWorkspaceIntroduction(ctx, hero)
  layout.text(
    hero,
    ctx.label({ en: 'WELCOME BACK', zh: '欢迎回来' }),
    { x: 452, y: 60, width: 376, height: 24 },
    businessText(profile, { color: profile.colors.primary, size: 11, weight: 600 })
  )
  renderLoginTitle(
    ctx,
    hero,
    ctx.label({ en: 'Sign in to your\nworkspace.', zh: '登录，\n继续你的工作。' }),
    { x: 452, y: 100, width: 376, height: 100 },
    30
  )
  layout.text(
    hero,
    ctx.label({
      en: 'Continue to your identity service to sign in. After signing in, complete your profile in Account setup.',
      zh: '继续后将前往身份服务登录。登录成功后，可在账号设置中登记本人资料。'
    }),
    { x: 452, y: 214, width: 376, height: 72 },
    businessText(profile, { color: profile.colors.muted, size: 14 })
  )
  layout.text(
    hero,
    ctx.label({
      en: 'Account access is managed by your identity service.',
      zh: '账号与登录权限由身份服务管理。'
    }),
    { x: 452, y: 398, width: 376, height: 44 },
    businessText(profile, { color: profile.colors.muted, size: 12 })
  )
  const children = ctx.editor.graph.getChildren(hero)
  const introduction = groupTemplateNodes(
    ctx.editor,
    hero,
    children.filter((node) => node.x < 420).map((node) => node.id),
    'Workspace introduction content'
  )
  ctx.editor.updateNodeWithUndo(
    introduction,
    {
      responsiveOverrides: {
        compact: { paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16 }
      }
    },
    'Space mobile welcome'
  )
  const content = groupTemplateNodes(
    ctx.editor,
    hero,
    children.filter((node) => node.x >= 420).map((node) => node.id),
    'Sign-in content'
  )
  return { parent: content, rect: { x: 0, y: 266, width: 376, height: 48 } }
}
import { groupTemplateNodes } from '@/app/lowcode/backend/responsive/structure'
