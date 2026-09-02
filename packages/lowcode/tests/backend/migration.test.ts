import { describe, expect, test } from 'bun:test'

import {
  planBackendMigration,
  validateMigrationPlan,
  type DataModelIR
} from '@open-pencil/lowcode/backend'

import { backendModelFixture, stripeSecretCanary } from './fixture'

describe('Backend Core migration planning', () => {
  test('classifies additive, high-risk, and destructive operations without raw SQL', async () => {
    const current = backendModelFixture()
    const target = structuredClone(current)
    target.entities[0].fields.push({
      id: 'summary',
      name: 'summary',
      type: 'string',
      nullable: true
    })
    target.entities[0].uniques = [{ id: 'notes_title_unique', fields: ['title'] }]
    const additive = await planBackendMigration(current, target)
    expect(additive.operations.map((entry) => [entry.operation.kind, entry.risk])).toEqual([
      ['add-field', 'low'],
      ['add-unique', 'high']
    ])
    expect(additive.highestRisk).toBe('high')
    expect(additive.requiresBackup).toBe(true)
    expect(JSON.stringify(additive).toLowerCase()).not.toContain('sql')
    expect(validateMigrationPlan(additive).ok).toBe(true)

    for (const field of [
      { id: 'required_plain', name: 'required_plain', type: 'string', nullable: false },
      {
        id: 'required_defaulted',
        name: 'required_defaulted',
        type: 'string',
        nullable: false,
        default: { kind: 'literal', value: 'initial' }
      }
    ] as const) {
      const requiredTarget = backendModelFixture()
      requiredTarget.entities[0].fields.push(field)
      const requiredPlan = await planBackendMigration(backendModelFixture(), requiredTarget)
      expect(requiredPlan.operations[0]).toMatchObject({
        operation: { kind: 'add-field' },
        risk: 'high'
      })
      expect(requiredPlan.highestRisk).toBe('high')
      expect(requiredPlan.requiresBackup).toBe(true)
    }

    const destructiveTarget: DataModelIR = { version: 1, entities: [], enums: [], relations: [] }
    const destructive = await planBackendMigration(current, destructiveTarget)
    expect(destructive.operations[0].operation.kind).toBe('drop-entity')
    expect(destructive.highestRisk).toBe('destructive')
  })

  test('never creates schema operations for legacy external entities', async () => {
    const empty: DataModelIR = { version: 1, entities: [], enums: [], relations: [] }
    const external: DataModelIR = {
      version: 1,
      entities: [
        { id: 'external:public.notes', name: 'notes', management: 'external', fields: [] }
      ],
      enums: [],
      relations: []
    }
    expect((await planBackendMigration(empty, external)).operations).toEqual([])
  })

  test('rejects caller-downgraded risk and derived backup claims', async () => {
    const plan = await planBackendMigration(backendModelFixture(), {
      version: 1,
      entities: [],
      enums: [],
      relations: []
    })
    plan.operations[0].risk = 'low'
    plan.highestRisk = 'low'
    plan.requiresBackup = false
    const result = validateMigrationPlan(plan)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics.map((entry) => entry.code)).toContain(
        'backend-migration-risk-mismatch'
      )
    }
  })

  test('rejects secret-like material in migration reasons before release binding', async () => {
    const secretCanary = stripeSecretCanary('0123456789abcdefghijklmnopqrstuvwxyz')
    const plan = await planBackendMigration(backendModelFixture(), {
      version: 1,
      entities: [],
      enums: [],
      relations: []
    })
    plan.operations[0].reason = secretCanary
    const result = validateMigrationPlan(plan)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics.map((entry) => entry.code)).toContain(
        'backend-secret-material-forbidden'
      )
      expect(JSON.stringify(result.diagnostics)).not.toContain(secretCanary)
    }
  })

  test('parses each operation variant exactly and rejects smuggled or malformed payloads', async () => {
    const destructive = await planBackendMigration(backendModelFixture(), {
      version: 1,
      entities: [],
      enums: [],
      relations: []
    })
    Reflect.set(destructive.operations[0].operation, 'nextName', 'smuggled_field')
    const smuggled = validateMigrationPlan(destructive)
    expect(smuggled.ok).toBe(false)
    if (!smuggled.ok) {
      expect(smuggled.diagnostics.map((entry) => entry.code)).toContain('backend-unknown-field')
    }

    const wrongType = structuredClone(destructive)
    Reflect.deleteProperty(wrongType.operations[0].operation, 'nextName')
    Reflect.set(wrongType.operations[0].operation, 'entityId', 42)
    expect(validateMigrationPlan(wrongType).ok).toBe(false)

    const created = await planBackendMigration(
      { version: 1, entities: [], enums: [], relations: [] },
      backendModelFixture()
    )
    Reflect.set(created.operations[0].operation, 'entity', { metadata: 'not-an-entity' })
    expect(validateMigrationPlan(created).ok).toBe(false)

    const alteredTarget = backendModelFixture()
    alteredTarget.entities[0].fields[2].nullable = false
    const altered = await planBackendMigration(backendModelFixture(), alteredTarget)
    const alterOperation = altered.operations[0].operation
    if (alterOperation.kind !== 'alter-field') throw new Error('Expected alter-field fixture')
    alterOperation.nextField.id = 'different-field'
    const identityMismatch = validateMigrationPlan(altered)
    expect(identityMismatch.ok).toBe(false)
    if (!identityMismatch.ok) {
      expect(identityMismatch.diagnostics.map((entry) => entry.code)).toContain(
        'backend-migration-field-identity-mismatch'
      )
    }

    let getterCalls = 0
    const accessor = await planBackendMigration(backendModelFixture(), {
      version: 1,
      entities: [],
      enums: [],
      relations: []
    })
    Object.defineProperty(accessor.operations[0].operation, 'entityId', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'notes'
      }
    })
    expect(validateMigrationPlan(accessor).ok).toBe(false)
    expect(getterCalls).toBe(0)
  })
})
