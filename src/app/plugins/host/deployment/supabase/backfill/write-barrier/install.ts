/* oxlint-disable eslint(max-lines) -- Keep the complete lock-bound installer and its capability boundary together for auditability. */
import {
  createSupabaseBackfillInspectionSubjectV1,
  type SupabaseBackfillInspectionSubjectV1
} from '@open-pencil/compiler/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  parseSupabaseStagingTargetBinding,
  type SupabaseStagingTargetBindingV1
} from '@/app/lowcode/supabase/staging-target'

import {
  type SupabaseBackfillLiveCatalogAuthorityV1,
  type SupabaseBackfillLiveCatalogCompilerInputV1,
  type SupabaseBackfillLiveCatalogInspectionV1
} from '../live-inspector'
import {
  trustedSupabaseBackfillWriteBarrierReviewContextV1,
  type SupabaseBackfillWriteBarrierReviewEnvelopeV1,
  type TrustedSupabaseBackfillWriteBarrierReviewContextV1
} from './review'
import {
  consumeTrustedSupabaseBackfillWriteBarrierAbsentPreparationV1,
  trustedSupabaseBackfillWriteBarrierAbsentVerificationV1,
  type SupabaseBackfillWriteBarrierVerificationV1
} from './verifier'

export const SUPABASE_BACKFILL_WRITE_BARRIER_INSTALL_REVIEW_FORMAT =
  'openpencil.supabase-backfill-write-barrier-install-review.v1' as const
export const SUPABASE_BACKFILL_WRITE_BARRIER_INSTALL_DISPATCH_CONTEXT_FORMAT =
  'openpencil.supabase-backfill-write-barrier-install-dispatch-context.v1' as const
export const SUPABASE_BACKFILL_WRITE_BARRIER_INSTALL_ARTIFACT_PATH =
  'backend/supabase-v2/backfill/write-barrier-install.sql' as const

const PROJECT_REF = /^[a-z]{20}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const MIGRATION_NAME = /^[a-z][a-z0-9_]{0,126}$/u
const CREATE_REVIEW_KEYS = ['review', 'absentVerification'] as const
const AUTHORIZE_KEYS = [
  'installReview',
  'stagingTargetBinding',
  'confirmation',
  'readCurrentCompilerInput',
  'readCurrentWriteAuthority',
  'readCurrentStagingTargetBinding'
] as const
const CONFIRMATION_KEYS = [
  'reviewDigest',
  'verificationDigest',
  'installDigest',
  'projectRefConfirmation',
  'accountIdConfirmation',
  'writeGrantGeneration',
  'confirmedIndependentStaging',
  'confirmedMigrationApply'
] as const
const WRITE_AUTHORITY_KEYS = [
  'projectRef',
  'accountId',
  'grantGeneration',
  'scope',
  'permission'
] as const

export interface SupabaseBackfillWriteBarrierWriteAuthorityV1 {
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly scope: 'database:write'
  readonly permission: 'database_migrations_write'
}

export interface SupabaseBackfillWriteBarrierInstallReviewV1 {
  readonly format: typeof SUPABASE_BACKFILL_WRITE_BARRIER_INSTALL_REVIEW_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environmentIntent: 'staging'
  readonly environmentVerified: false
  readonly reviewOnly: true
  readonly applyAvailable: false
  readonly releaseReady: false
  readonly sourceLedgerBound: false
  readonly mutationAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly bindings: Readonly<{
    reviewDigest: string
    verificationDigest: string
    subjectDigest: string
    inspectionDigest: string
    logicalScopeDigest: string
    markerBindingDigest: string
    catalogPreconditionDigest: string
    installDigest: string
  }>
  readonly authority: SupabaseBackfillLiveCatalogAuthorityV1
  readonly address: Readonly<{
    schemaName: 'public'
    schemaOid: string
    tableName: string
    tableOid: string
    targetField: string
    targetSubId: number
    targetTypeOid: string
  }>
  readonly migration: Readonly<{
    name: string
    endpointKind: 'management-api-migration'
    transactionIsolation: 'serializable'
    lockMode: 'access-exclusive'
    reinspectionUnderLock: true
    sourceLedgerBound: false
  }>
  readonly artifact: Readonly<{
    path: typeof SUPABASE_BACKFILL_WRITE_BARRIER_INSTALL_ARTIFACT_PATH
    kind: 'database-schema-install-review'
    mediaType: 'application/sql; charset=utf-8'
    byteLength: number
    digest: string
    statementCount: 6
    mutationStatementCount: 2
    containsCatalogRead: true
    containsManagedDataRead: false
    containsDml: false
    performsSchemaChange: true
    mutationDispatched: false
    hostDispatchAvailable: false
  }>
  readonly blockers: readonly string[]
}

export interface SupabaseBackfillWriteBarrierInstallReviewEnvelopeV1 {
  readonly review: SupabaseBackfillWriteBarrierInstallReviewV1
  readonly reviewDigest: string
  readonly installSql: string
}

export interface SupabaseBackfillWriteBarrierInstallConfirmationV1 {
  readonly reviewDigest: string
  readonly verificationDigest: string
  readonly installDigest: string
  readonly projectRefConfirmation: string
  readonly accountIdConfirmation: string
  readonly writeGrantGeneration: string
  readonly confirmedIndependentStaging: true
  readonly confirmedMigrationApply: true
}

/** Safe public face of an operation-scoped capability. The SQL and grant are retained privately. */
export interface SupabaseBackfillWriteBarrierInstallDispatchContextV1 {
  readonly format: typeof SUPABASE_BACKFILL_WRITE_BARRIER_INSTALL_DISPATCH_CONTEXT_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly projectRef: string
  readonly accountId: string
  readonly reviewDigest: string
  readonly verificationDigest: string
  readonly installDigest: string
  readonly migrationName: string
  readonly sourceLedgerBound: false
  readonly releaseReady: false
}

export interface CreateSupabaseBackfillWriteBarrierInstallReviewOptionsV1 {
  readonly review: SupabaseBackfillWriteBarrierReviewEnvelopeV1
  readonly absentVerification: SupabaseBackfillWriteBarrierVerificationV1
}

type MaybePromise<T> = T | Promise<T>

export interface AuthorizeSupabaseBackfillWriteBarrierInstallOptionsV1 {
  readonly installReview: SupabaseBackfillWriteBarrierInstallReviewEnvelopeV1
  /** Exact Host staging-store snapshot displayed to the confirmer. */
  readonly stagingTargetBinding: SupabaseStagingTargetBindingV1
  readonly confirmation: SupabaseBackfillWriteBarrierInstallConfirmationV1
  readonly readCurrentCompilerInput: () => MaybePromise<SupabaseBackfillLiveCatalogCompilerInputV1>
  readonly readCurrentWriteAuthority: () => MaybePromise<SupabaseBackfillWriteBarrierWriteAuthorityV1>
  /** Re-read the Host staging store before and after asynchronous digest/input checks. */
  readonly readCurrentStagingTargetBinding: () => MaybePromise<SupabaseStagingTargetBindingV1 | null>
}

export type SupabaseBackfillWriteBarrierInstallErrorCode =
  | 'supabase-backfill-write-barrier-install-input-invalid'
  | 'supabase-backfill-write-barrier-install-proof-invalid'
  | 'supabase-backfill-write-barrier-install-confirmation-mismatch'
  | 'supabase-backfill-write-barrier-install-staging-target-mismatch'
  | 'supabase-backfill-write-barrier-install-write-authority-invalid'
  | 'supabase-backfill-write-barrier-install-write-authority-not-separated'
  | 'supabase-backfill-write-barrier-install-input-changed'
  | 'supabase-backfill-write-barrier-install-digest-failed'

export class SupabaseBackfillWriteBarrierInstallError extends Error {
  constructor(readonly code: SupabaseBackfillWriteBarrierInstallErrorCode) {
    super(`Supabase backfill write-barrier install preparation failed: ${code}.`)
    this.name = 'SupabaseBackfillWriteBarrierInstallError'
  }
}

interface UnknownRecord {
  [key: PropertyKey]: unknown
}

interface TrustedInstallReviewContext {
  readonly envelope: SupabaseBackfillWriteBarrierInstallReviewEnvelopeV1
  readonly sourceReview: SupabaseBackfillWriteBarrierReviewEnvelopeV1
  readonly absentVerification: SupabaseBackfillWriteBarrierVerificationV1
  readonly reviewContext: TrustedSupabaseBackfillWriteBarrierReviewContextV1
  readonly installSql: string
}

export interface TrustedSupabaseBackfillWriteBarrierInstallDispatchV1 {
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly migrationName: string
  readonly installSql: string
  readonly installDigest: string
}

/** Same-process evidence retained for the journal controller; never serializable authority. */
export interface TrustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1 {
  readonly installReview: SupabaseBackfillWriteBarrierInstallReviewEnvelopeV1
  readonly sourceReview: SupabaseBackfillWriteBarrierReviewEnvelopeV1
  readonly absentVerification: SupabaseBackfillWriteBarrierVerificationV1
  readonly writeAuthority: SupabaseBackfillWriteBarrierWriteAuthorityV1
  readonly stagingTarget: SupabaseStagingTargetBindingV1
}

interface LiveInstallBinding {
  readonly subject: SupabaseBackfillInspectionSubjectV1
  readonly subjectDigest: string
  readonly writeAuthority: SupabaseBackfillWriteBarrierWriteAuthorityV1
  readonly stagingTarget: SupabaseStagingTargetBindingV1
}

const trustedInstallReviewContexts = new WeakMap<object, TrustedInstallReviewContext>()
const consumedInstallReviews = new WeakSet<object>()
const trustedDispatchContexts = new WeakMap<
  object,
  TrustedSupabaseBackfillWriteBarrierInstallDispatchV1
>()
const trustedDispatchEvidenceContexts = new WeakMap<
  object,
  TrustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1
>()
const consumedDispatchContexts = new WeakSet<object>()

function fail(code: SupabaseBackfillWriteBarrierInstallErrorCode): never {
  throw new SupabaseBackfillWriteBarrierInstallError(code)
}

function ownData(value: object, key: PropertyKey): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail('supabase-backfill-write-barrier-install-input-invalid')
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return fail('supabase-backfill-write-barrier-install-input-invalid')
  }
  return descriptor.value
}

function exactRecord(value: unknown, keys: readonly string[]): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('supabase-backfill-write-barrier-install-input-invalid')
  }
  let prototype: object | null
  let ownKeys: readonly PropertyKey[]
  try {
    prototype = Object.getPrototypeOf(value)
    ownKeys = Reflect.ownKeys(value)
  } catch {
    return fail('supabase-backfill-write-barrier-install-input-invalid')
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return fail('supabase-backfill-write-barrier-install-input-invalid')
  }
  for (const key of keys) ownData(value, key)
  return value as UnknownRecord
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.includes('\0')) {
    return fail('supabase-backfill-write-barrier-install-input-invalid')
  }
  return value
}

function digestText(value: unknown): string {
  const result = text(value)
  if (!DIGEST.test(result)) return fail('supabase-backfill-write-barrier-install-input-invalid')
  return result
}

function stableId(value: unknown): string {
  const result = text(value)
  if (!STABLE_ID.test(result)) return fail('supabase-backfill-write-barrier-install-input-invalid')
  return result
}

function projectRef(value: unknown): string {
  const result = text(value)
  if (!PROJECT_REF.test(result))
    return fail('supabase-backfill-write-barrier-install-input-invalid')
  return result
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function quoteLiteral(value: string): string {
  return `E'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
}

function booleanSql(value: boolean): 'TRUE' | 'FALSE' {
  return value ? 'TRUE' : 'FALSE'
}

function oidSql(value: string): string {
  return `${value}::"pg_catalog"."oid"`
}

function integerSql(value: number): string {
  if (!Number.isSafeInteger(value)) {
    return fail('supabase-backfill-write-barrier-install-input-invalid')
  }
  return String(value)
}

function equalityCount(sql: string, expected: number): string {
  return `(SELECT COUNT(*) FROM ${sql}) = ${integerSql(expected)}`
}

function tablePredicate(inspection: SupabaseBackfillLiveCatalogInspectionV1): string {
  const { table, schema } = inspection.catalog
  return `EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_class" AS "table_entry"
      JOIN "pg_catalog"."pg_namespace" AS "schema_entry"
        ON "schema_entry"."oid" = "table_entry"."relnamespace"
      JOIN "pg_catalog"."pg_roles" AS "owner_entry"
        ON "owner_entry"."oid" = "table_entry"."relowner"
      WHERE "schema_entry"."oid" = ${oidSql(schema.oid)}
        AND "schema_entry"."nspname" = ${quoteLiteral(schema.name)}::"pg_catalog"."name"
        AND "table_entry"."oid" = ${oidSql(table.oid)}
        AND "table_entry"."relname" = ${quoteLiteral(table.name)}::"pg_catalog"."name"
        AND "table_entry"."relkind" = 'r'
        AND "table_entry"."relowner" = ${oidSql(table.ownerOid)}
        AND "owner_entry"."rolname" = ${quoteLiteral(table.ownerName)}::"pg_catalog"."name"
        AND "table_entry"."relrowsecurity" IS ${booleanSql(table.rlsEnabled)}
        AND "table_entry"."relforcerowsecurity" IS ${booleanSql(table.rlsForced)}
        AND "pg_catalog"."obj_description"("table_entry"."oid", 'pg_class') =
          ${quoteLiteral(table.marker)}
        AND COALESCE("pg_catalog"."cardinality"("table_entry"."relacl"), 0) =
          ${integerSql(inspection.hazards.tableAclEntryCount)}
    )`
}

function cursorPredicate(inspection: SupabaseBackfillLiveCatalogInspectionV1): string {
  const cursor = inspection.catalog.cursor
  return `EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_attribute" AS "column_entry"
      JOIN "pg_catalog"."pg_type" AS "type_entry"
        ON "type_entry"."oid" = "column_entry"."atttypid"
      JOIN "pg_catalog"."pg_namespace" AS "type_schema"
        ON "type_schema"."oid" = "type_entry"."typnamespace"
      WHERE "column_entry"."attrelid" = ${oidSql(cursor.objectOid)}
        AND "column_entry"."attnum" = ${integerSql(cursor.subId)}
        AND "column_entry"."attname" = ${quoteLiteral(cursor.name)}::"pg_catalog"."name"
        AND "column_entry"."atttypid" = ${oidSql(cursor.typeOid)}
        AND "type_schema"."nspname" = ${quoteLiteral(cursor.typeSchema)}::"pg_catalog"."name"
        AND "type_entry"."typname" = ${quoteLiteral(cursor.typeName)}::"pg_catalog"."name"
        AND "column_entry"."atttypmod" = ${integerSql(cursor.typeModifier)}
        AND "column_entry"."attnotnull" IS ${booleanSql(cursor.notNull)}
        AND "column_entry"."attidentity" = ${quoteLiteral(cursor.identityKind)}::"pg_catalog"."char"
        AND "column_entry"."attgenerated" = ${quoteLiteral(cursor.generatedKind)}::"pg_catalog"."char"
        AND NOT "column_entry"."attisdropped"
        AND "pg_catalog"."col_description"(
          "column_entry"."attrelid", "column_entry"."attnum"
        ) = ${quoteLiteral(cursor.marker)}
    )`
}

function targetPredicate(inspection: SupabaseBackfillLiveCatalogInspectionV1): string {
  const target = inspection.catalog.target
  const enumValues = quoteLiteral(JSON.stringify(target.enumValues))
  const enumMarker = target.enumMarker === null ? 'IS NULL' : `= ${quoteLiteral(target.enumMarker)}`
  return `EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_attribute" AS "column_entry"
      JOIN "pg_catalog"."pg_type" AS "type_entry"
        ON "type_entry"."oid" = "column_entry"."atttypid"
      JOIN "pg_catalog"."pg_namespace" AS "type_schema"
        ON "type_schema"."oid" = "type_entry"."typnamespace"
      WHERE "column_entry"."attrelid" = ${oidSql(target.objectOid)}
        AND "column_entry"."attnum" = ${integerSql(target.subId)}
        AND "column_entry"."attname" = ${quoteLiteral(target.name)}::"pg_catalog"."name"
        AND "column_entry"."atttypid" = ${oidSql(target.typeOid)}
        AND "type_schema"."oid" = ${oidSql(target.typeSchemaOid)}
        AND "type_schema"."nspname" = ${quoteLiteral(target.typeSchema)}::"pg_catalog"."name"
        AND "type_entry"."typname" = ${quoteLiteral(target.typeName)}::"pg_catalog"."name"
        AND "type_entry"."typtype" = ${quoteLiteral(target.typeKind)}::"pg_catalog"."char"
        AND "column_entry"."atttypmod" = ${integerSql(target.typeModifier)}
        AND "column_entry"."attnotnull" IS ${booleanSql(target.notNull)}
        AND "column_entry"."attidentity" = ${quoteLiteral(target.identityKind)}::"pg_catalog"."char"
        AND "column_entry"."attgenerated" = ${quoteLiteral(target.generatedKind)}::"pg_catalog"."char"
        AND NOT "column_entry"."attisdropped"
        AND "pg_catalog"."col_description"(
          "column_entry"."attrelid", "column_entry"."attnum"
        ) = ${quoteLiteral(target.marker)}
        AND ${target.hasDefault ? '' : 'NOT '}EXISTS (
          SELECT 1 FROM "pg_catalog"."pg_attrdef" AS "column_default"
          WHERE "column_default"."adrelid" = "column_entry"."attrelid"
            AND "column_default"."adnum" = "column_entry"."attnum"
        )
        AND "pg_catalog"."obj_description"("type_entry"."oid", 'pg_type') ${enumMarker}
        AND COALESCE((
          SELECT "pg_catalog"."jsonb_agg"(
            "enum_entry"."enumlabel" ORDER BY "enum_entry"."enumsortorder"
          )
          FROM "pg_catalog"."pg_enum" AS "enum_entry"
          WHERE "enum_entry"."enumtypid" = "type_entry"."oid"
        ), '[]'::"pg_catalog"."jsonb") = ${enumValues}::"pg_catalog"."jsonb"
    )`
}

function primaryKeyPredicate(inspection: SupabaseBackfillLiveCatalogInspectionV1): string {
  const primaryKey = inspection.catalog.primaryKey
  return `EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_constraint" AS "constraint_entry"
      WHERE "constraint_entry"."oid" = ${oidSql(primaryKey.oid)}
        AND "constraint_entry"."conrelid" = ${oidSql(primaryKey.tableOid)}
        AND "constraint_entry"."conname" =
          ${quoteLiteral(primaryKey.name)}::"pg_catalog"."name"
        AND "constraint_entry"."contype" = 'p'
        AND "constraint_entry"."conkey" =
          ARRAY[${integerSql(primaryKey.cursorSubId)}]::"pg_catalog"."int2"[]
        AND "pg_catalog"."cardinality"("constraint_entry"."conkey") =
          ${integerSql(primaryKey.fieldCount)}
        AND "pg_catalog"."obj_description"("constraint_entry"."oid", 'pg_constraint') =
          ${quoteLiteral(primaryKey.marker)}
    )`
}

function sequencePredicate(inspection: SupabaseBackfillLiveCatalogInspectionV1): string {
  const sequence = inspection.catalog.sequence
  return `EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_class" AS "sequence_entry"
      JOIN "pg_catalog"."pg_namespace" AS "sequence_schema"
        ON "sequence_schema"."oid" = "sequence_entry"."relnamespace"
      JOIN "pg_catalog"."pg_sequence" AS "sequence_state"
        ON "sequence_state"."seqrelid" = "sequence_entry"."oid"
      JOIN "pg_catalog"."pg_depend" AS "sequence_dependency"
        ON "sequence_dependency"."objid" = "sequence_entry"."oid"
       AND "sequence_dependency"."classid" =
         'pg_catalog.pg_class'::"pg_catalog"."regclass"
       AND "sequence_dependency"."refclassid" =
         'pg_catalog.pg_class'::"pg_catalog"."regclass"
      WHERE "sequence_entry"."oid" = ${oidSql(sequence.oid)}
        AND "sequence_entry"."relkind" = 'S'
        AND "sequence_schema"."oid" = ${oidSql(sequence.schemaOid)}
        AND "sequence_schema"."nspname" =
          ${quoteLiteral(sequence.schema)}::"pg_catalog"."name"
        AND "sequence_entry"."relname" =
          ${quoteLiteral(sequence.name)}::"pg_catalog"."name"
        AND "sequence_dependency"."deptype" = ${quoteLiteral(sequence.dependencyType)}::"pg_catalog"."char"
        AND "sequence_dependency"."refobjid" = ${oidSql(sequence.ownedTableOid)}
        AND "sequence_dependency"."refobjsubid" = ${integerSql(sequence.ownedSubId)}
        AND "sequence_state"."seqincrement" = ${quoteLiteral(sequence.incrementBy)}::"pg_catalog"."int8"
        AND "sequence_state"."seqmin" = ${quoteLiteral(sequence.minimumValue)}::"pg_catalog"."int8"
        AND "sequence_state"."seqmax" = ${quoteLiteral(sequence.maximumValue)}::"pg_catalog"."int8"
        AND "sequence_state"."seqcache" = ${quoteLiteral(sequence.cacheSize)}::"pg_catalog"."int8"
        AND "sequence_state"."seqcycle" IS ${booleanSql(sequence.cycle)}
    )`
}

function hazardPredicates(inspection: SupabaseBackfillLiveCatalogInspectionV1): readonly string[] {
  const tableOid = oidSql(inspection.catalog.table.oid)
  const hazards = inspection.hazards
  return Object.freeze([
    equalityCount(
      `"pg_catalog"."pg_constraint" AS "entry" WHERE "entry"."conrelid" = ${tableOid} AND "entry"."contype" IN ('u', 'x')`,
      hazards.nonPrimaryUniqueOrExclusionConstraintCount
    ),
    equalityCount(
      `"pg_catalog"."pg_index" AS "entry" WHERE "entry"."indrelid" = ${tableOid} AND NOT "entry"."indisprimary"`,
      hazards.nonPrimaryIndexCount
    ),
    equalityCount(
      `"pg_catalog"."pg_index" AS "entry" WHERE "entry"."indrelid" = ${tableOid} AND ("entry"."indpred" IS NOT NULL OR "entry"."indexprs" IS NOT NULL)`,
      hazards.partialOrExpressionIndexCount
    ),
    equalityCount(
      `"pg_catalog"."pg_constraint" AS "entry" WHERE "entry"."conrelid" = ${tableOid} AND "entry"."contype" = 'c'`,
      hazards.checkConstraintCount
    ),
    equalityCount(
      `"pg_catalog"."pg_constraint" AS "entry" WHERE "entry"."conrelid" = ${tableOid} AND "entry"."contype" = 'f'`,
      hazards.outboundForeignKeyConstraintCount
    ),
    equalityCount(
      `"pg_catalog"."pg_constraint" AS "entry" WHERE "entry"."confrelid" = ${tableOid} AND "entry"."contype" = 'f'`,
      hazards.inboundForeignKeyConstraintCount
    ),
    equalityCount(
      `"pg_catalog"."pg_attribute" AS "entry" WHERE "entry"."attrelid" = ${tableOid} AND "entry"."attnum" > 0 AND NOT "entry"."attisdropped" AND "entry"."attgenerated" <> ''`,
      hazards.generatedColumnCount
    ),
    equalityCount(
      `"pg_catalog"."pg_inherits" AS "entry" WHERE "entry"."inhrelid" = ${tableOid} OR "entry"."inhparent" = ${tableOid}`,
      hazards.inheritanceRelationCount
    ),
    equalityCount(
      `"pg_catalog"."pg_trigger" AS "entry" WHERE "entry"."tgrelid" = ${tableOid} AND NOT "entry"."tgisinternal"`,
      hazards.userTriggerCount
    ),
    equalityCount(
      `"pg_catalog"."pg_rewrite" AS "entry" WHERE "entry"."ev_class" = ${tableOid} AND "entry"."rulename" <> '_RETURN'`,
      hazards.userRuleCount
    ),
    equalityCount(
      `"pg_catalog"."pg_policy" AS "entry" WHERE "entry"."polrelid" = ${tableOid}`,
      hazards.policyCount
    ),
    equalityCount(
      `"pg_catalog"."pg_publication_rel" AS "entry" WHERE "entry"."prrelid" = ${tableOid}`,
      hazards.publicationMembershipCount
    ),
    equalityCount(
      `"pg_catalog"."pg_attribute" AS "entry" WHERE "entry"."attrelid" = ${tableOid} AND "entry"."attnum" > 0 AND NOT "entry"."attisdropped" AND "entry"."attacl" IS NOT NULL`,
      hazards.columnAclCount
    )
  ])
}

function installSql(
  review: SupabaseBackfillWriteBarrierReviewEnvelopeV1,
  inspection: SupabaseBackfillLiveCatalogInspectionV1,
  verification: SupabaseBackfillWriteBarrierVerificationV1
): string {
  const qualifiedTable = `${quoteIdentifier('public')}.${quoteIdentifier(
    inspection.catalog.table.name
  )}`
  const constraint = quoteIdentifier(review.review.barrier.constraintName)
  const target = quoteIdentifier(inspection.catalog.target.name)
  const lock = `LOCK TABLE ONLY ${qualifiedTable} IN ACCESS EXCLUSIVE MODE`
  const addConstraint = `ALTER TABLE ONLY ${qualifiedTable} ADD CONSTRAINT ${constraint} CHECK (${target} IS NOT NULL) NO INHERIT NOT VALID`
  const addMarker = `COMMENT ON CONSTRAINT ${constraint} ON ${qualifiedTable} IS ${quoteLiteral(
    review.review.barrier.marker
  )}`
  const barrierAbsent = [
    `NOT EXISTS (SELECT 1 FROM "pg_catalog"."pg_constraint" AS "entry" WHERE "entry"."conrelid" = ${oidSql(
      inspection.catalog.table.oid
    )} AND "entry"."conname" = ${quoteLiteral(
      review.review.barrier.constraintName
    )}::"pg_catalog"."name")`,
    `NOT EXISTS (SELECT 1 FROM "pg_catalog"."pg_constraint" AS "entry" WHERE "pg_catalog"."obj_description"("entry"."oid", 'pg_constraint') = ${quoteLiteral(
      review.review.barrier.marker
    )})`
  ]
  const predicates = [
    `"pg_catalog"."current_setting"('transaction_isolation') = 'serializable'`,
    `"pg_catalog"."current_setting"('search_path') = 'pg_catalog'`,
    `"pg_catalog"."current_setting"('server_version_num') = ${quoteLiteral(
      verification.serverVersionNum
    )}`,
    `NOT "pg_catalog"."pg_is_in_recovery"()`,
    tablePredicate(inspection),
    cursorPredicate(inspection),
    targetPredicate(inspection),
    primaryKeyPredicate(inspection),
    sequencePredicate(inspection),
    ...hazardPredicates(inspection),
    ...barrierAbsent
  ]
  return [
    '-- OpenPencil Supabase backfill write-barrier installer v1.',
    '-- Host-dispatch only. The migration fails closed unless the complete reviewed catalog is unchanged.',
    'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
    'SET LOCAL search_path = pg_catalog;',
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL statement_timeout = '15s';",
    `${lock};`,
    'DO $openpencil$',
    'DECLARE',
    '  "catalog_ready" "pg_catalog"."bool";',
    'BEGIN',
    '  SELECT',
    predicates.map((predicate, index) => `    ${index === 0 ? '' : 'AND '}${predicate}`).join('\n'),
    '  INTO "catalog_ready";',
    '  IF "catalog_ready" IS DISTINCT FROM TRUE THEN',
    "    RAISE EXCEPTION USING ERRCODE = 'P0001',",
    "      MESSAGE = 'OpenPencil write-barrier catalog precondition failed';",
    '  END IF;',
    `  EXECUTE ${quoteLiteral(addConstraint)};`,
    `  EXECUTE ${quoteLiteral(addMarker)};`,
    'END',
    '$openpencil$;',
    ''
  ].join('\n')
}

function encodeBase64URL(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

async function digestSql(value: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(value)
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)))
  } catch {
    return fail('supabase-backfill-write-barrier-install-digest-failed')
  }
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-backfill-write-barrier-install-digest-failed')
  }
}

function migrationName(review: SupabaseBackfillWriteBarrierReviewEnvelopeV1): string {
  const name = `install_${review.review.barrier.constraintName}`
  if (!MIGRATION_NAME.test(name)) {
    return fail('supabase-backfill-write-barrier-install-input-invalid')
  }
  return name
}

function createReviewOptions(
  value: unknown
): CreateSupabaseBackfillWriteBarrierInstallReviewOptionsV1 {
  const source = exactRecord(value, CREATE_REVIEW_KEYS)
  const review = ownData(source, 'review')
  const absentVerification = ownData(source, 'absentVerification')
  if (
    review === null ||
    typeof review !== 'object' ||
    absentVerification === null ||
    typeof absentVerification !== 'object'
  ) {
    return fail('supabase-backfill-write-barrier-install-input-invalid')
  }
  return Object.freeze({
    review: review as SupabaseBackfillWriteBarrierReviewEnvelopeV1,
    absentVerification: absentVerification as SupabaseBackfillWriteBarrierVerificationV1
  })
}

/** Build the exact endpoint-ready SQL without creating or consuming mutation authority. */
export async function createSupabaseBackfillWriteBarrierInstallReviewV1(
  input: CreateSupabaseBackfillWriteBarrierInstallReviewOptionsV1
): Promise<SupabaseBackfillWriteBarrierInstallReviewEnvelopeV1> {
  const options = createReviewOptions(input)
  const verification = trustedSupabaseBackfillWriteBarrierAbsentVerificationV1(
    options.absentVerification,
    options.review
  )
  if (!verification) return fail('supabase-backfill-write-barrier-install-proof-invalid')
  const reviewContext = trustedSupabaseBackfillWriteBarrierReviewContextV1(options.review)
  if (!reviewContext) return fail('supabase-backfill-write-barrier-install-proof-invalid')
  const sql = installSql(options.review, reviewContext.inspection, verification)
  const sqlDigest = await digestSql(sql)
  const name = migrationName(options.review)
  const reviewWithoutDigest = Object.freeze({
    format: SUPABASE_BACKFILL_WRITE_BARRIER_INSTALL_REVIEW_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environmentIntent: 'staging' as const,
    environmentVerified: false as const,
    reviewOnly: true as const,
    applyAvailable: false as const,
    releaseReady: false as const,
    sourceLedgerBound: false as const,
    mutationAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    bindings: Object.freeze({
      reviewDigest: options.review.reviewDigest,
      verificationDigest: verification.verificationDigest,
      subjectDigest: options.review.review.bindings.subjectDigest,
      inspectionDigest: options.review.review.bindings.inspectionDigest,
      logicalScopeDigest: options.review.review.bindings.logicalScopeDigest,
      markerBindingDigest: options.review.review.bindings.markerBindingDigest,
      catalogPreconditionDigest: options.review.review.bindings.catalogPreconditionDigest,
      installDigest: sqlDigest
    }),
    authority: Object.freeze({ ...options.review.review.authority }),
    address: Object.freeze({
      schemaName: 'public' as const,
      schemaOid: options.review.review.address.schemaOid,
      tableName: options.review.review.address.tableName,
      tableOid: options.review.review.address.tableOid,
      targetField: options.review.review.address.targetField,
      targetSubId: options.review.review.address.targetSubId,
      targetTypeOid: options.review.review.address.targetTypeOid
    }),
    migration: Object.freeze({
      name,
      endpointKind: 'management-api-migration' as const,
      transactionIsolation: 'serializable' as const,
      lockMode: 'access-exclusive' as const,
      reinspectionUnderLock: true as const,
      sourceLedgerBound: false as const
    }),
    artifact: Object.freeze({
      path: SUPABASE_BACKFILL_WRITE_BARRIER_INSTALL_ARTIFACT_PATH,
      kind: 'database-schema-install-review' as const,
      mediaType: 'application/sql; charset=utf-8' as const,
      byteLength: new TextEncoder().encode(sql).byteLength,
      digest: sqlDigest,
      statementCount: 6 as const,
      mutationStatementCount: 2 as const,
      containsCatalogRead: true as const,
      containsManagedDataRead: false as const,
      containsDml: false as const,
      performsSchemaChange: true as const,
      mutationDispatched: false as const,
      hostDispatchAvailable: false as const
    }),
    blockers: Object.freeze([
      'staging-target-not-confirmed',
      'database-write-authority-not-bound',
      'dispatch-not-journaled',
      'write-barrier-installed-proof-not-observed',
      'source-migration-ledger-not-bound',
      'locked-high-water-not-captured',
      'database-batch-ledger-not-bound',
      'execution-runner-unavailable'
    ])
  }) satisfies SupabaseBackfillWriteBarrierInstallReviewV1
  const reviewDigest = await digest(reviewWithoutDigest)
  const envelope = Object.freeze({ review: reviewWithoutDigest, reviewDigest, installSql: sql })
  trustedInstallReviewContexts.set(
    envelope,
    Object.freeze({
      envelope,
      sourceReview: options.review,
      absentVerification: verification,
      reviewContext,
      installSql: sql
    })
  )
  return envelope
}

function confirmationSnapshot(value: unknown): SupabaseBackfillWriteBarrierInstallConfirmationV1 {
  const source = exactRecord(value, CONFIRMATION_KEYS)
  const confirmation = Object.freeze({
    reviewDigest: digestText(ownData(source, 'reviewDigest')),
    verificationDigest: digestText(ownData(source, 'verificationDigest')),
    installDigest: digestText(ownData(source, 'installDigest')),
    projectRefConfirmation: projectRef(ownData(source, 'projectRefConfirmation')),
    accountIdConfirmation: stableId(ownData(source, 'accountIdConfirmation')),
    writeGrantGeneration: stableId(ownData(source, 'writeGrantGeneration')),
    confirmedIndependentStaging: ownData(source, 'confirmedIndependentStaging'),
    confirmedMigrationApply: ownData(source, 'confirmedMigrationApply')
  })
  if (
    confirmation.confirmedIndependentStaging !== true ||
    confirmation.confirmedMigrationApply !== true
  ) {
    return fail('supabase-backfill-write-barrier-install-confirmation-mismatch')
  }
  return confirmation as SupabaseBackfillWriteBarrierInstallConfirmationV1
}

function writeAuthoritySnapshot(value: unknown): SupabaseBackfillWriteBarrierWriteAuthorityV1 {
  const source = exactRecord(value, WRITE_AUTHORITY_KEYS)
  const authority = Object.freeze({
    projectRef: projectRef(ownData(source, 'projectRef')),
    accountId: stableId(ownData(source, 'accountId')),
    grantGeneration: stableId(ownData(source, 'grantGeneration')),
    scope: ownData(source, 'scope'),
    permission: ownData(source, 'permission')
  })
  if (
    authority.scope !== 'database:write' ||
    authority.permission !== 'database_migrations_write'
  ) {
    return fail('supabase-backfill-write-barrier-install-write-authority-invalid')
  }
  return authority as SupabaseBackfillWriteBarrierWriteAuthorityV1
}

function sameStagingTarget(
  left: SupabaseStagingTargetBindingV1,
  right: SupabaseStagingTargetBindingV1
): boolean {
  return (
    left.projectRef === right.projectRef &&
    left.accountId === right.accountId &&
    left.boundAt === right.boundAt
  )
}

function sameWriteAuthority(
  left: SupabaseBackfillWriteBarrierWriteAuthorityV1,
  right: SupabaseBackfillWriteBarrierWriteAuthorityV1
): boolean {
  return (
    left.projectRef === right.projectRef &&
    left.accountId === right.accountId &&
    left.grantGeneration === right.grantGeneration
  )
}

function authorizeOptions(value: unknown): {
  readonly installReview: SupabaseBackfillWriteBarrierInstallReviewEnvelopeV1
  readonly stagingTargetBinding: SupabaseStagingTargetBindingV1
  readonly confirmation: SupabaseBackfillWriteBarrierInstallConfirmationV1
  readonly readCurrentCompilerInput: () => MaybePromise<SupabaseBackfillLiveCatalogCompilerInputV1>
  readonly readCurrentWriteAuthority: () => MaybePromise<SupabaseBackfillWriteBarrierWriteAuthorityV1>
  readonly readCurrentStagingTargetBinding: () => MaybePromise<SupabaseStagingTargetBindingV1 | null>
} {
  const source = exactRecord(value, AUTHORIZE_KEYS)
  const installReview = ownData(source, 'installReview')
  const readCurrentCompilerInput = ownData(source, 'readCurrentCompilerInput')
  const readCurrentWriteAuthority = ownData(source, 'readCurrentWriteAuthority')
  const readCurrentStagingTargetBinding = ownData(source, 'readCurrentStagingTargetBinding')
  if (
    installReview === null ||
    typeof installReview !== 'object' ||
    typeof readCurrentCompilerInput !== 'function' ||
    typeof readCurrentWriteAuthority !== 'function' ||
    typeof readCurrentStagingTargetBinding !== 'function'
  ) {
    return fail('supabase-backfill-write-barrier-install-input-invalid')
  }
  let stagingTargetBinding: SupabaseStagingTargetBindingV1
  try {
    stagingTargetBinding = parseSupabaseStagingTargetBinding(
      ownData(source, 'stagingTargetBinding')
    )
  } catch {
    return fail('supabase-backfill-write-barrier-install-staging-target-mismatch')
  }
  return Object.freeze({
    installReview: installReview as SupabaseBackfillWriteBarrierInstallReviewEnvelopeV1,
    stagingTargetBinding,
    confirmation: confirmationSnapshot(ownData(source, 'confirmation')),
    readCurrentCompilerInput:
      readCurrentCompilerInput as () => MaybePromise<SupabaseBackfillLiveCatalogCompilerInputV1>,
    readCurrentWriteAuthority:
      readCurrentWriteAuthority as () => MaybePromise<SupabaseBackfillWriteBarrierWriteAuthorityV1>,
    readCurrentStagingTargetBinding:
      readCurrentStagingTargetBinding as () => MaybePromise<SupabaseStagingTargetBindingV1 | null>
  })
}

async function liveInstallBinding(
  options: ReturnType<typeof authorizeOptions>
): Promise<LiveInstallBinding> {
  try {
    const input = await options.readCurrentCompilerInput()
    const subjectEnvelope = createSupabaseBackfillInspectionSubjectV1(input.registry, {
      plan: input.plan,
      selection: input.selection
    })
    const writeAuthority = writeAuthoritySnapshot(await options.readCurrentWriteAuthority())
    const stagingValue = await options.readCurrentStagingTargetBinding()
    if (stagingValue === null) {
      return fail('supabase-backfill-write-barrier-install-staging-target-mismatch')
    }
    const stagingTarget = parseSupabaseStagingTargetBinding(stagingValue)
    return Object.freeze({
      subject: subjectEnvelope.subject,
      subjectDigest: subjectEnvelope.subjectDigest,
      writeAuthority,
      stagingTarget
    })
  } catch (cause) {
    if (cause instanceof SupabaseBackfillWriteBarrierInstallError) throw cause
    return fail('supabase-backfill-write-barrier-install-input-invalid')
  }
}

function requireLiveBinding(
  live: LiveInstallBinding,
  context: TrustedInstallReviewContext,
  stagingTarget: SupabaseStagingTargetBindingV1,
  expectedWriteAuthority: SupabaseBackfillWriteBarrierWriteAuthorityV1
): void {
  if (
    live.subjectDigest !== context.sourceReview.review.bindings.subjectDigest ||
    live.subject.providerAuthority.digest !==
      context.reviewContext.subject.providerAuthority.digest ||
    !sameWriteAuthority(live.writeAuthority, expectedWriteAuthority) ||
    !sameStagingTarget(live.stagingTarget, stagingTarget)
  ) {
    fail('supabase-backfill-write-barrier-install-input-changed')
  }
}

function requireConfirmation(
  context: TrustedInstallReviewContext,
  stagingTarget: SupabaseStagingTargetBindingV1,
  confirmation: SupabaseBackfillWriteBarrierInstallConfirmationV1
): void {
  const source = context.sourceReview
  const install = context.envelope
  if (
    confirmation.reviewDigest !== source.reviewDigest ||
    confirmation.verificationDigest !== context.absentVerification.verificationDigest ||
    confirmation.installDigest !== install.review.bindings.installDigest ||
    confirmation.projectRefConfirmation !== source.review.authority.projectRef ||
    confirmation.accountIdConfirmation !== source.review.authority.accountId ||
    stagingTarget.projectRef !== source.review.authority.projectRef ||
    stagingTarget.accountId !== source.review.authority.accountId
  ) {
    fail('supabase-backfill-write-barrier-install-confirmation-mismatch')
  }
}

/**
 * Mint one operation-scoped dispatch capability after exact staging, confirmation, compiler, and
 * dedicated write-grant checks. The genuine review and absent proof are consumed synchronously
 * before this function reaches its first await.
 */
export async function authorizeSupabaseBackfillWriteBarrierInstallV1(
  input: AuthorizeSupabaseBackfillWriteBarrierInstallOptionsV1
): Promise<SupabaseBackfillWriteBarrierInstallDispatchContextV1> {
  const options = authorizeOptions(input)
  const context = trustedInstallReviewContexts.get(options.installReview)
  if (!context || consumedInstallReviews.has(options.installReview)) {
    return fail('supabase-backfill-write-barrier-install-proof-invalid')
  }
  requireConfirmation(context, options.stagingTargetBinding, options.confirmation)
  const consumed = consumeTrustedSupabaseBackfillWriteBarrierAbsentPreparationV1(
    context.absentVerification,
    context.sourceReview
  )
  if (
    !consumed ||
    consumed.reviewContext !== context.reviewContext ||
    consumed.verification !== context.absentVerification
  ) {
    return fail('supabase-backfill-write-barrier-install-proof-invalid')
  }
  consumedInstallReviews.add(options.installReview)

  const initial = await liveInstallBinding(options)
  const expectedWriteAuthority = writeAuthoritySnapshot(initial.writeAuthority)
  if (
    expectedWriteAuthority.projectRef !== context.sourceReview.review.authority.projectRef ||
    expectedWriteAuthority.accountId !== context.sourceReview.review.authority.accountId ||
    expectedWriteAuthority.grantGeneration !== options.confirmation.writeGrantGeneration
  ) {
    return fail('supabase-backfill-write-barrier-install-write-authority-invalid')
  }
  if (
    expectedWriteAuthority.grantGeneration === context.sourceReview.review.authority.grantGeneration
  ) {
    return fail('supabase-backfill-write-barrier-install-write-authority-not-separated')
  }
  requireLiveBinding(initial, context, options.stagingTargetBinding, expectedWriteAuthority)
  const final = await liveInstallBinding(options)
  requireLiveBinding(final, context, options.stagingTargetBinding, expectedWriteAuthority)

  const publicContext = Object.freeze({
    format: SUPABASE_BACKFILL_WRITE_BARRIER_INSTALL_DISPATCH_CONTEXT_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    projectRef: expectedWriteAuthority.projectRef,
    accountId: expectedWriteAuthority.accountId,
    reviewDigest: context.sourceReview.reviewDigest,
    verificationDigest: context.absentVerification.verificationDigest,
    installDigest: context.envelope.review.bindings.installDigest,
    migrationName: context.envelope.review.migration.name,
    sourceLedgerBound: false as const,
    releaseReady: false as const
  }) satisfies SupabaseBackfillWriteBarrierInstallDispatchContextV1
  trustedDispatchContexts.set(
    publicContext,
    Object.freeze({
      projectRef: expectedWriteAuthority.projectRef,
      accountId: expectedWriteAuthority.accountId,
      grantGeneration: expectedWriteAuthority.grantGeneration,
      migrationName: context.envelope.review.migration.name,
      installSql: context.installSql,
      installDigest: context.envelope.review.bindings.installDigest
    })
  )
  trustedDispatchEvidenceContexts.set(
    publicContext,
    Object.freeze({
      installReview: context.envelope,
      sourceReview: context.sourceReview,
      absentVerification: context.absentVerification,
      writeAuthority: expectedWriteAuthority,
      stagingTarget: options.stagingTargetBinding
    })
  )
  return publicContext
}

/** Non-consuming identity lookup for the specialized durable journal controller. */
export function trustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1(
  value: unknown
): TrustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1 | null {
  if (value === null || typeof value !== 'object') return null
  return trustedDispatchEvidenceContexts.get(value) ?? null
}

/** Consume the private SQL/grant projection once inside the fixed Management API transport. */
export function consumeTrustedSupabaseBackfillWriteBarrierInstallDispatchContextV1(
  value: unknown
): TrustedSupabaseBackfillWriteBarrierInstallDispatchV1 | null {
  if (value === null || typeof value !== 'object' || consumedDispatchContexts.has(value)) {
    return null
  }
  const context = trustedDispatchContexts.get(value)
  if (!context) return null
  consumedDispatchContexts.add(value)
  return context
}
