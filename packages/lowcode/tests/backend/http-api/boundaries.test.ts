import { describe, expect, test } from 'bun:test'

import {
  BACKEND_LIMITS,
  canonicalBackendApplicationBytes,
  parseBackendApplicationSpecV1,
  parseBackendApplicationSpecV2
} from '@open-pencil/lowcode/backend'

import { stripeSecretCanary } from '../fixture'
import { httpApplication, httpApplicationV2, httpResource } from './fixtures'

describe('Backend HTTP API bounded data boundary', () => {
  test('rejects unknown fields and accessors without evaluating getters at every nested level', () => {
    for (const level of ['api', 'authentication', 'resource'] as const) {
      for (const accessor of [false, true]) {
        const application = httpApplication()
        const targets = {
          api: application.httpApi,
          authentication: application.httpApi.authentication,
          resource: application.httpApi.resources[0]
        }
        const target = targets[level]
        let getterCalls = 0
        if (accessor)
          Object.defineProperty(target, 'unexpected', {
            enumerable: true,
            get: () => {
              getterCalls += 1
              throw new Error('must never evaluate HTTP extension')
            }
          })
        else Reflect.set(target, 'unexpected', 'unrecognized extension')
        expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
        expect(getterCalls).toBe(0)
      }
    }
    const v2 = httpApplicationV2()
    let calls = 0
    Object.defineProperty(v2.httpApi.authentication, 'algorithms', {
      enumerable: true,
      get: () => {
        calls += 1
        return ['RS256']
      }
    })
    expect(parseBackendApplicationSpecV2(v2).ok).toBe(false)
    expect(calls).toBe(0)
  })

  test('keeps raw JWT secret material out of normalized data and diagnostics', () => {
    const canary = stripeSecretCanary('httpBoundaryCanary1234567890')
    const application = httpApplication()
    Reflect.set(application.httpApi.authentication, 'secret', canary)
    const result = parseBackendApplicationSpecV1(application)
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result.diagnostics)).not.toContain(canary)
    expect(() => canonicalBackendApplicationBytes(application)).toThrow()
    for (const rawSetting of [canary, 'https://issuer.example.invalid']) {
      const inline = httpApplication()
      inline.httpApi.authentication.issuerEnvironment = rawSetting
      expect(parseBackendApplicationSpecV1(inline).ok).toBe(false)
    }
  })

  test('accepts the resource-count boundary and rejects empty or excessive collections', () => {
    expect(BACKEND_LIMITS.maxHttpApiResources).toBe(64)
    const application = httpApplication()
    application.httpApi.resources = Array.from({ length: 64 }, (_, index) =>
      httpResource(`resource_${index}`, `/api/resource_${index}`, ['list'])
    )
    expect(parseBackendApplicationSpecV1(application).ok).toBe(true)
    application.httpApi.resources.push(httpResource('overflow', '/api/overflow', ['list']))
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
    application.httpApi.resources = []
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
  })

  test('enforces exact path and page-size boundaries without choosing an implicit page size', () => {
    const application = httpApplication()
    application.httpApi.resources[0].path = `/${'x'.repeat(127)}`
    application.httpApi.resources[0].maxPageSize = 100
    expect(parseBackendApplicationSpecV1(application).ok).toBe(true)
    application.httpApi.resources[0].path += 'x'
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
    for (const pageSize of [undefined, 0, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const invalid = httpApplication()
      Reflect.set(invalid.httpApi.resources[0], 'maxPageSize', pageSize)
      expect(parseBackendApplicationSpecV1(invalid).ok).toBe(false)
    }
    const minimum = httpApplication()
    minimum.httpApi.resources[0].maxPageSize = 1
    expect(parseBackendApplicationSpecV1(minimum).ok).toBe(true)
    minimum.httpApi.resources = [httpResource('item', '/api/notes', ['read'])]
    minimum.httpApi.resources[0].maxPageSize = 1
    expect(parseBackendApplicationSpecV1(minimum).ok).toBe(false)
  })

  test('bounds field arrays before accepting duplicate overflow entries', () => {
    const application = httpApplication()
    const fields = application.dataModel.entities[0].fields
    while (fields.length < BACKEND_LIMITS.maxFieldsPerEntity) {
      const id = `field_${fields.length}`
      fields.push({ id, name: id, type: 'string', nullable: true })
    }
    application.httpApi.resources[0].readFields = fields.map((field) => field.id)
    expect(parseBackendApplicationSpecV1(application).ok).toBe(true)
    application.httpApi.resources[0].readFields.push('id')
    const result = parseBackendApplicationSpecV1(application)
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'backend-array-limit',
        path: '$.httpApi.resources[0].readFields'
      })
    )
  })

  test('rejects empty, duplicate and unsupported operations, fields and JWT algorithms', () => {
    for (const algorithms of [[], ['RS256', 'RS256'], ['HS256'], ['none']]) {
      const application = httpApplication()
      Reflect.set(application.httpApi.authentication, 'algorithms', algorithms)
      expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
    }
    for (const [key, values] of [
      ['operations', []],
      ['operations', ['list', 'list']],
      ['operations', ['search']],
      ['readFields', []],
      ['readFields', ['id', 'id']],
      ['createFields', []],
      ['createFields', ['title', 'title']],
      ['updateFields', []],
      ['updateFields', ['title', 'title']]
    ]) {
      const application = httpApplication()
      Reflect.set(application.httpApi.resources[0], String(key), values)
      expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
    }
    const future = httpApplication()
    Reflect.set(future.httpApi, 'version', 2)
    expect(parseBackendApplicationSpecV1(future).ok).toBe(false)
  })
})
