import type {
  BackendApplicationSpecV1,
  MigrationPlan,
  StagedMigrationExecutionPlanV1,
  StagedMigrationExecutionReceiptV1,
  StagedMigrationPhase
} from '@open-pencil/lowcode/backend'

import type { SupabaseInspectedMigrationSnapshotV1 } from '../inspection'

export const SUPABASE_TABLE_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const

export interface SupabaseMigrationReviewBlockerV1 {
  readonly code: string
  readonly path: string
  readonly message: string
}

export interface SupabaseTablePrivilegeReviewOperationV1 {
  readonly id: string
  readonly kind: 'grant-table'
  readonly schema: 'public'
  readonly tableName: string
  readonly grantee: 'anon' | 'authenticated'
  readonly privileges: readonly (typeof SUPABASE_TABLE_PRIVILEGES)[number][]
}

export interface SupabaseSchemaPrivilegeReviewOperationV1 {
  readonly id: string
  readonly kind: 'grant-schema-usage'
  readonly schema: 'public'
  readonly grantee: 'anon' | 'authenticated'
  readonly privileges: readonly ['USAGE']
}

export type SupabasePrivilegeReviewOperationV1 =
  | SupabaseTablePrivilegeReviewOperationV1
  | SupabaseSchemaPrivilegeReviewOperationV1

export type SupabaseMigrationReviewEnvironmentV1 = 'staging' | 'production'

export interface SupabaseStagedMigrationReviewInputV1 {
  /** Provider-neutral execution authority. It is normalized by the strict lowcode validator. */
  readonly executionPlan: unknown
  /**
   * Required for backfill/contract and must prove the declared predecessor succeeded against the
   * independently inspected provider, environment, project, account, schema, and observation time.
   * Provider-authority digests and grant generations remain opaque receipt evidence here.
   */
  readonly predecessorReceipt?: unknown
}

export interface SupabaseInspectedMigrationReviewManifestV1 {
  readonly format: 'openpencil.supabase-inspected-migration-review.v1'
  readonly version: 1
  readonly providerId: 'supabase'
  readonly schema: 'public'
  readonly environment: SupabaseMigrationReviewEnvironmentV1
  readonly applicationId: string
  readonly applicationDigest: string
  readonly inspectionProvenance: SupabaseInspectedMigrationSnapshotV1['provenance']
  /** Full timestamped catalog-capture integrity; excluded from the semantic approval digest. */
  readonly inspectionCaptureDigest: string
  readonly inspectedSchemaDigest: string
  /** Full authored DataModelIR digests, including relation identities and compatibility metadata. */
  readonly authoredCurrentModelDigest: string
  readonly authoredTargetModelDigest: string
  /** Digests of the explicit addressable PostgreSQL projection used for post-Apply comparison. */
  readonly currentModelDigest: string
  readonly targetModelDigest: string
  readonly migrationPlan: MigrationPlan
  readonly migrationPlanDigest: string
  readonly renderedMigrationOperationIds: readonly string[]
  readonly stagedExecutionPlan: StagedMigrationExecutionPlanV1 | null
  readonly stagedExecutionPlanDigest: string | null
  readonly predecessorReceipt: StagedMigrationExecutionReceiptV1 | null
  readonly predecessorReceiptDigest: string | null
  readonly renderedStagedMigrationOperationIds: readonly string[]
  readonly renderedMigrationPhases: readonly StagedMigrationPhase[]
  readonly baselinePreconditionVersion: 1
  readonly baselinePreconditionTableNames: readonly string[]
  readonly preGrantPreconditionTableNames: readonly string[]
  readonly desiredTablePrivileges: readonly SupabaseTablePrivilegeReviewOperationV1[]
  readonly privilegeOperations: readonly SupabasePrivilegeReviewOperationV1[]
  readonly privilegePlanDigest: string
  readonly sqlDigest: string
  readonly blockers: readonly SupabaseMigrationReviewBlockerV1[]
  readonly reviewReady: boolean
  readonly applyAllowed: false
  readonly releaseReady: false
}

export interface SupabaseInspectedMigrationReviewV1 {
  readonly snapshot: SupabaseInspectedMigrationSnapshotV1
  readonly sql: string
  readonly manifest: SupabaseInspectedMigrationReviewManifestV1
  readonly manifestDigest: string
}

export interface CreateSupabaseInspectedMigrationReviewInputV1 {
  readonly application: BackendApplicationSpecV1
  readonly snapshot: unknown
  readonly expectedProjectRef?: string
  readonly expectedAccountId?: string
  readonly expectedInspectedSchemaDigest?: string
  /** Accepts either the authored DataModelIR digest or the explicit physical projection digest. */
  readonly expectedTargetModelDigest?: string
  readonly environment?: SupabaseMigrationReviewEnvironmentV1
  readonly stagedExecution?: SupabaseStagedMigrationReviewInputV1
}
