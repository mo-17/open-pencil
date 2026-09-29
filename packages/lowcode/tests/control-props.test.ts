import { describe, expect, test } from 'bun:test'

import {
  LOWCODE_INPUT_TYPES,
  lowcodeSelectOptions,
  parseLowcodeSelectOption,
  validateInteractiveProps
} from '@open-pencil/lowcode'

describe('portable control properties', () => {
  test('number defaults distinguish empty strings from invalid or nonfinite text without coercion', () => {
    for (const value of ['', '0', '-0.5', '1e3'])
      expect(validateInteractiveProps('INPUT', { inputType: 'number', value })).toEqual([])
    for (const value of ['NaN', 'Infinity', '0x10', 'one', '1e999'])
      expect(validateInteractiveProps('INPUT', { inputType: 'number', value })).toContainEqual(
        expect.objectContaining({ code: 'interactive-props-value-number' })
      )
  })
  test('accepts reviewed native input options while keeping values strings', () => {
    for (const inputType of LOWCODE_INPUT_TYPES) {
      let min: number | string = 0
      let max: number | string = 20
      if (inputType === 'time') {
        min = '08:00'
        max = '18:00'
      } else if (inputType === 'datetime-local') {
        min = '2026-09-28T08:00'
        max = '2026-09-29T18:00'
      }
      expect(
        validateInteractiveProps('INPUT', {
          inputType,
          value: '',
          inputMode: 'decimal',
          autoComplete: 'off',
          disabled: false,
          readOnly: true,
          ariaLabel: 'Price',
          min,
          max,
          step: 'any',
          minLength: 0,
          maxLength: 30
        })
      ).toEqual([])
    }
    expect(validateInteractiveProps('INPUT', { inputType: 'number', value: 1 })).toContainEqual(
      expect.objectContaining({ code: 'interactive-props-value-type' })
    )
    expect(validateInteractiveProps('INPUT', { inputType: 'file' })).toContainEqual(
      expect.objectContaining({ code: 'interactive-props-inputType-type' })
    )
  })

  test.each([
    { step: 0 },
    { step: -1 },
    { minLength: 0.5 },
    { maxLength: -1 },
    { autoComplete: 'arbitrary token' },
    { inputMode: 'arbitrary' },
    { ariaLabel: ' '.repeat(4) },
    { ariaLabel: 'x'.repeat(321) },
    { disabled: 'true' },
    { readOnly: 1 }
  ])('rejects invalid owned input properties %j', (props) => {
    expect(
      validateInteractiveProps('INPUT', props).some((issue) => issue.severity === 'error')
    ).toBe(true)
  })

  test('keeps old options, separates labels from values and refuses malformed object options', () => {
    const options = ['Legacy', { label: 'Display name', value: 'stable-id', disabled: true }]
    expect(validateInteractiveProps('SELECT', { options })).toEqual([])
    expect(lowcodeSelectOptions(options)).toEqual([
      { label: 'Legacy', value: 'Legacy' },
      { label: 'Display name', value: 'stable-id', disabled: true }
    ])
    for (const option of [
      { label: 'Missing value' },
      { value: 1, label: 'Numeric' },
      { label: 'x', value: 'x', action: 'run' },
      { label: 'x', value: 'x', disabled: 'true' }
    ]) {
      expect(parseLowcodeSelectOption(option)).toBeUndefined()
      expect(validateInteractiveProps('SELECT', { options: [option] })).toContainEqual(
        expect.objectContaining({ code: 'interactive-props-options-type' })
      )
    }
    expect(
      parseLowcodeSelectOption(
        Object.defineProperty({}, 'label', {
          get() {
            throw new Error('Getter must not run')
          }
        })
      )
    ).toBeUndefined()
  })
})
