import { describe, expect, test } from 'bun:test'

import {
  parseBackendClientActionFields,
  validateBackendClientAction
} from '@open-pencil/lowcode/backend'
import type { BackendCommandRecoveryAction, DocumentStateDef } from '@open-pencil/scene-graph'

import { commandBrowserApplication as application } from '../browser-fixtures'

const states: DocumentStateDef[] = [
  { id: 'attempt', name: 'attempt', type: 'string', defaultValue: '' },
  { id: 'recovery', name: 'recovery', type: 'object', defaultValue: {} },
  { id: 'error', name: 'error', type: 'string', defaultValue: '' }
]

function action(
  operation: BackendCommandRecoveryAction['operation'] = 'inspect'
): BackendCommandRecoveryAction {
  return {
    id: 'recover-checkout',
    kind: 'backendCommandRecovery',
    commandId: 'checkout',
    idempotencyKeyTarget: 'attempt',
    operation,
    ...(operation === 'inspect' ? {} : { attemptKeyExpr: 'recovery.key' }),
    resultTarget: 'recovery',
    errorTarget: 'error'
  }
}

describe('declared backendCommandRecovery action contract', () => {
  test.each(['inspect', 'retry', 'acknowledge'] as const)(
    'accepts %s without a second command payload',
    (operation) => {
      const value = action(operation)
      expect(parseBackendClientActionFields(value)).toEqual({
        ok: true,
        value,
        diagnostics: []
      })
      expect(validateBackendClientAction(application(), value, states)).toEqual([])
    }
  )

  test('browser recovery is an explicit command opt-in and is omitted for existing commands', () => {
    const value = {
      id: 'checkout',
      kind: 'backendCommand',
      commandId: 'checkout',
      idempotencyKeyTarget: 'attempt',
      payloadEntries: [
        { key: 'productId', valueExpr: 'product.id' },
        { key: 'quantity', valueExpr: '1' }
      ]
    }
    expect(parseBackendClientActionFields(value)).toMatchObject({ ok: true, value })
    const optedIn = { ...value, recovery: 'browser' }
    expect(parseBackendClientActionFields(optedIn)).toMatchObject({ ok: true, value: optedIn })
    for (const recovery of [true, false, null, 'localStorage', 'server'])
      expect(parseBackendClientActionFields({ ...value, recovery }).ok).toBe(false)
    expect(parseBackendClientActionFields({ ...value, attemptKeyExpr: 'attempt' }).ok).toBe(false)
  })

  test.each([
    { attemptKeyExpr: 'attempt' },
    { operation: 'retry' },
    { operation: 'acknowledge' },
    { operation: 'replay' },
    { operation: 'retry', attemptKeyExpr: 'window.fetch("/api")' },
    { operation: 'retry', attemptKeyExpr: 'a'.repeat(4097) },
    { idempotencyKeyTarget: '' },
    { idempotencyKeyTarget: '__proto__' },
    { idempotencyKeyTarget: undefined },
    { payloadEntries: [{ key: 'quantity', valueExpr: '99' }] },
    { resourceId: 'orders' },
    { recovery: 'browser' },
    { headers: { authorization: 'Bearer private' } },
    { token: 'private' },
    { ownerId: 'other-user' },
    { onSuccess: {} },
    { onError: 'invalid' }
  ])('rejects ambiguous operations, credentials and request overrides %#', (patch) => {
    expect(parseBackendClientActionFields({ ...action(), ...patch }).ok).toBe(false)
  })

  test('requires a configured browser client and an explicitly declared command', () => {
    const value = application()
    expect(
      validateBackendClientAction(value, { ...action(), commandId: 'unknown' }, states)
    ).not.toEqual([])
    delete value.httpApi.browserClient
    expect(validateBackendClientAction(value, action(), states)).not.toEqual([])
  })

  test.each([
    ['attempt', { persist: true }],
    ['attempt', { computedExpr: '"computed"' }],
    ['attempt', { type: 'number' }],
    ['recovery', { persist: true }],
    ['recovery', { computedExpr: '{}' }],
    ['recovery', { type: 'array' }],
    ['error', { persist: true }],
    ['error', { type: 'object' }]
  ] as const)('rejects persistent, computed or mistyped target %s %#', (name, patch) => {
    const changed = states.map((state) => (state.name === name ? { ...state, ...patch } : state))
    expect(validateBackendClientAction(application(), action(), changed)).not.toEqual([])
  })

  test('requires separate declared targets for attempts, recovered results and errors', () => {
    for (const patch of [
      { idempotencyKeyTarget: 'missing' },
      { resultTarget: 'missing' },
      { errorTarget: 'missing' },
      { resultTarget: 'attempt' },
      { errorTarget: 'attempt' }
    ])
      expect(
        validateBackendClientAction(application(), { ...action(), ...patch }, states)
      ).not.toEqual([])
  })
})
