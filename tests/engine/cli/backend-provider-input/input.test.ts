import { describe, expect, test } from 'bun:test'

import {
  BACKEND_PROVIDER_COMPILE_HANDOFF_MAX_BYTES,
  BACKEND_PROVIDER_DEPLOY_READY_PREFIX,
  parseBackendProviderDeployMessage
} from '@open-pencil/compiler/backend'

import { backendProviderDispatchDigest } from '#cli/backend-provider-input'

import { inputFixture, preparedInput } from './helpers'

const DISPATCH = 'A'.repeat(43)

function readyMessage(line: string) {
  expect(line.startsWith(BACKEND_PROVIDER_DEPLOY_READY_PREFIX)).toBe(true)
  return parseBackendProviderDeployMessage(
    JSON.parse(line.slice(BACKEND_PROVIDER_DEPLOY_READY_PREFIX.length))
  )
}

describe('Backend Provider CLI input ownership', () => {
  test('consumes fragmented request and fresh authorization without waiting for EOF', async () => {
    const { stream, input, request, line } = inputFixture()
    try {
      const reading = input.readRequest()
      const bytes = Buffer.from(line)
      stream.write(bytes.subarray(0, 17))
      stream.write(bytes.subarray(17, -1))
      stream.write(bytes.subarray(-1))
      expect(await reading).toEqual(request)
      expect(stream.readableEnded).toBe(false)
      await input.authorizeUpload(DISPATCH, (output) => {
        const ready = readyMessage(output)
        stream.write(`${JSON.stringify({ ...ready, stage: 'authorize' })}\n`)
      })
      expect(stream.readableEnded).toBe(false)
      expect(stream.listenerCount('data')).toBe(0)
      expect(stream.listenerCount('end')).toBe(0)
      expect(stream.listenerCount('error')).toBe(0)
      await expect(input.authorizeUpload(DISPATCH)).rejects.toThrow('closed')
    } finally {
      input.dispose()
      stream.destroy()
    }
  })

  test('rejects premature input during build without emitting a ready message', async () => {
    const { stream, input } = await preparedInput()
    try {
      stream.write('{}\n')
      let emitted = false
      await expect(
        input.authorizeUpload(DISPATCH, () => {
          emitted = true
        })
      ).rejects.toThrow('Unexpected')
      expect(emitted).toBe(false)
    } finally {
      input.dispose()
      stream.destroy()
    }
  })

  for (const field of ['stage', 'handoffDigest', 'dispatchDigest', 'challenge'] as const) {
    test(`rejects upload authorization with a changed ${field}`, async () => {
      const { stream, input } = await preparedInput()
      try {
        await expect(
          input.authorizeUpload(DISPATCH, (output) => {
            const ready = readyMessage(output)
            const replacements = {
              stage: 'ready',
              handoffDigest: 'B'.repeat(42) + 'A',
              dispatchDigest: 'C'.repeat(42) + 'A',
              challenge: '00000000-0000-0000-0000-000000000000'
            }
            stream.write(
              `${JSON.stringify({ ...ready, stage: 'authorize', [field]: replacements[field] })}\n`
            )
          })
        ).rejects.toThrow('does not match')
      } finally {
        input.dispose()
        stream.destroy()
      }
    })
  }

  test('rejects duplicated authorization in the same input chunk', async () => {
    const { stream, input } = await preparedInput()
    try {
      await expect(
        input.authorizeUpload(DISPATCH, (output) => {
          const authorization = JSON.stringify({ ...readyMessage(output), stage: 'authorize' })
          stream.write(`${authorization}\n${authorization}\n`)
        })
      ).rejects.toThrow('exactly one')
    } finally {
      input.dispose()
      stream.destroy()
    }
  })

  for (const refusal of ['cancel', 'eof', 'timeout'] as const) {
    test(`does not authorize a prepared build after ${refusal}`, async () => {
      const { stream, input } = await preparedInput(30)
      try {
        const messages = { cancel: 'cancelled', eof: 'closed before', timeout: 'Timed out' }
        await expect(
          input.authorizeUpload(DISPATCH, (output) => {
            const ready = readyMessage(output)
            if (refusal === 'cancel')
              stream.write(`${JSON.stringify({ ...ready, stage: 'cancel' })}\n`)
            if (refusal === 'eof') stream.end()
          })
        ).rejects.toThrow(messages[refusal])
      } finally {
        input.dispose()
        stream.destroy()
      }
    })
  }

  for (const failure of ['oversize', 'invalid-utf8', 'eof', 'timeout'] as const) {
    test(`stops and detaches input after ${failure}`, async () => {
      const { stream, input } = inputFixture(30)
      try {
        const reading = input.readRequest()
        const messages = {
          oversize: 'byte limit',
          'invalid-utf8': 'UTF-8 JSON line',
          eof: 'closed before',
          timeout: 'Timed out'
        }
        const rejection = reading.catch((error: Error) => error)
        if (failure === 'oversize')
          stream.write(Buffer.alloc(BACKEND_PROVIDER_COMPILE_HANDOFF_MAX_BYTES + 1, 65))
        if (failure === 'invalid-utf8') stream.write(Buffer.from([0xc3, 0x28, 10]))
        if (failure === 'eof') stream.end('{')
        const error = await rejection
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toContain(messages[failure])
        expect(stream.listenerCount('data')).toBe(0)
        expect(stream.listenerCount('end')).toBe(0)
      } finally {
        input.dispose()
        stream.destroy()
      }
    })
  }

  test('handles a failed ready write without a dangling input promise', async () => {
    const { stream, input } = await preparedInput()
    try {
      await expect(
        input.authorizeUpload(DISPATCH, () => {
          throw new Error('closed output')
        })
      ).rejects.toThrow('Could not request')
      expect(stream.listenerCount('data')).toBe(0)
    } finally {
      input.dispose()
      stream.destroy()
    }
  })
})

test('static dispatch binding covers paths, actual bytes and public settings independent of map order', () => {
  const files = new Map([
    ['a.js', new Uint8Array([1, 2])],
    ['b.css', new Uint8Array([3])]
  ])
  const digest = backendProviderDispatchDigest(files, '{"provider":"netlify"}')
  expect(
    backendProviderDispatchDigest(new Map([...files].reverse()), '{"provider":"netlify"}')
  ).toBe(digest)
  expect(backendProviderDispatchDigest(files, '{"provider":"vercel"}')).not.toBe(digest)
  expect(
    backendProviderDispatchDigest(
      new Map([
        ['a.js', new Uint8Array([1, 3])],
        ['b.css', new Uint8Array([3])]
      ]),
      '{"provider":"netlify"}'
    )
  ).not.toBe(digest)
  expect(
    backendProviderDispatchDigest(
      new Map([
        ['c.js', new Uint8Array([1, 2])],
        ['b.css', new Uint8Array([3])]
      ]),
      '{"provider":"netlify"}'
    )
  ).not.toBe(digest)
})
