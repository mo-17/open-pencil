import { describe, expect, test } from 'bun:test'

import {
  auditValidatedFormControls,
  dateTimeInputSeconds,
  isIsoLocalDateTime,
  lowcodeInputRequiresString,
  validateDateTimeInputProps,
  validateInteractiveProps,
  validateTimeInputProps
} from '@open-pencil/lowcode'
import { SceneGraph } from '@open-pencil/scene-graph'

function civilSeconds(value: string): number {
  const seconds = dateTimeInputSeconds(value)
  if (seconds === undefined) throw new Error(`Invalid test date: ${value}`)
  return seconds
}

describe('local date-time input boundary', () => {
  test('validates real Gregorian calendar days without timezone or Date normalization', () => {
    for (const value of [
      '0001-01-01T00:00',
      '0099-12-31T23:59:59',
      '2000-02-29T12:30',
      '2024-02-29T23:59:59',
      '9999-12-31T23:59',
      '2026-03-08T02:30'
    ])
      expect(isIsoLocalDateTime(value)).toBe(true)
    for (const value of [
      '',
      null,
      2026,
      '0000-01-01T00:00',
      '1900-02-29T10:00',
      '2026-02-29T12:00',
      '2026-04-31T12:00',
      '2026-13-01T12:00',
      '2026-00-01T12:00',
      '2026-01-00T12:00',
      '2026-9-01T12:00',
      '2026-09-01 12:00',
      '2026-09-01T24:00',
      '2026-09-01T12:00Z',
      '2026-09-01T12:00+08:00',
      '2026-09-01T12:00:00.5',
      '2026-09-01T12:\n00',
      '2026-09-01T12:00\n'
    ])
      expect(isIsoLocalDateTime(value)).toBe(false)
    expect(dateTimeInputSeconds('0001-01-01T00:00')).toBe(0)
    expect(dateTimeInputSeconds('2026-09-01T12:00')).toBe(
      dateTimeInputSeconds('2026-09-01T12:00:00')
    )
    expect(civilSeconds('2024-03-01T00:00') - civilSeconds('2024-02-28T00:00')).toBe(172800)
    expect(civilSeconds('1900-03-01T00:00') - civilSeconds('1900-02-28T00:00')).toBe(86400)
    expect(dateTimeInputSeconds('not a date')).toBeUndefined()
  })

  test('empty values clear constraints while malformed values have stable field diagnostics', () => {
    expect(
      validateInteractiveProps('INPUT', {
        inputType: 'datetime-local',
        value: '',
        min: '',
        max: '',
        step: 'any'
      })
    ).toEqual([])
    const issues = validateDateTimeInputProps({
      value: '2026-02-30T09:00',
      min: 0,
      max: '2026-09-01T12:00Z',
      step: 0.5
    })
    expect(issues.map(({ code }) => code)).toEqual([
      'date-time-input-invalid-value',
      'date-time-input-invalid-min',
      'date-time-input-invalid-max',
      'date-time-input-invalid-step'
    ])
    expect(issues.every(({ severity }) => severity === 'error')).toBe(true)
    expect(
      validateInteractiveProps('INPUT', {
        inputType: 'datetime-local',
        value: '2026-09-28T10:00:15',
        step: 15
      })
    ).toEqual([])
  })

  test('rejects inverted full dates but preserves the existing time-only midnight interval', () => {
    expect(
      validateDateTimeInputProps({ min: '2026-09-28T22:00', max: '2026-09-28T02:00' })
    ).toEqual([
      expect.objectContaining({
        code: 'date-time-input-range-inverted',
        key: 'min',
        severity: 'error'
      })
    ])
    expect(validateTimeInputProps({ min: '22:00', max: '02:00', value: '23:00' })).toEqual([])
    expect(
      validateDateTimeInputProps({
        min: '2026-09-28T22:00',
        max: '2026-09-29T02:00',
        value: '2026-09-29T00:30'
      })
    ).toEqual([])
    expect(
      validateDateTimeInputProps({
        min: '2026-09-28T10:00',
        max: '2026-09-28T10:00:00',
        value: '2026-09-28T10:00'
      })
    ).toEqual([])
  })

  test('range and second steps follow civil elapsed time across days and leap years', () => {
    const issues = validateDateTimeInputProps({
      min: '2024-02-28T23:59:50',
      max: '2024-03-01T12:00',
      value: '2024-03-01T12:00:01',
      step: 15
    })
    expect(issues.map(({ code }) => code)).toEqual([
      'date-time-input-value-out-of-range',
      'date-time-input-step-mismatch'
    ])
    expect(issues.every(({ severity }) => severity === 'warning')).toBe(true)
    expect(
      validateDateTimeInputProps({
        min: '2024-02-28T23:59:50',
        value: '2024-02-29T00:00:05',
        step: 15
      })
    ).toEqual([])
    expect(validateDateTimeInputProps({ value: '2026-09-28T10:00:15' })).toEqual([])
    expect(
      validateDateTimeInputProps({
        min: '2026-09-28T00:00',
        value: '2026-09-28T10:00:15',
        step: 'any'
      })
    ).toEqual([])
  })

  test('date-time requires string FORM state and rejects text suggestions', () => {
    const graph = new SceneGraph(),
      page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [
        { id: 'text', name: 'appointment', type: 'string', defaultValue: '' },
        { id: 'number', name: 'amount', type: 'number', defaultValue: 2026 }
      ]
    })
    const node = graph.createNode('INPUT', page.id, {
      interactiveProps: { inputType: 'datetime-local', validation: { required: true } }
    })
    for (const stateId of ['text', 'number']) {
      graph.updateNode(node.id, { bindings: { value: { kind: 'ref', stateId } } })
      const result = auditValidatedFormControls(graph, node.id)
      if (!result.ok) throw new Error(result.error)
      expect(result.data.controls[0].allowedBindingTypes).toEqual(['string'])
      expect(result.data.controls[0].bindingStatus).toBe(stateId === 'text' ? 'valid' : 'invalid')
    }
    expect(lowcodeInputRequiresString(node.interactiveProps)).toBe(true)
    expect(
      validateInteractiveProps('INPUT', {
        inputType: 'datetime-local',
        suggestions: ['today']
      }).map(({ code }) => code)
    ).toContain('input-suggestions-type-unsupported')
  })
})
