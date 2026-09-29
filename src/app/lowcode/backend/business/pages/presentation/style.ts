import { parseColor } from '@open-pencil/core/color'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { BusinessPresentation } from './profiles'

export function businessSurface(
  profile: BusinessPresentation,
  options: { fill?: string; stroke?: string; radius?: number } = {}
): Partial<SceneNode> {
  const fill = parseColor(options.fill ?? profile.colors.surface)
  return {
    fills: [{ type: 'SOLID', color: fill, opacity: 1, visible: true }],
    cornerRadius: options.radius ?? 14,
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
      : []
  }
}

export function businessText(
  profile: BusinessPresentation,
  options: { color?: string; size?: number; weight?: number } = {}
): Partial<SceneNode> {
  return {
    ...businessSurface(profile, { fill: options.color ?? profile.colors.text, radius: 0 }),
    fontSize: options.size ?? 14,
    fontWeight: options.weight ?? 400
  }
}

export function businessButton(
  profile: BusinessPresentation,
  kind: 'primary' | 'secondary' | 'quiet' | 'active' = 'primary'
): Partial<SceneNode> {
  const { colors } = profile
  const emphasized = kind === 'primary' || kind === 'active'
  const fill = {
    primary: colors.primary,
    active: colors.tint,
    secondary: colors.surface,
    quiet: colors.surface
  }[kind]
  const textColor = {
    primary: colors.surface,
    active: colors.primary,
    secondary: colors.text,
    quiet: colors.text
  }[kind]
  return {
    ...businessSurface(profile, {
      fill,
      radius: 9,
      ...(kind === 'secondary' ? { stroke: colors.border } : {})
    }),
    fontSize: 14,
    fontWeight: emphasized ? 600 : 400,
    interactiveProps: { textColor }
  }
}

/** Only generated scene nodes receive these defaults; existing document styles are untouched. */
export function businessPresentationStyle(profile: BusinessPresentation) {
  return (type: SceneNode['type'], properties: Partial<SceneNode>): Partial<SceneNode> => {
    let defaults: Partial<SceneNode> = {}
    if (type === 'TEXT') defaults = businessText(profile)
    if (type === 'BUTTON') defaults = businessButton(profile)
    if (type === 'FRAME') defaults = businessSurface(profile)
    if (type === 'CANVAS')
      defaults = businessSurface(profile, { fill: profile.colors.background, radius: 0 })
    const control = ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(type)
    if (control && type !== 'BUTTON')
      defaults = {
        ...businessSurface(profile, { stroke: profile.colors.border, radius: 9 }),
        interactiveProps: { textColor: profile.colors.text }
      }
    return {
      ...defaults,
      ...properties,
      ...(control
        ? { interactiveProps: { ...defaults.interactiveProps, ...properties.interactiveProps } }
        : {})
    }
  }
}
