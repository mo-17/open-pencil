import {
  backendSha256,
  digestCanonicalBackendValue,
  freezeBackendValue
} from '#compiler/backend/canonical'

import {
  digestBackendApplication,
  normalizedBackendApplication,
  planBackendMigration
} from '@open-pencil/lowcode/backend'

import { parseSupabaseInspectedMigrationSnapshot } from '../inspection'
import { blockedSQL, reviewSQL, sortedBlockers } from './common'
import type {
  CreateSupabaseInspectedMigrationReviewInputV1,
  SupabaseInspectedMigrationReviewManifestV1,
  SupabaseInspectedMigrationReviewV1,
  SupabaseMigrationReviewBlockerV1
} from './contract'
import { foreignKeyIndexBlockers, inventoryBlockers } from './inventory'
import { renderPoliciesAndPrivileges } from './policy'
import { renderAdditiveMigrations } from './sql'

export type {
  CreateSupabaseInspectedMigrationReviewInputV1,
  SupabaseInspectedMigrationReviewManifestV1,
  SupabaseInspectedMigrationReviewV1,
  SupabaseMigrationReviewBlockerV1,
  SupabasePrivilegeReviewOperationV1,
  SupabaseSchemaPrivilegeReviewOperationV1,
  SupabaseTablePrivilegeReviewOperationV1
} from './contract'

export async function createSupabaseInspectedMigrationReview(
  input: CreateSupabaseInspectedMigrationReviewInputV1
): Promise<SupabaseInspectedMigrationReviewV1> {
  const application = normalizedBackendApplication(input.application)
  const snapshot = await parseSupabaseInspectedMigrationSnapshot(input.snapshot)
  if (
    input.expectedProjectRef !== undefined &&
    input.expectedProjectRef !== snapshot.provenance.projectRef
  ) {
    throw new TypeError('Supabase inspected schema belongs to a different project authority.')
  }
  if (
    input.expectedAccountId !== undefined &&
    input.expectedAccountId !== snapshot.provenance.accountId
  ) {
    throw new TypeError('Supabase inspected schema belongs to a different account authority.')
  }
  if (
    input.expectedInspectedSchemaDigest !== undefined &&
    input.expectedInspectedSchemaDigest !== snapshot.inspectedSchemaDigest
  ) {
    throw new TypeError('Supabase inspected schema drifted from the expected release authority.')
  }
  const migrationPlan = await planBackendMigration(snapshot.currentModel, application.dataModel)
  if (
    input.expectedTargetModelDigest !== undefined &&
    input.expectedTargetModelDigest !== migrationPlan.targetModelDigest
  ) {
    throw new TypeError(
      'Supabase target DataModelIR drifted from the expected migration authority.'
    )
  }
  if (migrationPlan.fromModelDigest !== snapshot.currentModelDigest) {
    throw new TypeError('Shared migration plan is not bound to the inspected current DataModelIR.')
  }

  const blockers: SupabaseMigrationReviewBlockerV1[] = []
  inventoryBlockers(snapshot, blockers)
  foreignKeyIndexBlockers(application, blockers)
  const migration = renderAdditiveMigrations(application, snapshot, migrationPlan, blockers)
  const privilege = renderPoliciesAndPrivileges(application, snapshot, migrationPlan, blockers)
  const finalBlockers = sortedBlockers(blockers)
  const executable = finalBlockers.length === 0
  const privilegeOperations = executable ? privilege.operations : []
  const renderedMigrationOperationIds = executable ? migration.operationIds : []
  const sql = executable
    ? reviewSQL([
        ...migration.statements,
        ...privilege.policyStatements,
        ...privilege.grantStatements
      ])
    : blockedSQL(finalBlockers)
  const applicationDigest = await digestBackendApplication(application)
  const migrationPlanDigest = digestCanonicalBackendValue(
    migrationPlan,
    '$.supabaseMigrationReview.migrationPlan'
  )
  const privilegePlanDigest = digestCanonicalBackendValue(
    {
      desiredTablePrivileges: privilege.desired,
      privilegeOperations
    },
    '$.supabaseMigrationReview.privilegePlan'
  )
  const sqlDigest = backendSha256(sql)
  const manifest = freezeBackendValue({
    format: 'openpencil.supabase-inspected-migration-review.v1',
    version: 1,
    providerId: 'supabase',
    schema: 'public',
    applicationId: application.applicationId,
    applicationDigest,
    inspectionProvenance: snapshot.provenance,
    inspectedSchemaDigest: snapshot.inspectedSchemaDigest,
    currentModelDigest: snapshot.currentModelDigest,
    targetModelDigest: migrationPlan.targetModelDigest,
    migrationPlan,
    migrationPlanDigest,
    renderedMigrationOperationIds,
    desiredTablePrivileges: privilege.desired,
    privilegeOperations,
    privilegePlanDigest,
    sqlDigest,
    blockers: finalBlockers,
    reviewReady: executable,
    applyAllowed: false,
    releaseReady: false
  }) as SupabaseInspectedMigrationReviewManifestV1
  const manifestDigest = digestCanonicalBackendValue(manifest, '$.supabaseMigrationReview.manifest')
  return freezeBackendValue({
    snapshot,
    sql,
    manifest,
    manifestDigest
  }) as SupabaseInspectedMigrationReviewV1
}
