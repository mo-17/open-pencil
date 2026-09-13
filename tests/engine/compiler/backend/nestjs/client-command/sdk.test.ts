import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { emitNestJSClient } from '#compiler/backend/nestjs/client'

import { commandApplication } from '../browser-client/command/helpers'

interface GeneratedClientModule {
  normalizeCommandParameters(value: unknown, parameters: readonly object[]): object
  createNestJSClient(options: {
    baseUrl: string
    getAccessToken: () => Promise<string | null>
    fetch: typeof fetch
  }): {
    commands: {
      'save-note'(
        payload: unknown,
        options: { idempotencyKey: string; signal?: AbortSignal }
      ): Promise<unknown>
    }
  }
}
async function generatedClient(timeoutMs = 30_000): Promise<GeneratedClientModule> {
  const root = mkdtempSync(join(tmpdir(), 'nestjs-command-sdk-'))
  try {
    const path = join(root, 'client.ts')
    writeFileSync(
      path,
      String(emitNestJSClient(commandApplication()).content).replace(
        'const COMMAND_TIMEOUT_MS = 30_000',
        'const COMMAND_TIMEOUT_MS = ' + timeoutMs
      )
    )
    return (await import(path)) as GeneratedClientModule
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
const key = 'same-order-key-0001'

describe('generated NestJS command SDK', () => {
  test('sends only parameters and reuses the caller key across explicit retries', async () => {
    const module = await generatedClient()
    const calls: { url: string; init?: RequestInit }[] = []
    const client = module.createNestJSClient({
      baseUrl: 'https://api.example/api',
      getAccessToken: () => Promise.resolve('access-token'),
      fetch: ((url, init) => {
        calls.push({ url: String(url), init })
        return Promise.resolve(Response.json({ id: 'saved', title: 'Tea' }))
      }) as typeof fetch
    })
    await client.commands['save-note']({ title: 'Tea' }, { idempotencyKey: key })
    await client.commands['save-note']({ title: 'Tea' }, { idempotencyKey: key })
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.url).toBe('https://api.example/api/commands/save-note')
      expect(call.init).toMatchObject({
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        body: '{"title":"Tea"}'
      })
      expect(new Headers(call.init?.headers).get('Idempotency-Key')).toBe(key)
    }
  })
  test('normalizes canonical scalars and rejects getters, unknown fields and invalid strings without transport', async () => {
    const module = await generatedClient()
    const parameters = [
      { name: 'id', type: 'uuid' },
      { name: 'quantity', type: 'integer', min: 0, max: 99 },
      { name: 'label', type: 'string', maxLength: 10 },
      { name: 'active', type: 'boolean' }
    ]
    expect(
      module.normalizeCommandParameters(
        { quantity: -0, label: '🍵', id: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA', active: true },
        parameters
      )
    ).toEqual({
      active: true,
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      label: '🍵',
      quantity: 0
    })
    let accessed = false
    const accessor = {
      get title() {
        accessed = true
        return 'Tea'
      }
    }
    const calls: unknown[] = []
    const client = module.createNestJSClient({
      baseUrl: '/api',
      getAccessToken: () => Promise.resolve('access-token'),
      fetch: ((url) => {
        calls.push(url)
        return Promise.resolve(Response.json({}))
      }) as typeof fetch
    })
    for (const payload of [
      accessor,
      { title: 'Tea', ownerId: 'spoof' },
      { title: '\u0000' },
      { title: '\ud800' },
      { title: 'x'.repeat(101) }
    ])
      expect(() => client.commands['save-note'](payload, { idempotencyKey: key })).toThrow(
        'Backend command failed.'
      )
    expect(accessed).toBe(false)
    expect(calls).toHaveLength(0)
    await expect(
      client.commands['save-note']({ title: 'Tea' }, { idempotencyKey: 'short' })
    ).rejects.toMatchObject({ status: 400, code: 'invalid-request' })
    expect(calls).toHaveLength(0)
  })
  test.each([
    [400, 'invalid-request'],
    [401, 'authentication-required'],
    [403, 'forbidden'],
    [404, 'not-found'],
    [409, 'conflict'],
    [503, 'unavailable'],
    [500, 'request-failed']
  ] as const)('maps HTTP %s to safe %s without private server messages', async (status, code) => {
    const module = await generatedClient()
    const client = module.createNestJSClient({
      baseUrl: '/api',
      getAccessToken: () => Promise.resolve('access-token'),
      fetch: (() =>
        Promise.resolve(
          Response.json({ message: 'SQL private detail' }, { status })
        )) as typeof fetch
    })
    await expect(
      client.commands['save-note']({ title: 'Tea' }, { idempotencyKey: key })
    ).rejects.toMatchObject({ status, code, message: 'Backend command failed.' })
  })
  test('fixed command deadline aborts a hanging transport with a safe unavailable result', async () => {
    const module = await generatedClient(25)
    const calls: RequestInit[] = []
    const client = module.createNestJSClient({
      baseUrl: '/api',
      getAccessToken: () => Promise.resolve('access-token'),
      fetch: ((_url, init) => {
        calls.push(init ?? {})
        return new Promise<Response>(() => {
          /* A transport which ignores abort forever. */
        })
      }) as typeof fetch
    })
    await expect(
      client.commands['save-note']({ title: 'Tea' }, { idempotencyKey: key })
    ).rejects.toMatchObject({
      status: 503,
      code: 'unavailable',
      message: 'Backend command failed.'
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].signal?.aborted).toBe(true)
  })
  test('external cancellation never becomes a timeout and completed requests remove their timer', async () => {
    const module = await generatedClient(25)
    const calls: RequestInit[] = []
    const controller = new AbortController()
    const client = module.createNestJSClient({
      baseUrl: '/api',
      getAccessToken: () => Promise.resolve('access-token'),
      fetch: ((_url, init) => {
        calls.push(init ?? {})
        return new Promise<Response>(() => {
          /* Wait until external cancellation. */
        })
      }) as typeof fetch
    })
    const running = client.commands['save-note'](
      { title: 'Tea' },
      { idempotencyKey: key, signal: controller.signal }
    ).catch((error: unknown) => error)
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
    controller.abort()
    expect(await running).toMatchObject({ status: 0, code: 'request-failed' })
    expect(calls[0].signal?.aborted).toBe(true)
    const completed: RequestInit[] = []
    const success = module.createNestJSClient({
      baseUrl: '/api',
      getAccessToken: () => Promise.resolve('access-token'),
      fetch: ((_url, init) => {
        completed.push(init ?? {})
        return Promise.resolve(Response.json({ id: 'saved', title: 'Tea' }))
      }) as typeof fetch
    })
    await success.commands['save-note']({ title: 'Tea' }, { idempotencyKey: key })
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 35)
    })
    expect(completed[0].signal?.aborted).toBe(false)
  })

  test('suppresses token-provider exceptions and rejects missing or malformed bearer tokens', async () => {
    const module = await generatedClient()
    for (const token of [null, 'bad\nheader', 'throws']) {
      const calls: unknown[] = []
      const client = module.createNestJSClient({
        baseUrl: '/api',
        getAccessToken: () =>
          token === 'throws' ? Promise.reject(new Error('private secret')) : Promise.resolve(token),
        fetch: ((url) => {
          calls.push(url)
          return Promise.resolve(Response.json({}))
        }) as typeof fetch
      })
      await expect(
        client.commands['save-note']({ title: 'Tea' }, { idempotencyKey: key })
      ).rejects.toMatchObject({
        message: 'Backend command failed.',
        code: token === 'throws' ? 'request-failed' : 'authentication-required'
      })
      expect(calls).toHaveLength(0)
    }
  })
})
