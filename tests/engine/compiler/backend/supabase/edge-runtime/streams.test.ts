import { describe, expect, test } from 'bun:test'

import { controlledStream, generatedRuntime, promptly, workflowRequest } from './helpers'

describe('executed Supabase Edge runtime stream bounds', () => {
  test.each([
    { direction: 'inbound', declared: false },
    { direction: 'outbound', declared: false },
    { direction: 'inbound', declared: true },
    { direction: 'outbound', declared: true }
  ] as const)(
    '$direction byte overflow (declared: $declared) returns before cancellation settles',
    async ({ direction, declared }) => {
      const bytes = direction === 'inbound' ? 64 * 1024 + 1 : 1024 * 1024 + 1
      const controlled = controlledStream(declared ? undefined : bytes)
      const headers = declared ? { 'content-length': String(bytes) } : undefined
      const upstream = new Response(controlled.stream, { headers })
      const runtime = generatedRuntime(async () => upstream)
      const request =
        direction === 'inbound'
          ? new Request('https://edge.example.com/runtime', {
              method: 'POST',
              headers,
              body: controlled.stream
            })
          : workflowRequest()
      const body = direction === 'inbound' ? request.body : upstream.body
      const operation = runtime.handler(request)
      try {
        const result = await promptly(operation)
        expect(result).toBeInstanceOf(Response)
        if (!(result instanceof Response)) throw new Error('Cancellation blocked the handler')
        expect(result.status).toBe(500)
        expect(await result.json()).toEqual({ error: 'Server workflow failed.' })
        expect(controlled.cancelCalls).toBe(1)
        expect(body?.locked).toBe(false)
        expect(runtime.calls).toHaveLength(direction === 'inbound' ? 0 : 1)
      } finally {
        controlled.release()
        await controlled.dispose(operation)
      }
      expect(controlled.unhandled).toEqual([])
    }
  )

  test('many small native chunks complete under one deadline and release the reader', async () => {
    let chunks = 0
    let cancelCalls = 0
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (chunks === 512) controller.close()
          else {
            chunks += 1
            controller.enqueue(new TextEncoder().encode('x'))
          }
        },
        cancel() {
          cancelCalls += 1
        }
      },
      { highWaterMark: 0 }
    )
    const runtime = generatedRuntime(async () => new Response(stream))
    const response = await runtime.handler(workflowRequest())
    expect(response.status).toBe(200)
    expect(await response.json()).toBe('x'.repeat(512))
    expect(chunks).toBe(512)
    expect(cancelCalls).toBe(0)
    expect(stream.locked).toBe(false)
    expect(runtime.calls).toHaveLength(1)
    expect(runtime.delays).toEqual([8_000])
    expect(runtime.clearedTimers).toBe(1)
  })

  test.each(['POST', 'PUT'] as const)(
    '%s keeps the original deadline through a stalled response body without retry',
    async (method) => {
      const controlled = controlledStream()
      const upstream = new Response(controlled.stream, {
        headers: { 'content-type': 'application/json' }
      })
      const runtime = generatedRuntime(async () => upstream, method)
      const operation = runtime.handler(workflowRequest())
      try {
        expect(await promptly(controlled.reading)).toBeUndefined()
        controlled.enqueue('{')
        await Bun.sleep(0)
        expect(runtime.delays).toEqual([8_000])
        runtime.expire()
        const result = await promptly(operation)
        expect(result).toBeInstanceOf(Response)
        if (!(result instanceof Response)) throw new Error('Body read ignored the HTTP deadline')
        expect(result.status).toBe(500)
        expect(await result.json()).toEqual({ error: 'Server workflow failed.' })
        expect(controlled.cancelCalls).toBe(1)
        expect(upstream.body?.locked).toBe(false)
        expect(runtime.calls).toHaveLength(1)
        expect(runtime.calls[0].init).toMatchObject({
          method,
          credentials: 'omit',
          redirect: 'manual',
          body: '{}'
        })
        expect(runtime.calls[0].init.signal?.aborted).toBe(true)
        expect(runtime.delays).toEqual([8_000])
        expect(runtime.clearedTimers).toBe(1)
      } finally {
        controlled.release()
        await controlled.dispose(operation)
      }
      expect(controlled.unhandled).toEqual([])
    }
  )

  test('an expired signal refuses a response that arrives after its original deadline', async () => {
    const controlled = controlledStream()
    const upstream = new Response(controlled.stream)
    const runtime = generatedRuntime(async () => {
      runtime.expire()
      return upstream
    })
    const operation = runtime.handler(workflowRequest())
    try {
      const result = await promptly(operation)
      expect(result).toBeInstanceOf(Response)
      if (!(result instanceof Response)) throw new Error('Expired response started a body read')
      expect(result.status).toBe(500)
      expect(await result.json()).toEqual({ error: 'Server workflow failed.' })
      expect(controlled.cancelCalls).toBe(1)
      expect(upstream.body?.locked).toBe(false)
      expect(runtime.calls).toHaveLength(1)
      expect(runtime.clearedTimers).toBe(1)
    } finally {
      controlled.release()
      await controlled.dispose(operation)
    }
    expect(controlled.unhandled).toEqual([])
  })

  test('a body completion racing the deadline cannot publish success', async () => {
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.close()
          runtime.expire()
        }
      },
      { highWaterMark: 0 }
    )
    const runtime = generatedRuntime(async () => new Response(stream))
    const response = await runtime.handler(workflowRequest())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Server workflow failed.' })
    expect(stream.locked).toBe(false)
    expect(runtime.calls).toHaveLength(1)
    expect(runtime.clearedTimers).toBe(1)
  })
})
