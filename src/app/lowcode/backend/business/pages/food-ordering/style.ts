import { parseColor } from '@open-pencil/core/color'
import type { SceneNode } from '@open-pencil/scene-graph'

export const FOOD_ORDERING_COLORS = {
  background: '#FBF8F3',
  surface: '#FFFFFF',
  text: '#2B241F',
  muted: '#766B60',
  primary: '#A13E27',
  border: '#E7E0D7',
  tint: '#F5E8DF'
} as const

export function foodSurface(
  options: { fill?: string; stroke?: string; radius?: number } = {}
): Partial<SceneNode> {
  return {
    fills: [
      {
        type: 'SOLID',
        color: parseColor(options.fill ?? FOOD_ORDERING_COLORS.surface),
        opacity: 1,
        visible: true
      }
    ],
    strokes: options.stroke
      ? [
          {
            color: parseColor(options.stroke),
            weight: 1,
            opacity: 1,
            visible: true,
            align: 'INSIDE'
          }
        ]
      : [],
    cornerRadius: options.radius ?? 16
  }
}

export function foodText(
  color: string = FOOD_ORDERING_COLORS.text,
  fontSize = 16,
  fontWeight = 400
): Partial<SceneNode> {
  return { ...foodSurface({ fill: color, radius: 0 }), fontSize, fontWeight }
}

export function foodButton(
  kind: 'primary' | 'secondary' | 'quiet' | 'active' = 'primary'
): Partial<SceneNode> {
  const primary = kind === 'primary'
  const active = kind === 'active'
  const backgrounds = {
    primary: FOOD_ORDERING_COLORS.primary,
    active: FOOD_ORDERING_COLORS.tint,
    secondary: FOOD_ORDERING_COLORS.surface,
    quiet: FOOD_ORDERING_COLORS.surface
  }
  const foregrounds = {
    primary: FOOD_ORDERING_COLORS.surface,
    active: FOOD_ORDERING_COLORS.primary,
    secondary: FOOD_ORDERING_COLORS.text,
    quiet: FOOD_ORDERING_COLORS.text
  }
  return {
    ...foodSurface({
      fill: backgrounds[kind],
      ...(kind === 'secondary' ? { stroke: FOOD_ORDERING_COLORS.border } : {}),
      radius: 10
    }),
    fontSize: 14,
    fontWeight: primary || active ? 600 : 400,
    interactiveProps: { textColor: foregrounds[kind] }
  }
}

function baseStyle(type: SceneNode['type']): Partial<SceneNode> {
  if (type === 'TEXT') return foodText()
  if (type === 'BUTTON') return foodButton()
  if (type === 'CANVAS') return foodSurface({ fill: FOOD_ORDERING_COLORS.background, radius: 0 })
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(type))
    return {
      ...foodSurface({ stroke: FOOD_ORDERING_COLORS.border, radius: 10 }),
      interactiveProps: { textColor: FOOD_ORDERING_COLORS.text }
    }
  return type === 'FRAME' ? foodSurface() : {}
}

/** Restaurant starters remain ordinary editable nodes, without a global theme override. */
export function foodOrderingStyle(
  type: SceneNode['type'],
  props: Partial<SceneNode>
): Partial<SceneNode> {
  const base = baseStyle(type)
  return {
    ...base,
    ...props,
    ...(['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(type)
      ? { interactiveProps: { ...base.interactiveProps, ...props.interactiveProps } }
      : {})
  }
}
