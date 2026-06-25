import { colorToCSS } from '@open-pencil/core/color'
import type { Color, Fill } from '@open-pencil/core/scene-graph'

import { resolveColorVariable } from '@/app/properties/color-variable-binding'

export type {
  ColorVariableBindingApi,
  GradientStopColorVariableBindingApi
} from '@/app/properties/color-variable-binding'

import type { ColorVariableBindingApi } from '@/app/properties/color-variable-binding'

export function opacityPercent(opacity: number) {
  return Math.round(opacity * 100)
}

export function opacityFromPercent(percent: number) {
  return Math.max(0, Math.min(1, percent / 100))
}

export function variableSwatchBackground(bindingApi: ColorVariableBindingApi, variableId: string) {
  const color = resolveColorVariable(bindingApi, variableId)
  return color ? colorToCSS(color) : 'transparent'
}

export function boundVariableColor(
  bindingApi: ColorVariableBindingApi,
  nodeId: string,
  index: number
): Color | undefined {
  const variable = bindingApi.getBoundVariable(nodeId, index)
  return variable ? resolveColorVariable(bindingApi, variable.id) : undefined
}

export function boundVariableSwatchBackground(
  bindingApi: ColorVariableBindingApi,
  nodeId: string,
  index: number
): string | undefined {
  const color = boundVariableColor(bindingApi, nodeId, index)
  return color ? colorToCSS(color) : undefined
}

export function displayFillWithBoundVariable(
  bindingApi: ColorVariableBindingApi,
  nodeId: string,
  index: number,
  fill: Fill
): Fill {
  const color = fill.type === 'SOLID' ? boundVariableColor(bindingApi, nodeId, index) : undefined
  return color ? { ...fill, color } : fill
}
