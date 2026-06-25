import { describe, expect, test } from 'bun:test'

import type { Color, Variable } from '@open-pencil/core/scene-graph'

import { boundGradientStopColor } from '@/app/properties/color-variable-binding'
import type { GradientStopColorVariableBindingApi } from '@/app/properties/color-variable-binding'

function fakeBindingApi(
  variable?: Variable,
  resolved?: unknown
): GradientStopColorVariableBindingApi {
  return {
    store: {
      resolveColorVariable: () => resolved
    },
    colorVariables: { value: [] },
    filteredVariables: { value: [] },
    searchTerm: { value: '' },
    getBoundVariable: () => undefined,
    bindVariable: () => undefined,
    unbindVariable: () => undefined,
    getGradientStopBoundVariable: () => variable,
    bindGradientStopVariable: () => undefined,
    unbindGradientStopVariable: () => undefined
  }
}

describe('color style row helpers', () => {
  test('resolves gradient stop variable colors', () => {
    const variable = {
      id: 'var:gradient-start',
      name: 'Gradient start',
      type: 'COLOR',
      collectionId: 'col:theme',
      valuesByMode: {},
      description: '',
      hiddenFromPublishing: false
    } satisfies Variable
    const color = { r: 0.25, g: 0.5, b: 0.75, a: 1 } satisfies Color

    expect(boundGradientStopColor(fakeBindingApi(variable, color), 'node:1', 0, 1)).toEqual(color)
  })

  test('ignores missing or non-color gradient stop variable values', () => {
    const variable = {
      id: 'var:gradient-start',
      name: 'Gradient start',
      type: 'COLOR',
      collectionId: 'col:theme',
      valuesByMode: {},
      description: '',
      hiddenFromPublishing: false
    } satisfies Variable

    expect(boundGradientStopColor(fakeBindingApi(undefined), 'node:1', 0, 1)).toBeUndefined()
    expect(
      boundGradientStopColor(fakeBindingApi(variable, 'not-a-color'), 'node:1', 0, 1)
    ).toBeUndefined()
  })
})
