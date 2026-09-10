import { describe, expect, test } from 'bun:test'

import { generatedRuntime, workflowRequest } from './helpers'

describe('executed Supabase Edge runtime request policy', () => {
  test.each([
    { body: '{"ok":true}', type: 'application/json', expected: { ok: true } },
    { body: 'plain response', type: 'text/plain', expected: 'plain response' },
    { body: '', type: 'application/json', expected: null }
  ])('reads a bounded $type response and releases its reader', async (fixture) => {
    const upstream = new Response(fixture.body, {
      headers: { 'content-type': fixture.type }
    })
    const runtime = generatedRuntime(async () => upstream)
    const response = await runtime.handler(workflowRequest())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(fixture.expected)
    expect(upstream.body?.locked).toBe(false)
    expect(runtime.calls).toHaveLength(1)
    expect(runtime.calls[0].init.signal?.aborted).toBe(false)
    expect(runtime.delays).toEqual([8_000])
    expect(runtime.clearedTimers).toBe(1)
  })

  test.each([
    'http://api.example.com/write',
    'https://user:private@api.example.com/write',
    'https://api.example.com:8443/write',
    'https://127.0.0.1/write',
    'https://unlisted.example.com/write'
  ])('refuses unsafe or unapproved URL %s before dispatch', async (url) => {
    const runtime = generatedRuntime(async () => {
      throw new Error('Unexpected dispatch')
    })
    const response = await runtime.handler(workflowRequest(url))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Server workflow failed.' })
    expect(runtime.calls).toEqual([])
    expect(runtime.delays).toEqual([])
  })

  test.each(['redirect', 'http error', 'invalid JSON', 'fetch failure'] as const)(
    '%s remains a single dispatch with a redacted handler error',
    async (scenario) => {
      const statuses = { redirect: 302, 'http error': 503, 'invalid JSON': 200 }
      const runtime = generatedRuntime(async () => {
        if (scenario === 'fetch failure') throw new Error('private upstream failure detail')
        return new Response('private upstream failure detail', {
          status: statuses[scenario],
          headers: { 'content-type': 'application/json' }
        })
      })
      const response = await runtime.handler(workflowRequest())
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'Server workflow failed.' })
      expect(runtime.calls).toHaveLength(1)
      expect(runtime.clearedTimers).toBe(1)
    }
  )

  test('keeps method, malformed request, and authentication handler responses', async () => {
    const runtime = generatedRuntime(async () => {
      throw new Error('Unexpected dispatch')
    })
    const options = await runtime.handler(
      new Request('https://edge.example.com', { method: 'OPTIONS' })
    )
    expect(options.status).toBe(204)
    const get = await runtime.handler(new Request('https://edge.example.com'))
    expect(get.status).toBe(405)
    expect(await get.json()).toEqual({ error: 'Method not allowed.' })
    const malformed = await runtime.handler(
      new Request('https://edge.example.com', {
        method: 'POST',
        body: 'not JSON'
      })
    )
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toEqual({ error: 'Invalid request.' })
    const unauthenticated = workflowRequest()
    unauthenticated.headers.delete('authorization')
    const unauthorized = await runtime.handler(unauthenticated)
    expect(unauthorized.status).toBe(401)
    expect(await unauthorized.json()).toEqual({ error: 'Unauthorized.' })
    expect(runtime.calls).toEqual([])
  })
})
