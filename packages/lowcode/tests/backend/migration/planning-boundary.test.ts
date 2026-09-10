import { describe, expect, test } from 'bun:test'

import {
  BACKEND_LIMITS,
  BackendMigrationPlanningError,
  planBackendMigration,
  validateDataModelIR,
  validateMigrationPlan,
  type DataModelIR
} from '@open-pencil/lowcode/backend'

function enumModel(): DataModelIR {
  return {
    version: 1,
    entities: [],
    enums: [{ id: 'status', name: 'status', values: ['draft'] }],
    relations: []
  }
}

function modelWithFields(addedFieldsPerEntity: number): DataModelIR {
  return {
    version: 1,
    entities: Array.from({ length: 10 }, (_, index) => ({
      id: `table_${index}`,
      name: `table_${index}`,
      management: 'managed',
      fields: [
        { id: 'id', name: 'id', type: 'uuid', nullable: false },
        ...Array.from({ length: addedFieldsPerEntity }, (_, field) => ({
          id: `field_${field}`,
          name: `field_${field}`,
          type: 'string' as const,
          nullable: true
        }))
      ]
    })),
    enums: [],
    relations: []
  }
}

function modelWithEnumValues(addedValuesPerEnum: number): DataModelIR {
  return {
    version: 1,
    entities: [],
    enums: Array.from({ length: 64 }, (_, index) => ({
      id: `status_${index}`,
      name: `status_${index}`,
      values: [
        'draft',
        ...Array.from({ length: addedValuesPerEnum }, (_, value) => `value_${value}`)
      ]
    })),
    relations: []
  }
}

describe('Backend migration planner output boundary', () => {
  test('rejects an unrepresented enum rename instead of returning an empty or partial plan', async () => {
    for (const addValue of [false, true]) {
      const current = enumModel()
      const target = enumModel()
      target.enums[0].name = 'lifecycle_status'
      if (addValue) target.enums[0].values.push('published')
      expect(validateDataModelIR(current).ok).toBe(true)
      expect(validateDataModelIR(target).ok).toBe(true)
      const original = structuredClone({ current, target })
      const planned = planBackendMigration(current, target)
      await expect(planned).rejects.toBeInstanceOf(TypeError)
      await expect(planned).rejects.toBeInstanceOf(BackendMigrationPlanningError)
      await expect(planned).rejects.toMatchObject({
        name: 'BackendMigrationPlanningError',
        diagnostics: [
          {
            code: 'backend-migration-enum-rename-unsupported',
            severity: 'error',
            path: '$.target.enums[0].name',
            message: expect.any(String)
          }
        ]
      })
      expect({ current, target }).toEqual(original)
    }
  })

  test('rejects aggregate plan expansion even below the operation-count limit', async () => {
    const current = modelWithFields(0)
    const target = modelWithFields(170)
    expect(validateDataModelIR(current).ok).toBe(true)
    expect(validateDataModelIR(target).ok).toBe(true)
    expect(10 * 170).toBeLessThan(BACKEND_LIMITS.maxMigrationOperations)
    await expect(planBackendMigration(current, target)).rejects.toMatchObject({
      name: 'BackendMigrationPlanningError',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'backend-limit-nodes', severity: 'error' })
      ])
    })

    const accepted = await planBackendMigration(current, modelWithFields(160))
    expect(accepted.operations).toHaveLength(1_600)
    expect(validateMigrationPlan(accepted).ok).toBe(true)
  })

  test('enforces the output operation limit while retaining the supported boundary', async () => {
    const current = modelWithEnumValues(0)
    const target = modelWithEnumValues(33)
    expect(validateDataModelIR(current).ok).toBe(true)
    expect(validateDataModelIR(target).ok).toBe(true)
    await expect(planBackendMigration(current, target)).rejects.toMatchObject({
      name: 'BackendMigrationPlanningError',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'backend-array-limit', path: '$.operations' })
      ])
    })

    const accepted = await planBackendMigration(current, modelWithEnumValues(32))
    expect(accepted.operations).toHaveLength(BACKEND_LIMITS.maxMigrationOperations)
    expect(validateMigrationPlan(accepted).ok).toBe(true)
    expect(accepted.highestRisk).toBe('low')
  })
})
