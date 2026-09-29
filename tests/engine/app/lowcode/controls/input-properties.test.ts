import { expect, test } from 'bun:test'

import { changeInputType } from '@/app/lowcode/controls/input-properties'

test('color type changes remove incompatible literals and constraints while unchanged color preserves empty values', () => {
  const source = {
    inputType: 'number',
    value: '25',
    min: 0,
    max: 30,
    step: 1,
    showStepper: true,
    stepperPlacement: 'sides',
    readOnly: true,
    name: 'accent'
  }
  expect(changeInputType(source, 'color')).toEqual({
    inputType: 'color',
    readOnly: true,
    name: 'accent'
  })
  expect(source.value).toBe('25')
  expect(
    changeInputType(
      {
        inputType: 'text',
        suggestions: ['red'],
        value: 'red',
        maxLength: 20,
        placeholder: 'Color'
      },
      'color'
    )
  ).toEqual({ inputType: 'color' })
  const color = { inputType: 'color', value: '', disabled: true }
  expect(changeInputType(color, 'color')).toEqual(color)
})

test('type changes clear incompatible constraints and local suggestions atomically without mutating input', () => {
  const original = {
    inputType: 'text',
    value: 'Xiamen',
    suggestions: ['Xiamen'],
    maxLength: 60,
    placeholder: 'City',
    disabled: true
  }
  const next = changeInputType(original, 'time')
  expect(next).toEqual({ inputType: 'time', disabled: true })
  expect(original.suggestions).toEqual(['Xiamen'])
  expect(original.value).toBe('Xiamen')
  expect(
    changeInputType(
      { inputType: 'time', min: '08:00', max: '18:00', step: 60, value: '09:30' },
      'number'
    )
  ).toEqual({ inputType: 'number' })
})

test('text/search changes preserve free values and suggestions while unchanged time preserves constraints', () => {
  expect(
    changeInputType({ inputType: 'text', suggestions: ['City'], value: 'Free text' }, 'search')
  ).toEqual({ inputType: 'search', suggestions: ['City'], value: 'Free text' })
  const time = { inputType: 'time', min: '22:00', max: '04:00', step: 'any', value: '23:00' }
  expect(changeInputType(time, 'time')).toEqual(time)
  expect(changeInputType({ value: '123', inputType: 'text' }, 'number')).toEqual({
    value: '123',
    inputType: 'number'
  })
})

test('advanced input switches remove incompatible affordances without mutating the original props', () => {
  const number = {
    inputType: 'number',
    value: '2.5',
    min: 0,
    max: 10,
    step: 0.5,
    showStepper: false,
    stepperPlacement: 'sides',
    disabled: true
  }
  expect(changeInputType(number, 'number')).toEqual(number)
  expect(changeInputType(number, 'datetime-local')).toEqual({
    inputType: 'datetime-local',
    disabled: true
  })
  expect(number.value).toBe('2.5')
  expect(number.showStepper).toBe(false)
  expect(
    changeInputType({ inputType: 'password', value: '', showPasswordToggle: true }, 'text')
  ).toEqual({ inputType: 'text', value: '' })
  expect(changeInputType({ inputType: 'text', suggestions: ['City'] }, 'password')).toEqual({
    inputType: 'password'
  })
})

test('date-time precision and bounds survive same-type edits but are cleared when changing kind', () => {
  const props = {
    inputType: 'datetime-local',
    value: '2026-09-28T09:30:15',
    min: '2026-01-01T00:00',
    max: '2026-12-31T23:59',
    step: 15
  }
  expect(changeInputType(props, 'datetime-local')).toEqual(props)
  expect(changeInputType(props, 'time')).toEqual({ inputType: 'time' })
  expect(changeInputType(props, 'number')).toEqual({ inputType: 'number' })
})
