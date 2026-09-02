import { canonicalBackendValue } from '#compiler/backend/canonical'

import { BACKEND_LIMITS, validateDataModelIR } from '@open-pencil/lowcode/backend'

import { validateInventoryBindings } from './bindings'
import type { CreateSupabaseInspectedMigrationSnapshotInputV1 } from './contract'
import { deriveSupabaseManagedDataModel } from './managed-model'
import {
  objectKey,
  parseColumn,
  parseCoverage,
  parseInspectionRole,
  parseObject,
  parsePolicy,
  parsePrivilege,
  parseProvenance,
  parseRoleMembership,
  privilegeObjectKey
} from './object-parser'
import { array, exactRecord, invalid } from './primitives'
import { parseConstraint, parseDefaultPrivilege, parseIndex } from './structure-parser'

const MAX_OBJECTS = BACKEND_LIMITS.maxEntities * 4
const MAX_PRIVILEGES = BACKEND_LIMITS.maxMigrationOperations

function compareTableMembers(
  left: { readonly schema: string; readonly tableName: string; readonly name: string },
  right: { readonly schema: string; readonly tableName: string; readonly name: string }
): number {
  return `${left.schema}:${left.tableName}:${left.name}`.localeCompare(
    `${right.schema}:${right.tableName}:${right.name}`,
    'en'
  )
}

export function normalizeSupabaseInspectionInput(
  value: unknown
): CreateSupabaseInspectedMigrationSnapshotInputV1 {
  const canonical = canonicalBackendValue(value, '$.supabaseInspectionInput')
  const source = exactRecord(canonical, '$', [
    'provenance',
    'currentModel',
    'coverage',
    'objects',
    'columns',
    'constraints',
    'indexes',
    'roles',
    'roleMemberships',
    'policies',
    'privileges',
    'defaultPrivileges'
  ])
  const parsedModel = validateDataModelIR(source.currentModel)
  if (!parsedModel.ok) {
    invalid(
      '$.currentModel',
      `invalid DataModelIR (${parsedModel.diagnostics.map((entry) => entry.code).join(', ')})`
    )
  }
  const provenance = parseProvenance(source.provenance)
  const coverage = parseCoverage(source.coverage)
  const objects = array(source.objects, '$.objects', MAX_OBJECTS)
    .map(parseObject)
    .sort((left, right) => objectKey(left).localeCompare(objectKey(right), 'en'))
  const policies = array(source.policies, '$.policies', BACKEND_LIMITS.maxPolicies)
    .map(parsePolicy)
    .sort(compareTableMembers)
  const roles = array(source.roles, '$.roles', MAX_PRIVILEGES)
    .map(parseInspectionRole)
    .sort((left, right) => left.roleName.localeCompare(right.roleName, 'en'))
  if (!roles.some((role) => role.roleName === provenance.databaseRole)) {
    invalid('$.provenance.databaseRole', 'inspection database role lacks complete role evidence')
  }
  const roleMemberships = array(source.roleMemberships, '$.roleMemberships', MAX_PRIVILEGES)
    .map(parseRoleMembership)
    .sort((left, right) =>
      `${left.memberName}:${left.roleName}:${left.grantorName}`.localeCompare(
        `${right.memberName}:${right.roleName}:${right.grantorName}`,
        'en'
      )
    )
  const columns = array(source.columns, '$.columns', BACKEND_LIMITS.maxNodes)
    .map(parseColumn)
    .sort(compareTableMembers)
  const constraints = array(
    source.constraints,
    '$.constraints',
    BACKEND_LIMITS.maxMigrationOperations
  )
    .map(parseConstraint)
    .sort(compareTableMembers)
  const indexes = array(source.indexes, '$.indexes', BACKEND_LIMITS.maxMigrationOperations)
    .map(parseIndex)
    .sort(compareTableMembers)
  const derivedModel = deriveSupabaseManagedDataModel({ objects, columns, constraints, indexes })
  const normalizedDerivedModel = validateDataModelIR(derivedModel)
  if (!normalizedDerivedModel.ok) {
    invalid('$.currentModel', 'managed catalog evidence does not form a valid DataModelIR')
  }
  if (
    JSON.stringify(canonicalBackendValue(parsedModel.value, '$.currentModel')) !==
    JSON.stringify(canonicalBackendValue(normalizedDerivedModel.value, '$.derivedCurrentModel'))
  ) {
    invalid(
      '$.currentModel',
      'current model must exactly match the address-validated managed catalog markers'
    )
  }
  const privileges = array(source.privileges, '$.privileges', MAX_PRIVILEGES)
    .map(parsePrivilege)
    .sort((left, right) =>
      `${privilegeObjectKey(left)}:${left.grantor}:${left.grantee}:${left.privilege}:${String(left.isGrantable)}:${left.source}`.localeCompare(
        `${privilegeObjectKey(right)}:${right.grantor}:${right.grantee}:${right.privilege}:${String(right.isGrantable)}:${right.source}`,
        'en'
      )
    )
  const defaultPrivileges = array(source.defaultPrivileges, '$.defaultPrivileges', MAX_PRIVILEGES)
    .map(parseDefaultPrivilege)
    .sort((left, right) =>
      `${left.schema}:${left.objectKind}:${left.grantor}:${left.grantee}:${left.privilege}:${String(left.isGrantable)}:${left.source}`.localeCompare(
        `${right.schema}:${right.objectKind}:${right.grantor}:${right.grantee}:${right.privilege}:${String(right.isGrantable)}:${right.source}`,
        'en'
      )
    )
  validateInventoryBindings(
    objects,
    columns,
    constraints,
    indexes,
    roles,
    roleMemberships,
    policies,
    privileges,
    defaultPrivileges
  )
  return {
    provenance,
    currentModel: parsedModel.value,
    coverage,
    objects,
    columns,
    constraints,
    indexes,
    roles,
    roleMemberships,
    policies,
    privileges,
    defaultPrivileges
  }
}
