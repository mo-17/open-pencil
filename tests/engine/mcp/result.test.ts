import { describe, expect, test } from 'bun:test'

import { fail, getDomainFailure, MAX_RESULT_BYTES, ok } from '#mcp/result'

describe('MCP result formatting', () => {
  test('keeps compact text for legacy clients and adds structured content', () => {
    const result = ok({ id: '1:2', nested: { value: true } }, 'get_node', {
      openpencil: { durationMs: 3 }
    })

    expect(result.isError).toBeUndefined()
    expect(result.content).toEqual([{ type: 'text', text: '{"id":"1:2","nested":{"value":true}}' }])
    expect(result.structuredContent).toEqual({ id: '1:2', nested: { value: true } })
    expect(result._meta).toEqual({ openpencil: { durationMs: 3 } })
  })

  test('wraps non-object structured results without changing legacy text', () => {
    const result = ok(['a', 'b'])

    expect(result.content).toEqual([{ type: 'text', text: '["a","b"]' }])
    expect(result.structuredContent).toEqual({ result: ['a', 'b'] })
  })

  test('returns machine-readable errors', () => {
    const result = fail(new Error('Node not found'))

    expect(result.isError).toBe(true)
    expect(result.structuredContent).toEqual({ error: 'Node not found' })
  })

  test('recognizes both core domain failure envelopes', () => {
    expect(getDomainFailure({ error: 'missing' })).toEqual({ error: 'missing' })
    expect(getDomainFailure({ ok: false, error: 'invalid' })).toEqual({ error: 'invalid' })
    expect(getDomainFailure({ ok: true, data: { error: 'domain data' } })).toBeUndefined()
  })

  test('returns structured errors for oversized text results', () => {
    const result = ok({ payload: 'x'.repeat(MAX_RESULT_BYTES) }, 'large_tool')

    expect(result.isError).toBe(true)
    expect(result.content[0].type).toBe('text')
    if (result.content[0].type !== 'text') throw new Error('Expected text result')
    const error = JSON.parse(result.content[0].text) as { error: string }
    expect(error.error).toContain('large_tool')
    expect(error.error).toContain('too large')
  })
})
