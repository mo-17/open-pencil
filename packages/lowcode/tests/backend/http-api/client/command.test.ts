import { describe, expect, test } from 'bun:test'

import {
  parseBackendClientActionFields,
  validateBackendClientAction
} from '@open-pencil/lowcode/backend'
import type { BackendCommandAction, DocumentStateDef } from '@open-pencil/scene-graph'

import { commandBrowserApplication as application } from '../browser-fixtures'

const states: DocumentStateDef[] = [
  { id: 'attempt', name: 'attempt', type: 'string', defaultValue: '' },
  { id: 'result', name: 'result', type: 'object', defaultValue: {} },
  { id: 'error', name: 'error', type: 'string', defaultValue: '' }
]
function action(): BackendCommandAction {
  return {
    id: 'buy',
    kind: 'backendCommand',
    commandId: 'checkout',
    idempotencyKeyTarget: 'attempt',
    payloadEntries: [
      { key: 'productId', valueExpr: 'product.id' },
      { key: 'quantity', valueExpr: '1' }
    ],
    resultTarget: 'result',
    errorTarget: 'error'
  }
}

describe('declared backendCommand action contract', () => {
  test('accepts declared parameters with a separate session-only key state', () => {
    expect(parseBackendClientActionFields(action())).toMatchObject({ ok: true, value: action() })
    expect(validateBackendClientAction(application(), action(), states)).toEqual([])
  })
  test.each([
    { idempotencyKeyTarget: '' },
    { idempotencyKeyTarget: undefined },
    { operation: 'create' },
    { resourceId: 'notes-api' },
    { idExpr: 'product.id' },
    { headers: { 'Idempotency-Key': 'arbitrary' } },
    { filterEntries: [] },
    { retry: true },
    { onSuccess: 'invalid' },
    {
      payloadEntries: [
        { key: 'quantity', valueExpr: '1' },
        { key: 'quantity', valueExpr: '2' }
      ]
    }
  ])('rejects resource, retry, arbitrary-header and malformed command fields %#', (patch) => {
    expect(parseBackendClientActionFields({ ...action(), ...patch }).ok).toBe(false)
  })
  test('rejects undeclared commands and incomplete or additional parameters', () => {
    const value = application()
    expect(
      validateBackendClientAction(value, { ...action(), commandId: 'unknown' }, states)
    ).not.toEqual([])
    expect(
      validateBackendClientAction(value, { ...action(), payloadEntries: [] }, states)
    ).not.toEqual([])
    expect(
      validateBackendClientAction(
        value,
        {
          ...action(),
          payloadEntries: [
            ...(action().payloadEntries ?? []),
            { key: 'ownerId', valueExpr: '"other"' }
          ]
        },
        states
      )
    ).not.toEqual([])
  })
  test.each([
    { persist: true },
    { computedExpr: '"computed"' },
    { type: 'number' },
    { name: 'other' }
  ])('requires writable non-persistent string key target %#', (patch) => {
    const definitions = [{ ...states[0], ...patch }, ...states.slice(1)] as DocumentStateDef[]
    expect(validateBackendClientAction(application(), action(), definitions)).not.toEqual([])
  })
  test('prevents a result or error target from overwriting the retry identity', () => {
    expect(
      validateBackendClientAction(application(), { ...action(), errorTarget: 'attempt' }, states)
    ).not.toEqual([])
    expect(
      validateBackendClientAction(application(), { ...action(), resultTarget: 'attempt' }, states)
    ).not.toEqual([])
  })
})
