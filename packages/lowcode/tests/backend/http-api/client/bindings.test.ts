import { describe, expect, test } from 'bun:test'

import {
  parseBackendClientActionFields,
  parseBackendResourceDataSource,
  validateBackendClientAction,
  validateBackendResourceDataSource
} from '@open-pencil/lowcode/backend'
import type { BackendRequestAction, DocumentStateDef } from '@open-pencil/scene-graph'

import { browserApplication } from '../browser-fixtures'
import { httpApplication } from '../fixtures'

const STATES: DocumentStateDef[] = [
  { id: 'rows', name: 'rows', type: 'array', defaultValue: [] },
  { id: 'row', name: 'row', type: 'object', defaultValue: {} },
  { id: 'cursor', name: 'cursor', type: 'string', defaultValue: '' },
  { id: 'error', name: 'error', type: 'string', defaultValue: '' }
]

function request(operation: BackendRequestAction['operation']): BackendRequestAction {
  return {
    id: 'request',
    kind: 'backendRequest',
    resourceId: 'notes-api',
    operation,
    errorTarget: 'error',
    resultTarget: operation === 'list' ? 'rows' : 'row',
    ...(['read', 'update', 'delete'].includes(operation) ? { idExpr: 'item.id' } : {}),
    ...(['create', 'update'].includes(operation)
      ? { payloadEntries: [{ key: 'title', valueExpr: 'titleInput' }] }
      : {}),
    ...(operation === 'list' ? { limit: 20, afterExpr: 'cursor', cursorTarget: 'cursor' } : {})
  }
}

describe('declared Backend client action and list boundary', () => {
  test.each(['list', 'read', 'create', 'update', 'delete'] as const)(
    'accepts declared %s operation',
    (operation) => {
      const action = request(operation)
      expect(parseBackendClientActionFields(action)).toEqual({
        ok: true,
        value: action,
        diagnostics: []
      })
      expect(validateBackendClientAction(browserApplication(), action, STATES)).toEqual([])
    }
  )

  test('leaves recursive result-branch validation and preservation to the action walker', () => {
    const action = { ...request('create'), onSuccess: [{ id: 'done', kind: 'stop' }] }
    const parsed = parseBackendClientActionFields(action)
    expect(parsed.ok).toBe(true)
    expect(parsed.ok && Object.hasOwn(parsed.value, 'onSuccess')).toBe(false)
    expect(action.onSuccess).toHaveLength(1)
    expect(parseBackendClientActionFields({ ...action, onError: 'not-an-array' }).ok).toBe(false)
  })

  test.each([
    { ...request('create'), idExpr: 'item.id' },
    { ...request('delete'), idExpr: undefined },
    { ...request('read'), limit: 10 },
    { ...request('update'), payloadEntries: [] },
    { ...request('list'), payloadEntries: [{ key: 'title', valueExpr: '"text"' }] },
    { ...request('list'), limit: 101 },
    { ...request('list'), afterExpr: 'cursor@invalid' },
    { ...request('delete'), idExpr: 'not@valid' },
    {
      ...request('create'),
      payloadEntries: [
        { key: 'title', valueExpr: '"a"' },
        { key: 'title', valueExpr: '"b"' }
      ]
    },
    { ...request('list'), url: 'https://arbitrary.example.test' },
    { ...request('list'), headers: { Authorization: 'not-declarative' } }
  ])('rejects invalid request shape %#', (action) => {
    expect(parseBackendClientActionFields(action).ok).toBe(false)
  })

  test('requires browser login and declared operation projections before UI binding', () => {
    const application = browserApplication()
    const action = request('create')
    expect(validateBackendClientAction(httpApplication(), action, STATES)).not.toEqual([])
    expect(
      validateBackendClientAction(application, { ...action, resourceId: 'hidden' }, STATES)
    ).not.toEqual([])
    expect(
      validateBackendClientAction(
        application,
        {
          ...action,
          payloadEntries: [{ key: 'owner_id', valueExpr: '"forged-owner"' }]
        },
        STATES
      )
    ).not.toEqual([])
    expect(
      validateBackendClientAction(
        application,
        {
          ...action,
          payloadEntries: [{ key: 'body', valueExpr: '"missing-title"' }]
        },
        STATES
      )
    ).not.toEqual([])
    application.httpApi.resources[0].operations = ['list']
    expect(validateBackendClientAction(application, action, STATES)).not.toEqual([])
  })

  test('requires typed, writable, non-persistent targets for account-bound results', () => {
    const application = browserApplication()
    const action = request('list')
    for (const change of [{ type: 'object' as const }, { persist: true }, { computedExpr: '[]' }]) {
      const states = STATES.map((entry) =>
        entry.name === 'rows' ? { ...entry, ...change } : entry
      )
      expect(validateBackendClientAction(application, action, states)).not.toEqual([])
    }
    expect(validateBackendClientAction(application, action, [])).not.toEqual([])
    expect(
      validateBackendClientAction(application, { ...action, errorTarget: 'row' }, STATES)
    ).not.toEqual([])
  })

  test('validates automatic LIST requests independently of Supabase', () => {
    const source = {
      kind: 'backendResource' as const,
      resourceId: 'notes-api',
      limit: 20,
      afterExpr: 'cursor',
      nextCursorTarget: 'cursor',
      errorTarget: 'error'
    }
    expect(parseBackendResourceDataSource(source).ok).toBe(true)
    expect(validateBackendResourceDataSource(browserApplication(), source, STATES)).toEqual([])
    expect(
      validateBackendResourceDataSource(browserApplication(), { ...source, limit: 26 }, STATES)
    ).not.toEqual([])
    expect(
      validateBackendResourceDataSource(
        browserApplication(),
        { ...source, nextCursorTarget: 'rows' },
        STATES
      )
    ).not.toEqual([])
    expect(parseBackendResourceDataSource({ ...source, query: 'select *' }).ok).toBe(false)
  })

  test('rejects accessor payloads without invoking them', () => {
    const action = request('create')
    let calls = 0
    Object.defineProperty(action, 'payloadEntries', {
      enumerable: true,
      get: () => {
        calls++
        return []
      }
    })
    expect(parseBackendClientActionFields(action).ok).toBe(false)
    expect(calls).toBe(0)
  })

  test('sign-in supports a static local return route and sign-out has no redirect input', () => {
    const action = { id: 'auth', kind: 'backendAuth', operation: 'signIn', returnPath: '/notes' }
    expect(parseBackendClientActionFields(action).ok).toBe(true)
    for (const returnPath of [
      '//external.example.test',
      '/_openpencil/auth/callback',
      '/notes?redirect=x'
    ])
      expect(parseBackendClientActionFields({ ...action, returnPath }).ok).toBe(false)
    expect(parseBackendClientActionFields({ ...action, operation: 'signOut' }).ok).toBe(false)
    expect(parseBackendClientActionFields({ ...action, onSuccess: [] }).ok).toBe(false)
    expect(
      parseBackendClientActionFields({ id: 'auth', kind: 'backendAuth', operation: 'signOut' }).ok
    ).toBe(true)
  })
})
