import { describe, expect, test } from 'bun:test'

import {
  parseBackendClientActionFields,
  parseBackendResourceDataSource,
  validateBackendClientAction,
  validateBackendResourceDataSource
} from '@open-pencil/lowcode/backend'
import type { BackendRequestAction, BackendResourceDataSource } from '@open-pencil/scene-graph'

import { browserApplication } from '../browser-fixtures'

const binding: BackendResourceDataSource = {
  kind: 'backendResource',
  resourceId: 'notes-api',
  filterEntries: [{ key: 'title', valueExpr: 'titleFilter' }],
  searchExpr: 'searchText',
  sortField: 'id',
  sortDirection: 'desc'
}
function application() {
  const app = browserApplication()
  app.httpApi.resources[0].query = {
    filterFields: ['title'],
    searchFields: ['title'],
    sortFields: ['id']
  }
  return app
}

describe('bounded client list query bindings', () => {
  test('normalizes empty AI-authored filter lists to omitted filters', () => {
    const source = { kind: 'backendResource', resourceId: 'notes-api', filterEntries: [] }
    const action = {
      kind: 'backendRequest',
      id: 'search',
      operation: 'list',
      resourceId: 'notes-api',
      filterEntries: []
    }
    const parsedSource = parseBackendResourceDataSource(source)
    const parsedAction = parseBackendClientActionFields(action)
    expect(parsedSource.ok).toBe(true)
    expect(parsedAction.ok).toBe(true)
    if (!parsedSource.ok || !parsedAction.ok) throw new Error('Expected empty query bindings')
    expect(parsedSource.value).not.toHaveProperty('filterEntries')
    expect(parsedAction.value).not.toHaveProperty('filterEntries')
  })

  test('retains declared expression filters, search and sort for LIST and request actions', () => {
    const action: BackendRequestAction = {
      ...binding,
      id: 'search',
      kind: 'backendRequest',
      operation: 'list'
    }
    expect(parseBackendResourceDataSource(binding)).toMatchObject({ ok: true, value: binding })
    expect(parseBackendClientActionFields(action)).toMatchObject({ ok: true, value: action })
    expect(validateBackendResourceDataSource(application(), binding)).toEqual([])
    expect(validateBackendClientAction(application(), action)).toEqual([])
  })

  test('fails closed when a binding expands beyond the resource query declaration', () => {
    for (const source of [
      { ...binding, filterEntries: [{ key: 'owner_id', valueExpr: 'user.id' }] },
      { ...binding, sortField: 'title' },
      { ...binding, resourceId: 'missing' }
    ])
      expect(validateBackendResourceDataSource(application(), source)).not.toEqual([])
    expect(validateBackendResourceDataSource(browserApplication(), binding)).not.toEqual([])
  })

  test('rejects query options on non-list actions and duplicate or malformed expression filters', () => {
    for (const operation of ['create', 'read', 'update', 'delete'] as const) {
      expect(
        parseBackendClientActionFields({
          ...binding,
          id: 'invalid',
          kind: 'backendRequest',
          operation
        }).ok
      ).toBe(false)
    }
    for (const source of [
      {
        ...binding,
        filterEntries: [
          { key: 'title', valueExpr: 'x' },
          { key: 'title', valueExpr: 'y' }
        ]
      },
      { ...binding, searchExpr: 'bad@expression' },
      { ...binding, sortField: undefined, sortDirection: 'desc' },
      {
        ...binding,
        filterEntries: Array.from({ length: 17 }, (_value, index) => ({
          key: 'field' + index,
          valueExpr: '1'
        }))
      },
      { ...binding, sql: 'SELECT * FROM users' }
    ])
      expect(parseBackendResourceDataSource(source).ok).toBe(false)
  })
})
