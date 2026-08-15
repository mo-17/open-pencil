import { describe, expect, test } from 'bun:test'

import { emitExpression, parseExpression } from '@open-pencil/lowcode'

function emit(src: string): string {
  const r = parseExpression(src)
  if (!r.ok) throw new Error(`parse failed: ${r.error}`)
  return emitExpression(r.ast)
}

function refs(src: string): string[] {
  const r = parseExpression(src)
  if (!r.ok) throw new Error(`parse failed: ${r.error}`)
  return [...r.references].sort()
}

describe('parseExpression — literals & identifiers', () => {
  test('integer literal', () => {
    expect(emit('42')).toBe('42')
  })

  test('string literal preserves contents', () => {
    expect(emit('"hello"')).toBe('"hello"')
    expect(emit("'world'")).toBe('"world"')
  })

  test('identifier', () => {
    expect(emit('count')).toBe('count')
    expect(refs('count')).toEqual(['count'])
  })

  test('member access', () => {
    expect(emit('state.count')).toBe('state.count')
    expect(refs('state.count')).toEqual(['state'])
  })

  test('rejects empty input', () => {
    expect(parseExpression('').ok).toBe(false)
    expect(parseExpression('   ').ok).toBe(false)
  })
})

describe('parseExpression — operators', () => {
  test('addition / subtraction', () => {
    expect(emit('count + 1')).toBe('count + 1')
    expect(emit('count - 1')).toBe('count - 1')
  })

  test('precedence: * binds tighter than +', () => {
    const out = emit('a + b * c')
    expect(out).toBe('a + b * c')
  })

  test('parentheses preserve grouping', () => {
    expect(emit('(a + b) * c')).toBe('(a + b) * c')
  })

  test('comparisons', () => {
    expect(emit('count >= 10')).toBe('count >= 10')
    expect(emit('a === b')).toBe('a === b')
  })

  test('logical operators', () => {
    expect(emit('a && b || c')).toBe('a && b || c')
  })

  test('unary !', () => {
    expect(emit('!flag')).toBe('!flag')
  })

  test('ternary', () => {
    expect(emit('a ? 1 : 0')).toBe('a ? 1 : 0')
  })
})

describe('parseExpression — refusals', () => {
  test('rejects function calls', () => {
    expect(parseExpression('foo(1)').ok).toBe(false)
  })

  test('rejects assignment', () => {
    expect(parseExpression('a = 1').ok).toBe(false)
  })

  test('rejects array literal', () => {
    expect(parseExpression('[1, 2]').ok).toBe(false)
  })

  test('rejects object literal', () => {
    expect(parseExpression('{ a: 1 }').ok).toBe(false)
  })

  test('rejects template literal', () => {
    expect(parseExpression('`a${b}`').ok).toBe(false)
  })

  test('rejects trailing tokens', () => {
    expect(parseExpression('a b').ok).toBe(false)
  })
})

describe('references collection', () => {
  test('binary expression collects both sides', () => {
    expect(refs('a + b')).toEqual(['a', 'b'])
  })

  test('member chain reports root identifier only', () => {
    expect(refs('user.profile.name')).toEqual(['user'])
  })

  test('ternary collects all branches', () => {
    expect(refs('cond ? yes : no')).toEqual(['cond', 'no', 'yes'])
  })
})
