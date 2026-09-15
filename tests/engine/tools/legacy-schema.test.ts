import { describe, expect, test } from 'bun:test'

import * as v from 'valibot'

import { defineTool, isToolExposed } from '#core/tools/schema'

import { setupToolTest } from '#tests/helpers/tools'

describe('legacy tool declaration boundary', () => {
  const definition = defineTool({
    name: 'legacy-contract-fixture',
    description: 'Compatibility contract',
    mutates: true,
    exposure: { webmcp: true, ai: false },
    params: {
      patch: {
        type: 'object',
        description: 'Strict patch',
        required: true,
        properties: {
          amount: { type: 'number', description: 'Amount', required: true, min: 1, max: 5 },
          active: { type: 'boolean', description: 'Active', default: false }
        }
      },
      labels: {
        type: 'array',
        description: 'Labels',
        minItems: 1,
        maxItems: 2,
        items: { type: 'string', description: 'Label', enum: ['a', 'b'] }
      }
    },
    execute: (_figma, args, context) => ({ args, signal: context?.signal })
  })

  test('normalizes nested numbers and defaults while retaining request context', () => {
    const { figma } = setupToolTest()
    const signal = new AbortController().signal
    expect(definition.execute(figma, { patch: { amount: '2' } }, { signal })).toEqual({
      args: { patch: { amount: 2, active: false } },
      signal
    })
  })

  test.each([
    { patch: { amount: ' ' } },
    { patch: { amount: true } },
    { patch: { amount: Infinity } },
    { patch: { amount: 6 } },
    { patch: { amount: 2, unreviewed: true } },
    { patch: { amount: 2 }, labels: [] },
    { patch: { amount: 2 }, labels: ['a', 'b', 'a'] },
    { patch: { amount: 2 }, labels: ['c'] }
  ])('rejects malformed legacy input %# before execution', (args) => {
    expect(v.safeParse(definition.input, args).success).toBe(false)
    expect(() => definition.execute(setupToolTest().figma, args)).toThrow()
  })

  test('does not grant legacy extensions browser-native authority', () => {
    expect(isToolExposed(definition, 'webmcp')).toBe(false)
    expect(isToolExposed(definition, 'ai')).toBe(false)
    expect(isToolExposed(definition, 'mcp')).toBe(true)
    expect(definition.execution).toEqual({ kind: 'async', mutation: 'document' })
  })
})
