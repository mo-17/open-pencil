import type {
  AuthRowAccessIntentIR,
  BackendApplicationSpecV1,
  BackendDiagnostic,
  DataEntityIR,
  DataFieldIR
} from '@open-pencil/lowcode/backend'

import { validateNestJSApplication } from '../validation'

export const PRISMA_CRM_CUSTOMER_ENTITY_ID = 'business-customers'
export const PRISMA_CRM_MANAGER_ROLE = 'crm-manager'
export const PRISMA_CRM_CUSTOMER_FIELDS = Object.freeze([
  'assignee_id',
  'assignee_subject',
  'closed',
  'company',
  'created_at',
  'description',
  'email',
  'id',
  'phone',
  'stage',
  'title',
  'version'
] as const)

const MODEL_NAMES: Readonly<Record<string, string>> = Object.freeze({
  'business-customers': 'customers',
  'business-customer-history': 'customer_history',
  'business-users': 'users'
})
const STAGES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost']
const COMMON_FIELDS: Readonly<Record<string, DataFieldIR['type']>> = {
  id: 'uuid',
  owner_id: 'uuid',
  created_at: 'datetime'
}
const MODEL_FIELDS: Readonly<
  Record<string, Readonly<Record<string, DataFieldIR['type']>> | undefined>
> = {
  'business-customers': {
    ...COMMON_FIELDS,
    assignee_id: 'uuid',
    assignee_subject: 'uuid',
    closed: 'boolean',
    company: 'string',
    description: 'string',
    email: 'string',
    phone: 'string',
    stage: 'enum',
    title: 'string',
    version: 'integer'
  },
  'business-customer-history': {
    ...COMMON_FIELDS,
    action: 'string',
    actor_subject: 'uuid',
    after_stage: 'enum',
    before_stage: 'enum',
    customer_id: 'uuid',
    note: 'string'
  },
  'business-users': { ...COMMON_FIELDS, active: 'boolean', title: 'string' }
}

function sameSet(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  return (
    actual !== undefined &&
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    expected.every((entry) => actual.includes(entry))
  )
}

function sameOrder(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  return actual?.length === expected.length && expected.every((entry, i) => actual[i] === entry)
}

function validDefault(field: DataFieldIR): boolean {
  const value = field.default
  if (field.id === 'id') return value?.kind === 'generated' && value.generator === 'uuid'
  if (field.id === 'created_at')
    return value?.kind === 'generated' && value.generator === 'created-at'
  if (field.type === 'enum') return value?.kind === 'literal' && value.value === 'new'
  if (field.id === 'active') return value?.kind === 'literal' && value.value === true
  if (field.id === 'closed') return value?.kind === 'literal' && value.value === false
  if (field.id === 'version') return value?.kind === 'literal' && value.value === 0
  return value === undefined
}

function validFields(entity: DataEntityIR): boolean {
  const expected = MODEL_FIELDS[entity.id]
  return (
    expected !== undefined &&
    sameSet(
      entity.fields.map((field) => field.id),
      Object.keys(expected)
    ) &&
    entity.fields.every(
      (field) =>
        field.name === field.id &&
        field.type === expected[field.id] &&
        !field.nullable &&
        field.enumId === (field.type === 'enum' ? 'customer-stage' : undefined) &&
        validDefault(field)
    )
  )
}

function validConstraints(entity: DataEntityIR): boolean {
  const uniques = entity.uniques ?? []
  const ownerKey = uniques.filter((entry) => sameOrder(entry.fields, ['id', 'owner_id']))
  const accountKey = uniques.filter((entry) => sameOrder(entry.fields, ['owner_id']))
  const users = entity.id === 'business-users'
  if (
    !sameOrder(entity.primaryKey?.fields, ['id']) ||
    uniques.length !== (users ? 2 : 1) ||
    ownerKey.length !== 1 ||
    accountKey.length !== (users ? 1 : 0)
  )
    return false
  const foreignKeys = entity.foreignKeys ?? []
  if (entity.id !== 'business-customer-history') return foreignKeys.length === 0
  const reference = foreignKeys[0]
  return (
    foreignKeys.length === 1 &&
    reference.targetEntityId === PRISMA_CRM_CUSTOMER_ENTITY_ID &&
    sameOrder(reference.fields, ['customer_id', 'owner_id']) &&
    sameOrder(reference.targetFields, ['id', 'owner_id']) &&
    reference.onDelete === 'restrict'
  )
}

function validCustomerPolicy(policy: AuthRowAccessIntentIR): 'assignee' | 'manager' | undefined {
  if (
    policy.effect !== 'allow' ||
    !sameOrder(policy.operations, ['select']) ||
    policy.conditions !== undefined
  )
    return undefined
  const principal = policy.principal
  if (principal.kind === 'role' && principal.roleId === PRISMA_CRM_MANAGER_ROLE) return 'manager'
  if (
    principal.kind === 'related-member' &&
    principal.entityFieldId === 'id' &&
    principal.membershipEntityId === PRISMA_CRM_CUSTOMER_ENTITY_ID &&
    principal.membershipFieldId === 'id' &&
    principal.identityFieldId === 'assignee_subject' &&
    principal.conditions === undefined &&
    principal.roleId === undefined
  )
    return 'assignee'
  return undefined
}

function prismaCRMDiagnostic(path: string, message: string): BackendDiagnostic {
  return { code: 'backend-prisma-crm-unsupported', severity: 'error', path, message }
}

function modelDiagnostics(application: BackendApplicationSpecV1): BackendDiagnostic[] {
  const diagnostics: BackendDiagnostic[] = []
  const reject = (path: string, message: string) =>
    diagnostics.push(prismaCRMDiagnostic(path, message))
  if (
    !sameSet(
      application.dataModel.entities.map((entity) => entity.id),
      Object.keys(MODEL_NAMES)
    ) ||
    application.dataModel.relations.length
  )
    reject(
      '$.application.dataModel',
      'Prisma CRM requires exactly the customers, customer_history and users entities without additional relation declarations.'
    )
  const stage = application.dataModel.enums[0]
  if (
    application.dataModel.enums.length !== 1 ||
    stage.id !== 'customer-stage' ||
    stage.name !== 'customer_stage' ||
    !sameOrder(stage.values, STAGES)
  )
    reject(
      '$.application.dataModel.enums',
      'Prisma CRM requires the reviewed customer_stage labels and database ordering.'
    )
  for (const [index, entity] of application.dataModel.entities.entries()) {
    if (
      entity.management !== 'managed' ||
      entity.name !== MODEL_NAMES[entity.id] ||
      !validFields(entity) ||
      !validConstraints(entity)
    )
      reject(
        '$.application.dataModel.entities[' + index + ']',
        'Prisma CRM requires the reviewed table names, field types, defaults, nullability, primary keys, unique keys and owner-bound history reference. Secondary indexes remain SQL-owned.'
      )
    const owners = application.auth.ownership.filter((owner) => owner.entityId === entity.id)
    if (owners.length !== 1 || owners[0].identityFieldId !== 'owner_id')
      reject(
        '$.application.auth.ownership',
        'Prisma CRM requires one owner_id identity mapping for every entity.'
      )
  }
  return diagnostics
}

function customerDiagnostics(application: BackendApplicationSpecV1): BackendDiagnostic[] {
  const diagnostics: BackendDiagnostic[] = []
  const reject = (path: string, message: string) =>
    diagnostics.push(prismaCRMDiagnostic(path, message))
  const policies = application.auth.rowAccess.filter(
    (policy) => policy.entityId === PRISMA_CRM_CUSTOMER_ENTITY_ID
  )
  if (
    policies.length !== 2 ||
    !sameSet(
      policies.map((policy) => validCustomerPolicy(policy) ?? 'unsupported'),
      ['assignee', 'manager']
    )
  )
    reject(
      '$.application.auth.rowAccess',
      'Prisma customer reads require exactly the unconditional current-assignee and crm-manager select grants; additional, conditional, owner or public grants are unsupported.'
    )
  const resources =
    application.httpApi?.resources.filter(
      (resource) => resource.entityId === PRISMA_CRM_CUSTOMER_ENTITY_ID
    ) ?? []
  const customer = resources[0]
  if (
    resources.length !== 1 ||
    customer.id !== 'customers' ||
    !sameSet(customer.operations, ['list', 'read']) ||
    !sameSet(customer.readFields, PRISMA_CRM_CUSTOMER_FIELDS) ||
    !sameSet(
      customer.readPolicyIds,
      policies.map((policy) => policy.id)
    ) ||
    customer.createFields !== undefined ||
    customer.updateFields !== undefined ||
    !sameSet(customer.query?.filterFields, ['stage', 'closed', 'assignee_id']) ||
    !sameSet(customer.query?.searchFields, ['title', 'company']) ||
    !sameSet(customer.query?.sortFields, ['created_at'])
  )
    reject(
      '$.application.httpApi.resources',
      'Prisma CRM requires one customers list/read resource with the reviewed public projection, both customer policies, and stage/closed/assignee filters, title/company search and created_at ordering.'
    )
  return diagnostics
}

/** A deliberately closed query profile: every accepted deviation is still represented by SQL. */
export function validatePrismaCRMApplication(
  application: BackendApplicationSpecV1
): BackendDiagnostic[] {
  const diagnostics = [
    ...validateNestJSApplication(application),
    ...modelDiagnostics(application),
    ...customerDiagnostics(application)
  ]
  if (
    application.modules !== undefined ||
    application.commerce !== undefined ||
    application.foodOrdering !== undefined ||
    application.auth.tenants.length
  )
    diagnostics.push(
      prismaCRMDiagnostic(
        '$.application',
        'Prisma CRM supports the standalone CRM model without modules, commerce, food ordering or tenant partitions.'
      )
    )
  return diagnostics
}
