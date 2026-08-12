import { describe, expect, test } from 'bun:test'

import type { Color, Variable } from '@open-pencil/scene-graph'

import { boundGradientStopColor } from '@/app/properties/color-variable-binding'
import type { GradientStopColorVariableBindingAPI } from '@/app/properties/color-variable-binding'

function fakeBindingAPI(
  variable?: Variable,
  resolved?: unknown
): GradientStopColorVariableBindingAPI {
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

    expect(boundGradientStopColor(fakeBindingAPI(variable, color), 'node:1', 0, 1)).toEqual(color)
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

    expect(boundGradientStopColor(fakeBindingAPI(undefined), 'node:1', 0, 1)).toBeUndefined()
    expect(
      boundGradientStopColor(fakeBindingAPI(variable, 'not-a-color'), 'node:1', 0, 1)
    ).toBeUndefined()
  })
})
