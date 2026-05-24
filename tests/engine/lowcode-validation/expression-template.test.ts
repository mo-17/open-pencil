import { describe, expect, test } from 'bun:test'

import { emitExpression, parseTemplate } from '@open-pencil/core/lowcode-validation'

/** Parse a raw template string and emit it back to a JS string, failing the
 *  test if the scanner rejects the input. */
function emitTpl(raw: string): string {
  const r = parseTemplate(raw)
  if (!r.ok) throw new Error(`parseTemplate failed: ${r.error}`)
  return emitExpression(r.ast)
}

function refs(raw: string): string[] {
  const r = parseTemplate(raw)
  if (!r.ok) throw new Error(`parseTemplate failed: ${r.error}`)
  return [...r.references].sort()
}

describe('parseTemplate — degenerate (no interpolation)', () => {
  test('plain string yields a zero-expression template', () => {
    const r = parseTemplate('https://example.com/users')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.ast.kind).toBe('template')
    if (r.ast.kind !== 'template') return
    expect(r.ast.quasis).toEqual(['https://example.com/users'])
    expect(r.ast.expressions).toHaveLength(0)
    expect([...r.references]).toEqual([])
  })

  test('empty string is an empty degenerate template', () => {
    const r = parseTemplate('')
    expect(r.ok).toBe(true)
    if (!r.ok || r.ast.kind !== 'template') return
    expect(r.ast.quasis).toEqual([''])
    expect(r.ast.expressions).toHaveLength(0)
  })

  test('static template emits as a byte-identical double-quoted string', () => {
    // Decision §4.2 #c — static URLs must stay byte-identical to §3's
    // `JSON.stringify(url)` so the §3 emit golden does not drift.
    expect(emitTpl('https://example.com/users')).toBe(JSON.stringify('https://example.com/users'))
    expect(emitTpl('')).toBe('""')
  })
})

describe('parseTemplate — interpolation', () => {
  test('single interpolation splits quasis around the expression', () => {
    const r = parseTemplate('https://api.test/users/${userId}')
    expect(r.ok).toBe(true)
    if (!r.ok || r.ast.kind !== 'template') return
    expect(r.ast.quasis).toEqual(['https://api.test/users/', ''])
    expect(r.ast.expressions).toHaveLength(1)
    expect(r.ast.expressions[0]).toEqual({ kind: 'ident', name: 'userId' })
  })

  test('quasis.length === expressions.length + 1 invariant holds', () => {
    const r = parseTemplate('${a}-${b}-${c}')
    expect(r.ok).toBe(true)
    if (!r.ok || r.ast.kind !== 'template') return
    expect(r.ast.quasis).toHaveLength(r.ast.expressions.length + 1)
    expect(r.ast.quasis).toEqual(['', '-', '-', ''])
  })

  test('collects identifier references across every interpolation', () => {
    expect(refs('https://api.test/${userId}/posts/${postId}')).toEqual(['postId', 'userId'])
  })

  test('member expressions inside interpolation collect the root reference', () => {
    expect(refs('${user.name}/${index}')).toEqual(['index', 'user'])
  })

  test('emits a backtick template with interpolations preserved', () => {
    expect(emitTpl('https://api.test/users/${userId}')).toBe('`https://api.test/users/${userId}`')
    expect(emitTpl('${a + 1}')).toBe('`${a + 1}`')
  })

  test('escapes backticks and ${ inside literal quasi segments', () => {
    expect(emitTpl('a`b${x}')).toBe('`a\\`b${x}`')
    // A literal `$\{` in the raw text (not an interpolation) survives escaped.
    const r = parseTemplate('cost: $5 ${qty}')
    expect(r.ok).toBe(true)
    expect(emitTpl('cost: $5 ${qty}')).toBe('`cost: $5 ${qty}`')
  })
})

describe('parseTemplate — failures', () => {
  test('unterminated ${ is rejected', () => {
    const r = parseTemplate('https://api.test/${userId')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('unterminated')
  })

  test('a syntactically invalid interpolation is rejected', () => {
    const r = parseTemplate('${a +}')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('interpolation')
  })

  test('an empty interpolation is rejected', () => {
    const r = parseTemplate('${}')
    expect(r.ok).toBe(false)
  })
})

describe('parseTemplate — string literals inside ${ }', () => {
  test('a closing brace inside a string literal does not end the interpolation', () => {
    const r = parseTemplate('${greeting + "}"}')
    expect(r.ok).toBe(true)
    if (!r.ok || r.ast.kind !== 'template') return
    expect(r.ast.expressions).toHaveLength(1)
    expect(refs('${greeting + "}"}')).toEqual(['greeting'])
  })

  test('text after a string-literal-containing interpolation is captured', () => {
    const r = parseTemplate('${"a}b"}/tail')
    expect(r.ok).toBe(true)
    if (!r.ok || r.ast.kind !== 'template') return
    expect(r.ast.quasis).toEqual(['', '/tail'])
  })
})
