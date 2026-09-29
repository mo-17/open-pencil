import type { CommerceLayout } from './layout'
import { COMMERCE_PALETTE as colors, commerceSurface } from './presentation'

export function createCommerceLoginIntroduction(
  layout: CommerceLayout,
  parent: string,
  y: number,
  locale: string
) {
  const zh = locale.toLowerCase().startsWith('zh')
  layout.shape(
    'FRAME',
    'Shop welcome',
    parent,
    48,
    y,
    900,
    392,
    commerceSurface(colors.surface, true)
  )
  layout.shape(
    'FRAME',
    'Shopping illustration',
    parent,
    48,
    y,
    388,
    392,
    commerceSurface(colors.tint)
  )
  layout.text(
    parent,
    zh ? '好物常在，\n从容挑选。' : 'Thoughtful choices.\nSimple shopping.',
    84,
    y + 32,
    312,
    {
      fontSize: 30,
      fontWeight: 600,
      height: 96
    }
  )
  layout.shape(
    'FRAME',
    'Parcel illustration',
    parent,
    142,
    y + 174,
    184,
    150,
    commerceSurface('#BBCBE4', true)
  )
  layout.shape(
    'RECTANGLE',
    'Parcel ribbon',
    parent,
    218,
    y + 174,
    32,
    150,
    commerceSurface('#DAE4F3')
  )
  layout.shape(
    'FRAME',
    'Parcel label',
    parent,
    166,
    y + 246,
    46,
    40,
    commerceSurface(colors.surface)
  )
  layout.text(parent, zh ? '欢迎回来' : 'Welcome back', 488, y + 54, 400, {
    fontSize: 28,
    fontWeight: 600,
    height: 42
  })
  layout.text(
    parent,
    zh
      ? '登录账号，继续挑选心仪好物，\n查看和管理你的订单。'
      : 'Sign in to choose your next find\nand keep your orders together.',
    488,
    y + 120,
    392,
    {
      fontSize: 16,
      height: 64
    }
  )
  layout.text(
    parent,
    zh ? '继续后将前往账号登录页面。' : 'Continue to your account to sign in.',
    488,
    y + 286,
    392,
    {
      fontSize: 13,
      height: 44
    }
  )
  return { x: 488, y: y + 212, errorY: y + 414 }
}
