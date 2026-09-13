import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import {
  COMMAND_ITEM,
  COMMAND_SUBJECT,
  commandRuntime,
  literal,
  type RuntimeCommandQuery
} from './helpers'

describe('generated atomic server command execution', () => {
  let loaded: Awaited<ReturnType<typeof commandRuntime>>
  beforeAll(async () => {
    loaded = await commandRuntime()
  })
  afterAll(async () => {
    await loaded.dispose()
  })

  test('normalizes canonical input and rejects omitted, unknown and malformed values', () => {
    const input = loaded.input
    const parameters = [
      { name: 'quantity', type: 'integer' as const, required: true as const, min: 1, max: 99 }
    ]
    for (const quantity of [0, -1, 1.5, 100, '2', null, Number.NaN, Infinity])
      expect(() => input.commandInput(parameters, { quantity })).toThrow('Invalid request')
    expect(() => loaded.input.commandInput(parameters, {})).toThrow()
    expect(() => loaded.input.commandInput(parameters, { quantity: 2, price: 1 })).toThrow()
    expect(loaded.input.commandInput(parameters, { quantity: 2 })).toEqual({ quantity: 2 })
    expect(
      loaded.input.commandInput(loaded.plan.parameters, {
        title: 'Valid',
        noteId: COMMAND_ITEM.toUpperCase()
      })
    ).toEqual({ noteId: COMMAND_ITEM, title: 'Valid' })
    expect(() =>
      loaded.input.commandInput(loaded.plan.parameters, { title: '\ud800', noteId: COMMAND_ITEM })
    ).toThrow()
  })

  test('requires one exact bounded idempotency header', () => {
    const input = loaded.input
    const key = 'request-key-00000001'
    expect(
      loaded.input.commandRequestKey({
        rawHeaders: ['Idempotency-Key', key],
        headers: { 'idempotency-key': key }
      })
    ).toBe(key)
    for (const rawHeaders of [
      [],
      ['Idempotency-Key', 'short'],
      ['Idempotency-Key', key, 'idempotency-key', key]
    ])
      expect(() =>
        input.commandRequestKey({ rawHeaders, headers: { 'idempotency-key': key } })
      ).toThrow()
    expect(() =>
      loaded.input.commandRequestKey({
        rawHeaders: ['Idempotency-Key', key],
        headers: { 'idempotency-key': key + 'x' }
      })
    ).toThrow()
  })

  test('checks arithmetic overflow and never takes caller subject from input', () => {
    const input = loaded.input
    expect(
      loaded.input.commandValue(
        {
          kind: 'integer-arithmetic',
          operator: 'multiply',
          left: literal(1299),
          right: literal(3)
        },
        {},
        new Map(),
        COMMAND_SUBJECT
      )
    ).toBe(3897)
    for (const [left, right] of [
      [2147483647, 2],
      [-2147483648, -1],
      [1.5, 2]
    ])
      expect(() =>
        input.commandValue(
          {
            kind: 'integer-arithmetic',
            operator: 'multiply',
            left: literal(left),
            right: literal(right)
          },
          {},
          new Map(),
          COMMAND_SUBJECT
        )
      ).toThrow('Request conflict')
    expect(
      loaded.input.commandValue(
        { kind: 'caller-sub' },
        { subject: COMMAND_ITEM },
        new Map(),
        COMMAND_SUBJECT
      )
    ).toBe(COMMAND_SUBJECT)
  })

  test('locks the owner-scoped row and parameterizes adversarial values in the update', async () => {
    const queries: RuntimeCommandQuery[] = []
    const title = "x'); DELETE FROM notes; --"
    const response = await loaded.execution.executeCommand(
      {
        query: async (text, values = []) => {
          queries.push({ text, values })
          return {
            rowCount: 1,
            rows: [{ id: COMMAND_ITEM, title: queries.length === 1 ? 'Old' : title }]
          }
        }
      },
      loaded.plan,
      { noteId: COMMAND_ITEM, title },
      COMMAND_SUBJECT
    )
    expect(queries[0].text).toContain('"owner_id" = $2 FOR UPDATE')
    expect(queries[0].values).toEqual([COMMAND_ITEM, COMMAND_SUBJECT])
    expect(queries[1].text).not.toContain(title)
    expect(queries[1].values).toEqual([title, COMMAND_ITEM])
    expect(response).toEqual({ id: COMMAND_ITEM, title })
  })

  test('a missing owner-scoped row terminates before any mutation', async () => {
    let calls = 0
    await expect(
      loaded.execution.executeCommand(
        {
          query: async () => {
            calls += 1
            return { rowCount: 0, rows: [] }
          }
        },
        loaded.plan,
        { noteId: COMMAND_ITEM, title: 'No write' },
        COMMAND_SUBJECT
      )
    ).rejects.toThrow('Resource not found')
    expect(calls).toBe(1)
  })
})
