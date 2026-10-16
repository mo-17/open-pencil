import { expect, test } from 'bun:test'

import { isCanonicalBackendDate, isWellFormedBackendText } from '#lowcode/backend/scalar-text'

test('portable Backend text preserves valid astral and replacement characters while rejecting isolated surrogate units', () => {
  for (const value of [
    '',
    'plain\u0000text',
    '中文',
    '\uFFFD',
    '\uD800\uDC00',
    '\uDBFF\uDFFF',
    'a😀b'
  ]) {
    expect(isWellFormedBackendText(value)).toBe(true)
  }
  for (const value of [
    '\uD800',
    '\uDBFF',
    '\uDC00',
    '\uDFFF',
    'x\uD800',
    '\uD800x',
    '\uDC00\uD800',
    '\uD800\uD800\uDC00',
    '\uD800\uDC00\uDC00'
  ]) {
    expect(isWellFormedBackendText(value)).toBe(false)
  }
})

test('canonical Backend dates accept leap days without calendar rollover or implicit time suffixes', () => {
  for (const value of ['0000-01-01', '2000-02-29', '2024-02-29', '9999-12-31'])
    expect(isCanonicalBackendDate(value)).toBe(true)
  for (const value of [
    '1900-02-29',
    '2023-02-29',
    '2024-04-31',
    '2024-00-01',
    '2024-01-00',
    '2024-1-01',
    '2024-01-01Z',
    '2024-01-01T00:00:00.000Z'
  ])
    expect(isCanonicalBackendDate(value)).toBe(false)
})
