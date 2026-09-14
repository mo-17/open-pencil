import { describe, expect, test } from 'bun:test'

import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { httpApplication } from './fixtures'

describe('HTTP resource read policy subsets', () => {
  test('normalizes a nonempty exact subset of same-entity allow/select grants', () => {
    const app = httpApplication()
    app.httpApi.resources[0].readPolicyIds = ['owner-access']
    const parsed = parseBackendApplicationSpecV1(app)
    expect(parsed.ok, JSON.stringify(parsed.diagnostics)).toBe(true)
    if (!parsed.ok) throw new Error('Expected read policy subset')
    expect(parsed.value.httpApi?.resources[0].readPolicyIds).toEqual(['owner-access'])
  })

  test.each([
    'empty',
    'duplicate',
    'missing',
    'deny',
    'write-only-policy',
    'foreign-entity',
    'no-read-operation'
  ])('rejects %s read policy selection', (fault) => {
    const app = httpApplication()
    const resource = app.httpApi.resources[0]
    const policy = app.auth.rowAccess[0]
    resource.readPolicyIds = ['owner-access']
    if (fault === 'empty') resource.readPolicyIds = []
    if (fault === 'duplicate') resource.readPolicyIds.push('owner-access')
    if (fault === 'missing') resource.readPolicyIds = ['unknown']
    if (fault === 'deny') policy.effect = 'deny'
    if (fault === 'write-only-policy') policy.operations = ['update']
    if (fault === 'foreign-entity') policy.entityId = 'other-entity'
    if (fault === 'no-read-operation') {
      resource.operations = ['create']
      delete resource.updateFields
      delete resource.maxPageSize
    }
    expect(parseBackendApplicationSpecV1(app).ok).toBe(false)
  })
})
