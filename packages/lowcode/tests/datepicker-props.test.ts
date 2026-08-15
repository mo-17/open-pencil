import { describe, expect, test } from 'bun:test'

import { type DatePickerIssueCode, isIsoDate, validateDatePickerProps } from '@open-pencil/lowcode'

/**
 * Phase 3 §3.v7 step 1 — direct unit coverage at the shared location.
 * Tool-side end-to-end coverage (via `update_lowcode_node`) lives in
 * `tests/engine/tools/lowcode/`; emit/IR-warning coverage lives in the
 * compiler tests. These exercise the validator in isolation so all three
 * consumers inherit the same contract.
 */

function codes(ip: Record<string, unknown>): DatePickerIssueCode[] {
  return validateDatePickerProps(ip).map((i) => i.code)
}

describe('isIsoDate', () => {
  test('accepts real zero-padded calendar days', () => {
    expect(isIsoDate('2026-05-29')).toBe(true)
    expect(isIsoDate('2000-01-01')).toBe(true)
    expect(isIsoDate('2024-02-29')).toBe(true) // leap year
  })

  test('rejects impossible calendar days the regex alone would pass', () => {
    expect(isIsoDate('2026-13-45')).toBe(false)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2026-00-10')).toBe(false)
    expect(isIsoDate('2025-02-29')).toBe(false) // not a leap year
  })

  test('rejects non-strict / non-ISO shapes', () => {
    expect(isIsoDate('2026-2-3')).toBe(false) // not zero-padded
    expect(isIsoDate('next tuesday')).toBe(false)
    expect(isIsoDate('05/29/2026')).toBe(false)
    expect(isIsoDate('')).toBe(false)
    expect(isIsoDate('2026-05-29T00:00')).toBe(false)
  })
})

describe('validateDatePickerProps', () => {
  test('empty / absent / non-string fields are "not set" → clean', () => {
    expect(validateDatePickerProps({})).toEqual([])
    expect(validateDatePickerProps({ value: '', min: '', max: '' })).toEqual([])
    expect(validateDatePickerProps({ value: 42, min: null, max: undefined })).toEqual([])
  })

  test('valid value + min + max is clean', () => {
    expect(
      validateDatePickerProps({ value: '2026-06-15', min: '2026-01-01', max: '2026-12-31' })
    ).toEqual([])
  })

  test('single-sided range is allowed', () => {
    expect(validateDatePickerProps({ value: '2026-06-15', min: '2026-01-01' })).toEqual([])
    expect(validateDatePickerProps({ value: '2026-06-15', max: '2026-12-31' })).toEqual([])
  })

  test('flags invalid format per field', () => {
    expect(codes({ value: '2026-13-45' })).toEqual(['datepicker-invalid-value'])
    expect(codes({ min: 'soon' })).toEqual(['datepicker-invalid-min'])
    expect(codes({ max: '2026-02-30' })).toEqual(['datepicker-invalid-max'])
    const issue = validateDatePickerProps({ min: 'bad' })[0]
    expect(issue?.key).toBe('min')
  })

  test('range-inverted when min > max (both valid)', () => {
    expect(codes({ min: '2026-12-31', max: '2026-01-01' })).toEqual(['datepicker-range-inverted'])
    // equal bounds are not inverted
    expect(codes({ min: '2026-06-15', max: '2026-06-15' })).toEqual([])
  })

  test('does not range-check when a bound is format-invalid', () => {
    // only the format issue, no spurious range-inverted
    expect(codes({ min: 'bad', max: '2026-01-01' })).toEqual(['datepicker-invalid-min'])
  })

  test('value-out-of-range below min or above max', () => {
    expect(codes({ value: '2025-12-31', min: '2026-01-01' })).toEqual([
      'datepicker-value-out-of-range'
    ])
    expect(codes({ value: '2027-01-01', max: '2026-12-31' })).toEqual([
      'datepicker-value-out-of-range'
    ])
    // inclusive bounds are in range
    expect(codes({ value: '2026-01-01', min: '2026-01-01', max: '2026-12-31' })).toEqual([])
  })

  test('a format-invalid value is not also flagged out-of-range', () => {
    expect(codes({ value: 'bad', min: '2026-01-01' })).toEqual(['datepicker-invalid-value'])
  })

  test('multiple independent issues are all reported', () => {
    const result = codes({ value: 'bad', min: '2026-12-31', max: '2026-01-01' })
    expect(result).toContain('datepicker-invalid-value')
    expect(result).toContain('datepicker-range-inverted')
  })
})
