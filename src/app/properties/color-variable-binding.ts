import type { Color, Variable } from '@open-pencil/scene-graph'

export type ColorVariableBindingApi = {
  store: {
    resolveColorVariable: (id: string) => unknown
  }
  colorVariables: { value: Variable[] }
  filteredVariables: { value: Variable[] }
  searchTerm: { value: string }
  getBoundVariable: (nodeId: string, index: number) => Variable | undefined
  bindVariable: (nodeId: string, index: number, variableId: string) => void
  unbindVariable: (nodeId: string, index: number) => void
  createAndBindVariable?: (nodeId: string, index: number, color: Color, name?: string) => void
}

export type GradientStopColorVariableBindingApi = ColorVariableBindingApi & {
  getGradientStopBoundVariable: (
    nodeId: string,
    fillIndex: number,
    stopIndex: number
  ) => Variable | undefined
  bindGradientStopVariable: (
    nodeId: string,
    fillIndex: number,
    stopIndex: number,
    variableId: string
  ) => void
  unbindGradientStopVariable: (nodeId: string, fillIndex: number, stopIndex: number) => void
  createAndBindGradientStopVariable?: (
    nodeId: string,
    fillIndex: number,
    stopIndex: number,
    color: Color,
    name?: string
  ) => void
}

function isColor(value: unknown): value is Color {
  return (
    typeof value === 'object' &&
    value !== null &&
    'r' in value &&
    'g' in value &&
    'b' in value &&
    'a' in value &&
    typeof value.r === 'number' &&
    typeof value.g === 'number' &&
    typeof value.b === 'number' &&
    typeof value.a === 'number'
  )
}

export function resolveColorVariable(
  bindingApi: Pick<ColorVariableBindingApi, 'store'>,
  variableId: string
): Color | undefined {
  const color = bindingApi.store.resolveColorVariable(variableId)
  return isColor(color) ? color : undefined
}

export function boundGradientStopColor(
  bindingApi: GradientStopColorVariableBindingApi,
  nodeId: string,
  fillIndex: number,
  stopIndex: number
): Color | undefined {
  const variable = bindingApi.getGradientStopBoundVariable(nodeId, fillIndex, stopIndex)
  return variable ? resolveColorVariable(bindingApi, variable.id) : undefined
}
