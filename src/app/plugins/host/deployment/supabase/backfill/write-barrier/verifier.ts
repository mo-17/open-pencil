/* eslint-disable max-lines -- fixed catalog SQL and strict inert decoders stay co-located */

import {
  createSupabaseBackfillInspectionSubjectV1,
  type SupabaseBackfillInspectionSubjectEnvelopeV1
} from '@open-pencil/compiler/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  type SupabaseBackfillLiveCatalogAuthorityV1,
  type SupabaseBackfillLiveCatalogCompilerInputV1,
  type SupabaseBackfillLiveCatalogProjectAuthorityV1
} from '../live-inspector'
import {
  consumeTrustedSupabaseBackfillWriteBarrierReviewContextV1,
  trustedSupabaseBackfillWriteBarrierReviewContextV1,
  type SupabaseBackfillWriteBarrierReviewEnvelopeV1,
  type TrustedSupabaseBackfillWriteBarrierReviewContextV1
} from './review'

export const SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_VERSION =
  'openpencil-supabase-backfill-write-barrier-verification-v1' as const
export const SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_ID =
  'backfill-write-barrier-verification' as const
export const SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_FORMAT =
  'openpencil.supabase-backfill-write-barrier-verification.v1' as const

export const SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_PARAMETER_ORDER = Object.freeze([
  'schema',
  'table',
  'entityMarker',
  'tableOid',
  'targetField',
  'targetMarker',
  'targetSubId',
  'targetTypeOid',
  'constraintName',
  'barrierMarker',
  'subjectDigest',
  'reviewDigest',
  'projectRef',
  'accountId',
  'grantGeneration',
  'queryVersion',
  'queryDigest'
] as const)

/**
 * One fixed pg_catalog-only statement. It never returns a raw constraint expression: PostgreSQL
 * compares the server-rendered expression to the single allowed predicate and returns counts only.
 */
export const SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_SQL = `WITH "requested" AS (
  SELECT
    $1::"pg_catalog"."name" AS "schema_name",
    $2::"pg_catalog"."name" AS "table_name",
    $3::"pg_catalog"."text" AS "entity_marker",
    $4::"pg_catalog"."oid" AS "table_oid",
    $5::"pg_catalog"."name" AS "target_field",
    $6::"pg_catalog"."text" AS "target_marker",
    $7::"pg_catalog"."int2" AS "target_sub_id",
    $8::"pg_catalog"."oid" AS "target_type_oid",
    $9::"pg_catalog"."name" AS "constraint_name",
    $10::"pg_catalog"."text" AS "barrier_marker",
    $11::"pg_catalog"."text" AS "subject_digest",
    $12::"pg_catalog"."text" AS "review_digest",
    $13::"pg_catalog"."text" AS "project_ref",
    $14::"pg_catalog"."text" AS "account_id",
    $15::"pg_catalog"."text" AS "grant_generation",
    $16::"pg_catalog"."text" AS "query_version",
    $17::"pg_catalog"."text" AS "query_digest"
),
"managed_table" AS (
  SELECT
    "namespace_entry"."oid" AS "schema_oid",
    "namespace_entry"."nspname" AS "schema_name",
    "table_entry"."oid" AS "table_oid",
    "table_entry"."relname" AS "table_name",
    "table_entry"."relowner" AS "owner_oid",
    "table_owner"."rolname" AS "owner_name",
    "table_entry"."relrowsecurity" AS "rls_enabled",
    "table_entry"."relforcerowsecurity" AS "rls_forced",
    "table_entry"."relchecks" AS "check_count"
  FROM "pg_catalog"."pg_class" AS "table_entry"
  JOIN "pg_catalog"."pg_namespace" AS "namespace_entry"
    ON "namespace_entry"."oid" = "table_entry"."relnamespace"
  JOIN "pg_catalog"."pg_roles" AS "table_owner"
    ON "table_owner"."oid" = "table_entry"."relowner"
  CROSS JOIN "requested"
  WHERE "namespace_entry"."nspname" = "requested"."schema_name"
    AND "table_entry"."relname" = "requested"."table_name"
    AND "table_entry"."oid" = "requested"."table_oid"
    AND "table_entry"."relkind" = 'r'
    AND "pg_catalog"."obj_description"("table_entry"."oid", 'pg_class') =
      "requested"."entity_marker"
),
"target_column" AS (
  SELECT
    "column_entry"."attrelid" AS "table_oid",
    "column_entry"."attnum" AS "sub_id",
    "column_entry"."attname" AS "column_name",
    "column_entry"."atttypid" AS "type_oid"
  FROM "pg_catalog"."pg_attribute" AS "column_entry"
  JOIN "managed_table" ON "managed_table"."table_oid" = "column_entry"."attrelid"
  CROSS JOIN "requested"
  WHERE "column_entry"."attname" = "requested"."target_field"
    AND "column_entry"."attnum" = "requested"."target_sub_id"
    AND "column_entry"."atttypid" = "requested"."target_type_oid"
    AND "column_entry"."attnum" > 0
    AND NOT "column_entry"."attisdropped"
    AND NOT "column_entry"."attnotnull"
    AND "column_entry"."attidentity" = ''
    AND "column_entry"."attgenerated" = ''
    AND NOT EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_attrdef" AS "column_default"
      WHERE "column_default"."adrelid" = "column_entry"."attrelid"
        AND "column_default"."adnum" = "column_entry"."attnum"
    )
    AND "pg_catalog"."col_description"(
      "column_entry"."attrelid",
      "column_entry"."attnum"
    ) = "requested"."target_marker"
),
"check_constraints" AS (
  SELECT
    "constraint_entry"."oid" AS "constraint_oid",
    "constraint_entry"."conname" AS "constraint_name",
    "pg_catalog"."obj_description"(
      "constraint_entry"."oid",
      'pg_constraint'
    ) AS "marker",
    (
      "constraint_entry"."conkey" =
        ARRAY["target_column"."sub_id"]::"pg_catalog"."int2"[]
      AND "constraint_entry"."contypid" = 0
      AND "constraint_entry"."conindid" = 0
      AND "constraint_entry"."confrelid" = 0
      AND "constraint_entry"."conparentid" = 0
      AND NOT "constraint_entry"."condeferrable"
      AND NOT "constraint_entry"."condeferred"
      AND NOT "constraint_entry"."convalidated"
      AND "constraint_entry"."connoinherit"
      AND "constraint_entry"."conislocal"
      AND "constraint_entry"."coninhcount" = 0
      AND "constraint_entry"."conbin" IS NOT NULL
      AND "pg_catalog"."pg_get_expr"(
        "constraint_entry"."conbin",
        "constraint_entry"."conrelid",
        FALSE
      ) = "pg_catalog"."format"('(%I IS NOT NULL)', "requested"."target_field")
    ) AS "definition_matches"
  FROM "managed_table"
  JOIN "target_column" ON "target_column"."table_oid" = "managed_table"."table_oid"
  JOIN "pg_catalog"."pg_constraint" AS "constraint_entry"
    ON "constraint_entry"."conrelid" = "managed_table"."table_oid"
   AND "constraint_entry"."contype" = 'c'
  CROSS JOIN "requested"
),
"constraint_inventory" AS (
  SELECT
    COUNT("check_constraints"."constraint_oid")::"pg_catalog"."int4" AS "total_count",
    COUNT(*) FILTER (
      WHERE "check_constraints"."constraint_name" = "requested"."constraint_name"
    )::"pg_catalog"."int4" AS "name_match_count",
    COUNT(*) FILTER (
      WHERE "check_constraints"."marker" = "requested"."barrier_marker"
    )::"pg_catalog"."int4" AS "marker_match_count",
    (
      SELECT COUNT(*)::"pg_catalog"."int4"
      FROM "pg_catalog"."pg_constraint" AS "global_constraint"
      WHERE "pg_catalog"."obj_description"(
        "global_constraint"."oid",
        'pg_constraint'
      ) = "requested"."barrier_marker"
    ) AS "global_marker_match_count",
    COUNT(*) FILTER (
      WHERE "check_constraints"."definition_matches"
    )::"pg_catalog"."int4" AS "definition_match_count",
    COUNT(*) FILTER (
      WHERE "check_constraints"."constraint_name" = "requested"."constraint_name"
        AND "check_constraints"."marker" = "requested"."barrier_marker"
        AND "check_constraints"."definition_matches"
    )::"pg_catalog"."int4" AS "exact_match_count",
    MIN("check_constraints"."constraint_oid") FILTER (
      WHERE "check_constraints"."constraint_name" = "requested"."constraint_name"
        AND "check_constraints"."marker" = "requested"."barrier_marker"
        AND "check_constraints"."definition_matches"
    ) AS "exact_constraint_oid"
  FROM "requested"
  LEFT JOIN "check_constraints" ON TRUE
),
"current_role_entry" AS (
  SELECT "role_entry".*
  FROM "pg_catalog"."pg_roles" AS "role_entry"
  WHERE "role_entry"."rolname" = CURRENT_USER
),
"session_role_entry" AS (
  SELECT "role_entry".*
  FROM "pg_catalog"."pg_roles" AS "role_entry"
  WHERE "role_entry"."rolname" = SESSION_USER
)
SELECT
  "requested"."subject_digest" AS "subjectDigest",
  "requested"."review_digest" AS "reviewDigest",
  "requested"."project_ref" AS "projectRef",
  "requested"."account_id" AS "accountId",
  "requested"."grant_generation" AS "grantGeneration",
  "requested"."query_version" AS "queryVersion",
  "requested"."query_digest" AS "queryDigest",
  'read-only'::"pg_catalog"."text" AS "accessMode",
  'single-statement'::"pg_catalog"."text" AS "snapshotScope",
  TRUE AS "catalogOnly",
  "pg_catalog"."current_setting"('server_version_num') AS "serverVersionNum",
  "pg_catalog"."txid_current_snapshot"()::"pg_catalog"."text" AS "snapshotMarker",
  "pg_catalog"."to_char"(
    "pg_catalog"."statement_timestamp"() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS "observedAt",
  "pg_catalog"."jsonb_build_object"(
    'currentOid', "current_role_entry"."oid"::"pg_catalog"."text",
    'currentName', CURRENT_USER::"pg_catalog"."text",
    'currentSuperuser', "current_role_entry"."rolsuper",
    'sessionOid', "session_role_entry"."oid"::"pg_catalog"."text",
    'sessionName', SESSION_USER::"pg_catalog"."text",
    'sessionSuperuser', "session_role_entry"."rolsuper"
  ) AS "roles",
  "pg_catalog"."jsonb_build_object"(
    'databasePrimary', NOT "pg_catalog"."pg_is_in_recovery"(),
    'effectiveSearchPath', "pg_catalog"."to_jsonb"("pg_catalog"."current_schemas"(TRUE))
  ) AS "settings",
  "pg_catalog"."jsonb_build_object"(
    'schemaOid', "managed_table"."schema_oid"::"pg_catalog"."text",
    'tableOid', "managed_table"."table_oid"::"pg_catalog"."text",
    'tableOwnerOid', "managed_table"."owner_oid"::"pg_catalog"."text",
    'tableOwnerName', "managed_table"."owner_name"::"pg_catalog"."text",
    'tableRlsEnabled', "managed_table"."rls_enabled",
    'tableRlsForced', "managed_table"."rls_forced",
    'tableCheckCount', "managed_table"."check_count",
    'targetSubId', "target_column"."sub_id",
    'targetTypeOid', "target_column"."type_oid"::"pg_catalog"."text"
  ) AS "address",
  "pg_catalog"."jsonb_build_object"(
    'totalCheckConstraintCount', "constraint_inventory"."total_count",
    'nameMatchCount', "constraint_inventory"."name_match_count",
    'markerMatchCount', "constraint_inventory"."marker_match_count",
    'globalMarkerMatchCount', "constraint_inventory"."global_marker_match_count",
    'definitionMatchCount', "constraint_inventory"."definition_match_count",
    'exactMatchCount', "constraint_inventory"."exact_match_count",
    'constraintOid', "constraint_inventory"."exact_constraint_oid"::"pg_catalog"."text"
  ) AS "barrier"
FROM "requested"
JOIN "managed_table" ON TRUE
JOIN "target_column" ON "target_column"."table_oid" = "managed_table"."table_oid"
JOIN "constraint_inventory" ON TRUE
JOIN "current_role_entry" ON TRUE
JOIN "session_role_entry" ON TRUE`

export const SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_FIXED_QUERY = Object.freeze({
  queryId: SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_ID,
  version: SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_VERSION,
  sql: SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_SQL,
  parameterOrder: SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_PARAMETER_ORDER,
  statementCount: 1 as const,
  catalogOnly: true as const,
  accessMode: 'read-only' as const,
  snapshotScope: 'single-statement' as const
})

export interface SupabaseBackfillWriteBarrierVerificationRequestV1 extends SupabaseBackfillLiveCatalogAuthorityV1 {
  readonly queryId: typeof SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_ID
  readonly queryVersion: typeof SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_VERSION
  readonly queryDigest: string
  readonly subjectDigest: string
  readonly reviewDigest: string
  readonly statementCount: 1
  readonly catalogOnly: true
  readonly accessMode: 'read-only'
  readonly snapshotScope: 'single-statement'
  readonly parameters: Readonly<{
    schema: 'public'
    table: string
    entityMarker: string
    tableOid: string
    targetField: string
    targetMarker: string
    targetSubId: number
    targetTypeOid: string
    constraintName: string
    barrierMarker: string
    subjectDigest: string
    reviewDigest: string
    projectRef: string
    accountId: string
    grantGeneration: string
    queryVersion: typeof SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_VERSION
    queryDigest: string
  }>
}

export interface SupabaseBackfillWriteBarrierVerificationHostTransportV1 {
  getProjectAuthority(
    request: SupabaseBackfillLiveCatalogAuthorityV1
  ): Promise<SupabaseBackfillLiveCatalogProjectAuthorityV1>
  runReadOnlyWriteBarrierVerificationQuery(
    request: SupabaseBackfillWriteBarrierVerificationRequestV1
  ): Promise<unknown>
}

export type SupabaseBackfillWriteBarrierStateV1 = 'absent' | 'installed' | 'mismatch'

export interface SupabaseBackfillWriteBarrierVerificationV1 {
  readonly format: typeof SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly reviewOnly: true
  readonly applyAvailable: false
  readonly releaseReady: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly subjectDigest: string
  readonly reviewDigest: string
  readonly verificationDigest: string
  readonly authority: SupabaseBackfillLiveCatalogAuthorityV1
  readonly query: Readonly<{
    id: typeof SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_ID
    version: typeof SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_VERSION
    digest: string
    statementCount: 1
    catalogOnly: true
    accessMode: 'read-only'
    snapshotScope: 'single-statement'
  }>
  readonly observedAt: string
  readonly snapshotMarker: string
  readonly serverVersionNum: string
  readonly state: SupabaseBackfillWriteBarrierStateV1
  readonly verifiedInstalled: boolean
  readonly roles: Readonly<{
    currentOid: string
    currentName: string
    currentSuperuser: boolean
    sessionOid: string
    sessionName: string
    sessionSuperuser: boolean
  }>
  readonly settings: Readonly<{
    databasePrimary: boolean
    effectiveSearchPath: readonly string[]
  }>
  readonly address: Readonly<{
    schemaOid: string
    tableOid: string
    tableOwnerOid: string
    tableOwnerName: string
    tableRlsEnabled: boolean
    tableRlsForced: boolean
    tableCheckCount: number
    targetSubId: number
    targetTypeOid: string
  }>
  readonly barrier: Readonly<{
    constraintName: string
    marker: string
    constraintOid: string | null
    totalCheckConstraintCount: number
    nameMatchCount: number
    markerMatchCount: number
    globalMarkerMatchCount: number
    definitionMatchCount: number
    exactMatchCount: number
    rawDefinitionReturned: false
  }>
  readonly checks: Readonly<{
    queryRoleMatchesReadOnlyEndpoint: boolean
    queryRoleIsNonSuperuser: boolean
    currentAndSessionRoleMatch: boolean
    databaseIsPrimary: boolean
    searchPathIsBounded: boolean
    tableRlsIsForced: boolean
    exactBarrierState: boolean
    allVerificationChecksPassed: boolean
  }>
  readonly blockers: readonly string[]
}

type MaybePromise<T> = T | Promise<T>

export interface VerifySupabaseBackfillWriteBarrierOptionsV1 {
  readonly review: SupabaseBackfillWriteBarrierReviewEnvelopeV1
  readonly readCurrentCompilerInput: () => MaybePromise<SupabaseBackfillLiveCatalogCompilerInputV1>
  readonly readCurrentAuthority: () => MaybePromise<SupabaseBackfillLiveCatalogAuthorityV1>
  readonly transport: SupabaseBackfillWriteBarrierVerificationHostTransportV1
}

export type SupabaseBackfillWriteBarrierVerificationErrorCode =
  | 'supabase-backfill-write-barrier-verification-input-invalid'
  | 'supabase-backfill-write-barrier-verification-input-changed'
  | 'supabase-backfill-write-barrier-verification-project-authority-mismatch'
  | 'supabase-backfill-write-barrier-verification-response-invalid'
  | 'supabase-backfill-write-barrier-verification-query-binding-mismatch'
  | 'supabase-backfill-write-barrier-verification-address-mismatch'
  | 'supabase-backfill-write-barrier-verification-transport-failed'
  | 'supabase-backfill-write-barrier-verification-digest-failed'

export class SupabaseBackfillWriteBarrierVerificationError extends Error {
  constructor(readonly code: SupabaseBackfillWriteBarrierVerificationErrorCode) {
    super(`Supabase backfill write-barrier verification failed: ${code}.`)
    this.name = 'SupabaseBackfillWriteBarrierVerificationError'
  }
}

interface TrustedVerificationContext {
  readonly review: SupabaseBackfillWriteBarrierReviewEnvelopeV1
  readonly verification: SupabaseBackfillWriteBarrierVerificationV1
  readonly installedVerificationEpoch: SupabaseBackfillWriteBarrierInstalledVerificationEpochV1
}

type UnknownRecord = Record<PropertyKey, unknown>

declare const SUPABASE_BACKFILL_WRITE_BARRIER_INSTALLED_VERIFICATION_EPOCH_BRAND: unique symbol

/**
 * Opaque same-process freshness capability. Runtime acceptance depends on object identity retained
 * by this module; serialized, cloned, or structurally forged values cannot satisfy the comparison.
 */
export type SupabaseBackfillWriteBarrierInstalledVerificationEpochV1 = Readonly<{
  readonly [SUPABASE_BACKFILL_WRITE_BARRIER_INSTALLED_VERIFICATION_EPOCH_BRAND]: true
}>

const trustedVerificationContexts = new WeakMap<object, TrustedVerificationContext>()
const installedVerificationEpochs = new WeakMap<
  SupabaseBackfillWriteBarrierReviewEnvelopeV1,
  SupabaseBackfillWriteBarrierInstalledVerificationEpochV1
>()
const consumedAbsentVerifications = new WeakSet<object>()
const consumedInstalledVerifications = new WeakSet<object>()
const OPTION_KEYS = [
  'review',
  'readCurrentCompilerInput',
  'readCurrentAuthority',
  'transport'
] as const
const RESPONSE_KEYS = [
  'subjectDigest',
  'reviewDigest',
  'projectRef',
  'accountId',
  'grantGeneration',
  'queryVersion',
  'queryDigest',
  'accessMode',
  'snapshotScope',
  'catalogOnly',
  'serverVersionNum',
  'snapshotMarker',
  'observedAt',
  'roles',
  'settings',
  'address',
  'barrier'
] as const
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const PROJECT_REF = /^[a-z]{20}$/u
const OID = /^(?:0|[1-9][0-9]{0,9})$/u
const SNAPSHOT_MARKER = /^[0-9:,]{1,512}$/u

function freshInstalledVerificationEpoch(): SupabaseBackfillWriteBarrierInstalledVerificationEpochV1 {
  return Object.freeze({}) as SupabaseBackfillWriteBarrierInstalledVerificationEpochV1
}

function currentInstalledVerificationEpoch(
  review: SupabaseBackfillWriteBarrierReviewEnvelopeV1
): SupabaseBackfillWriteBarrierInstalledVerificationEpochV1 {
  const current = installedVerificationEpochs.get(review)
  if (current) return current
  const initial = freshInstalledVerificationEpoch()
  installedVerificationEpochs.set(review, initial)
  return initial
}
const SUPPORTED_SERVER_VERSION = /^(?:15|16|17)[0-9]{4}$/u
const MAX_COUNT = 1_000_000

function fail(code: SupabaseBackfillWriteBarrierVerificationErrorCode): never {
  throw new SupabaseBackfillWriteBarrierVerificationError(code)
}

function ownData(
  value: object,
  key: PropertyKey,
  code: SupabaseBackfillWriteBarrierVerificationErrorCode = 'supabase-backfill-write-barrier-verification-input-invalid'
): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail(code)
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return fail(code)
  }
  return descriptor.value
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  code: SupabaseBackfillWriteBarrierVerificationErrorCode
): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail(code)
  let prototype: object | null
  let ownKeys: readonly PropertyKey[]
  try {
    prototype = Object.getPrototypeOf(value)
    ownKeys = Reflect.ownKeys(value)
  } catch {
    return fail(code)
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return fail(code)
  }
  for (const key of keys) ownData(value, key, code)
  return value as UnknownRecord
}

function text(value: unknown, code: SupabaseBackfillWriteBarrierVerificationErrorCode): string {
  if (typeof value !== 'string' || value.includes('\0') || value.length > 8_192) return fail(code)
  return value
}

function stableId(value: unknown, code: SupabaseBackfillWriteBarrierVerificationErrorCode): string {
  const parsed = text(value, code)
  if (!STABLE_ID.test(parsed)) return fail(code)
  return parsed
}

function oid(value: unknown, code: SupabaseBackfillWriteBarrierVerificationErrorCode): string {
  if (typeof value !== 'string' || !OID.test(value)) return fail(code)
  return value
}

function boolean(value: unknown, code: SupabaseBackfillWriteBarrierVerificationErrorCode): boolean {
  if (typeof value !== 'boolean') return fail(code)
  return value
}

function integer(value: unknown, code: SupabaseBackfillWriteBarrierVerificationErrorCode): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_COUNT) {
    return fail(code)
  }
  return value as number
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return fail('supabase-backfill-write-barrier-verification-response-invalid')
  }
  if (new Date(value).toISOString() !== value) {
    return fail('supabase-backfill-write-barrier-verification-response-invalid')
  }
  return value
}

function sameAuthority(
  left: SupabaseBackfillLiveCatalogAuthorityV1,
  right: SupabaseBackfillLiveCatalogAuthorityV1
): boolean {
  return (
    left.projectRef === right.projectRef &&
    left.accountId === right.accountId &&
    left.grantGeneration === right.grantGeneration
  )
}

function checkedAuthority(value: unknown): SupabaseBackfillLiveCatalogAuthorityV1 {
  const source = exactRecord(
    value,
    ['projectRef', 'accountId', 'grantGeneration'],
    'supabase-backfill-write-barrier-verification-input-invalid'
  )
  const projectRef = ownData(source, 'projectRef')
  const accountId = ownData(source, 'accountId')
  const grantGeneration = ownData(source, 'grantGeneration')
  if (typeof projectRef !== 'string' || !PROJECT_REF.test(projectRef)) {
    return fail('supabase-backfill-write-barrier-verification-input-invalid')
  }
  return Object.freeze({
    projectRef,
    accountId: stableId(accountId, 'supabase-backfill-write-barrier-verification-input-invalid'),
    grantGeneration: stableId(
      grantGeneration,
      'supabase-backfill-write-barrier-verification-input-invalid'
    )
  })
}

function optionsSnapshot(value: unknown): VerifySupabaseBackfillWriteBarrierOptionsV1 {
  const source = exactRecord(
    value,
    OPTION_KEYS,
    'supabase-backfill-write-barrier-verification-input-invalid'
  )
  const review = ownData(source, 'review')
  const readCurrentCompilerInput = ownData(source, 'readCurrentCompilerInput')
  const readCurrentAuthority = ownData(source, 'readCurrentAuthority')
  const transport = ownData(source, 'transport')
  if (
    !trustedSupabaseBackfillWriteBarrierReviewContextV1(review) ||
    typeof readCurrentCompilerInput !== 'function' ||
    typeof readCurrentAuthority !== 'function' ||
    transport === null ||
    typeof transport !== 'object'
  ) {
    return fail('supabase-backfill-write-barrier-verification-input-invalid')
  }
  return Object.freeze({
    review: review as SupabaseBackfillWriteBarrierReviewEnvelopeV1,
    readCurrentCompilerInput:
      readCurrentCompilerInput as VerifySupabaseBackfillWriteBarrierOptionsV1['readCurrentCompilerInput'],
    readCurrentAuthority:
      readCurrentAuthority as VerifySupabaseBackfillWriteBarrierOptionsV1['readCurrentAuthority'],
    transport: transport as SupabaseBackfillWriteBarrierVerificationHostTransportV1
  })
}

async function currentInputs(options: VerifySupabaseBackfillWriteBarrierOptionsV1) {
  try {
    const compilerInput = await options.readCurrentCompilerInput()
    const authority = checkedAuthority(await options.readCurrentAuthority())
    const subject = createSupabaseBackfillInspectionSubjectV1(compilerInput.registry, {
      plan: compilerInput.plan,
      selection: compilerInput.selection
    })
    return Object.freeze({ subject, authority })
  } catch (cause) {
    if (cause instanceof SupabaseBackfillWriteBarrierVerificationError) throw cause
    return fail('supabase-backfill-write-barrier-verification-input-invalid')
  }
}

function requireSameInputs(
  expectedSubjectDigest: string,
  expectedAuthority: SupabaseBackfillLiveCatalogAuthorityV1,
  current: Readonly<{
    subject: SupabaseBackfillInspectionSubjectEnvelopeV1
    authority: SupabaseBackfillLiveCatalogAuthorityV1
  }>
): void {
  if (
    current.subject.subjectDigest !== expectedSubjectDigest ||
    !sameAuthority(expectedAuthority, current.authority)
  ) {
    fail('supabase-backfill-write-barrier-verification-input-changed')
  }
}

function requireProjectAuthority(
  value: unknown,
  expected: SupabaseBackfillLiveCatalogAuthorityV1
): void {
  const source = exactRecord(
    value,
    ['projectRef', 'organizationId', 'grantGeneration'],
    'supabase-backfill-write-barrier-verification-project-authority-mismatch'
  )
  if (
    ownData(source, 'projectRef') !== expected.projectRef ||
    ownData(source, 'organizationId') !== expected.accountId ||
    ownData(source, 'grantGeneration') !== expected.grantGeneration
  ) {
    fail('supabase-backfill-write-barrier-verification-project-authority-mismatch')
  }
}

function parseRoles(value: unknown) {
  const code = 'supabase-backfill-write-barrier-verification-response-invalid' as const
  const source = exactRecord(
    value,
    [
      'currentOid',
      'currentName',
      'currentSuperuser',
      'sessionOid',
      'sessionName',
      'sessionSuperuser'
    ],
    code
  )
  return Object.freeze({
    currentOid: oid(source.currentOid, code),
    currentName: stableId(source.currentName, code),
    currentSuperuser: boolean(source.currentSuperuser, code),
    sessionOid: oid(source.sessionOid, code),
    sessionName: stableId(source.sessionName, code),
    sessionSuperuser: boolean(source.sessionSuperuser, code)
  })
}

function parseSettings(value: unknown) {
  const code = 'supabase-backfill-write-barrier-verification-response-invalid' as const
  const source = exactRecord(value, ['databasePrimary', 'effectiveSearchPath'], code)
  if (!Array.isArray(source.effectiveSearchPath) || source.effectiveSearchPath.length > 16) {
    return fail(code)
  }
  return Object.freeze({
    databasePrimary: boolean(source.databasePrimary, code),
    effectiveSearchPath: Object.freeze(source.effectiveSearchPath.map((entry) => text(entry, code)))
  })
}

function parseAddress(
  value: unknown,
  review: SupabaseBackfillWriteBarrierReviewEnvelopeV1,
  inspection: TrustedSupabaseBackfillWriteBarrierReviewContextV1['inspection']
) {
  const code = 'supabase-backfill-write-barrier-verification-response-invalid' as const
  const source = exactRecord(
    value,
    [
      'schemaOid',
      'tableOid',
      'tableOwnerOid',
      'tableOwnerName',
      'tableRlsEnabled',
      'tableRlsForced',
      'tableCheckCount',
      'targetSubId',
      'targetTypeOid'
    ],
    code
  )
  const parsed = Object.freeze({
    schemaOid: oid(source.schemaOid, code),
    tableOid: oid(source.tableOid, code),
    tableOwnerOid: oid(source.tableOwnerOid, code),
    tableOwnerName: stableId(source.tableOwnerName, code),
    tableRlsEnabled: boolean(source.tableRlsEnabled, code),
    tableRlsForced: boolean(source.tableRlsForced, code),
    tableCheckCount: integer(source.tableCheckCount, code),
    targetSubId: integer(source.targetSubId, code),
    targetTypeOid: oid(source.targetTypeOid, code)
  })
  const expected = review.review.address
  const expectedTable = inspection.catalog.table
  if (
    parsed.schemaOid !== expected.schemaOid ||
    parsed.tableOid !== expected.tableOid ||
    parsed.tableOwnerOid !== expectedTable.ownerOid ||
    parsed.tableOwnerName !== expectedTable.ownerName ||
    parsed.tableRlsEnabled !== expectedTable.rlsEnabled ||
    parsed.tableRlsForced !== expectedTable.rlsForced ||
    parsed.targetSubId !== expected.targetSubId ||
    parsed.targetTypeOid !== expected.targetTypeOid
  ) {
    return fail('supabase-backfill-write-barrier-verification-address-mismatch')
  }
  return parsed
}

function parseBarrier(value: unknown, review: SupabaseBackfillWriteBarrierReviewEnvelopeV1) {
  const code = 'supabase-backfill-write-barrier-verification-response-invalid' as const
  const source = exactRecord(
    value,
    [
      'totalCheckConstraintCount',
      'nameMatchCount',
      'markerMatchCount',
      'globalMarkerMatchCount',
      'definitionMatchCount',
      'exactMatchCount',
      'constraintOid'
    ],
    code
  )
  const exactMatchCount = integer(source.exactMatchCount, code)
  const constraintOid = source.constraintOid === null ? null : oid(source.constraintOid, code)
  if ((exactMatchCount === 1) !== (constraintOid !== null) || exactMatchCount > 1) return fail(code)
  return Object.freeze({
    constraintName: review.review.barrier.constraintName,
    marker: review.review.barrier.marker,
    constraintOid,
    totalCheckConstraintCount: integer(source.totalCheckConstraintCount, code),
    nameMatchCount: integer(source.nameMatchCount, code),
    markerMatchCount: integer(source.markerMatchCount, code),
    globalMarkerMatchCount: integer(source.globalMarkerMatchCount, code),
    definitionMatchCount: integer(source.definitionMatchCount, code),
    exactMatchCount,
    rawDefinitionReturned: false as const
  })
}

function barrierState(
  barrier: SupabaseBackfillWriteBarrierVerificationV1['barrier']
): SupabaseBackfillWriteBarrierStateV1 {
  const counts = [
    barrier.totalCheckConstraintCount,
    barrier.nameMatchCount,
    barrier.markerMatchCount,
    barrier.globalMarkerMatchCount,
    barrier.definitionMatchCount,
    barrier.exactMatchCount
  ]
  if (counts.every((value) => value === 0) && barrier.constraintOid === null) return 'absent'
  if (counts.every((value) => value === 1) && barrier.constraintOid !== null) return 'installed'
  return 'mismatch'
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index])
}

function blockers(
  state: SupabaseBackfillWriteBarrierStateV1,
  checks: Omit<SupabaseBackfillWriteBarrierVerificationV1['checks'], 'allVerificationChecksPassed'>
): readonly string[] {
  const stateBlockers: string[] = []
  if (state === 'absent') stateBlockers.push('write-barrier-not-installed')
  if (state === 'mismatch') stateBlockers.push('write-barrier-catalog-mismatch')
  const result = [
    ...stateBlockers,
    'locked-high-water-not-captured',
    'database-batch-ledger-not-bound',
    'execution-runner-unavailable'
  ]
  const mapped = [
    ['queryRoleMatchesReadOnlyEndpoint', 'unexpected-read-only-query-role'],
    ['queryRoleIsNonSuperuser', 'privileged-query-role'],
    ['currentAndSessionRoleMatch', 'current-session-role-mismatch'],
    ['databaseIsPrimary', 'database-not-primary'],
    ['searchPathIsBounded', 'search-path-not-bounded'],
    ['tableRlsIsForced', 'table-rls-not-forced'],
    ['exactBarrierState', 'write-barrier-verification-failed']
  ] as const
  for (const [key, blocker] of mapped) if (!checks[key]) result.push(blocker)
  return Object.freeze([...new Set(result)])
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-backfill-write-barrier-verification-digest-failed')
  }
}

async function verificationRequest(
  review: SupabaseBackfillWriteBarrierReviewEnvelopeV1,
  subject: SupabaseBackfillInspectionSubjectEnvelopeV1,
  authority: SupabaseBackfillLiveCatalogAuthorityV1
): Promise<SupabaseBackfillWriteBarrierVerificationRequestV1> {
  const queryDigest = await digest(SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_FIXED_QUERY)
  const parameters = Object.freeze({
    schema: 'public' as const,
    table: subject.subject.migration.entity.table,
    entityMarker: subject.subject.migration.entity.marker,
    tableOid: review.review.address.tableOid,
    targetField: subject.subject.migration.target.field,
    targetMarker: subject.subject.migration.target.marker,
    targetSubId: review.review.address.targetSubId,
    targetTypeOid: review.review.address.targetTypeOid,
    constraintName: review.review.barrier.constraintName,
    barrierMarker: review.review.barrier.marker,
    subjectDigest: subject.subjectDigest,
    reviewDigest: review.reviewDigest,
    projectRef: authority.projectRef,
    accountId: authority.accountId,
    grantGeneration: authority.grantGeneration,
    queryVersion: SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_VERSION,
    queryDigest
  })
  return Object.freeze({
    queryId: SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_ID,
    queryVersion: SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_VERSION,
    queryDigest,
    subjectDigest: subject.subjectDigest,
    reviewDigest: review.reviewDigest,
    ...authority,
    statementCount: 1 as const,
    catalogOnly: true as const,
    accessMode: 'read-only' as const,
    snapshotScope: 'single-statement' as const,
    parameters
  })
}

function responseBindings(
  source: UnknownRecord,
  request: SupabaseBackfillWriteBarrierVerificationRequestV1
): Readonly<{ snapshotMarker: string; serverVersionNum: string }> {
  const code = 'supabase-backfill-write-barrier-verification-response-invalid' as const
  for (const [key, expected] of [
    ['subjectDigest', request.subjectDigest],
    ['reviewDigest', request.reviewDigest],
    ['projectRef', request.projectRef],
    ['accountId', request.accountId],
    ['grantGeneration', request.grantGeneration]
  ] as const) {
    if (source[key] !== expected) return fail(code)
  }
  if (
    source.queryVersion !== request.queryVersion ||
    source.queryDigest !== request.queryDigest ||
    source.accessMode !== 'read-only' ||
    source.snapshotScope !== 'single-statement' ||
    source.catalogOnly !== true
  ) {
    return fail('supabase-backfill-write-barrier-verification-query-binding-mismatch')
  }
  if (typeof source.snapshotMarker !== 'string' || !SNAPSHOT_MARKER.test(source.snapshotMarker)) {
    return fail(code)
  }
  if (
    typeof source.serverVersionNum !== 'string' ||
    !SUPPORTED_SERVER_VERSION.test(source.serverVersionNum)
  ) {
    return fail(code)
  }
  return Object.freeze({
    snapshotMarker: source.snapshotMarker,
    serverVersionNum: source.serverVersionNum
  })
}

async function inspectResponse(
  value: unknown,
  request: SupabaseBackfillWriteBarrierVerificationRequestV1,
  reviewContext: TrustedSupabaseBackfillWriteBarrierReviewContextV1
): Promise<SupabaseBackfillWriteBarrierVerificationV1> {
  const review = reviewContext.envelope
  const code = 'supabase-backfill-write-barrier-verification-response-invalid' as const
  const source = exactRecord(value, RESPONSE_KEYS, code)
  const bindings = responseBindings(source, request)
  const roles = parseRoles(source.roles)
  const settings = parseSettings(source.settings)
  const address = parseAddress(source.address, review, reviewContext.inspection)
  const barrier = parseBarrier(source.barrier, review)
  const state = barrierState(barrier)
  if (address.tableCheckCount !== barrier.totalCheckConstraintCount) return fail(code)
  const queryRoleMatchesReadOnlyEndpoint =
    roles.currentName === 'supabase_read_only_user' &&
    roles.sessionName === 'supabase_read_only_user'
  const queryRoleIsNonSuperuser =
    !roles.currentSuperuser &&
    !roles.sessionSuperuser &&
    roles.currentOid !== address.tableOwnerOid &&
    roles.currentName !== address.tableOwnerName &&
    roles.sessionOid !== address.tableOwnerOid &&
    roles.sessionName !== address.tableOwnerName
  const currentAndSessionRoleMatch =
    roles.currentOid === roles.sessionOid && roles.currentName === roles.sessionName
  const partialChecks = Object.freeze({
    queryRoleMatchesReadOnlyEndpoint,
    queryRoleIsNonSuperuser,
    currentAndSessionRoleMatch,
    databaseIsPrimary: settings.databasePrimary,
    searchPathIsBounded: sameStrings(settings.effectiveSearchPath, ['pg_catalog', 'public']),
    tableRlsIsForced: address.tableRlsEnabled && address.tableRlsForced,
    exactBarrierState: state !== 'mismatch'
  })
  const checks = Object.freeze({
    ...partialChecks,
    allVerificationChecksPassed: Object.values(partialChecks).every(Boolean)
  })
  const withoutDigest = Object.freeze({
    format: SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    reviewOnly: true as const,
    applyAvailable: false as const,
    releaseReady: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    subjectDigest: request.subjectDigest,
    reviewDigest: request.reviewDigest,
    authority: Object.freeze({
      projectRef: request.projectRef,
      accountId: request.accountId,
      grantGeneration: request.grantGeneration
    }),
    query: Object.freeze({
      id: request.queryId,
      version: request.queryVersion,
      digest: request.queryDigest,
      statementCount: 1 as const,
      catalogOnly: true as const,
      accessMode: 'read-only' as const,
      snapshotScope: 'single-statement' as const
    }),
    observedAt: canonicalTimestamp(source.observedAt),
    snapshotMarker: bindings.snapshotMarker,
    serverVersionNum: bindings.serverVersionNum,
    state,
    verifiedInstalled: state === 'installed' && checks.allVerificationChecksPassed,
    roles,
    settings,
    address,
    barrier,
    checks,
    blockers: blockers(state, partialChecks)
  })
  const verificationDigest = await digest(withoutDigest)
  return Object.freeze({
    ...withoutDigest,
    verificationDigest
  })
}

/**
 * Verify only the exact transient barrier produced by a genuine in-memory Host review. This never
 * dispatches DDL and does not relax the generic managed-table Inspector's CHECK-constraint gate.
 */
export async function verifySupabaseBackfillWriteBarrierV1(
  input: VerifySupabaseBackfillWriteBarrierOptionsV1
): Promise<SupabaseBackfillWriteBarrierVerificationV1> {
  const options = optionsSnapshot(input)
  const trustedReview = trustedSupabaseBackfillWriteBarrierReviewContextV1(options.review)
  if (!trustedReview) return fail('supabase-backfill-write-barrier-verification-input-invalid')
  const installedVerificationEpoch = currentInstalledVerificationEpoch(options.review)
  const initial = await currentInputs(options)
  requireSameInputs(
    trustedReview.inspection.subjectDigest,
    trustedReview.inspection.authority,
    initial
  )
  const request = await verificationRequest(options.review, initial.subject, initial.authority)
  const transport = exactRecord(
    options.transport,
    ['getProjectAuthority', 'runReadOnlyWriteBarrierVerificationQuery'],
    'supabase-backfill-write-barrier-verification-input-invalid'
  )
  const getProjectAuthority = ownData(transport, 'getProjectAuthority')
  const runQuery = ownData(transport, 'runReadOnlyWriteBarrierVerificationQuery')
  if (typeof getProjectAuthority !== 'function' || typeof runQuery !== 'function') {
    return fail('supabase-backfill-write-barrier-verification-input-invalid')
  }
  let projectAuthority: unknown
  try {
    projectAuthority = await getProjectAuthority.call(options.transport, initial.authority)
  } catch {
    return fail('supabase-backfill-write-barrier-verification-transport-failed')
  }
  requireProjectAuthority(projectAuthority, initial.authority)
  const beforeQuery = await currentInputs(options)
  requireSameInputs(request.subjectDigest, initial.authority, beforeQuery)
  let response: unknown
  try {
    response = await runQuery.call(options.transport, request)
  } catch {
    return fail('supabase-backfill-write-barrier-verification-transport-failed')
  }
  const afterQuery = await currentInputs(options)
  requireSameInputs(request.subjectDigest, initial.authority, afterQuery)
  const verification = await inspectResponse(response, request, trustedReview)
  const final = await currentInputs(options)
  requireSameInputs(request.subjectDigest, initial.authority, final)
  trustedVerificationContexts.set(
    verification,
    Object.freeze({ review: options.review, verification, installedVerificationEpoch })
  )
  return verification
}

/**
 * Invalidate every installed proof whose verification started before this call and return the only
 * epoch that a later installed proof may satisfy. Rotation creates no write or receipt authority.
 */
export function rotateSupabaseBackfillWriteBarrierInstalledVerificationEpochV1(
  review: SupabaseBackfillWriteBarrierReviewEnvelopeV1
): SupabaseBackfillWriteBarrierInstalledVerificationEpochV1 {
  if (!trustedSupabaseBackfillWriteBarrierReviewContextV1(review)) {
    return fail('supabase-backfill-write-barrier-verification-input-invalid')
  }
  const epoch = freshInstalledVerificationEpoch()
  installedVerificationEpochs.set(review, epoch)
  return epoch
}

/**
 * Read-only identity check used to build a reviewable installer artifact. It deliberately creates
 * no mutation authority and does not consume either the review or the verification proof.
 */
export function trustedSupabaseBackfillWriteBarrierAbsentVerificationV1(
  value: unknown,
  expectedReview: SupabaseBackfillWriteBarrierReviewEnvelopeV1
): SupabaseBackfillWriteBarrierVerificationV1 | null {
  if (value === null || typeof value !== 'object' || consumedAbsentVerifications.has(value)) {
    return null
  }
  const context = trustedVerificationContexts.get(value)
  if (
    !context ||
    context.review !== expectedReview ||
    context.verification.state !== 'absent' ||
    !context.verification.checks.allVerificationChecksPassed
  ) {
    return null
  }
  return context.verification
}

export interface TrustedSupabaseBackfillWriteBarrierAbsentPreparationV1 {
  readonly reviewContext: TrustedSupabaseBackfillWriteBarrierReviewContextV1
  readonly verification: SupabaseBackfillWriteBarrierVerificationV1
}

/**
 * Atomically consumes both genuine in-memory identities before an installer performs any await.
 * This prevents two independently minted absent proofs for one review from authorizing two writes.
 */
export function consumeTrustedSupabaseBackfillWriteBarrierAbsentPreparationV1(
  value: unknown,
  expectedReview: SupabaseBackfillWriteBarrierReviewEnvelopeV1
): TrustedSupabaseBackfillWriteBarrierAbsentPreparationV1 | null {
  const verification = trustedSupabaseBackfillWriteBarrierAbsentVerificationV1(
    value,
    expectedReview
  )
  if (!verification) return null
  const reviewContext = consumeTrustedSupabaseBackfillWriteBarrierReviewContextV1(expectedReview)
  if (!reviewContext) return null
  consumedAbsentVerifications.add(value as object)
  return Object.freeze({ reviewContext, verification })
}

/** Consume one exact installed-barrier proof when reconciling a prior dispatch. */
export function consumeTrustedSupabaseBackfillWriteBarrierInstalledVerificationV1(
  value: unknown,
  expectedReview: SupabaseBackfillWriteBarrierReviewEnvelopeV1,
  expectedEpoch: SupabaseBackfillWriteBarrierInstalledVerificationEpochV1
): SupabaseBackfillWriteBarrierVerificationV1 | null {
  if (value === null || typeof value !== 'object' || consumedInstalledVerifications.has(value)) {
    return null
  }
  const context = trustedVerificationContexts.get(value)
  if (
    !context ||
    context.review !== expectedReview ||
    installedVerificationEpochs.get(expectedReview) !== expectedEpoch ||
    context.installedVerificationEpoch !== expectedEpoch ||
    context.verification.state !== 'installed' ||
    !context.verification.verifiedInstalled ||
    context.verification.barrier.constraintOid === null ||
    !context.verification.checks.allVerificationChecksPassed
  ) {
    return null
  }
  consumedInstalledVerifications.add(value)
  return context.verification
}
