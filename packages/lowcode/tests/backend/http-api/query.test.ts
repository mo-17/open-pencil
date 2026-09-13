import { describe, expect, test } from 'bun:test'

import {
  digestBackendApplication,
  parseBackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import { httpApplication } from './fixtures'

describe('HTTP list query declarations', () => {
  test('normalizes field sets and binds them into the application digest', async () => {
    const application = httpApplication()
    const original = await digestBackendApplication(application)
    application.httpApi.resources[0].query = {
      filterFields: ['title', 'id'],
      searchFields: ['title'],
      sortFields: ['created_at']
    }
    const first = parseBackendApplicationSpecV1(application)
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error('Expected query declaration')
    expect(first.value.httpApi?.resources[0].query?.filterFields).toEqual(['id', 'title'])
    expect(await digestBackendApplication(application)).not.toBe(original)
    application.httpApi.resources[0].query.filterFields.reverse()
    expect(await digestBackendApplication(application)).toBe(
      await digestBackendApplication(first.value)
    )
  })

  test.each([
    { filterFields: ['private'], searchFields: [], sortFields: [] },
    { filterFields: [], searchFields: ['id'], sortFields: [] },
    { filterFields: [], searchFields: [], sortFields: ['title'] },
    { filterFields: [], searchFields: [], sortFields: ['body'] },
    { filterFields: ['id', 'id'], searchFields: [], sortFields: [] },
    { filterFields: [], searchFields: [], sortFields: [] },
    { filterFields: ['id'], searchFields: [], sortFields: [], sql: 'SELECT 1' }
  ])('rejects unsupported query declarations %#', (query) => {
    const application = httpApplication()
    Reflect.set(application.httpApi.resources[0], 'query', query)
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
  })

  test('does not grant access to hidden fields or a resource without list', () => {
    const application = httpApplication()
    const resource = application.httpApi.resources[0]
    resource.query = { filterFields: ['owner_id'], searchFields: [], sortFields: [] }
    resource.readFields = ['id', 'title']
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
    resource.query.filterFields = ['id']
    resource.operations = ['read']
    delete resource.maxPageSize
    delete resource.createFields
    delete resource.updateFields
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
  })
})
