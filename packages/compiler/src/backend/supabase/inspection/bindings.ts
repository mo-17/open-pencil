import type {
  SupabaseInspectionColumnV1,
  SupabaseInspectionConstraintV1,
  SupabaseInspectionDefaultPrivilegeV1,
  SupabaseInspectionIndexV1,
  SupabaseInspectionObjectV1,
  SupabaseInspectionPolicyV1,
  SupabaseInspectionPrivilegeV1,
  SupabaseInspectionRoleMembershipV1,
  SupabaseInspectionRoleV1
} from './contract'
import { objectKey, privilegeObjectKey } from './object-parser'
import { invalid } from './primitives'

function validateUnique<T>(values: readonly T[], key: (value: T) => string, path: string): void {
  const seen = new Set<string>()
  for (const value of values) {
    const identity = key(value)
    if (seen.has(identity)) invalid(path, `duplicate inventory identity ${identity}`)
    seen.add(identity)
  }
}

function validateRoleBindings(
  roles: readonly SupabaseInspectionRoleV1[],
  roleMemberships: readonly SupabaseInspectionRoleMembershipV1[],
  policies: readonly SupabaseInspectionPolicyV1[],
  privileges: readonly SupabaseInspectionPrivilegeV1[],
  defaultPrivileges: readonly SupabaseInspectionDefaultPrivilegeV1[]
): void {
  const roleNames = new Set(roles.map((entry) => entry.roleName))
  for (const membership of roleMemberships) {
    if (!roleNames.has(membership.roleName) || !roleNames.has(membership.memberName)) {
      invalid(
        '$.roleMemberships',
        `membership ${membership.memberName}->${membership.roleName} lacks complete role evidence`
      )
    }
  }

  const referencedGrantees = new Set<string>(['anon', 'authenticated'])
  for (const policy of policies) {
    for (const role of policy.roles) if (role !== 'PUBLIC') referencedGrantees.add(role)
  }
  for (const privilege of privileges) {
    if (privilege.grantee !== 'PUBLIC') referencedGrantees.add(privilege.grantee)
  }
  for (const privilege of defaultPrivileges) {
    if (privilege.grantee !== 'PUBLIC') referencedGrantees.add(privilege.grantee)
  }
  for (const grantee of referencedGrantees) {
    if (!roleNames.has(grantee)) {
      invalid('$.roles', `referenced grantee ${grantee} lacks complete role evidence`)
    }
  }
}

export function validateInventoryBindings(
  objects: readonly SupabaseInspectionObjectV1[],
  columns: readonly SupabaseInspectionColumnV1[],
  constraints: readonly SupabaseInspectionConstraintV1[],
  indexes: readonly SupabaseInspectionIndexV1[],
  roles: readonly SupabaseInspectionRoleV1[],
  roleMemberships: readonly SupabaseInspectionRoleMembershipV1[],
  policies: readonly SupabaseInspectionPolicyV1[],
  privileges: readonly SupabaseInspectionPrivilegeV1[],
  defaultPrivileges: readonly SupabaseInspectionDefaultPrivilegeV1[]
): void {
  const objectKeys = new Set(objects.map(objectKey))
  validateUnique(objects, objectKey, '$.objects')
  validateUnique(
    columns,
    (entry) => `${entry.schema}:${entry.tableName}:${entry.name}`,
    '$.columns'
  )
  validateUnique(
    columns.filter((entry) => entry.management === 'managed'),
    (entry) => `${entry.schema}:${entry.tableName}:${entry.openPencilFieldId ?? ''}`,
    '$.columns'
  )
  validateUnique(
    constraints,
    (entry) => `${entry.schema}:${entry.tableName}:${entry.name}`,
    '$.constraints'
  )
  validateUnique(
    constraints.filter((entry) => entry.management === 'managed'),
    (entry) => `${entry.schema}:${entry.tableName}:${entry.openPencilId ?? ''}`,
    '$.constraints'
  )
  validateUnique(
    indexes,
    (entry) => `${entry.schema}:${entry.tableName}:${entry.name}`,
    '$.indexes'
  )
  validateUnique(
    indexes.filter((entry) => entry.management === 'managed'),
    (entry) => `${entry.schema}:${entry.tableName}:${entry.openPencilId ?? ''}`,
    '$.indexes'
  )
  validateUnique(roles, (entry) => entry.roleName, '$.roles')
  validateUnique(
    roleMemberships,
    (entry) => `${entry.memberName}:${entry.roleName}:${entry.grantorName}`,
    '$.roleMemberships'
  )
  validateUnique(
    policies,
    (entry) => `${entry.schema}:${entry.tableName}:${entry.name}`,
    '$.policies'
  )
  validateUnique(
    privileges,
    (entry) => `${privilegeObjectKey(entry)}:${entry.grantor}:${entry.grantee}:${entry.privilege}`,
    '$.privileges'
  )
  validateUnique(
    defaultPrivileges,
    (entry) =>
      `${entry.schema}:${entry.objectKind}:${entry.grantor}:${entry.grantee}:${entry.privilege}`,
    '$.defaultPrivileges'
  )
  validateRoleBindings(roles, roleMemberships, policies, privileges, defaultPrivileges)

  for (const policy of policies) {
    if (!objectKeys.has(`table:${policy.schema}:${policy.tableName}`)) {
      invalid('$.policies', `policy ${policy.name} references an uninspected table`)
    }
  }
  for (const privilege of privileges) {
    if (privilege.objectKind !== 'schema' && !objectKeys.has(privilegeObjectKey(privilege))) {
      invalid('$.privileges', 'privilege references an uninspected object')
    }
  }
  for (const column of columns) {
    if (!objectKeys.has(`table:${column.schema}:${column.tableName}`)) {
      invalid('$.columns', `column ${column.name} references an uninspected table`)
    }
  }
  for (const constraint of constraints) {
    if (!objectKeys.has(`table:${constraint.schema}:${constraint.tableName}`)) {
      invalid('$.constraints', `constraint ${constraint.name} references an uninspected table`)
    }
    if (
      constraint.kind === 'foreign-key' &&
      !objectKeys.has(`table:${constraint.schema}:${constraint.targetTableName}`)
    ) {
      invalid('$.constraints', `foreign key ${constraint.name} references an uninspected table`)
    }
  }
  for (const index of indexes) {
    if (!objectKeys.has(`table:${index.schema}:${index.tableName}`)) {
      invalid('$.indexes', `index ${index.name} references an uninspected table`)
    }
  }
}
