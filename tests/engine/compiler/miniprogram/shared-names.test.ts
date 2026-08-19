import { describe, expect, test } from 'bun:test'

import { safeMiniProgramIdentifier } from '#compiler/adapters/miniprogram-shared'

import { ECMASCRIPT_RESERVED_IDENTIFIERS } from '@open-pencil/lowcode'

const LEGACY_EMBEDDED_RESERVED_IDENTIFIERS = [
  'abstract',
  'boolean',
  'byte',
  'char',
  'double',
  'final',
  'float',
  'goto',
  'int',
  'long',
  'native',
  'short',
  'synchronized',
  'throws',
  'transient',
  'volatile'
] as const

describe('Mini Program shared generated names', () => {
  test('aliases every ECMAScript and legacy embedded-runtime reserved word', () => {
    for (const reserved of [
      ...ECMASCRIPT_RESERVED_IDENTIFIERS,
      ...LEGACY_EMBEDDED_RESERVED_IDENTIFIERS
    ]) {
      const identifier = safeMiniProgramIdentifier(reserved, 'prop')
      expect(identifier).not.toBe(reserved)
      expect(identifier).toMatch(/^[A-Za-z_$][A-Za-z0-9_$]*$/)
      expect(() =>
        new Bun.Transpiler({ loader: 'tsx' }).transformSync(`const ${identifier} = 1`)
      ).not.toThrow()
    }
  })

  test('keeps ordinary identifiers stable', () => {
    expect(safeMiniProgramIdentifier('cardTitle', 'prop')).toBe('cardTitle')
    expect(safeMiniProgramIdentifier('class', 'prop')).toBe(
      safeMiniProgramIdentifier('class', 'prop')
    )
  })
})
