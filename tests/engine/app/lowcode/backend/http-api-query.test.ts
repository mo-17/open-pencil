import { describe, expect, test } from 'bun:test'

import type { BackendHttpAPIResourceIRV1, DataFieldIR } from '@open-pencil/lowcode/backend'

import {
  allowsHTTPAPIQueryField,
  pruneHTTPAPIQuery,
  setHTTPAPIQueryField
} from '@/app/lowcode/backend/http-api-query'
import {
  createNestJSNotesApplication,
  removeNestJSFieldReferences
} from '@/app/lowcode/backend/nestjs-draft'

function field(id: string, type: DataFieldIR['type'], nullable = false): DataFieldIR {
  return { id, name: id, type, nullable }
}

function resource(): BackendHttpAPIResourceIRV1 {
  return {
    id: 'products',
    path: '/products',
    entityId: 'products',
    operations: ['list', 'read'],
    readFields: ['title', 'price', 'status'],
    maxPageSize: 20
  }
}

describe('HTTP API query authoring', () => {
  test('limits capabilities to readable fields and supported scalar operations', () => {
    const current = resource()
    setHTTPAPIQueryField(current, 'searchFields', field('title', 'string'), true)
    setHTTPAPIQueryField(current, 'searchFields', field('price', 'integer'), true)
    setHTTPAPIQueryField(current, 'filterFields', field('private', 'string'), true)
    setHTTPAPIQueryField(current, 'sortFields', field('title', 'string'), true)
    setHTTPAPIQueryField(current, 'sortFields', field('price', 'integer', true), true)
    setHTTPAPIQueryField(current, 'sortFields', field('status', 'enum'), true)
    expect(current.query).toEqual({
      filterFields: [],
      searchFields: ['title'],
      sortFields: ['status']
    })
    expect(allowsHTTPAPIQueryField(field('created_at', 'datetime'), 'sortFields')).toBe(true)
    expect(allowsHTTPAPIQueryField(field('payload', 'json'), 'filterFields')).toBe(false)
  })

  test('removes query access alongside a removed read projection and deletes empty declarations', () => {
    const current = resource()
    current.query = {
      filterFields: ['title', 'price'],
      searchFields: ['title'],
      sortFields: ['price']
    }
    current.readFields = ['title']
    pruneHTTPAPIQuery(current)
    expect(current.query).toEqual({
      filterFields: ['title'],
      searchFields: ['title'],
      sortFields: []
    })
    current.readFields = []
    pruneHTTPAPIQuery(current)
    expect(current.query).toBeUndefined()
  })

  test('does not retain or allow query options without list access', () => {
    const current = resource()
    current.query = { filterFields: ['price'], searchFields: [], sortFields: [] }
    current.operations = ['read']
    pruneHTTPAPIQuery(current)
    setHTTPAPIQueryField(current, 'filterFields', field('price', 'integer'), true)
    expect(current.query).toBeUndefined()
  })

  test('lets the author clear an unsupported existing selection', () => {
    const current = resource()
    current.query = { filterFields: [], searchFields: [], sortFields: ['title'] }
    setHTTPAPIQueryField(current, 'sortFields', field('title', 'string'), false)
    expect(current.query).toBeUndefined()
  })

  test('deleting a NestJS field removes every query reference without changing unrelated access', () => {
    const application = createNestJSNotesApplication('query-authoring')
    const current = application.httpApi?.resources[0]
    if (!current) throw new Error('Missing notes resource')
    current.query = { filterFields: ['title', 'content'], searchFields: ['title'], sortFields: [] }
    const access = structuredClone(application.auth)
    removeNestJSFieldReferences(application, current.entityId, 'title')
    expect(current.query).toEqual({ filterFields: ['content'], searchFields: [], sortFields: [] })
    expect(current.readFields).not.toContain('title')
    expect(application.auth).toEqual(access)
  })
})
