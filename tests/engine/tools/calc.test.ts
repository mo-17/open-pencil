import { describe, expect, test } from 'bun:test'

import { getTool, setupToolTest } from '#tests/helpers/tools'

interface CalcSuccess {
  expr: string
  result: number
}

interface CalcFailure {
  expr?: string
  error: string
}

interface CalcBatchResult {
  results: Array<CalcSuccess | CalcFailure>
}

type CalcResult = CalcSuccess | CalcFailure | CalcBatchResult

function calculate(expr: string): CalcResult {
  const { figma } = setupToolTest()
  return getTool('calc').execute(figma, { expr }) as CalcResult
}

function expectRejected(expr: string): void {
  const result = calculate(expr)
  expect(result).toHaveProperty('error')
}

describe('calc', () => {
  test('evaluates the documented bounded arithmetic grammar', () => {
    expect(calculate('1 + 2 * 3')).toEqual({ expr: '1 + 2 * 3', result: 7 })
    expect(calculate('(1 + 2) * 3')).toEqual({ expr: '(1 + 2) * 3', result: 9 })
    expect(calculate('2 ** 3 ** 2')).toEqual({ expr: '2 ** 3 ** 2', result: 512 })
    expect(calculate('5 % 2 + 1e2 + 0x10')).toEqual({
      expr: '5 % 2 + 1e2 + 0x10',
      result: 117
    })
  })

  test('allows only the documented math functions with bounded arity', () => {
    expect(
      calculate(
        'min(8, 3, 5) + max(2, 7) + floor(1.9) + ceil(1.1) + round(1.6) + abs(-2) + sqrt(9) + pow(2, 3)'
      )
    ).toMatchObject({ result: 28 })
    expectRejected('min()')
    expectRejected('sqrt(4, 9)')
    expectRejected('pow(2)')
  })

  test('preserves single, single-entry batch, multi-entry batch, and empty batch shapes', () => {
    expect(calculate('["1 + 2"]')).toEqual({ expr: '1 + 2', result: 3 })
    expect(calculate('["1 + 2", "sqrt(16)", "1 / 0"]')).toEqual({
      results: [
        { expr: '1 + 2', result: 3 },
        { expr: 'sqrt(16)', result: 4 },
        { expr: '1 / 0', error: 'Calculator expression is invalid: produced Infinity' }
      ]
    })
    expect(calculate('[]')).toEqual({ results: [] })
  })

  test('rejects non-finite results and literals', () => {
    expectRejected('1 / 0')
    expectRejected('0 / 0')
    expectRejected('sqrt(-1)')
    expectRejected('1e309')
  })

  test('rejects code, state, prototype access, and undocumented expression forms', () => {
    for (const expression of [
      'PI',
      'random()',
      'constructor.constructor("return 1")()',
      '__proto__',
      'prototype',
      'value = 1',
      'f(x) = x * x',
      '1; 2',
      '[1, 2]',
      '{ value: 1 }',
      'Math.floor(1.2)',
      '1 ^ 2',
      '2!',
      'true ? 1 : 2',
      '1 && 2',
      '"1"'
    ]) {
      expectRejected(expression)
    }
  })

  test('enforces expression, AST, nesting, batch, and item-type limits', () => {
    expectRejected('1'.repeat(2_049))
    expectRejected(`${'('.repeat(40)}1${')'.repeat(40)}`)
    expectRejected(Array.from({ length: 140 }, () => '1').join(' + '))

    const tooMany = JSON.stringify(Array.from({ length: 65 }, () => '1'))
    expect(calculate(tooMany)).toEqual({ error: 'Calculator batch exceeds 64 expressions' })
    expect(calculate('["1", 2]')).toEqual({
      error: 'Calculator batch entries must all be strings'
    })
  })
})
