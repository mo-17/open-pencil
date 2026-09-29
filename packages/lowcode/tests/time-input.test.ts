import { describe, expect, test } from 'bun:test'

import {
  isIsoTime,
  timeInputSeconds,
  validateTimeInputProps,
  validateInteractiveProps,
  parseInputSuggestions,
  lowcodeInputRequiresString,
  auditValidatedFormControls
} from '@open-pencil/lowcode'
import { SceneGraph } from '@open-pencil/scene-graph'

describe('authored time input boundary', () => {
  test('accepts only padded local 24-hour strings and never dates, offsets or fractional seconds', () => {
    for (const value of ['00:00', '23:59', '09:30:45', '00:00:00'])
      expect(isIsoTime(value)).toBe(true)
    for (const value of [
      '',
      '9:30',
      '24:00',
      '12:60',
      '12:30:60',
      '12:30Z',
      '12:30:00.1',
      '2026-09-27',
      null,
      1230
    ])
      expect(isIsoTime(value)).toBe(false)
    expect(timeInputSeconds('23:59:59')).toBe(86399)
    expect(timeInputSeconds('24:00')).toBeUndefined()
    expect(
      validateInteractiveProps('INPUT', {
        inputType: 'time',
        value: '',
        min: '',
        max: '',
        step: 'any'
      })
    ).toEqual([])
  })
  test('reports malformed attributes separately from native range and step constraints', () => {
    expect(
      validateTimeInputProps({ value: 930, min: '8:00', max: '24:00', step: 0.5 }).map(
        (issue) => issue.code
      )
    ).toEqual([
      'time-input-invalid-value',
      'time-input-invalid-min',
      'time-input-invalid-max',
      'time-input-invalid-step'
    ])
    const invalid = validateTimeInputProps({
      min: '09:00',
      max: '17:00',
      value: '08:30:01',
      step: 60
    })
    expect(invalid.map((issue) => issue.code)).toEqual([
      'time-input-value-out-of-range',
      'time-input-step-mismatch'
    ])
    expect(invalid.every((issue) => issue.severity === 'warning')).toBe(true)
    expect(validateTimeInputProps({ value: '09:30:15' })).toEqual([])
    expect(validateTimeInputProps({ min: '00:00', value: '09:30:15', step: 'any' })).toEqual([])
  })
  test('respects native ranges crossing midnight without silently reordering times', () => {
    for (const value of ['23:00', '00:30', '22:00', '02:00'])
      expect(validateTimeInputProps({ min: '22:00', max: '02:00', value })).toEqual([])
    expect(validateTimeInputProps({ min: '22:00', max: '02:00', value: '12:00' })[0]?.code).toBe(
      'time-input-value-out-of-range'
    )
    expect(validateTimeInputProps({ min: '09:00', max: '09:00', value: '09:00' })).toEqual([])
  })
  test('time and suggestions require string FORM state while ordinary numeric input remains valid', () => {
    const graph = new SceneGraph(),
      page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [{ id: 'number', name: 'amount', type: 'number', defaultValue: 930 }]
    })
    for (const props of [
      { inputType: 'time' },
      { inputType: 'text', suggestions: ['Alpha'] },
      { inputType: 'number' }
    ]) {
      const node = graph.createNode('INPUT', page.id, {
        bindings: { value: { kind: 'ref', stateId: 'number' } },
        interactiveProps: { ...props, validation: { required: true } }
      })
      const audit = auditValidatedFormControls(graph, node.id)
      expect(audit.ok).toBe(true)
      if (!audit.ok) throw new Error(audit.error)
      expect(audit.data.controls[0].bindingStatus).toBe(
        props.inputType === 'number' ? 'valid' : 'invalid'
      )
      expect(audit.data.controls[0].allowedBindingTypes).toEqual(
        props.inputType === 'number' ? ['string', 'number'] : ['string']
      )
    }
  })
  test('suggestions stay bounded, literal, unique and restricted to text/search', () => {
    expect(parseInputSuggestions(['<img src=x>', '中文'])).toEqual(['<img src=x>', '中文'])
    for (const value of [
      null,
      [''],
      ['  '],
      ['a', 'a'],
      [1],
      ['a'.repeat(201)],
      Array.from({ length: 101 }, (_, index) => String(index))
    ])
      expect(parseInputSuggestions(value)).toBeUndefined()
    expect(
      validateInteractiveProps('INPUT', { inputType: 'time', suggestions: ['09:00'] }).map(
        (issue) => issue.code
      )
    ).toContain('input-suggestions-type-unsupported')
    expect(lowcodeInputRequiresString({ inputType: 'search', suggestions: ['A'] })).toBe(true)
    expect(lowcodeInputRequiresString({ inputType: 'number' })).toBe(false)
  })
})
