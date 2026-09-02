import type {
  AuthAccessOperation,
  BackendApplicationSpecV1,
  DataEntityIR,
  MigrationPlan
} from '@open-pencil/lowcode/backend'

import type { SupabaseInspectedMigrationSnapshotV1 } from '../inspection'
import { formatSupabaseManagedMarker } from '../inspection'
import { isSupabaseAllowPolicyEmittable, requiredSupabasePolicyOperations } from '../policy'
import {
  supabaseAllowPolicyPredicate,
  supabasePolicyOperationClause,
  supabasePolicyTargetRole,
  visitSupabaseWorkflowSteps
} from '../policy-helpers'
import { addBlocker, qualified, quoteIdentifier, quoteLiteral, stableSQLName } from './common'
import type {
  SupabaseMigrationReviewBlockerV1,
  SupabasePrivilegeReviewOperationV1,
  SupabaseTablePrivilegeReviewOperationV1
} from './contract'

const OPERATION_ORDER: readonly AuthAccessOperation[] = ['select', 'insert', 'update', 'delete']
const TABLE_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const

function requiredOperations(
  application: BackendApplicationSpecV1
): ReadonlyMap<string, ReadonlySet<AuthAccessOperation>> {
  const result = new Map<string, Set<AuthAccessOperation>>()
  for (const workflow of application.workflows.workflows) {
    visitSupabaseWorkflowSteps(workflow.steps, (step) => {
      if (step.kind !== 'data.read' && step.kind !== 'data.mutate') return
      let operations = result.get(step.entityId)
      if (!operations) {
        operations = new Set<AuthAccessOperation>()
        result.set(step.entityId, operations)
      }
      for (const operation of requiredSupabasePolicyOperations(step)) operations.add(operation)
    })
  }
  return result
}

function privilegeFor(operation: AuthAccessOperation): (typeof TABLE_PRIVILEGES)[number] {
  return operation.toUpperCase() as (typeof TABLE_PRIVILEGES)[number]
}

type SupabaseRuntimeRole = 'anon' | 'authenticated'
type SupabasePolicyIntent = BackendApplicationSpecV1['auth']['rowAccess'][number]

function reviewedWorkflowEntity(
  application: BackendApplicationSpecV1,
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  createdEntityIds: ReadonlySet<string>,
  entityId: string,
  required: ReadonlySet<AuthAccessOperation>,
  blockers: SupabaseMigrationReviewBlockerV1[]
): DataEntityIR | null {
  const entity = application.dataModel.entities.find((entry) => entry.id === entityId)
  if (!entity) return null
  if (entity.management !== 'managed') {
    addBlocker(
      blockers,
      'supabase-external-workflow-grant-blocked',
      `$.targetModel.entities.${entityId}`,
      'External entities are inspect-only and cannot receive generated grants.'
    )
    return null
  }
  const liveTable = snapshot.objects.find(
    (object) => object.kind === 'table' && object.name === entity.name
  )
  if (
    !createdEntityIds.has(entity.id) &&
    (liveTable?.kind !== 'table' ||
      liveTable.management !== 'managed' ||
      liveTable.openPencilId !== entity.id)
  ) {
    addBlocker(
      blockers,
      'supabase-live-table-binding-required',
      `$.snapshot.objects.${entity.name}`,
      'Existing table lacks an exact managed live identity binding.'
    )
    return null
  }
  if (
    required.has('insert') &&
    entity.fields.some(
      (field) => field.default?.kind === 'generated' && field.default.generator === 'identity'
    )
  ) {
    addBlocker(
      blockers,
      'supabase-sequence-grant-review-required',
      `$.targetModel.entities.${entity.id}`,
      'Identity-backed inserts require an exact inspected sequence grant review.'
    )
  }
  return entity
}

function sortedEntityIntents(
  application: BackendApplicationSpecV1,
  entityId: string
): readonly SupabasePolicyIntent[] {
  return application.auth.rowAccess
    .filter((entry) => entry.entityId === entityId)
    .sort((left, right) => left.id.localeCompare(right.id, 'en'))
}

function allowPolicyCoverage(
  application: BackendApplicationSpecV1,
  intents: readonly SupabasePolicyIntent[]
): ReadonlyMap<SupabaseRuntimeRole, ReadonlySet<AuthAccessOperation>> {
  const coverage = new Map<SupabaseRuntimeRole, Set<AuthAccessOperation>>()
  for (const intent of intents) {
    if (!isSupabaseAllowPolicyEmittable(application, intent)) continue
    const role = supabasePolicyTargetRole(intent.principal)
    const operations = coverage.get(role) ?? new Set<AuthAccessOperation>()
    for (const operation of intent.operations) operations.add(operation)
    coverage.set(role, operations)
  }
  return coverage
}

function addPolicyCoverageBlockers(
  entity: DataEntityIR,
  required: ReadonlySet<AuthAccessOperation>,
  coverage: ReadonlyMap<SupabaseRuntimeRole, ReadonlySet<AuthAccessOperation>>,
  blockers: SupabaseMigrationReviewBlockerV1[]
): void {
  for (const operation of OPERATION_ORDER.filter((entry) => required.has(entry))) {
    if ([...coverage.values()].some((operations) => operations.has(operation))) continue
    addBlocker(
      blockers,
      'supabase-grant-policy-coverage-required',
      `$.targetModel.entities.${entity.id}.${operation}`,
      'Workflow data access lacks an executable allow policy for every granted operation.'
    )
  }
}

function desiredTablePrivileges(
  entity: DataEntityIR,
  required: ReadonlySet<AuthAccessOperation>,
  coverage: ReadonlyMap<SupabaseRuntimeRole, ReadonlySet<AuthAccessOperation>>
): readonly SupabaseTablePrivilegeReviewOperationV1[] {
  const desired: SupabaseTablePrivilegeReviewOperationV1[] = []
  for (const role of ['anon', 'authenticated'] as const) {
    const privileges = OPERATION_ORDER.filter(
      (operation) => required.has(operation) && coverage.get(role)?.has(operation)
    ).map(privilegeFor)
    if (privileges.length === 0) continue
    desired.push({
      id: stableSQLName('priv', `${entity.id}:${role}:${privileges.join(',')}`),
      kind: 'grant-table',
      schema: 'public',
      tableName: entity.name,
      grantee: role,
      privileges
    })
  }
  return desired
}

function reviewedIntentPredicate(
  application: BackendApplicationSpecV1,
  entity: DataEntityIR,
  intent: SupabasePolicyIntent,
  blockers: SupabaseMigrationReviewBlockerV1[]
): string | undefined {
  if (intent.effect !== 'deny') {
    return isSupabaseAllowPolicyEmittable(application, intent)
      ? supabaseAllowPolicyPredicate(application, entity, intent.principal)
      : undefined
  }
  if (intent.principal.kind === 'anonymous' || intent.principal.kind === 'authenticated') {
    return 'false'
  }
  addBlocker(
    blockers,
    'supabase-conditional-deny-policy-blocked',
    `$.targetModel.auth.rowAccess.${intent.id}`,
    'Conditional deny intent requires a separately reviewed restrictive translation.'
  )
  return undefined
}

function renderIntentPolicies(
  application: BackendApplicationSpecV1,
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  entity: DataEntityIR,
  required: ReadonlySet<AuthAccessOperation>,
  intents: readonly SupabasePolicyIntent[],
  blockers: SupabaseMigrationReviewBlockerV1[],
  desiredPolicyNames: Set<string>
): readonly string[] {
  const statements: string[] = []
  for (const intent of intents) {
    const relevant = OPERATION_ORDER.filter(
      (operation) => required.has(operation) && intent.operations.includes(operation)
    )
    if (relevant.length === 0) continue
    const predicate = reviewedIntentPredicate(application, entity, intent, blockers)
    if (!predicate) {
      addBlocker(
        blockers,
        'supabase-policy-predicate-binding-required',
        `$.targetModel.auth.rowAccess.${intent.id}`,
        'Policy predicate could not be derived from exact normalized references.'
      )
      continue
    }
    for (const operation of relevant) {
      const policyName = stableSQLName(
        'openpencil_policy',
        `${entity.id}:${intent.id}:${intent.effect}:${operation}`
      )
      desiredPolicyNames.add(policyName)
      const existingPolicy = snapshot.policies.find(
        (policy) => policy.tableName === entity.name && policy.name === policyName
      )
      if (existingPolicy?.source === 'openpencil') {
        statements.push(`DROP POLICY ${quoteIdentifier(policyName)} ON ${qualified(entity.name)};`)
      } else if (existingPolicy) {
        addBlocker(
          blockers,
          'supabase-policy-name-collision-blocked',
          `$.snapshot.policies.${entity.name}:${policyName}`,
          'A non-managed policy occupies the deterministic target policy name.'
        )
      }
      statements.push(
        `CREATE POLICY ${quoteIdentifier(policyName)} ON ${qualified(entity.name)} AS ${intent.effect === 'deny' ? 'RESTRICTIVE' : 'PERMISSIVE'} FOR ${operation.toUpperCase()} TO ${quoteIdentifier(supabasePolicyTargetRole(intent.principal))} ${supabasePolicyOperationClause(operation, predicate)};`
      )
      statements.push(
        `COMMENT ON POLICY ${quoteIdentifier(policyName)} ON ${qualified(entity.name)} IS ${quoteLiteral(formatSupabaseManagedMarker('policy', policyName))};`
      )
    }
  }
  return statements
}

function addStaleManagedPolicyBlockers(
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  desiredPolicyNames: ReadonlySet<string>,
  blockers: SupabaseMigrationReviewBlockerV1[]
): void {
  for (const policy of snapshot.policies) {
    if (policy.source !== 'openpencil' || desiredPolicyNames.has(policy.name)) continue
    addBlocker(
      blockers,
      'supabase-stale-managed-policy-review-required',
      `$.snapshot.policies.${policy.tableName}:${policy.name}`,
      'An existing managed policy is outside the exact target set; implicit removal is forbidden.'
    )
  }
}

function addStaleManagedGrantBlockers(
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  desired: readonly SupabaseTablePrivilegeReviewOperationV1[],
  blockers: SupabaseMigrationReviewBlockerV1[]
): void {
  const desiredKeys = new Set(
    desired.flatMap((entry) =>
      entry.privileges.map(
        (privilege) => `table:public:${entry.tableName}:${entry.grantee}:${privilege}`
      )
    )
  )
  for (const role of new Set(desired.map((entry) => entry.grantee))) {
    desiredKeys.add(`schema:public:public:${role}:USAGE`)
  }
  for (const privilege of snapshot.privileges) {
    if (
      privilege.objectKind === 'schema' &&
      privilege.privilege === 'USAGE' &&
      !privilege.isGrantable
    ) {
      continue
    }
    const key = `${privilege.objectKind}:${privilege.schema}:${privilege.objectName}:${privilege.grantee}:${privilege.privilege}`
    if (privilege.source === 'third-party' || desiredKeys.has(key)) continue
    if (!['anon', 'authenticated'].includes(privilege.grantee)) continue
    addBlocker(
      blockers,
      'supabase-stale-managed-grant-review-required',
      `$.snapshot.privileges.${privilege.objectName}:${privilege.grantee}:${privilege.privilege}`,
      'Existing runtime grant is outside the exact desired least-privilege set; implicit REVOKE is forbidden.'
    )
  }
}

function createPrivilegeGrantPlan(
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  desired: readonly SupabaseTablePrivilegeReviewOperationV1[]
): {
  readonly operations: readonly SupabasePrivilegeReviewOperationV1[]
  readonly statements: readonly string[]
} {
  const existingKeys = new Set(
    snapshot.privileges
      .filter((entry) => entry.source !== 'third-party')
      .map(
        (entry) =>
          `${entry.objectKind}:${entry.schema}:${entry.objectName}:${entry.grantee}:${entry.privilege}`
      )
  )
  const operations: SupabasePrivilegeReviewOperationV1[] = []
  const statements: string[] = []
  const roles = [...new Set(desired.map((entry) => entry.grantee))].sort()
  for (const role of roles) {
    if (existingKeys.has(`schema:public:public:${role}:USAGE`)) continue
    operations.push({
      id: stableSQLName('priv_schema', role),
      kind: 'grant-schema-usage',
      schema: 'public',
      grantee: role,
      privileges: ['USAGE']
    })
    statements.push(
      `GRANT USAGE ON SCHEMA ${quoteIdentifier('public')} TO ${quoteIdentifier(role)};`
    )
  }
  for (const entry of desired) {
    const missing = entry.privileges.filter(
      (privilege) =>
        !existingKeys.has(`table:public:${entry.tableName}:${entry.grantee}:${privilege}`)
    )
    if (missing.length === 0) continue
    operations.push({
      ...entry,
      id: stableSQLName('priv_table', `${entry.tableName}:${entry.grantee}:${missing.join(',')}`),
      privileges: missing
    })
    statements.push(
      `GRANT ${missing.join(', ')} ON TABLE ${qualified(entry.tableName)} TO ${quoteIdentifier(entry.grantee)};`
    )
  }
  return { operations, statements }
}

export function renderPoliciesAndPrivileges(
  application: BackendApplicationSpecV1,
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  plan: MigrationPlan,
  blockers: SupabaseMigrationReviewBlockerV1[]
): {
  readonly policyStatements: readonly string[]
  readonly desired: readonly SupabaseTablePrivilegeReviewOperationV1[]
  readonly operations: readonly SupabasePrivilegeReviewOperationV1[]
  readonly grantStatements: readonly string[]
} {
  const usage = requiredOperations(application)
  const policyStatements: string[] = []
  const desired: SupabaseTablePrivilegeReviewOperationV1[] = []
  const desiredPolicyNames = new Set<string>()
  const createdEntityIds = new Set(
    plan.operations.flatMap((entry) =>
      entry.operation.kind === 'create-entity' ? [entry.operation.entity.id] : []
    )
  )

  for (const entity of application.dataModel.entities
    .filter((entry) => entry.management === 'managed' && createdEntityIds.has(entry.id))
    .sort((left, right) => left.id.localeCompare(right.id, 'en'))) {
    policyStatements.push(`ALTER TABLE ${qualified(entity.name)} ENABLE ROW LEVEL SECURITY;`)
    policyStatements.push(`ALTER TABLE ${qualified(entity.name)} FORCE ROW LEVEL SECURITY;`)
  }

  for (const entityId of [...usage.keys()].sort()) {
    const required = usage.get(entityId)
    if (!required) continue
    const entity = reviewedWorkflowEntity(
      application,
      snapshot,
      createdEntityIds,
      entityId,
      required,
      blockers
    )
    if (!entity) continue
    const intents = sortedEntityIntents(application, entity.id)
    const coverage = allowPolicyCoverage(application, intents)
    addPolicyCoverageBlockers(entity, required, coverage, blockers)
    desired.push(...desiredTablePrivileges(entity, required, coverage))
    policyStatements.push(
      ...renderIntentPolicies(
        application,
        snapshot,
        entity,
        required,
        intents,
        blockers,
        desiredPolicyNames
      )
    )
  }
  addStaleManagedPolicyBlockers(snapshot, desiredPolicyNames, blockers)
  addStaleManagedGrantBlockers(snapshot, desired, blockers)
  const grants = createPrivilegeGrantPlan(snapshot, desired)
  return {
    policyStatements,
    desired,
    operations: grants.operations,
    grantStatements: grants.statements
  }
}
