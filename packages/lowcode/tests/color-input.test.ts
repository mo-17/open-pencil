import { expect, test } from 'bun:test'

import { isHexColorInputValue, validateColorInputProps } from '../src/color-input'
import { inputControlConfig } from '../src/input-affordances'
import { lowcodeInputRequiresString } from '../src/input-suggestions'
import { validateInteractiveProps } from '../src/interactive-props'

test('only bounded six-digit sRGB hex strings are color values', () => {
  for (const value of ['#000000', '#ffffff', '#12AbEf']) {
    expect(isHexColorInputValue(value)).toBe(true)
    expect(validateColorInputProps({ value })).toEqual([])
    expect(validateInteractiveProps('INPUT', { inputType: 'color', value })).toEqual([])
  }
  for (const value of [
    '#fff',
    '#11223344',
    'red',
    '#000000\n',
    ' #112233',
    'rgb(1,2,3)',
    'color(display-p3 1 0 0)',
    null,
    123
  ]) {
    expect(isHexColorInputValue(value)).toBe(false)
    expect(validateColorInputProps({ value })[0]?.code).toBe('color-input-invalid-value')
    expect(
      validateInteractiveProps('INPUT', { inputType: 'color', value }).some(
        (issue) => issue.code === 'color-input-invalid-value'
      )
    ).toBe(true)
  }
})

test('empty and missing remain unselected business values while color bindings require strings', () => {
  expect(validateColorInputProps({})).toEqual([])
  expect(validateColorInputProps({ value: '' })).toEqual([])
  expect(isHexColorInputValue('')).toBe(false)
  expect(lowcodeInputRequiresString({ inputType: 'color' })).toBe(true)
  expect(inputControlConfig({ inputType: 'color', value: '' })).toEqual({
    kind: 'color',
    readOnly: false
  })
  expect(inputControlConfig({ inputType: 'color', readOnly: true })).toEqual({
    kind: 'color',
    readOnly: true
  })
  expect(
    validateInteractiveProps('INPUT', { inputType: 'color', suggestions: ['#ffffff'] }).some(
      (issue) => issue.code === 'input-suggestions-type-unsupported'
    )
  ).toBe(true)
})
