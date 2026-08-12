import { colorToCSS } from '@open-pencil/core/color'
import type { Color, Fill } from '@open-pencil/scene-graph'

import { resolveColorVariable } from '@/app/properties/color-variable-binding'

export type {
  ColorVariableBindingAPI,
  GradientStopColorVariableBindingAPI
} from '@/app/properties/color-variable-binding'

import type { ColorVariableBindingAPI } from '@/app/properties/color-variable-binding'

export function opacityPercent(opacity: number) {
  return Math.round(opacity * 100)
}

export function opacityFromPercent(percent: number) {
  return Math.max(0, Math.min(1, percent / 100))
}

export function variableSwatchBackground(bindingAPI: ColorVariableBindingAPI, variableId: string) {
  const color = resolveColorVariable(bindingAPI, variableId)
  return color ? colorToCSS(color) : 'transparent'
}

export function boundVariableColor(
  bindingAPI: ColorVariableBindingAPI,
  nodeId: string,
  index: number
): Color | undefined {
  const variable = bindingAPI.getBoundVariable(nodeId, index)
  return variable ? resolveColorVariable(bindingAPI, variable.id) : undefined
}

export function boundVariableSwatchBackground(
  bindingAPI: ColorVariableBindingAPI,
  nodeId: string,
  index: number
): string | undefined {
  const color = boundVariableColor(bindingAPI, nodeId, index)
  return color ? colorToCSS(color) : undefined
}

export function displayFillWithBoundVariable(
  bindingAPI: ColorVariableBindingAPI,
  nodeId: string,
  index: number,
  fill: Fill
): Fill {
  const color = fill.type === 'SOLID' ? boundVariableColor(bindingAPI, nodeId, index) : undefined
  return color ? { ...fill, color } : fill
}
