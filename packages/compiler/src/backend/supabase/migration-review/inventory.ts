import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import type { SupabaseInspectedMigrationSnapshotV1 } from '../inspection'
import { addBlocker } from './common'
import type { SupabaseMigrationReviewBlockerV1 } from './contract'

const SUPABASE_PUBLIC_SCHEMA_USAGE_BASELINE_GRANTEES = new Set([
  'PUBLIC',
  'anon',
  'authenticated',
  'postgres',
  'service_role'
])

/**
 * Supabase exposes the public schema through a non-grantable USAGE baseline. The exact inspection
 * role also needs non-grantable CREATE authority to create reviewed objects in that schema. These
 * schema ACLs are existing Provider authority, not application runtime grants; relation, routine,
 * default ACL, and grant-option authority remain fully inspected below.
 */
function isSafePublicSchemaPrivilegeBaseline(
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  privilege: SupabaseInspectedMigrationSnapshotV1['privileges'][number]
): boolean {
  if (
    privilege.objectKind !== 'schema' ||
    privilege.isGrantable ||
    privilege.source === 'third-party'
  ) {
    return false
  }
  if (privilege.privilege === 'CREATE') {
    return privilege.source === 'unknown' && privilege.grantee === snapshot.provenance.databaseRole
  }
  return (
    privilege.privilege === 'USAGE' &&
    (SUPABASE_PUBLIC_SCHEMA_USAGE_BASELINE_GRANTEES.has(privilege.grantee) ||
      privilege.grantee === snapshot.provenance.databaseRole)
  )
}

function referencedRuntimeRoles(snapshot: SupabaseInspectedMigrationSnapshotV1): Set<string> {
  const roles = new Set<string>(['anon', 'authenticated'])
  for (const policy of snapshot.policies) {
    for (const role of policy.roles) if (role !== 'PUBLIC') roles.add(role)
  }
  for (const privilege of snapshot.privileges) {
    if (isSafePublicSchemaPrivilegeBaseline(snapshot, privilege)) continue
    if (privilege.grantee !== 'PUBLIC') roles.add(privilege.grantee)
  }
  for (const privilege of snapshot.defaultPrivileges) {
    if (privilege.grantee !== 'PUBLIC') roles.add(privilege.grantee)
  }
  return roles
}

function roleAuthorityBlockers(
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  blockers: SupabaseMigrationReviewBlockerV1[]
): void {
  const rolesByName = new Map(snapshot.roles.map((role) => [role.roleName, role]))
  const membershipsByMember = new Map<string, (typeof snapshot.roleMemberships)[number][]>()
  for (const membership of snapshot.roleMemberships) {
    const memberships = membershipsByMember.get(membership.memberName) ?? []
    memberships.push(membership)
    membershipsByMember.set(membership.memberName, memberships)
  }

  const reachable = referencedRuntimeRoles(snapshot)
  const pending = [...reachable].sort()
  for (const roleName of pending) {
    const role = rolesByName.get(roleName)
    if (role?.superuser) {
      addBlocker(
        blockers,
        'supabase-superuser-runtime-role-blocked',
        `$.snapshot.roles.${roleName}`,
        'A referenced runtime grantee has PostgreSQL superuser authority.'
      )
    }
    if (role?.bypassRls) {
      addBlocker(
        blockers,
        'supabase-bypassrls-runtime-role-blocked',
        `$.snapshot.roles.${roleName}`,
        'A referenced runtime grantee can bypass every row-level security policy.'
      )
    }

    for (const membership of membershipsByMember.get(roleName) ?? []) {
      addBlocker(
        blockers,
        'supabase-runtime-role-membership-blocked',
        `$.snapshot.roleMemberships.${membership.memberName}:${membership.roleName}:${membership.grantorName}`,
        'Direct or transitive external role membership cannot be changed or relied upon by reviewed SQL.'
      )
      if (!reachable.has(membership.roleName)) {
        reachable.add(membership.roleName)
        pending.push(membership.roleName)
      }
    }
  }
}

function objectAuthorityBlockers(
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  blockers: SupabaseMigrationReviewBlockerV1[]
): void {
  for (const object of snapshot.objects) {
    if (
      object.kind === 'table' &&
      object.management === 'managed' &&
      (!object.rlsEnabled || !object.rlsForced)
    ) {
      addBlocker(
        blockers,
        'supabase-managed-table-rls-drift-blocked',
        `$.snapshot.objects.${object.name}`,
        'Managed public tables must retain enabled and forced row-level security.'
      )
    }
    if (object.kind === 'view' && !object.securityInvoker) {
      addBlocker(
        blockers,
        'supabase-public-security-definer-view-blocked',
        `$.snapshot.objects.${object.name}`,
        'Public-schema views must provide inspected security_invoker evidence before release review.'
      )
    }
    if (object.kind === 'function' && object.securityDefiner) {
      addBlocker(
        blockers,
        'supabase-public-security-definer-function-blocked',
        `$.snapshot.objects.${object.name}`,
        'Public-schema SECURITY DEFINER functions require separate trusted review.'
      )
    }
  }
}

export function inventoryBlockers(
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  blockers: SupabaseMigrationReviewBlockerV1[]
): void {
  roleAuthorityBlockers(snapshot, blockers)
  objectAuthorityBlockers(snapshot, blockers)
  for (const policy of snapshot.policies) {
    if (policy.roles.includes('PUBLIC')) {
      addBlocker(
        blockers,
        'supabase-public-policy-role-blocked',
        `$.snapshot.policies.${policy.name}`,
        'PUBLIC policy roles are not accepted for inspected migration authority.'
      )
    }
    if (policy.mode === 'permissive' && policy.source !== 'openpencil') {
      addBlocker(
        blockers,
        'supabase-unknown-permissive-policy-blocked',
        `$.snapshot.policies.${policy.name}`,
        'Unknown or third-party permissive policy can widen a future table grant.'
      )
    }
    if (
      policy.mode === 'permissive' &&
      policy.source !== 'openpencil' &&
      policy.usingExpressionDigest === null &&
      policy.withCheckExpressionDigest === null
    ) {
      addBlocker(
        blockers,
        'supabase-broad-live-policy-blocked',
        `$.snapshot.policies.${policy.name}`,
        'Predicate-free permissive policy cannot be bound to a least-privilege review.'
      )
    }
  }
  for (const privilege of snapshot.privileges) {
    if (isSafePublicSchemaPrivilegeBaseline(snapshot, privilege)) continue
    if (privilege.isGrantable) {
      addBlocker(
        blockers,
        'supabase-privilege-grant-option-blocked',
        `$.snapshot.privileges.${privilege.objectKind}:${privilege.objectName}:${privilege.grantee}`,
        'A grant option can delegate ACL authority and is never repaired or relied upon by reviewed SQL.'
      )
    }
    if (privilege.grantee === 'PUBLIC') {
      addBlocker(
        blockers,
        'supabase-public-acl-blocked',
        `$.snapshot.privileges.${privilege.objectKind}:${privilege.objectName}`,
        'PUBLIC ACL must be reconciled before producing review SQL.'
      )
    }
    if (privilege.source === 'third-party') {
      addBlocker(
        blockers,
        'supabase-third-party-acl-blocked',
        `$.snapshot.privileges.${privilege.objectKind}:${privilege.objectName}:${privilege.grantee}`,
        'Explicitly third-party ACL cannot be changed or relied upon.'
      )
    }
    if (!['anon', 'authenticated'].includes(privilege.grantee)) {
      addBlocker(
        blockers,
        'supabase-privileged-grantee-blocked',
        `$.snapshot.privileges.${privilege.grantee}`,
        'Only exact anon/authenticated runtime grants are in scope; service_role and admin roles are forbidden.'
      )
    }
  }
  for (const privilege of snapshot.defaultPrivileges) {
    if (!privilege.isGrantable) continue
    addBlocker(
      blockers,
      'supabase-default-privilege-grant-option-blocked',
      `$.snapshot.defaultPrivileges.${privilege.objectKind}:${privilege.grantee}`,
      'A default grant option can delegate future ACL authority and is never repaired by reviewed SQL.'
    )
  }
  if (snapshot.defaultPrivileges.length > 0) {
    addBlocker(
      blockers,
      'supabase-default-privileges-blocked',
      '$.snapshot.defaultPrivileges',
      'Default privileges are never inferred or modified by reviewed SQL.'
    )
  }
}

export function foreignKeyIndexBlockers(
  application: BackendApplicationSpecV1,
  blockers: SupabaseMigrationReviewBlockerV1[]
): void {
  for (const entity of application.dataModel.entities) {
    for (const foreignKey of entity.foreignKeys ?? []) {
      const indexed = (entity.indexes ?? []).some(
        (index) =>
          index.fields.length >= foreignKey.fields.length &&
          foreignKey.fields.every((field, position) => index.fields[position] === field)
      )
      if (!indexed) {
        addBlocker(
          blockers,
          'supabase-foreign-key-index-review-required',
          `$.targetModel.entities.${entity.id}.foreignKeys.${foreignKey.id}`,
          'Foreign key fields lack an explicit leading index; the compiler will not invent one.'
        )
      }
    }
  }
}
