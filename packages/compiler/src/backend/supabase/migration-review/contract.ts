import type { BackendApplicationSpecV1, MigrationPlan } from '@open-pencil/lowcode/backend'

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

export interface SupabaseInspectedMigrationReviewManifestV1 {
  readonly format: 'openpencil.supabase-inspected-migration-review.v1'
  readonly version: 1
  readonly providerId: 'supabase'
  readonly schema: 'public'
  readonly applicationId: string
  readonly applicationDigest: string
  readonly inspectionProvenance: SupabaseInspectedMigrationSnapshotV1['provenance']
  readonly inspectedSchemaDigest: string
  readonly currentModelDigest: string
  readonly targetModelDigest: string
  readonly migrationPlan: MigrationPlan
  readonly migrationPlanDigest: string
  readonly renderedMigrationOperationIds: readonly string[]
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
  readonly expectedTargetModelDigest?: string
}
