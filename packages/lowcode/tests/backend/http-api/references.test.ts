import { describe, expect, test } from 'bun:test'

import {
  parseBackendApplicationSpecV1,
  parseBackendApplicationSpecV2
} from '@open-pencil/lowcode/backend'

import { httpApplication, httpApplicationV2, httpResource } from './fixtures'

describe('Backend HTTP API application references', () => {
  test('requires a declared user identity rather than a missing, anonymous or service identity', () => {
    for (const kind of ['anonymous', 'service'] as const) {
      const application = httpApplication()
      application.auth.identities[0].kind = kind
      expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
    }
    const application = httpApplication()
    application.httpApi.authentication.identityId = 'undeclared-user'
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
  })

  test('requires every JWT setting to reference a required server environment declaration', () => {
    for (const key of ['issuerEnvironment', 'audienceEnvironment', 'jwksUrlEnvironment'] as const) {
      for (const change of ['missing', 'optional', 'client-public', 'credential'] as const) {
        const application = httpApplication()
        const name = application.httpApi.authentication[key]
        const index = application.secrets.findIndex((entry) => entry.name === name)
        expect(index).toBeGreaterThanOrEqual(0)
        if (change === 'missing') application.secrets.splice(index, 1)
        else if (change === 'optional') application.secrets[index].required = false
        else if (change === 'client-public') application.secrets[index].exposure = 'client-public'
        else
          application.secrets[index] = {
            kind: 'credential',
            name,
            credentialRef: 'credential.00000000-0000-4000-8000-000000000001',
            exposure: 'server',
            required: true
          }
        expect(parseBackendApplicationSpecV1(application).ok, `${key}/${change}`).toBe(false)
      }
    }
    const sharedName = httpApplication()
    sharedName.httpApi.authentication.audienceEnvironment = 'JWT_ISSUER'
    sharedName.httpApi.authentication.jwksUrlEnvironment = 'JWT_ISSUER'
    expect(parseBackendApplicationSpecV1(sharedName).ok).toBe(true)
  })

  test('rejects unknown entities and field names that are not field IDs', () => {
    const unknownEntity = httpApplication()
    unknownEntity.httpApi.resources[0].entityId = 'missing-entity'
    expect(parseBackendApplicationSpecV1(unknownEntity).ok).toBe(false)
    for (const fieldSet of ['readFields', 'createFields', 'updateFields'] as const) {
      const application = httpApplication()
      application.dataModel.entities[0].fields[2].name = 'display_title'
      application.httpApi.resources[0][fieldSet] = ['display_title']
      expect(parseBackendApplicationSpecV1(application).ok, fieldSet).toBe(false)
    }
  })

  test('rejects client writes to generated, ownership and tenant fields', () => {
    for (const fieldSet of ['createFields', 'updateFields'] as const) {
      for (const field of ['created_at', 'owner_id', 'tenant_id']) {
        const application = httpApplication()
        application.dataModel.entities[0].fields.push({
          id: 'tenant_id',
          name: 'tenant_id',
          type: 'uuid',
          nullable: false
        })
        application.auth.tenants.push({
          id: 'workspace',
          entityId: 'notes',
          tenantFieldId: 'tenant_id'
        })
        expect(parseBackendApplicationSpecV1(application).ok).toBe(true)
        application.httpApi.resources[0][fieldSet] = [field]
        expect(parseBackendApplicationSpecV1(application).ok, `${fieldSet}/${field}`).toBe(false)
      }
    }
  })

  test('allows an ordinary primary key at creation but never in updates', () => {
    const application = httpApplication()
    Reflect.deleteProperty(application.dataModel.entities[0].fields[0], 'default')
    application.httpApi.resources[0].createFields = ['id', 'title']
    expect(parseBackendApplicationSpecV1(application).ok).toBe(true)
    application.httpApi.resources[0].updateFields = ['id', 'title']
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
  })

  test('requires exactly one supported nonnullable primary key for item operations', () => {
    for (const operation of ['read', 'update', 'delete'] as const) {
      for (const invalid of ['missing', 'composite', 'boolean', 'number', 'nullable'] as const) {
        const application = httpApplication()
        application.httpApi.resources = [httpResource('item', '/api/notes', [operation])]
        const entity = application.dataModel.entities[0]
        Reflect.deleteProperty(entity.fields[0], 'default')
        if (invalid === 'missing') Reflect.deleteProperty(entity, 'primaryKey')
        else if (invalid === 'composite') entity.primaryKey = { fields: ['id', 'owner_id'] }
        else if (invalid === 'nullable') entity.fields[0].nullable = true
        else entity.fields[0].type = invalid
        expect(parseBackendApplicationSpecV1(application).ok, `${operation}/${invalid}`).toBe(false)
      }
    }
    for (const type of ['string', 'uuid', 'integer'] as const) {
      const application = httpApplication()
      Reflect.deleteProperty(application.dataModel.entities[0].fields[0], 'default')
      application.dataModel.entities[0].fields[0].type = type
      expect(parseBackendApplicationSpecV1(application).ok, type).toBe(true)
    }
  })

  test('requires write projections only for enabled operations and never inserts defaults', () => {
    for (const operation of ['create', 'update'] as const) {
      const application = httpApplication()
      Reflect.deleteProperty(application.httpApi.resources[0], `${operation}Fields`)
      expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
      application.httpApi.resources = [httpResource('list', '/api/notes', ['list'])]
      Reflect.set(application.httpApi.resources[0], `${operation}Fields`, ['title'])
      expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
    }
    const readonly = httpApplication()
    readonly.httpApi.resources = [httpResource('list', '/api/notes', ['list'])]
    const parsed = parseBackendApplicationSpecV1(readonly)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok || !parsed.value.httpApi) throw new Error('read-only HTTP API must parse')
    expect(Object.hasOwn(parsed.value.httpApi.resources[0], 'createFields')).toBe(false)
    expect(Object.hasOwn(parsed.value.httpApi.resources[0], 'updateFields')).toBe(false)
  })

  test('revalidates HTTP references in V2 instead of dropping or trusting the section', () => {
    const application = httpApplicationV2()
    application.httpApi.resources[0].readFields = ['missing-field']
    expect(parseBackendApplicationSpecV2(application).ok).toBe(false)
    const wrongIdentity = httpApplicationV2()
    wrongIdentity.httpApi.authentication.identityId = 'missing-user'
    expect(parseBackendApplicationSpecV2(wrongIdentity).ok).toBe(false)
  })
})
