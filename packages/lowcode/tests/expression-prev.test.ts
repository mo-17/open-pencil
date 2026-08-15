import { describe, expect, test } from 'bun:test'

import {
  emitExpression,
  hasPrevReference,
  parseExpression,
  PREV_IDENT,
  substitutePrev
} from '@open-pencil/lowcode'

function parse(src: string) {
  const r = parseExpression(src)
  if (!r.ok) throw new Error(`parse failed: ${r.error}`)
  return r
}

describe('parseExpression — $prev reserved identifier (Phase 2 §2)', () => {
  test('$prev parses as a plain identifier', () => {
    const r = parse('$prev')
    expect(r.ast).toEqual({ kind: 'ident', name: '$prev' })
    expect([...r.references]).toEqual(['$prev'])
  })

  test('$prev + 1 — references collected', () => {
    const r = parse('$prev + 1')
    expect([...r.references]).toEqual(['$prev'])
    expect(emitExpression(r.ast)).toBe('$prev + 1')
  })

  test('mixed $prev and a regular state ident', () => {
    const r = parse('$prev * 2 + count')
    expect([...r.references].sort()).toEqual(['$prev', 'count'])
  })

  test('member access stays anchored at the root ident', () => {
    const r = parse('$prev.length')
    expect([...r.references]).toEqual(['$prev'])
  })

  test('PREV_IDENT export matches the literal users type', () => {
    expect(PREV_IDENT).toBe('$prev')
  })

  test('other $ identifiers parse without crashing (caller validates)', () => {
    const r = parse('$foo + 1')
    expect([...r.references]).toEqual(['$foo'])
  })

  test('$ at start of identifier inside string literal is untouched', () => {
    const r = parse("'$prev'")
    expect(r.ast).toEqual({ kind: 'string', value: '$prev' })
    expect([...r.references]).toEqual([])
  })
})

describe('hasPrevReference', () => {
  test('plain $prev', () => {
    expect(hasPrevReference(parse('$prev').ast)).toBe(true)
  })

  test('arithmetic involving $prev', () => {
    expect(hasPrevReference(parse('$prev + 1').ast)).toBe(true)
    expect(hasPrevReference(parse('1 + $prev').ast)).toBe(true)
    expect(hasPrevReference(parse('count + 1').ast)).toBe(false)
  })

  test('inside unary / member / ternary', () => {
    expect(hasPrevReference(parse('!$prev').ast)).toBe(true)
    expect(hasPrevReference(parse('$prev.length').ast)).toBe(true)
    expect(hasPrevReference(parse('flag ? $prev : 0').ast)).toBe(true)
    expect(hasPrevReference(parse('flag ? 1 : 0').ast)).toBe(false)
  })

  test('$other does not count as $prev', () => {
    expect(hasPrevReference(parse('$other + 1').ast)).toBe(false)
  })
})

describe('substitutePrev', () => {
  test('renames $prev to the chosen formal parameter', () => {
    const ast = parse('$prev + 1').ast
    expect(emitExpression(substitutePrev(ast, 'prev'))).toBe('prev + 1')
  })

  test('renames every $prev occurrence', () => {
    const ast = parse('$prev * $prev').ast
    expect(emitExpression(substitutePrev(ast, 'prev'))).toBe('prev * prev')
  })

  test('leaves non-$prev identifiers alone', () => {
    const ast = parse('$prev * 2 + count').ast
    expect(emitExpression(substitutePrev(ast, 'prev'))).toBe('prev * 2 + count')
  })

  test('input AST is not mutated', () => {
    const ast = parse('$prev + 1').ast
    const original = JSON.stringify(ast)
    substitutePrev(ast, 'prev')
    expect(JSON.stringify(ast)).toBe(original)
  })

  test('preserves member access and nested structures', () => {
    const ast = parse('$prev.length + 1').ast
    expect(emitExpression(substitutePrev(ast, 'prev'))).toBe('prev.length + 1')
  })

  test('ternary descend', () => {
    const ast = parse('flag ? $prev + 1 : $prev - 1').ast
    expect(emitExpression(substitutePrev(ast, 'prev'))).toBe('flag ? prev + 1 : prev - 1')
  })
})
