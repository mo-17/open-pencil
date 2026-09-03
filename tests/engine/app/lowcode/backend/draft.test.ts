import { describe, expect, test } from 'bun:test'

import { BACKEND_LIMITS, parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import {
  createEmptyBackendApplication,
  prepareBackendApplicationDraft
} from '@/app/lowcode/backend/document'
import {
  BackendDraftOperationError,
  addBackendEntity,
  addBackendEnum,
  addBackendEnumValue,
  addBackendField,
  addBackendOwnership,
  addBackendRole,
  addBackendRowAccess,
  addBackendStorageBucket,
  addBackendStoragePathRule,
  addBackendTenant,
  addBackendWorkflow,
  addBackendWorkflowStep,
  addDirectBackendRelation,
  addManyToManyBackendRelation,
  removeBackendEntity,
  removeBackendField,
  removeBackendOwnership,
  removeBackendRelation,
  removeBackendTenant,
  removeBackendWorkflow,
  replaceBackendRelation,
  setBackendOwnershipEntity,
  setBackendFieldNullable,
  setBackendFieldPrimary,
  setBackendFieldType,
  setBackendRelationOnDelete,
  setBackendRowAccessEntity,
  setBackendStoragePathRulePrincipal,
  setBackendTenantEntity,
  setBackendTenantMembershipEntity,
  setBackendTenantMembershipField,
  setBackendWorkflowMutationValueField,
  setBackendWorkflowStepEntity
} from '@/app/lowcode/backend/draft'

function sequentialIds() {
  let value = 0
  return (prefix: string) => `${prefix}:test-${++value}`
}

describe('Backend visual draft operations', () => {
  test('keeps stable entity and field ids across renames', () => {
    const application = createEmptyBackendApplication('visual-backend')
    const createId = sequentialIds()
    const entity = addBackendEntity(application, createId)
    const field = addBackendField(entity, createId)
    const entityId = entity.id
    const fieldId = field.id

    entity.name = 'renamed_table'
    field.name = 'renamed_field'

    expect(entity.id).toBe(entityId)
    expect(field.id).toBe(fieldId)
    expect(parseBackendApplicationSpecV1(prepareBackendApplicationDraft(application)).ok).toBe(true)
  })

  test('authors enums with stable ids and rejects a deleted referenced enum', () => {
    const application = createEmptyBackendApplication('visual-backend')
    const createId = sequentialIds()
    const dataEnum = addBackendEnum(application, createId)
    const enumId = dataEnum.id
    const addedValue = addBackendEnumValue(dataEnum)
    dataEnum.name = 'task_status'
    dataEnum.values[0] = 'open'
    dataEnum.values[1] = 'closed'
    const entity = addBackendEntity(application, createId)
    const field = addBackendField(entity, createId)
    field.type = 'enum'
    field.enumId = dataEnum.id
    field.default = { kind: 'literal', value: 'open' }

    expect(addedValue).toBe('value_2')
    expect(dataEnum.id).toBe(enumId)
    expect(parseBackendApplicationSpecV1(prepareBackendApplicationDraft(application)).ok).toBe(true)

    application.dataModel.enums.splice(0, 1)
    const deleted = parseBackendApplicationSpecV1(prepareBackendApplicationDraft(application))
    expect(deleted.ok).toBe(false)
    expect(deleted.diagnostics.map((entry) => entry.code)).toContain(
      'backend-enum-reference-missing'
    )
  })

  test('authors stable roles and rejects a deleted RLS role reference', () => {
    const application = createEmptyBackendApplication('visual-backend')
    const createId = sequentialIds()
    const entity = addBackendEntity(application, createId)
    const role = addBackendRole(application, createId)
    const roleId = role.id
    role.name = 'project_admin'
    const access = addBackendRowAccess(application, entity.id, createId)
    access.principal = { kind: 'role', roleId: role.id }

    expect(role.id).toBe(roleId)
    expect(parseBackendApplicationSpecV1(prepareBackendApplicationDraft(application)).ok).toBe(true)

    application.auth.roles.splice(0, 1)
    const deleted = parseBackendApplicationSpecV1(prepareBackendApplicationDraft(application))
    expect(deleted.ok).toBe(false)
    expect(deleted.diagnostics.map((entry) => entry.code)).toContain('backend-auth-role-missing')
  })

  test('creates a valid direct relation with FK and one-to-one unique semantics', () => {
    const application = createEmptyBackendApplication('visual-backend')
    const createId = sequentialIds()
    const source = addBackendEntity(application, createId)
    const target = addBackendEntity(application, createId)
    const sourceField = addBackendField(source, createId)
    sourceField.type = 'uuid'
    const targetField = target.fields[0]

    const relation = addDirectBackendRelation(
      application,
      {
        kind: 'one-to-one',
        sourceEntityId: source.id,
        sourceFieldId: sourceField.id,
        targetEntityId: target.id,
        targetFieldId: targetField.id
      },
      createId
    )

    expect(source.foreignKeys?.[0]).toMatchObject({
      id: relation.sourceForeignKeyId,
      fields: [sourceField.id],
      targetEntityId: target.id,
      targetFields: [targetField.id]
    })
    expect(source.uniques?.some((unique) => unique.fields[0] === sourceField.id)).toBe(true)
    expect(parseBackendApplicationSpecV1(prepareBackendApplicationDraft(application)).ok).toBe(true)
  })

  test('creates a valid managed junction for many-to-many', () => {
    const application = createEmptyBackendApplication('visual-backend')
    const createId = sequentialIds()
    const source = addBackendEntity(application, createId)
    const target = addBackendEntity(application, createId)

    const relation = addManyToManyBackendRelation(
      application,
      { sourceEntityId: source.id, targetEntityId: target.id },
      createId
    )
    const junction = application.dataModel.entities.find(
      (entity) => entity.id === relation.junctionEntityId
    )

    expect(junction).toMatchObject({ management: 'managed' })
    expect(junction?.foreignKeys).toHaveLength(2)
    expect(junction?.primaryKey?.fields).toHaveLength(2)
    expect(parseBackendApplicationSpecV1(prepareBackendApplicationDraft(application)).ok).toBe(true)
  })

  test('rejects an invalid direct relation before adding an FK', () => {
    const application = createEmptyBackendApplication('visual-backend')
    const createId = sequentialIds()
    const source = addBackendEntity(application, createId)
    const target = addBackendEntity(application, createId)
    const nonKey = addBackendField(target, createId)
    const before = structuredClone(source.foreignKeys)

    expect(() =>
      addDirectBackendRelation(
        application,
        {
          kind: 'one-to-many',
          sourceEntityId: source.id,
          sourceFieldId: source.fields[0].id,
          targetEntityId: target.id,
          targetFieldId: nonKey.id
        },
        createId
      )
    ).toThrow(BackendDraftOperationError)
    expect(source.foreignKeys).toEqual(before)
    expect(application.dataModel.relations).toEqual([])
  })

  test('adds owner, tenant, RLS, and an authenticated response workflow', () => {
    const application = createEmptyBackendApplication('visual-backend')
    const createId = sequentialIds()
    const entity = addBackendEntity(application, createId)
    const field = entity.fields[0]
    const owner = addBackendOwnership(application, entity.id, field.id, createId)
    const tenant = addBackendTenant(application, entity.id, field.id, createId)
    const access = addBackendRowAccess(application, entity.id, createId)
    access.principal = { kind: 'owner', ownershipId: owner.id }
    const workflow = addBackendWorkflow(application, createId)

    expect(tenant.tenantFieldId).toBe(field.id)
    expect(workflow.steps).toEqual([{ id: expect.any(String), kind: 'respond', status: 200 }])
    expect(parseBackendApplicationSpecV1(prepareBackendApplicationDraft(application)).ok).toBe(true)
  })

  test('creates valid bounded skeletons for every visual workflow step kind', () => {
    const application = createEmptyBackendApplication('visual-backend')
    const createId = sequentialIds()
    addBackendEntity(application, createId)
    const target = addBackendWorkflow(application, createId)
    const workflow = addBackendWorkflow(application, createId)
    const steps = [
      addBackendWorkflowStep(application, workflow, 'data.read', createId),
      addBackendWorkflowStep(application, workflow, 'data.mutate', createId),
      addBackendWorkflowStep(application, workflow, 'http.request', createId),
      addBackendWorkflowStep(application, workflow, 'branch', createId),
      addBackendWorkflowStep(application, workflow, 'call', createId),
      addBackendWorkflowStep(application, workflow, 'respond', createId)
    ]

    expect(steps.map((step) => step.kind)).toEqual([
      'data.read',
      'data.mutate',
      'http.request',
      'branch',
      'call',
      'respond'
    ])
    expect(steps[1]?.kind).toBe('data.mutate')
    if (steps[1]?.kind !== 'data.mutate') throw new Error('Expected a mutation step.')
    expect(steps[1].operation).toBe('insert')
    expect(typeof steps[1].values?.[0]?.field).toBe('string')
    expect(steps[2]).toMatchObject({
      method: 'GET',
      url: { kind: 'expression', expression: '"https://example.invalid"' }
    })
    expect(steps[3]).toMatchObject({
      condition: 'true',
      consequent: [{ kind: 'respond', status: 200 }],
      alternate: [{ kind: 'respond', status: 200 }]
    })
    expect(steps[4]).toMatchObject({ workflowId: target.id })
    expect(parseBackendApplicationSpecV1(prepareBackendApplicationDraft(application)).ok).toBe(true)
  })

  test('accepts declared server environment value sources and fails closed on missing calls', () => {
    const application = createEmptyBackendApplication('visual-backend')
    const createId = sequentialIds()
    addBackendEntity(application, createId)
    const target = addBackendWorkflow(application, createId)
    const workflow = addBackendWorkflow(application, createId)
    const request = addBackendWorkflowStep(application, workflow, 'http.request', createId)
    const call = addBackendWorkflowStep(application, workflow, 'call', createId)
    if (request.kind !== 'http.request' || call.kind !== 'call') {
      throw new Error('Expected HTTP request and call steps.')
    }
    application.secrets.push({
      kind: 'environment',
      name: 'API_ORIGIN',
      exposure: 'server',
      required: true
    })
    request.url = { kind: 'environment', name: 'API_ORIGIN' }

    expect(parseBackendApplicationSpecV1(prepareBackendApplicationDraft(application)).ok).toBe(true)

    const undeclaredEnvironment = structuredClone(application)
    undeclaredEnvironment.secrets = []
    const undeclared = parseBackendApplicationSpecV1(
      prepareBackendApplicationDraft(undeclaredEnvironment)
    )
    expect(undeclared.ok).toBe(false)
    expect(undeclared.diagnostics.map((entry) => entry.code)).toContain(
      'backend-workflow-environment-undeclared'
    )

    application.workflows.workflows.splice(
      application.workflows.workflows.findIndex((entry) => entry.id === target.id),
      1
    )
    const missing = parseBackendApplicationSpecV1(prepareBackendApplicationDraft(application))
    expect(missing.ok).toBe(false)
    expect(missing.diagnostics.map((entry) => entry.code)).toContain(
      'backend-workflow-call-missing'
    )
  })

  test('creates valid bounded Storage buckets with stable ids and unique names', () => {
    const application = createEmptyBackendApplication('visual-backend')
    const createId = sequentialIds()
    const first = addBackendStorageBucket(application, createId)
    const second = addBackendStorageBucket(application, createId)
    const stableId = first.id

    first.name = 'user-assets'

    expect(first.id).toBe(stableId)
    expect(second.name).toBe('bucket_2')
    expect(first).toMatchObject({
      access: 'private',
      maxObjectBytes: 10 * 1024 * 1024,
      allowedMimeTypes: ['application/octet-stream'],
      pathRules: [
        {
          prefix: ['objects'],
          principal: { kind: 'owner' },
          operations: ['read', 'create', 'update', 'delete', 'upsert']
        }
      ]
    })
    expect(parseBackendApplicationSpecV1(prepareBackendApplicationDraft(application)).ok).toBe(true)
  })

  test('only assigns Storage tenant paths to an existing complete tenant membership rule', () => {
    const application = createEmptyBackendApplication('visual-backend')
    const createId = sequentialIds()
    const resource = addBackendEntity(application, createId)
    const membership = addBackendEntity(application, createId)
    const membershipTenant = addBackendField(membership, createId)
    membershipTenant.type = 'uuid'
    const tenant = addBackendTenant(application, resource.id, resource.fields[0].id, createId)
    setBackendTenantMembershipEntity(application, tenant, membership.id)
    setBackendTenantMembershipField(application, tenant, 'tenant', membershipTenant.id)
    const bucket = addBackendStorageBucket(application, createId)

    const rule = addBackendStoragePathRule(
      application,
      { bucketId: bucket.id, principal: { kind: 'tenant-member', tenantId: tenant.id } },
      createId
    )

    expect(rule.principal).toEqual({ kind: 'tenant-member', tenantId: tenant.id })
    expect(rule.prefix).toEqual(['objects_2'])
    expect(parseBackendApplicationSpecV1(prepareBackendApplicationDraft(application)).ok).toBe(true)

    expect(() =>
      setBackendStoragePathRulePrincipal(application, rule, 'tenant-member', 'missing-tenant')
    ).toThrow(BackendDraftOperationError)
    expect(rule.principal).toEqual({ kind: 'tenant-member', tenantId: tenant.id })

    const replacementMembership = addBackendEntity(application, createId)
    const replacementTenantField = addBackendField(replacementMembership, createId)
    replacementTenantField.type = 'uuid'
    setBackendTenantMembershipEntity(application, tenant, replacementMembership.id)
    expect(tenant).toMatchObject({
      membershipEntityId: replacementMembership.id,
      membershipIdentityFieldId: replacementMembership.fields[0].id,
      membershipTenantFieldId: replacementTenantField.id
    })
    expect(tenant.membershipIdentityFieldId).not.toBe(membership.fields[0].id)
    expect(tenant.membershipTenantFieldId).not.toBe(membershipTenant.id)

    const replacementResource = addBackendEntity(application, createId)
    setBackendTenantEntity(application, tenant, replacementResource.id)
    expect(tenant.entityId).toBe(replacementResource.id)
    expect(tenant.tenantFieldId).toBe(replacementResource.fields[0].id)

    const beforeInvalidField = structuredClone(tenant)
    expect(() =>
      setBackendTenantMembershipField(application, tenant, 'identity', membership.fields[0].id)
    ).toThrow(BackendDraftOperationError)
    expect(tenant).toEqual(beforeInvalidField)
    expect(parseBackendApplicationSpecV1(prepareBackendApplicationDraft(application)).ok).toBe(true)

    const invalid = structuredClone(application)
    invalid.auth.tenants[0].membershipTenantFieldId = 'missing-field'
    expect(parseBackendApplicationSpecV1(prepareBackendApplicationDraft(invalid)).ok).toBe(false)
  })

  test('removes direct relation FKs and generated many-to-many junctions atomically', () => {
    const application = createEmptyBackendApplication('visual-backend')
    const createId = sequentialIds()
    const source = addBackendEntity(application, createId)
    const target = addBackendEntity(application, createId)
    const sourceField = addBackendField(source, createId)
    sourceField.type = 'uuid'
    const direct = addDirectBackendRelation(
      application,
      {
        kind: 'one-to-many',
        sourceEntityId: source.id,
        sourceFieldId: sourceField.id,
        targetEntityId: target.id,
        targetFieldId: target.fields[0].id
      },
      createId
    )

    expect(() =>
      addDirectBackendRelation(
        application,
        {
          kind: 'one-to-one',
          sourceEntityId: source.id,
          sourceFieldId: sourceField.id,
          targetEntityId: target.id,
          targetFieldId: target.fields[0].id
        },
        createId
      )
    ).toThrow(BackendDraftOperationError)
    expect(source.foreignKeys).toHaveLength(1)

    expect(removeBackendRelation(application, direct.id)).toBe(true)
    expect(source.foreignKeys).toBeUndefined()
    expect(application.dataModel.relations).toEqual([])

    const many = addManyToManyBackendRelation(
      application,
      { sourceEntityId: source.id, targetEntityId: target.id },
      createId
    )
    const junctionId = many.junctionEntityId
    expect(removeBackendRelation(application, many.id)).toBe(true)
    expect(application.dataModel.entities.some((entity) => entity.id === junctionId)).toBe(false)
    expect(parseBackendApplicationSpecV1(prepareBackendApplicationDraft(application)).ok).toBe(true)
  })

  test('edits relation delete behavior without allowing SET NULL on required fields', () => {
    const application = createEmptyBackendApplication('visual-backend')
    const createId = sequentialIds()
    const source = addBackendEntity(application, createId)
    const target = addBackendEntity(application, createId)
    const sourceField = addBackendField(source, createId)
    sourceField.type = 'uuid'
    sourceField.nullable = false
    const relation = addDirectBackendRelation(
      application,
      {
        kind: 'one-to-many',
        sourceEntityId: source.id,
        sourceFieldId: sourceField.id,
        targetEntityId: target.id,
        targetFieldId: target.fields[0].id
      },
      createId
    )

    expect(() => setBackendRelationOnDelete(application, relation.id, 'set-null')).toThrow(
      BackendDraftOperationError
    )
    setBackendRelationOnDelete(application, relation.id, 'cascade')
    expect(source.foreignKeys?.[0]?.onDelete).toBe('cascade')
    expect(() => setBackendFieldType(application, source, sourceField, 'string')).toThrow(
      BackendDraftOperationError
    )

    const replaced = replaceBackendRelation(
      application,
      relation.id,
      {
        kind: 'one-to-one',
        sourceEntityId: source.id,
        sourceFieldId: sourceField.id,
        targetEntityId: target.id,
        targetFieldId: target.fields[0].id
      },
      createId
    )
    const liveSource = application.dataModel.entities.find((entity) => entity.id === source.id)
    expect(replaced).toMatchObject({ id: relation.id, kind: 'one-to-one' })
    expect(liveSource?.foreignKeys).toHaveLength(1)
    expect(liveSource?.uniques?.some((unique) => unique.fields[0] === sourceField.id)).toBe(true)
    expect(parseBackendApplicationSpecV1(prepareBackendApplicationDraft(application)).ok).toBe(true)
  })

  test('keeps primary keys required and rejects nullable SET NULL regressions', () => {
    const application = createEmptyBackendApplication('visual-backend')
    const createId = sequentialIds()
    const entity = addBackendEntity(application, createId)
    const field = addBackendField(entity, createId)
    field.default = { kind: 'literal', value: null }

    setBackendFieldPrimary(entity, field.id, true)
    expect(field.nullable).toBe(false)
    expect(field.default).toBeUndefined()
    expect(() => setBackendFieldNullable(entity, field, true)).toThrow(BackendDraftOperationError)
  })

  test('rejects referenced entity, field, auth, tenant, and workflow removals', () => {
    const application = createEmptyBackendApplication('visual-backend')
    const createId = sequentialIds()
    const entity = addBackendEntity(application, createId)
    const owner = addBackendOwnership(application, entity.id, entity.fields[0].id, createId)
    const tenant = addBackendTenant(application, entity.id, entity.fields[0].id, createId)
    const row = addBackendRowAccess(application, entity.id, createId)
    row.principal = { kind: 'owner', ownershipId: owner.id }
    const bucket = addBackendStorageBucket(application, createId)
    const membership = addBackendEntity(application, createId)
    setBackendTenantMembershipEntity(application, tenant, membership.id)
    setBackendStoragePathRulePrincipal(application, bucket.pathRules[0], 'tenant-member', tenant.id)
    const targetWorkflow = addBackendWorkflow(application, createId)
    const caller = addBackendWorkflow(application, createId)
    addBackendWorkflowStep(application, caller, 'call', createId)

    expect(() => removeBackendEntity(application, entity.id)).toThrow(BackendDraftOperationError)
    expect(() => removeBackendField(application, entity.id, entity.fields[0].id)).toThrow(
      BackendDraftOperationError
    )
    expect(() => removeBackendOwnership(application, owner.id)).toThrow(BackendDraftOperationError)
    expect(() => removeBackendTenant(application, tenant.id)).toThrow(BackendDraftOperationError)
    expect(() => removeBackendWorkflow(application, targetWorkflow.id)).toThrow(
      BackendDraftOperationError
    )
  })

  test('rebinds owner, RLS, and workflow fields when their entity changes', () => {
    const application = createEmptyBackendApplication('visual-backend')
    const createId = sequentialIds()
    const first = addBackendEntity(application, createId)
    const second = addBackendEntity(application, createId)
    const owner = addBackendOwnership(application, first.id, first.fields[0].id, createId)
    const access = addBackendRowAccess(application, first.id, createId)
    access.principal = { kind: 'owner', ownershipId: owner.id }
    const workflow = addBackendWorkflow(application, createId)
    const read = addBackendWorkflowStep(application, workflow, 'data.read', createId)
    const mutate = addBackendWorkflowStep(application, workflow, 'data.mutate', createId)
    if (read.kind !== 'data.read' || mutate.kind !== 'data.mutate') {
      throw new Error('Expected data steps.')
    }
    read.fields = [first.fields[0].id]
    read.filters = [
      {
        field: first.fields[0].id,
        operator: 'eq',
        value: { kind: 'expression', expression: '$currentUser.id' }
      }
    ]

    expect(() => setBackendOwnershipEntity(application, owner, second.id)).toThrow(
      BackendDraftOperationError
    )
    setBackendRowAccessEntity(application, access, second.id)
    setBackendOwnershipEntity(application, owner, second.id)
    setBackendWorkflowStepEntity(application, read, second.id)
    setBackendWorkflowStepEntity(application, mutate, second.id)

    expect(owner).toMatchObject({ entityId: second.id, identityFieldId: second.fields[0].id })
    expect(access).toMatchObject({ entityId: second.id, principal: { kind: 'authenticated' } })
    expect(read.fields).toBeUndefined()
    expect(read.filters).toBeUndefined()
    expect(mutate.values?.[0]?.field).toBe(second.fields[0].id)
    expect(parseBackendApplicationSpecV1(prepareBackendApplicationDraft(application)).ok).toBe(true)
  })

  test('rejects duplicate mutation assignments and visual additions beyond contract limits', () => {
    const application = createEmptyBackendApplication('visual-backend')
    const createId = sequentialIds()
    const entity = addBackendEntity(application, createId)
    const secondField = addBackendField(entity, createId)
    const workflow = addBackendWorkflow(application, createId)
    const mutate = addBackendWorkflowStep(application, workflow, 'data.mutate', createId)
    if (mutate.kind !== 'data.mutate') throw new Error('Expected a mutation step.')
    mutate.values = [
      { field: entity.fields[0].id, value: { kind: 'expression', expression: '1' } },
      { field: secondField.id, value: { kind: 'expression', expression: '2' } }
    ]
    expect(() =>
      setBackendWorkflowMutationValueField(application, mutate, 1, entity.fields[0].id)
    ).toThrow(BackendDraftOperationError)

    application.dataModel.entities = Array.from(
      { length: BACKEND_LIMITS.maxEntities },
      (_, index) => ({
        id: `entity:limit-${index}`,
        name: `table_${index}`,
        management: 'managed' as const,
        fields: []
      })
    )
    expect(() => addBackendEntity(application, createId)).toThrow(BackendDraftOperationError)
    expect(application.dataModel.entities).toHaveLength(BACKEND_LIMITS.maxEntities)
  })
})
