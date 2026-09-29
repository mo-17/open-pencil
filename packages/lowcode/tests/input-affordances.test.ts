import { describe, expect, test } from 'bun:test'

import { inputControlConfig, validateInputAffordances } from '../src/input-affordances'

describe('authored number and password controls', () => {
  test('preserves legacy native inputs unless explicitly configured', () => {
    for (const inputType of ['text', 'number', 'password', 'time']) {
      expect(inputControlConfig({ inputType })).toBeUndefined()
      expect(validateInputAffordances({ inputType })).toEqual([])
    }
    expect(inputControlConfig({ inputType: 'password', showPasswordToggle: false })).toBeUndefined()
  })

  test('distinguishes native, hidden, end and two-sided number steppers', () => {
    expect(inputControlConfig({ inputType: 'number', showStepper: true })).toEqual({
      kind: 'number',
      showStepper: true,
      placement: 'end'
    })
    expect(inputControlConfig({ inputType: 'number', showStepper: false })).toEqual({
      kind: 'number',
      showStepper: false,
      placement: 'end'
    })
    expect(inputControlConfig({ inputType: 'number', stepperPlacement: 'sides' })).toEqual({
      kind: 'number',
      showStepper: true,
      placement: 'sides'
    })
    expect(
      inputControlConfig({ inputType: 'number', showStepper: false, stepperPlacement: 'sides' })
    ).toEqual({ kind: 'number', showStepper: false, placement: 'sides' })
  })

  test('does not embed values or a revealed state in password runtime configuration', () => {
    const props = { inputType: 'password', showPasswordToggle: true, value: 'fixture-only' }
    expect(inputControlConfig(props)).toEqual({ kind: 'password' })
    expect(props.value).toBe('fixture-only')
  })

  test('rejects malformed and incompatible options rather than coercing them', () => {
    for (const value of ['false', 0, {}, null]) {
      expect(validateInputAffordances({ inputType: 'number', showStepper: value })[0]?.code).toBe(
        'input-affordance-invalid-type'
      )
      expect(
        inputControlConfig({ inputType: 'password', showPasswordToggle: value })
      ).toBeUndefined()
    }
    for (const props of [
      { inputType: 'text', showStepper: true },
      { inputType: 'password', stepperPlacement: 'end' },
      { inputType: 'number', showPasswordToggle: true },
      { inputType: 'number', stepperPlacement: 'left' }
    ]) {
      expect(validateInputAffordances(props).length).toBeGreaterThan(0)
      expect(inputControlConfig(props)).toBeUndefined()
    }
  })
})
