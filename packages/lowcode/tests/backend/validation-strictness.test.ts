import { describe, expect, test } from 'bun:test'

import { parseBackendApplicationSpecV1, validateDataModelIR } from '@open-pencil/lowcode/backend'

import { backendApplicationFixture, backendModelFixture } from './fixture'

describe('provider-neutral Backend Core strict semantics', () => {
  test('binds owner and tenant principals to the row-access entity', () => {
    const base = backendApplicationFixture()
    base.dataModel.entities.push({
      id: 'other',
      name: 'other',
      management: 'managed',
      fields: [{ id: 'owner_id', name: 'owner_id', type: 'uuid', nullable: false }],
      primaryKey: { fields: ['owner_id'] }
    })

    const ownerMismatch = structuredClone(base)
    ownerMismatch.auth.ownership[0].entityId = 'other'
    const ownerResult = parseBackendApplicationSpecV1(ownerMismatch)
    expect(ownerResult.ok).toBe(false)
    if (!ownerResult.ok) {
      expect(ownerResult.diagnostics.map((entry) => entry.code)).toContain(
        'backend-auth-ownership-entity-mismatch'
      )
    }

    const tenantMismatch = structuredClone(base)
    tenantMismatch.auth.tenants = [
      { id: 'workspace', entityId: 'other', tenantFieldId: 'owner_id' }
    ]
    tenantMismatch.auth.rowAccess[0].principal = {
      kind: 'tenant-member',
      tenantId: 'workspace'
    }
    const tenantResult = parseBackendApplicationSpecV1(tenantMismatch)
    expect(tenantResult.ok).toBe(false)
    if (!tenantResult.ok) {
      expect(tenantResult.diagnostics.map((entry) => entry.code)).toContain(
        'backend-auth-tenant-entity-mismatch'
      )
    }
  })

  test('rejects scalar, generator, nullability, calendar, and enum default mismatches', () => {
    const invalidDefaults = [
      { field: 'title', type: 'integer', default: { kind: 'literal', value: 'oops' } },
      { field: 'title', type: 'boolean', default: { kind: 'literal', value: 123 } },
      { field: 'id', type: 'uuid', default: { kind: 'literal', value: 'not-a-uuid' } },
      { field: 'title', type: 'integer', default: { kind: 'generated', generator: 'uuid' } },
      {
        field: 'title',
        type: 'string',
        nullable: false,
        default: { kind: 'literal', value: null }
      },
      { field: 'title', type: 'date', default: { kind: 'literal', value: '2025-02-30' } },
      { field: 'title', type: 'datetime', default: { kind: 'literal', value: 'Aug 30 2026' } },
      {
        field: 'title',
        type: 'datetime',
        default: { kind: 'literal', value: '2026-02-30T12:00:00Z' }
      }
    ]
    for (const candidate of invalidDefaults) {
      const model = backendModelFixture()
      const field = model.entities[0].fields.find((entry) => entry.id === candidate.field)
      if (!field) throw new Error('Missing field fixture')
      Reflect.set(field, 'type', candidate.type)
      if (candidate.nullable !== undefined) field.nullable = candidate.nullable
      Reflect.set(field, 'default', candidate.default)
      const result = validateDataModelIR(model)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.diagnostics.map((entry) => entry.code)).toContain(
          'backend-field-default-type-mismatch'
        )
      }
    }

    const enumModel = backendModelFixture()
    enumModel.enums.push({ id: 'status', name: 'status', values: ['draft', 'published'] })
    Reflect.set(enumModel.entities[0].fields[2], 'type', 'enum')
    Reflect.set(enumModel.entities[0].fields[2], 'enumId', 'status')
    enumModel.entities[0].fields[2].default = { kind: 'literal', value: 'archived' }
    const enumResult = validateDataModelIR(enumModel)
    expect(enumResult.ok).toBe(false)
    if (!enumResult.ok) {
      expect(enumResult.diagnostics.map((entry) => entry.code)).toContain(
        'backend-enum-default-invalid'
      )
    }
  })
})
