/* oxlint-disable eslint(max-lines), eslint/complexity -- Fixed catalog SQL and its strict decoder stay together for auditability. */

import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL_SOURCE from './verification-v1.sql?raw'

import {
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_TABLES,
  trustedSupabaseBackfillDatabaseCASLedgerReviewContextV1,
  type SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1,
  type TrustedSupabaseBackfillDatabaseCASLedgerReviewContextV1
} from './review'
import type { SupabaseBackfillLiveCatalogAuthorityV1 } from '@/app/plugins/host/deployment/supabase/backfill/live-inspector'

export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_ID =
  'backfill-database-cas-ledger-verification' as const
export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_VERSION =
  'openpencil-supabase-backfill-database-cas-ledger-verification-v1' as const
export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_FORMAT =
  'openpencil.supabase-backfill-database-cas-ledger-verification.v1' as const
export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_CONSTRAINT =
  'backfill_executions_v1_pkey' as const
export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_PREFIX =
  'openpencil-install:v1:supabase-backfill-database-cas-ledger:' as const

export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_PARAMETER_ORDER = Object.freeze([
  'schemaName',
  'reviewDigest',
  'ledgerShapeDigest',
  'sqlDigest',
  'projectRef',
  'accountId',
  'grantGeneration',
  'queryVersion',
  'queryDigest'
] as const)

const EXECUTIONS = SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_TABLES.executions
const RECEIPTS = SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_TABLES.receipts
const HEADS = SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_TABLES.heads
const SCHEMA_COMMENT = 'openpencil:release-ledger:v1'
const TABLE_COMMENTS = Object.freeze({
  [EXECUTIONS]: 'openpencil:release-ledger:backfill-executions:v1',
  [RECEIPTS]: 'openpencil:release-ledger:backfill-receipts:v2',
  [HEADS]: 'openpencil:release-ledger:backfill-heads:v1'
} as const)

interface ExpectedColumnV1 {
  readonly tableName: string
  readonly ordinal: number
  readonly columnName: string
  readonly typeSchema: 'pg_catalog'
  readonly typeName: 'text' | 'int8' | 'int4' | 'timestamptz' | 'bytea'
  readonly notNull: boolean
  readonly identityKind: ''
  readonly generatedKind: ''
  readonly typeModifier: -1
  readonly usesTypeDefaultCollation: true
  readonly hasDefault: false
  readonly nonOwnerColumnPrivilegeCount: 0
}

interface VerifiedColumnV1 extends Omit<
  ExpectedColumnV1,
  'typeModifier' | 'usesTypeDefaultCollation' | 'hasDefault' | 'nonOwnerColumnPrivilegeCount'
> {
  readonly typeModifier: number
  readonly usesTypeDefaultCollation: boolean
  readonly hasDefault: boolean
  readonly nonOwnerColumnPrivilegeCount: number
}

type IndexedColumnTypeV1 = 'text' | 'int8'

interface ExpectedIndexOpclassV1 {
  readonly schemaName: 'pg_catalog'
  readonly opclassName: 'text_ops' | 'int8_ops'
}

interface VerifiedIndexOpclassV1 {
  readonly schemaName: string
  readonly opclassName: string
}

interface ExpectedSupportingIndexV1 {
  readonly indexSchemaName: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA
  readonly indexName: string
  readonly tableSchemaName: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA
  readonly tableName: string
  readonly accessMethodName: 'btree'
  readonly keyAttributeCount: number
  readonly totalAttributeCount: number
  readonly keyFields: readonly string[]
  readonly includedFields: readonly string[]
  readonly keyOpclasses: readonly ExpectedIndexOpclassV1[]
  readonly keyOptions: readonly number[]
  readonly keyCollationsMatchColumns: true
  readonly primary: boolean
  readonly valid: true
  readonly ready: true
  readonly live: true
  readonly unique: true
  readonly immediate: true
  readonly hasPredicate: false
  readonly hasExpressions: false
  readonly nullsNotDistinct: false
}

interface VerifiedSupportingIndexV1 extends Omit<
  ExpectedSupportingIndexV1,
  | 'indexSchemaName'
  | 'tableSchemaName'
  | 'accessMethodName'
  | 'keyCollationsMatchColumns'
  | 'valid'
  | 'ready'
  | 'live'
  | 'unique'
  | 'immediate'
  | 'hasPredicate'
  | 'hasExpressions'
  | 'nullsNotDistinct'
  | 'keyOpclasses'
> {
  readonly indexSchemaName: string
  readonly tableSchemaName: string
  readonly accessMethodName: string
  readonly keyOpclasses: readonly VerifiedIndexOpclassV1[]
  readonly keyCollationsMatchColumns: boolean
  readonly valid: boolean
  readonly ready: boolean
  readonly live: boolean
  readonly unique: boolean
  readonly immediate: boolean
  readonly hasPredicate: boolean
  readonly hasExpressions: boolean
  readonly nullsNotDistinct: boolean
}

interface ExpectedOperatorIdentityV1 {
  readonly schemaName: 'pg_catalog'
  readonly operatorName: '='
  readonly leftTypeSchemaName: 'pg_catalog'
  readonly leftTypeName: IndexedColumnTypeV1
  readonly rightTypeSchemaName: 'pg_catalog'
  readonly rightTypeName: IndexedColumnTypeV1
}

interface VerifiedOperatorIdentityV1 extends Omit<
  ExpectedOperatorIdentityV1,
  | 'schemaName'
  | 'operatorName'
  | 'leftTypeSchemaName'
  | 'leftTypeName'
  | 'rightTypeSchemaName'
  | 'rightTypeName'
> {
  readonly schemaName: string
  readonly operatorName: string
  readonly leftTypeSchemaName: string
  readonly leftTypeName: string
  readonly rightTypeSchemaName: string
  readonly rightTypeName: string
}

interface ForeignKeyOperatorsV1<OperatorIdentity> {
  readonly primaryForeign: readonly OperatorIdentity[]
  readonly primaryPrimary: readonly OperatorIdentity[]
  readonly foreignForeign: readonly OperatorIdentity[]
}

type ExpectedForeignKeyOperatorsV1 = ForeignKeyOperatorsV1<ExpectedOperatorIdentityV1>
type VerifiedForeignKeyOperatorsV1 = ForeignKeyOperatorsV1<VerifiedOperatorIdentityV1>

interface ExpectedConstraintV1 {
  readonly tableName: string
  readonly constraintName: string
  readonly constraintType: 'p' | 'u' | 'f' | 'c'
  readonly fields: readonly string[]
  readonly targetSchemaName: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA | null
  readonly targetTableName: string | null
  readonly targetFields: readonly string[]
  readonly updateAction: ' ' | 'r'
  readonly deleteAction: ' ' | 'r'
  readonly matchType: ' ' | 's' | 'f'
  readonly deferrable: false
  readonly initiallyDeferred: false
  readonly validated: true
  readonly noInherit: false
  readonly local: true
  readonly inheritedCount: 0
  readonly hasParentConstraint: false
  readonly constraintTriggerCount: 0 | 4
  readonly enabledConstraintTriggerCount: 0 | 4
  readonly supportingIndex: ExpectedSupportingIndexV1 | null
  readonly foreignKeyOperators: ExpectedForeignKeyOperatorsV1 | null
  /** Only CHECK constraints expose their fixed server-rendered definition. */
  readonly checkDefinition: string | null
}

interface VerifiedConstraintV1 extends Omit<
  ExpectedConstraintV1,
  | 'targetSchemaName'
  | 'deferrable'
  | 'initiallyDeferred'
  | 'validated'
  | 'noInherit'
  | 'local'
  | 'inheritedCount'
  | 'hasParentConstraint'
  | 'constraintTriggerCount'
  | 'enabledConstraintTriggerCount'
  | 'supportingIndex'
  | 'foreignKeyOperators'
> {
  readonly targetSchemaName: string | null
  readonly deferrable: boolean
  readonly initiallyDeferred: boolean
  readonly validated: boolean
  readonly noInherit: boolean
  readonly local: boolean
  readonly inheritedCount: number
  readonly hasParentConstraint: boolean
  readonly constraintTriggerCount: number
  readonly enabledConstraintTriggerCount: number
  readonly supportingIndex: VerifiedSupportingIndexV1 | null
  readonly foreignKeyOperators: VerifiedForeignKeyOperatorsV1 | null
}

function expectedColumn(
  tableName: string,
  ordinal: number,
  columnName: string,
  typeName: ExpectedColumnV1['typeName'],
  notNull = true
): ExpectedColumnV1 {
  return Object.freeze({
    tableName,
    ordinal,
    columnName,
    typeSchema: 'pg_catalog' as const,
    typeName,
    notNull,
    identityKind: '' as const,
    generatedKind: '' as const,
    typeModifier: -1 as const,
    usesTypeDefaultCollation: true as const,
    hasDefault: false as const,
    nonOwnerColumnPrivilegeCount: 0 as const
  })
}

function expectedIndexedColumnType(tableName: string, columnName: string): IndexedColumnTypeV1 {
  const column = SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1.find(
    (entry) => entry.tableName === tableName && entry.columnName === columnName
  )
  if (column?.typeName !== 'text' && column?.typeName !== 'int8') {
    throw new TypeError(`Unsupported CAS ledger index field ${tableName}.${columnName}.`)
  }
  return column.typeName
}

function expectedIndexOpclass(typeName: IndexedColumnTypeV1): ExpectedIndexOpclassV1 {
  return Object.freeze({
    schemaName: 'pg_catalog' as const,
    opclassName: typeName === 'text' ? ('text_ops' as const) : ('int8_ops' as const)
  })
}

function expectedOperatorIdentity(
  leftTypeName: IndexedColumnTypeV1,
  rightTypeName: IndexedColumnTypeV1
): ExpectedOperatorIdentityV1 {
  return Object.freeze({
    schemaName: 'pg_catalog' as const,
    operatorName: '=' as const,
    leftTypeSchemaName: 'pg_catalog' as const,
    leftTypeName,
    rightTypeSchemaName: 'pg_catalog' as const,
    rightTypeName
  })
}

function expectedSupportingIndex(
  tableName: string,
  indexName: string,
  fields: readonly string[],
  primary: boolean
): ExpectedSupportingIndexV1 {
  return Object.freeze({
    indexSchemaName: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA,
    indexName,
    tableSchemaName: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA,
    tableName,
    accessMethodName: 'btree' as const,
    keyAttributeCount: fields.length,
    totalAttributeCount: fields.length,
    keyFields: Object.freeze([...fields]),
    includedFields: Object.freeze([]),
    keyOpclasses: Object.freeze(
      fields.map((field) => expectedIndexOpclass(expectedIndexedColumnType(tableName, field)))
    ),
    keyOptions: Object.freeze(fields.map(() => 0)),
    keyCollationsMatchColumns: true as const,
    primary,
    valid: true as const,
    ready: true as const,
    live: true as const,
    unique: true as const,
    immediate: true as const,
    hasPredicate: false as const,
    hasExpressions: false as const,
    nullsNotDistinct: false as const
  })
}

function expectedForeignKeyOperators(
  foreignTableName: string,
  foreignFields: readonly string[],
  primaryTableName: string,
  primaryFields: readonly string[]
): ExpectedForeignKeyOperatorsV1 {
  if (foreignFields.length !== primaryFields.length) {
    throw new TypeError('CAS ledger foreign-key field counts must match.')
  }
  const foreignTypes = foreignFields.map((field) =>
    expectedIndexedColumnType(foreignTableName, field)
  )
  const primaryTypes = primaryFields.map((field) =>
    expectedIndexedColumnType(primaryTableName, field)
  )
  return Object.freeze({
    primaryForeign: Object.freeze(
      primaryTypes.map((typeName, index) => expectedOperatorIdentity(typeName, foreignTypes[index]))
    ),
    primaryPrimary: Object.freeze(
      primaryTypes.map((typeName) => expectedOperatorIdentity(typeName, typeName))
    ),
    foreignForeign: Object.freeze(
      foreignTypes.map((typeName) => expectedOperatorIdentity(typeName, typeName))
    )
  })
}

function expectedConstraint(
  tableName: string,
  constraintName: string,
  constraintType: ExpectedConstraintV1['constraintType'],
  fields: readonly string[],
  options: Readonly<{
    targetTableName?: string
    targetFields?: readonly string[]
    matchType?: 's' | 'f'
    supportingIndexName?: string
    supportingIndexPrimary?: boolean
    checkDefinition?: string
  }> = {}
): ExpectedConstraintV1 {
  const foreign = constraintType === 'f'
  const indexed = constraintType !== 'c'
  const targetTableName = options.targetTableName ?? null
  const targetFields = Object.freeze([...(options.targetFields ?? [])])
  let indexTableName = tableName
  let indexName = constraintName
  let indexFields = fields
  if (foreign) {
    if (!targetTableName || !options.supportingIndexName) {
      throw new TypeError(`CAS ledger foreign key ${constraintName} has no supporting index.`)
    }
    indexTableName = targetTableName
    indexName = options.supportingIndexName
    indexFields = targetFields
  }
  const supportingIndex = indexed
    ? expectedSupportingIndex(
        indexTableName,
        indexName,
        indexFields,
        options.supportingIndexPrimary ?? constraintType === 'p'
      )
    : null
  const foreignKeyOperators = foreign
    ? expectedForeignKeyOperators(tableName, fields, indexTableName, targetFields)
    : null
  return Object.freeze({
    tableName,
    constraintName,
    constraintType,
    fields: Object.freeze([...fields]),
    targetSchemaName: foreign ? SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA : null,
    targetTableName,
    targetFields,
    updateAction: foreign ? ('r' as const) : (' ' as const),
    deleteAction: foreign ? ('r' as const) : (' ' as const),
    matchType: foreign ? (options.matchType ?? ('s' as const)) : (' ' as const),
    deferrable: false as const,
    initiallyDeferred: false as const,
    validated: true as const,
    noInherit: false as const,
    local: true as const,
    inheritedCount: 0 as const,
    hasParentConstraint: false as const,
    constraintTriggerCount: foreign ? (4 as const) : (0 as const),
    enabledConstraintTriggerCount: foreign ? (4 as const) : (0 as const),
    supportingIndex,
    foreignKeyOperators,
    checkDefinition: options.checkDefinition ?? null
  })
}

const STABLE_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
const DIGEST_PATTERN = '^[A-Za-z0-9_-]{43}$'

/**
 * Exact live-column inventory produced by the reviewed DDL. Internal PostgreSQL type names are
 * intentional: they are less presentation-dependent than format_type() output.
 */
export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1 = Object.freeze([
  expectedColumn(EXECUTIONS, 1, 'execution_id', 'text'),
  expectedColumn(EXECUTIONS, 2, 'provider_id', 'text'),
  expectedColumn(EXECUTIONS, 3, 'environment', 'text'),
  expectedColumn(EXECUTIONS, 4, 'application_id', 'text'),
  expectedColumn(EXECUTIONS, 5, 'application_digest', 'text'),
  expectedColumn(EXECUTIONS, 6, 'migration_id', 'text'),
  expectedColumn(EXECUTIONS, 7, 'migration_digest', 'text'),
  expectedColumn(EXECUTIONS, 8, 'migration_plan_digest', 'text'),
  expectedColumn(EXECUTIONS, 9, 'provider_authority_digest', 'text'),
  expectedColumn(EXECUTIONS, 10, 'source_ledger_digest', 'text'),
  expectedColumn(EXECUTIONS, 11, 'scope_digest', 'text'),
  expectedColumn(EXECUTIONS, 12, 'resource_identity_digest', 'text'),
  expectedColumn(EXECUTIONS, 13, 'catalog_precondition_digest', 'text'),
  expectedColumn(EXECUTIONS, 14, 'canonical_scope', 'bytea'),
  expectedColumn(EXECUTIONS, 15, 'canonical_scope_byte_length', 'int4'),
  expectedColumn(EXECUTIONS, 16, 'capture_digest', 'text'),
  expectedColumn(EXECUTIONS, 17, 'captured_high_water', 'int8', false),
  expectedColumn(EXECUTIONS, 18, 'initial_remaining_eligible_row_count', 'int8'),
  expectedColumn(EXECUTIONS, 19, 'initial_remaining_target_row_count', 'int8'),
  expectedColumn(EXECUTIONS, 20, 'required_matched_row_count', 'int8', false),
  expectedColumn(EXECUTIONS, 21, 'required_batch_count', 'int4'),
  expectedColumn(EXECUTIONS, 22, 'batch_size', 'int4'),
  expectedColumn(EXECUTIONS, 23, 'maximum_receipt_count', 'int4'),
  expectedColumn(EXECUTIONS, 24, 'maximum_batch_count', 'int4'),
  expectedColumn(EXECUTIONS, 25, 'status', 'text'),
  expectedColumn(EXECUTIONS, 26, 'created_at', 'timestamptz'),
  expectedColumn(EXECUTIONS, 27, 'updated_at', 'timestamptz'),
  expectedColumn(RECEIPTS, 1, 'execution_id', 'text'),
  expectedColumn(RECEIPTS, 2, 'revision', 'int8'),
  expectedColumn(RECEIPTS, 3, 'event_id', 'text'),
  expectedColumn(RECEIPTS, 4, 'receipt_id', 'text'),
  expectedColumn(RECEIPTS, 5, 'idempotency_key', 'text'),
  expectedColumn(RECEIPTS, 6, 'request_digest', 'text'),
  expectedColumn(RECEIPTS, 7, 'receipt_digest', 'text'),
  expectedColumn(RECEIPTS, 8, 'previous_revision', 'int8', false),
  expectedColumn(RECEIPTS, 9, 'previous_event_id', 'text', false),
  expectedColumn(RECEIPTS, 10, 'previous_receipt_digest', 'text', false),
  expectedColumn(RECEIPTS, 11, 'checkpoint_kind', 'text'),
  expectedColumn(RECEIPTS, 12, 'canonical_receipt', 'bytea'),
  expectedColumn(RECEIPTS, 13, 'canonical_receipt_byte_length', 'int4'),
  expectedColumn(RECEIPTS, 14, 'committed_at', 'timestamptz'),
  expectedColumn(HEADS, 1, 'execution_id', 'text'),
  expectedColumn(HEADS, 2, 'revision', 'int8'),
  expectedColumn(HEADS, 3, 'event_id', 'text'),
  expectedColumn(HEADS, 4, 'receipt_digest', 'text'),
  expectedColumn(HEADS, 5, 'updated_at', 'timestamptz')
] as const)

/**
 * Exact constraint inventory. CHECK definitions use stable non-pretty pg_get_constraintdef output; any
 * server-rendering or semantic drift therefore fails closed as a mismatch instead of being
 * accepted by name alone.
 */
export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1 = Object.freeze([
  expectedConstraint(EXECUTIONS, 'backfill_executions_v1_application_id_check', 'c', [], {
    checkDefinition: `CHECK ((application_id ~ '${STABLE_ID_PATTERN}'::text))`
  }),
  expectedConstraint(EXECUTIONS, 'backfill_executions_v1_capacity_check', 'c', [], {
    checkDefinition:
      'CHECK (((batch_size >= 1) AND (batch_size <= 1000) AND (maximum_receipt_count = 10000) AND (maximum_batch_count = 9999) AND (initial_remaining_eligible_row_count >= 0) AND (initial_remaining_eligible_row_count <= ((batch_size)::bigint * (maximum_batch_count)::bigint)) AND (initial_remaining_target_row_count >= 0) AND (initial_remaining_target_row_count <= initial_remaining_eligible_row_count) AND ((required_matched_row_count IS NULL) OR ((required_matched_row_count >= 0) AND (required_matched_row_count <= initial_remaining_target_row_count))) AND (required_batch_count = CASE WHEN (initial_remaining_eligible_row_count = 0) THEN 0 ELSE (((initial_remaining_eligible_row_count - 1) / (batch_size)::bigint) + 1) END) AND (required_batch_count >= 0) AND (required_batch_count <= maximum_batch_count)))'
  }),
  expectedConstraint(EXECUTIONS, 'backfill_executions_v1_capture_key', 'u', ['capture_digest']),
  expectedConstraint(EXECUTIONS, 'backfill_executions_v1_digest_check', 'c', [], {
    checkDefinition: `CHECK (((application_digest ~ '${DIGEST_PATTERN}'::text) AND (migration_digest ~ '${DIGEST_PATTERN}'::text) AND (migration_plan_digest ~ '${DIGEST_PATTERN}'::text) AND (provider_authority_digest ~ '${DIGEST_PATTERN}'::text) AND (source_ledger_digest ~ '${DIGEST_PATTERN}'::text) AND (scope_digest ~ '${DIGEST_PATTERN}'::text) AND (resource_identity_digest ~ '${DIGEST_PATTERN}'::text) AND (catalog_precondition_digest ~ '${DIGEST_PATTERN}'::text) AND (capture_digest ~ '${DIGEST_PATTERN}'::text)))`
  }),
  expectedConstraint(EXECUTIONS, 'backfill_executions_v1_execution_id_check', 'c', [], {
    checkDefinition: `CHECK ((execution_id ~ '${STABLE_ID_PATTERN}'::text))`
  }),
  expectedConstraint(EXECUTIONS, 'backfill_executions_v1_high_water_check', 'c', [], {
    checkDefinition:
      'CHECK ((((captured_high_water IS NULL) = (initial_remaining_eligible_row_count = 0)) AND ((captured_high_water IS NULL) OR ((captured_high_water >= 0) AND (captured_high_water <= 9007199254740991)))))'
  }),
  expectedConstraint(EXECUTIONS, 'backfill_executions_v1_migration_id_check', 'c', [], {
    checkDefinition: `CHECK ((migration_id ~ '${STABLE_ID_PATTERN}'::text))`
  }),
  expectedConstraint(EXECUTIONS, 'backfill_executions_v1_pkey', 'p', ['execution_id']),
  expectedConstraint(EXECUTIONS, 'backfill_executions_v1_provider_check', 'c', [], {
    checkDefinition:
      "CHECK (((provider_id = 'supabase'::text) AND (environment = 'staging'::text)))"
  }),
  expectedConstraint(EXECUTIONS, 'backfill_executions_v1_scope_bytes_check', 'c', [], {
    checkDefinition:
      "CHECK (((canonical_scope_byte_length = octet_length(canonical_scope)) AND (canonical_scope_byte_length >= 2) AND (canonical_scope_byte_length <= 65536) AND (scope_digest = translate(rtrim(encode(sha256(canonical_scope), 'base64'::text), '='::text), '+/'::text, '-_'::text))))"
  }),
  expectedConstraint(EXECUTIONS, 'backfill_executions_v1_scope_key', 'u', ['scope_digest']),
  expectedConstraint(EXECUTIONS, 'backfill_executions_v1_status_check', 'c', [], {
    checkDefinition:
      "CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])))"
  }),
  expectedConstraint(EXECUTIONS, 'backfill_executions_v1_time_check', 'c', [], {
    checkDefinition: 'CHECK ((updated_at >= created_at))'
  }),
  expectedConstraint(RECEIPTS, 'backfill_receipts_v2_canonical_bytes_check', 'c', [], {
    checkDefinition:
      "CHECK (((canonical_receipt_byte_length = octet_length(canonical_receipt)) AND (canonical_receipt_byte_length >= 2) AND (canonical_receipt_byte_length <= 65536) AND (receipt_digest = translate(rtrim(encode(sha256(canonical_receipt), 'base64'::text), '='::text), '+/'::text, '-_'::text))))"
  }),
  expectedConstraint(RECEIPTS, 'backfill_receipts_v2_checkpoint_check', 'c', [], {
    checkDefinition:
      "CHECK ((((revision = 1) AND (checkpoint_kind = 'capture'::text)) OR ((revision > 1) AND (checkpoint_kind = ANY (ARRAY['batch'::text, 'failure'::text])))))"
  }),
  expectedConstraint(RECEIPTS, 'backfill_receipts_v2_digest_check', 'c', [], {
    checkDefinition: `CHECK (((receipt_digest ~ '${DIGEST_PATTERN}'::text) AND (request_digest ~ '${DIGEST_PATTERN}'::text) AND ((previous_receipt_digest IS NULL) OR (previous_receipt_digest ~ '${DIGEST_PATTERN}'::text))))`
  }),
  expectedConstraint(RECEIPTS, 'backfill_receipts_v2_digest_key', 'u', [
    'execution_id',
    'receipt_digest'
  ]),
  expectedConstraint(RECEIPTS, 'backfill_receipts_v2_event_key', 'u', ['execution_id', 'event_id']),
  expectedConstraint(RECEIPTS, 'backfill_receipts_v2_execution_fkey', 'f', ['execution_id'], {
    targetTableName: EXECUTIONS,
    targetFields: ['execution_id'],
    supportingIndexName: 'backfill_executions_v1_pkey',
    supportingIndexPrimary: true
  }),
  expectedConstraint(RECEIPTS, 'backfill_receipts_v2_head_key', 'u', [
    'execution_id',
    'revision',
    'event_id',
    'receipt_digest'
  ]),
  expectedConstraint(RECEIPTS, 'backfill_receipts_v2_idempotency_key', 'u', [
    'execution_id',
    'idempotency_key'
  ]),
  expectedConstraint(RECEIPTS, 'backfill_receipts_v2_identifier_check', 'c', [], {
    checkDefinition: `CHECK (((event_id ~ '${STABLE_ID_PATTERN}'::text) AND (receipt_id ~ '${STABLE_ID_PATTERN}'::text) AND (idempotency_key ~ '${STABLE_ID_PATTERN}'::text)))`
  }),
  expectedConstraint(RECEIPTS, 'backfill_receipts_v2_pkey', 'p', ['execution_id', 'revision']),
  expectedConstraint(RECEIPTS, 'backfill_receipts_v2_previous_head_check', 'c', [], {
    checkDefinition:
      'CHECK ((((revision = 1) AND (previous_revision IS NULL) AND (previous_event_id IS NULL) AND (previous_receipt_digest IS NULL)) OR ((revision > 1) AND (previous_revision IS NOT NULL) AND (previous_revision = (revision - 1)) AND (previous_event_id IS NOT NULL) AND (previous_receipt_digest IS NOT NULL))))'
  }),
  expectedConstraint(
    RECEIPTS,
    'backfill_receipts_v2_previous_head_fkey',
    'f',
    ['execution_id', 'previous_revision', 'previous_event_id', 'previous_receipt_digest'],
    {
      targetTableName: RECEIPTS,
      targetFields: ['execution_id', 'revision', 'event_id', 'receipt_digest'],
      supportingIndexName: 'backfill_receipts_v2_head_key'
    }
  ),
  expectedConstraint(RECEIPTS, 'backfill_receipts_v2_receipt_id_key', 'u', [
    'execution_id',
    'receipt_id'
  ]),
  expectedConstraint(RECEIPTS, 'backfill_receipts_v2_request_digest_key', 'u', [
    'execution_id',
    'request_digest'
  ]),
  expectedConstraint(RECEIPTS, 'backfill_receipts_v2_revision_check', 'c', [], {
    checkDefinition: 'CHECK (((revision >= 1) AND (revision <= 10000)))'
  }),
  expectedConstraint(HEADS, 'backfill_heads_v1_digest_check', 'c', [], {
    checkDefinition: `CHECK ((receipt_digest ~ '${DIGEST_PATTERN}'::text))`
  }),
  expectedConstraint(HEADS, 'backfill_heads_v1_event_id_check', 'c', [], {
    checkDefinition: `CHECK ((event_id ~ '${STABLE_ID_PATTERN}'::text))`
  }),
  expectedConstraint(HEADS, 'backfill_heads_v1_pkey', 'p', ['execution_id']),
  expectedConstraint(
    HEADS,
    'backfill_heads_v1_receipt_fkey',
    'f',
    ['execution_id', 'revision', 'event_id', 'receipt_digest'],
    {
      targetTableName: RECEIPTS,
      targetFields: ['execution_id', 'revision', 'event_id', 'receipt_digest'],
      supportingIndexName: 'backfill_receipts_v2_head_key'
    }
  ),
  expectedConstraint(HEADS, 'backfill_heads_v1_revision_check', 'c', [], {
    checkDefinition: 'CHECK (((revision >= 1) AND (revision <= 10000)))'
  })
] as const)

/** One fixed, schema-qualified pg_catalog statement. It never reads any ledger or application row. */
const GENERATED_SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL = `WITH RECURSIVE "requested" AS (
  SELECT
    $1::"pg_catalog"."name" AS "schema_name",
    $2::"pg_catalog"."text" AS "review_digest",
    $3::"pg_catalog"."text" AS "ledger_shape_digest",
    $4::"pg_catalog"."text" AS "sql_digest",
    $5::"pg_catalog"."text" AS "project_ref",
    $6::"pg_catalog"."text" AS "account_id",
    $7::"pg_catalog"."text" AS "grant_generation",
    $8::"pg_catalog"."text" AS "query_version",
    $9::"pg_catalog"."text" AS "query_digest"
),
"expected_tables"("table_name") AS (
  VALUES
    ('backfill_executions_v1'::"pg_catalog"."name"),
    ('backfill_heads_v1'::"pg_catalog"."name"),
    ('backfill_receipts_v2'::"pg_catalog"."name")
),
"schema_entry" AS (
  SELECT
    "namespace_entry"."oid" AS "schema_oid",
    "namespace_entry"."nspowner" AS "owner_oid",
    "owner_entry"."rolname" AS "owner_name",
    "pg_catalog"."obj_description"("namespace_entry"."oid", 'pg_namespace') AS "comment",
    "namespace_entry"."nspacl" AS "acl"
  FROM "pg_catalog"."pg_namespace" AS "namespace_entry"
  JOIN "pg_catalog"."pg_roles" AS "owner_entry"
    ON "owner_entry"."oid" = "namespace_entry"."nspowner"
  CROSS JOIN "requested"
  WHERE "namespace_entry"."nspname" = "requested"."schema_name"
),
"owner_role_members"("role_oid") AS (
  SELECT "membership_entry"."member"
  FROM "schema_entry"
  JOIN "pg_catalog"."pg_auth_members" AS "membership_entry"
    ON "membership_entry"."roleid" = "schema_entry"."owner_oid"
  UNION
  SELECT "membership_entry"."member"
  FROM "pg_catalog"."pg_auth_members" AS "membership_entry"
  JOIN "owner_role_members"
    ON "membership_entry"."roleid" = "owner_role_members"."role_oid"
),
"table_entries" AS (
  SELECT
    "table_entry"."oid" AS "table_oid",
    "table_entry"."relname" AS "table_name",
    "table_entry"."relowner" AS "owner_oid",
    "owner_entry"."rolname" AS "owner_name",
    "table_entry"."relkind" AS "relation_kind",
    "table_entry"."relpersistence" AS "persistence",
    "table_entry"."relispartition" AS "is_partition",
    "table_entry"."relreplident" AS "replica_identity",
    "table_entry"."relrowsecurity" AS "rls_enabled",
    "table_entry"."relforcerowsecurity" AS "rls_forced",
    "table_entry"."relacl" AS "acl",
    "pg_catalog"."obj_description"("table_entry"."oid", 'pg_class') AS "comment"
  FROM "schema_entry"
  JOIN "pg_catalog"."pg_class" AS "table_entry"
    ON "table_entry"."relnamespace" = "schema_entry"."schema_oid"
  JOIN "expected_tables" ON "expected_tables"."table_name" = "table_entry"."relname"
  JOIN "pg_catalog"."pg_roles" AS "owner_entry" ON "owner_entry"."oid" = "table_entry"."relowner"
  WHERE "table_entry"."relkind" = 'r'
),
"install_marker_constraint_entry" AS (
  SELECT
    "constraint_entry"."oid" AS "constraint_oid",
    "pg_catalog"."obj_description"("constraint_entry"."oid", 'pg_constraint') AS "comment"
  FROM "schema_entry"
  JOIN "pg_catalog"."pg_class" AS "table_entry"
    ON "table_entry"."relnamespace" = "schema_entry"."schema_oid"
   AND "table_entry"."relname" = 'backfill_executions_v1'
   AND "table_entry"."relkind" = 'r'
  JOIN "pg_catalog"."pg_constraint" AS "constraint_entry"
    ON "constraint_entry"."conrelid" = "table_entry"."oid"
   AND "constraint_entry"."connamespace" = "schema_entry"."schema_oid"
   AND "constraint_entry"."conname" = 'backfill_executions_v1_pkey'
   AND "constraint_entry"."contype" = 'p'
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
  "requested"."review_digest" AS "reviewDigest",
  "requested"."ledger_shape_digest" AS "ledgerShapeDigest",
  "requested"."sql_digest" AS "sqlDigest",
  "requested"."project_ref" AS "projectRef",
  "requested"."account_id" AS "accountId",
  "requested"."grant_generation" AS "grantGeneration",
  "requested"."query_version" AS "queryVersion",
  "requested"."query_digest" AS "queryDigest",
  'read-only'::"pg_catalog"."text" AS "accessMode",
  'single-statement'::"pg_catalog"."text" AS "snapshotScope",
  TRUE AS "catalogOnly",
  FALSE AS "managedDataRead",
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
    'currentBypassRls', "current_role_entry"."rolbypassrls",
    'currentHasEffectivePgReadAllData', "pg_catalog"."pg_has_role"(CURRENT_USER, 'pg_read_all_data', 'usage'),
    'sessionOid', "session_role_entry"."oid"::"pg_catalog"."text",
    'sessionName', SESSION_USER::"pg_catalog"."text",
    'sessionSuperuser', "session_role_entry"."rolsuper",
    'sessionBypassRls', "session_role_entry"."rolbypassrls",
    'sessionHasEffectivePgReadAllData', "pg_catalog"."pg_has_role"(SESSION_USER, 'pg_read_all_data', 'usage')
  ) AS "roles",
  "pg_catalog"."jsonb_build_object"(
    'databasePrimary', NOT "pg_catalog"."pg_is_in_recovery"(),
    'transactionReadOnly', "pg_catalog"."current_setting"('transaction_read_only')::"pg_catalog"."boolean",
    'effectiveSearchPath', "pg_catalog"."to_jsonb"("pg_catalog"."current_schemas"(TRUE))
  ) AS "settings",
  "pg_catalog"."jsonb_build_object"(
    'schemaCount', (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" FROM "schema_entry"),
    'schemaOid', (SELECT "schema_oid"::"pg_catalog"."text" FROM "schema_entry"),
    'schemaOwnerOid', (SELECT "owner_oid"::"pg_catalog"."text" FROM "schema_entry"),
    'schemaOwnerName', (SELECT "owner_name"::"pg_catalog"."text" FROM "schema_entry"),
    'schemaComment', (SELECT "comment" FROM "schema_entry"),
    'installMarkerConstraintComment', (
      SELECT "comment" FROM "install_marker_constraint_entry"
    ),
    'schemaInstallMarkerPrefixCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "schema_entry"
      JOIN "pg_catalog"."pg_constraint" AS "constraint_entry"
        ON "constraint_entry"."connamespace" = "schema_entry"."schema_oid"
      WHERE "pg_catalog"."obj_description"("constraint_entry"."oid", 'pg_constraint')
        LIKE 'openpencil-install:v1:supabase-backfill-database-cas-ledger:%'
    ), 0),
    'ownerRoleMemberCount', (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" FROM "owner_role_members"),
    'ownerDefaultNonOwnerPrivilegeCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "schema_entry"
      JOIN "pg_catalog"."pg_default_acl" AS "default_acl_entry"
        ON "default_acl_entry"."defaclrole" = "schema_entry"."owner_oid"
       AND "default_acl_entry"."defaclnamespace" IN (0, "schema_entry"."schema_oid")
       AND "default_acl_entry"."defaclobjtype" = 'r'
      CROSS JOIN LATERAL "pg_catalog"."aclexplode"("default_acl_entry"."defaclacl") AS "acl_entry"
      WHERE "acl_entry"."grantee" <> "schema_entry"."owner_oid"
    ), 0),
    'schemaNonOwnerPrivilegeCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "schema_entry"
      CROSS JOIN LATERAL "pg_catalog"."aclexplode"(
        COALESCE("schema_entry"."acl", "pg_catalog"."acldefault"('n', "schema_entry"."owner_oid"))
      ) AS "acl_entry"
      WHERE "acl_entry"."grantee" <> "schema_entry"."owner_oid"
    ), 0),
    'relationCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "schema_entry"
      JOIN "pg_catalog"."pg_class" AS "relation_entry"
        ON "relation_entry"."relnamespace" = "schema_entry"."schema_oid"
      WHERE "relation_entry"."relkind" IN ('r', 'p', 'v', 'm', 'S', 'f')
    ), 0),
    'unexpectedIndexCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "table_entries"
      JOIN "pg_catalog"."pg_index" AS "index_entry"
        ON "index_entry"."indrelid" = "table_entries"."table_oid"
      LEFT JOIN "pg_catalog"."pg_constraint" AS "backing_constraint"
        ON "backing_constraint"."conindid" = "index_entry"."indexrelid"
       AND "backing_constraint"."contype" IN ('p', 'u')
      WHERE "backing_constraint"."oid" IS NULL
    ), 0),
    'unexpectedTriggerCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "table_entries"
      JOIN "pg_catalog"."pg_trigger" AS "trigger_entry"
        ON "trigger_entry"."tgrelid" = "table_entries"."table_oid"
      WHERE NOT "trigger_entry"."tgisinternal"
    ), 0),
    'unexpectedRuleCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "table_entries"
      JOIN "pg_catalog"."pg_rewrite" AS "rule_entry"
        ON "rule_entry"."ev_class" = "table_entries"."table_oid"
    ), 0),
    'unexpectedConstraintCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "table_entries"
      JOIN "pg_catalog"."pg_constraint" AS "constraint_entry"
        ON "constraint_entry"."conrelid" = "table_entries"."table_oid"
      WHERE "constraint_entry"."contype" NOT IN ('p', 'u', 'f', 'c')
    ), 0),
    'inheritanceRelationCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "pg_catalog"."pg_inherits" AS "inheritance_entry"
      WHERE "inheritance_entry"."inhrelid" IN (SELECT "table_oid" FROM "table_entries")
         OR "inheritance_entry"."inhparent" IN (SELECT "table_oid" FROM "table_entries")
    ), 0),
    'publicationExposureCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "pg_catalog"."pg_publication_tables" AS "publication_entry"
      CROSS JOIN "requested"
      WHERE "publication_entry"."schemaname" = "requested"."schema_name"
        AND "publication_entry"."tablename" IN (SELECT "table_name" FROM "expected_tables")
    ), 0),
    'droppedColumnCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "table_entries"
      JOIN "pg_catalog"."pg_attribute" AS "column_entry"
        ON "column_entry"."attrelid" = "table_entries"."table_oid"
       AND "column_entry"."attnum" > 0
       AND "column_entry"."attisdropped"
    ), 0),
    'policyCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "table_entries"
      JOIN "pg_catalog"."pg_policy" AS "policy_entry"
        ON "policy_entry"."polrelid" = "table_entries"."table_oid"
    ), 0),
    'tables', COALESCE((
      SELECT "pg_catalog"."jsonb_agg"(
        "pg_catalog"."jsonb_build_object"(
          'tableName', "table_entries"."table_name"::"pg_catalog"."text",
          'tableOid', "table_entries"."table_oid"::"pg_catalog"."text",
          'ownerOid', "table_entries"."owner_oid"::"pg_catalog"."text",
          'ownerName', "table_entries"."owner_name"::"pg_catalog"."text",
          'relationKind', "table_entries"."relation_kind"::"pg_catalog"."text",
          'persistence', "table_entries"."persistence"::"pg_catalog"."text",
          'isPartition', "table_entries"."is_partition",
          'replicaIdentity', "table_entries"."replica_identity"::"pg_catalog"."text",
          'rlsEnabled', "table_entries"."rls_enabled",
          'rlsForced', "table_entries"."rls_forced",
          'comment', "table_entries"."comment",
          'nonOwnerPrivilegeCount', (
            SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
            FROM "pg_catalog"."aclexplode"(
              COALESCE("table_entries"."acl", "pg_catalog"."acldefault"('r', "table_entries"."owner_oid"))
            ) AS "acl_entry"
            WHERE "acl_entry"."grantee" <> "table_entries"."owner_oid"
          ),
          'policyCount', (
            SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
            FROM "pg_catalog"."pg_policy" AS "policy_entry"
            WHERE "policy_entry"."polrelid" = "table_entries"."table_oid"
          )
        ) ORDER BY CASE "table_entries"."table_name"
          WHEN 'backfill_executions_v1' THEN 1
          WHEN 'backfill_receipts_v2' THEN 2
          ELSE 3 END
      )
      FROM "table_entries"
    ), '[]'::"pg_catalog"."jsonb"),
    'columns', COALESCE((
      SELECT "pg_catalog"."jsonb_agg"(
        "pg_catalog"."jsonb_build_object"(
          'tableName', "table_entries"."table_name"::"pg_catalog"."text",
          'ordinal', "column_entry"."attnum"::"pg_catalog"."int4",
          'columnName', "column_entry"."attname"::"pg_catalog"."text",
          'typeSchema', "type_namespace"."nspname"::"pg_catalog"."text",
          'typeName', "type_entry"."typname"::"pg_catalog"."text",
          'notNull', "column_entry"."attnotnull",
          'identityKind', "column_entry"."attidentity"::"pg_catalog"."text",
          'generatedKind', "column_entry"."attgenerated"::"pg_catalog"."text",
          'typeModifier', "column_entry"."atttypmod"::"pg_catalog"."int4",
          'usesTypeDefaultCollation', "column_entry"."attcollation" = "type_entry"."typcollation",
          'hasDefault', "column_default"."oid" IS NOT NULL,
          'nonOwnerColumnPrivilegeCount', COALESCE((
            SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
            FROM "pg_catalog"."aclexplode"("column_entry"."attacl") AS "acl_entry"
            WHERE "acl_entry"."grantee" <> "table_entries"."owner_oid"
          ), 0)
        ) ORDER BY CASE "table_entries"."table_name"
          WHEN 'backfill_executions_v1' THEN 1
          WHEN 'backfill_receipts_v2' THEN 2
          ELSE 3 END, "column_entry"."attnum"
      )
      FROM "table_entries"
      JOIN "pg_catalog"."pg_attribute" AS "column_entry"
        ON "column_entry"."attrelid" = "table_entries"."table_oid"
       AND "column_entry"."attnum" > 0
       AND NOT "column_entry"."attisdropped"
      JOIN "pg_catalog"."pg_type" AS "type_entry" ON "type_entry"."oid" = "column_entry"."atttypid"
      JOIN "pg_catalog"."pg_namespace" AS "type_namespace"
        ON "type_namespace"."oid" = "type_entry"."typnamespace"
      LEFT JOIN "pg_catalog"."pg_attrdef" AS "column_default"
        ON "column_default"."adrelid" = "column_entry"."attrelid"
       AND "column_default"."adnum" = "column_entry"."attnum"
    ), '[]'::"pg_catalog"."jsonb"),
    'constraints', COALESCE((
      SELECT "pg_catalog"."jsonb_agg"(
        "pg_catalog"."jsonb_build_object"(
          'tableName', "table_entries"."table_name"::"pg_catalog"."text",
          'constraintName', "constraint_entry"."conname"::"pg_catalog"."text",
          'constraintType', "constraint_entry"."contype"::"pg_catalog"."text",
          'fields', CASE WHEN "constraint_entry"."contype" = 'c'
            THEN '[]'::"pg_catalog"."jsonb"
            ELSE COALESCE((
              SELECT "pg_catalog"."jsonb_agg"("field_entry"."attname" ORDER BY "key_entry"."ordinality")
              FROM "pg_catalog"."unnest"("constraint_entry"."conkey")
                WITH ORDINALITY AS "key_entry"("attnum", "ordinality")
              JOIN "pg_catalog"."pg_attribute" AS "field_entry"
                ON "field_entry"."attrelid" = "constraint_entry"."conrelid"
               AND "field_entry"."attnum" = "key_entry"."attnum"
            ), '[]'::"pg_catalog"."jsonb") END,
          'targetSchemaName', "target_namespace"."nspname"::"pg_catalog"."text",
          'targetTableName', "target_table"."relname"::"pg_catalog"."text",
          'targetFields', CASE WHEN "constraint_entry"."contype" = 'f'
            THEN COALESCE((
              SELECT "pg_catalog"."jsonb_agg"("field_entry"."attname" ORDER BY "key_entry"."ordinality")
              FROM "pg_catalog"."unnest"("constraint_entry"."confkey")
                WITH ORDINALITY AS "key_entry"("attnum", "ordinality")
              JOIN "pg_catalog"."pg_attribute" AS "field_entry"
                ON "field_entry"."attrelid" = "constraint_entry"."confrelid"
               AND "field_entry"."attnum" = "key_entry"."attnum"
            ), '[]'::"pg_catalog"."jsonb") ELSE '[]'::"pg_catalog"."jsonb" END,
          'updateAction', "constraint_entry"."confupdtype"::"pg_catalog"."text",
          'deleteAction', "constraint_entry"."confdeltype"::"pg_catalog"."text",
          'matchType', "constraint_entry"."confmatchtype"::"pg_catalog"."text",
          'deferrable', "constraint_entry"."condeferrable",
          'initiallyDeferred', "constraint_entry"."condeferred",
          'validated', "constraint_entry"."convalidated",
          'noInherit', "constraint_entry"."connoinherit",
          'local', "constraint_entry"."conislocal",
          'inheritedCount', "constraint_entry"."coninhcount"::"pg_catalog"."int4",
          'hasParentConstraint', "constraint_entry"."conparentid" <> 0,
          'constraintTriggerCount', (
            SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
            FROM "pg_catalog"."pg_trigger" AS "constraint_trigger"
            WHERE "constraint_trigger"."tgconstraint" = "constraint_entry"."oid"
          ),
          'enabledConstraintTriggerCount', (
            SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
            FROM "pg_catalog"."pg_trigger" AS "constraint_trigger"
            WHERE "constraint_trigger"."tgconstraint" = "constraint_entry"."oid"
              AND "constraint_trigger"."tgenabled" = 'O'
          ),
          'supportingIndex', CASE WHEN "supporting_index"."indexrelid" IS NULL THEN NULL
            ELSE "pg_catalog"."jsonb_build_object"(
              'indexSchemaName', "supporting_index_namespace"."nspname"::"pg_catalog"."text",
              'indexName', "supporting_index_entry"."relname"::"pg_catalog"."text",
              'tableSchemaName', "supporting_index_table_namespace"."nspname"::"pg_catalog"."text",
              'tableName', "supporting_index_table"."relname"::"pg_catalog"."text",
              'accessMethodName', "supporting_index_access_method"."amname"::"pg_catalog"."text",
              'keyAttributeCount', "supporting_index"."indnkeyatts"::"pg_catalog"."int4",
              'totalAttributeCount', "supporting_index"."indnatts"::"pg_catalog"."int4",
              'keyFields', COALESCE((
                SELECT "pg_catalog"."jsonb_agg"(
                  "index_field"."attname" ORDER BY "index_key"."ordinality"
                )
                FROM "pg_catalog"."unnest"("supporting_index"."indkey")
                  WITH ORDINALITY AS "index_key"("attnum", "ordinality")
                JOIN "pg_catalog"."pg_attribute" AS "index_field"
                  ON "index_field"."attrelid" = "supporting_index"."indrelid"
                 AND "index_field"."attnum" = "index_key"."attnum"
                WHERE "index_key"."ordinality" <= "supporting_index"."indnkeyatts"
              ), '[]'::"pg_catalog"."jsonb"),
              'includedFields', COALESCE((
                SELECT "pg_catalog"."jsonb_agg"(
                  "included_field"."attname" ORDER BY "included_key"."ordinality"
                )
                FROM "pg_catalog"."unnest"("supporting_index"."indkey")
                  WITH ORDINALITY AS "included_key"("attnum", "ordinality")
                JOIN "pg_catalog"."pg_attribute" AS "included_field"
                  ON "included_field"."attrelid" = "supporting_index"."indrelid"
                 AND "included_field"."attnum" = "included_key"."attnum"
                WHERE "included_key"."ordinality" > "supporting_index"."indnkeyatts"
              ), '[]'::"pg_catalog"."jsonb"),
              'keyOpclasses', COALESCE((
                SELECT "pg_catalog"."jsonb_agg"(
                  "pg_catalog"."jsonb_build_object"(
                    'schemaName', "opclass_namespace"."nspname"::"pg_catalog"."text",
                    'opclassName', "opclass_entry"."opcname"::"pg_catalog"."text"
                  ) ORDER BY "opclass_key"."ordinality"
                )
                FROM "pg_catalog"."unnest"("supporting_index"."indclass")
                  WITH ORDINALITY AS "opclass_key"("opclass_oid", "ordinality")
                JOIN "pg_catalog"."pg_opclass" AS "opclass_entry"
                  ON "opclass_entry"."oid" = "opclass_key"."opclass_oid"
                JOIN "pg_catalog"."pg_namespace" AS "opclass_namespace"
                  ON "opclass_namespace"."oid" = "opclass_entry"."opcnamespace"
                WHERE "opclass_key"."ordinality" <= "supporting_index"."indnkeyatts"
              ), '[]'::"pg_catalog"."jsonb"),
              'keyOptions', COALESCE((
                SELECT "pg_catalog"."jsonb_agg"(
                  "option_key"."option"::"pg_catalog"."int4" ORDER BY "option_key"."ordinality"
                )
                FROM "pg_catalog"."unnest"("supporting_index"."indoption")
                  WITH ORDINALITY AS "option_key"("option", "ordinality")
                WHERE "option_key"."ordinality" <= "supporting_index"."indnkeyatts"
              ), '[]'::"pg_catalog"."jsonb"),
              'keyCollationsMatchColumns', COALESCE((
                SELECT "pg_catalog"."bool_and"(
                  "supporting_index"."indcollation"[
                    "pg_catalog"."array_lower"("supporting_index"."indcollation", 1) +
                    "collation_key"."ordinality"::"pg_catalog"."int4" - 1
                  ] = "collation_field"."attcollation"
                )
                FROM "pg_catalog"."unnest"("supporting_index"."indkey")
                  WITH ORDINALITY AS "collation_key"("attnum", "ordinality")
                JOIN "pg_catalog"."pg_attribute" AS "collation_field"
                  ON "collation_field"."attrelid" = "supporting_index"."indrelid"
                 AND "collation_field"."attnum" = "collation_key"."attnum"
                WHERE "collation_key"."ordinality" <= "supporting_index"."indnkeyatts"
              ), FALSE),
              'primary', "supporting_index"."indisprimary",
              'valid', "supporting_index"."indisvalid",
              'ready', "supporting_index"."indisready",
              'live', "supporting_index"."indislive",
              'unique', "supporting_index"."indisunique",
              'immediate', "supporting_index"."indimmediate",
              'hasPredicate', "supporting_index"."indpred" IS NOT NULL,
              'hasExpressions', "supporting_index"."indexprs" IS NOT NULL,
              'nullsNotDistinct', "supporting_index"."indnullsnotdistinct"
            ) END,
          'foreignKeyOperators', CASE WHEN "constraint_entry"."contype" = 'f' THEN
            "pg_catalog"."jsonb_build_object"(
              'primaryForeign', COALESCE((
                SELECT "pg_catalog"."jsonb_agg"(
                  "pg_catalog"."jsonb_build_object"(
                    'schemaName', "primary_foreign_operator_namespace"."nspname"::"pg_catalog"."text",
                    'operatorName', "primary_foreign_operator"."oprname"::"pg_catalog"."text",
                    'leftTypeSchemaName', "primary_foreign_left_type_namespace"."nspname"::"pg_catalog"."text",
                    'leftTypeName', "primary_foreign_left_type"."typname"::"pg_catalog"."text",
                    'rightTypeSchemaName', "primary_foreign_right_type_namespace"."nspname"::"pg_catalog"."text",
                    'rightTypeName', "primary_foreign_right_type"."typname"::"pg_catalog"."text"
                  ) ORDER BY "primary_foreign_operator_key"."ordinality"
                )
                FROM "pg_catalog"."unnest"("constraint_entry"."conpfeqop")
                  WITH ORDINALITY AS "primary_foreign_operator_key"("operator_oid", "ordinality")
                JOIN "pg_catalog"."pg_operator" AS "primary_foreign_operator"
                  ON "primary_foreign_operator"."oid" = "primary_foreign_operator_key"."operator_oid"
                JOIN "pg_catalog"."pg_namespace" AS "primary_foreign_operator_namespace"
                  ON "primary_foreign_operator_namespace"."oid" = "primary_foreign_operator"."oprnamespace"
                JOIN "pg_catalog"."pg_type" AS "primary_foreign_left_type"
                  ON "primary_foreign_left_type"."oid" = "primary_foreign_operator"."oprleft"
                JOIN "pg_catalog"."pg_namespace" AS "primary_foreign_left_type_namespace"
                  ON "primary_foreign_left_type_namespace"."oid" = "primary_foreign_left_type"."typnamespace"
                JOIN "pg_catalog"."pg_type" AS "primary_foreign_right_type"
                  ON "primary_foreign_right_type"."oid" = "primary_foreign_operator"."oprright"
                JOIN "pg_catalog"."pg_namespace" AS "primary_foreign_right_type_namespace"
                  ON "primary_foreign_right_type_namespace"."oid" = "primary_foreign_right_type"."typnamespace"
              ), '[]'::"pg_catalog"."jsonb"),
              'primaryPrimary', COALESCE((
                SELECT "pg_catalog"."jsonb_agg"(
                  "pg_catalog"."jsonb_build_object"(
                    'schemaName', "primary_primary_operator_namespace"."nspname"::"pg_catalog"."text",
                    'operatorName', "primary_primary_operator"."oprname"::"pg_catalog"."text",
                    'leftTypeSchemaName', "primary_primary_left_type_namespace"."nspname"::"pg_catalog"."text",
                    'leftTypeName', "primary_primary_left_type"."typname"::"pg_catalog"."text",
                    'rightTypeSchemaName', "primary_primary_right_type_namespace"."nspname"::"pg_catalog"."text",
                    'rightTypeName', "primary_primary_right_type"."typname"::"pg_catalog"."text"
                  ) ORDER BY "primary_primary_operator_key"."ordinality"
                )
                FROM "pg_catalog"."unnest"("constraint_entry"."conppeqop")
                  WITH ORDINALITY AS "primary_primary_operator_key"("operator_oid", "ordinality")
                JOIN "pg_catalog"."pg_operator" AS "primary_primary_operator"
                  ON "primary_primary_operator"."oid" = "primary_primary_operator_key"."operator_oid"
                JOIN "pg_catalog"."pg_namespace" AS "primary_primary_operator_namespace"
                  ON "primary_primary_operator_namespace"."oid" = "primary_primary_operator"."oprnamespace"
                JOIN "pg_catalog"."pg_type" AS "primary_primary_left_type"
                  ON "primary_primary_left_type"."oid" = "primary_primary_operator"."oprleft"
                JOIN "pg_catalog"."pg_namespace" AS "primary_primary_left_type_namespace"
                  ON "primary_primary_left_type_namespace"."oid" = "primary_primary_left_type"."typnamespace"
                JOIN "pg_catalog"."pg_type" AS "primary_primary_right_type"
                  ON "primary_primary_right_type"."oid" = "primary_primary_operator"."oprright"
                JOIN "pg_catalog"."pg_namespace" AS "primary_primary_right_type_namespace"
                  ON "primary_primary_right_type_namespace"."oid" = "primary_primary_right_type"."typnamespace"
              ), '[]'::"pg_catalog"."jsonb"),
              'foreignForeign', COALESCE((
                SELECT "pg_catalog"."jsonb_agg"(
                  "pg_catalog"."jsonb_build_object"(
                    'schemaName', "foreign_foreign_operator_namespace"."nspname"::"pg_catalog"."text",
                    'operatorName', "foreign_foreign_operator"."oprname"::"pg_catalog"."text",
                    'leftTypeSchemaName', "foreign_foreign_left_type_namespace"."nspname"::"pg_catalog"."text",
                    'leftTypeName', "foreign_foreign_left_type"."typname"::"pg_catalog"."text",
                    'rightTypeSchemaName', "foreign_foreign_right_type_namespace"."nspname"::"pg_catalog"."text",
                    'rightTypeName', "foreign_foreign_right_type"."typname"::"pg_catalog"."text"
                  ) ORDER BY "foreign_foreign_operator_key"."ordinality"
                )
                FROM "pg_catalog"."unnest"("constraint_entry"."conffeqop")
                  WITH ORDINALITY AS "foreign_foreign_operator_key"("operator_oid", "ordinality")
                JOIN "pg_catalog"."pg_operator" AS "foreign_foreign_operator"
                  ON "foreign_foreign_operator"."oid" = "foreign_foreign_operator_key"."operator_oid"
                JOIN "pg_catalog"."pg_namespace" AS "foreign_foreign_operator_namespace"
                  ON "foreign_foreign_operator_namespace"."oid" = "foreign_foreign_operator"."oprnamespace"
                JOIN "pg_catalog"."pg_type" AS "foreign_foreign_left_type"
                  ON "foreign_foreign_left_type"."oid" = "foreign_foreign_operator"."oprleft"
                JOIN "pg_catalog"."pg_namespace" AS "foreign_foreign_left_type_namespace"
                  ON "foreign_foreign_left_type_namespace"."oid" = "foreign_foreign_left_type"."typnamespace"
                JOIN "pg_catalog"."pg_type" AS "foreign_foreign_right_type"
                  ON "foreign_foreign_right_type"."oid" = "foreign_foreign_operator"."oprright"
                JOIN "pg_catalog"."pg_namespace" AS "foreign_foreign_right_type_namespace"
                  ON "foreign_foreign_right_type_namespace"."oid" = "foreign_foreign_right_type"."typnamespace"
              ), '[]'::"pg_catalog"."jsonb")
            ) ELSE NULL END,
          'checkDefinition', CASE WHEN "constraint_entry"."contype" = 'c'
            THEN "pg_catalog"."pg_get_constraintdef"("constraint_entry"."oid", FALSE)
            ELSE NULL END
        ) ORDER BY CASE "table_entries"."table_name"
          WHEN 'backfill_executions_v1' THEN 1
          WHEN 'backfill_receipts_v2' THEN 2
          ELSE 3 END, "constraint_entry"."conname"
      )
      FROM "table_entries"
      JOIN "pg_catalog"."pg_constraint" AS "constraint_entry"
        ON "constraint_entry"."conrelid" = "table_entries"."table_oid"
      LEFT JOIN "pg_catalog"."pg_class" AS "target_table"
        ON "target_table"."oid" = "constraint_entry"."confrelid"
      LEFT JOIN "pg_catalog"."pg_namespace" AS "target_namespace"
        ON "target_namespace"."oid" = "target_table"."relnamespace"
      LEFT JOIN "pg_catalog"."pg_index" AS "supporting_index"
        ON "supporting_index"."indexrelid" = "constraint_entry"."conindid"
      LEFT JOIN "pg_catalog"."pg_class" AS "supporting_index_entry"
        ON "supporting_index_entry"."oid" = "supporting_index"."indexrelid"
      LEFT JOIN "pg_catalog"."pg_namespace" AS "supporting_index_namespace"
        ON "supporting_index_namespace"."oid" = "supporting_index_entry"."relnamespace"
      LEFT JOIN "pg_catalog"."pg_am" AS "supporting_index_access_method"
        ON "supporting_index_access_method"."oid" = "supporting_index_entry"."relam"
      LEFT JOIN "pg_catalog"."pg_class" AS "supporting_index_table"
        ON "supporting_index_table"."oid" = "supporting_index"."indrelid"
      LEFT JOIN "pg_catalog"."pg_namespace" AS "supporting_index_table_namespace"
        ON "supporting_index_table_namespace"."oid" = "supporting_index_table"."relnamespace"
      WHERE "constraint_entry"."contype" IN ('p', 'u', 'f', 'c')
    ), '[]'::"pg_catalog"."jsonb")
  ) AS "catalog"
FROM "requested"
JOIN "current_role_entry" ON TRUE
JOIN "session_role_entry" ON TRUE`

if (
  `${GENERATED_SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL}\n` !==
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL_SOURCE
) {
  throw new Error('Supabase backfill database CAS-ledger verification SQL source drifted')
}

export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL =
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL_SOURCE.slice(0, -1)

export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_FIXED_QUERY = Object.freeze({
  queryId: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_ID,
  version: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_VERSION,
  sql: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL,
  parameterOrder: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_PARAMETER_ORDER,
  statementCount: 1 as const,
  catalogOnly: true as const,
  managedDataRead: false as const,
  accessMode: 'read-only' as const,
  snapshotScope: 'single-statement' as const
})

export interface SupabaseBackfillDatabaseCASLedgerVerificationRequestV1 extends SupabaseBackfillLiveCatalogAuthorityV1 {
  readonly queryId: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_ID
  readonly queryVersion: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_VERSION
  readonly queryDigest: string
  readonly reviewDigest: string
  readonly ledgerShapeDigest: string
  readonly sqlDigest: string
  readonly statementCount: 1
  readonly catalogOnly: true
  readonly managedDataRead: false
  readonly accessMode: 'read-only'
  readonly snapshotScope: 'single-statement'
  readonly parameters: Readonly<{
    schemaName: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA
    reviewDigest: string
    ledgerShapeDigest: string
    sqlDigest: string
    projectRef: string
    accountId: string
    grantGeneration: string
    queryVersion: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_VERSION
    queryDigest: string
  }>
}

export interface SupabaseBackfillDatabaseCASLedgerVerificationHostTransportV1 {
  getProjectAuthority(request: SupabaseBackfillLiveCatalogAuthorityV1): Promise<unknown>
  runReadOnlyDatabaseCASLedgerVerificationQuery(
    request: SupabaseBackfillDatabaseCASLedgerVerificationRequestV1
  ): Promise<unknown>
}

export type SupabaseBackfillDatabaseCASLedgerStateV1 = 'absent' | 'installed' | 'mismatch'

export type SupabaseBackfillDatabaseCASLedgerInstallMarkerStateV1 =
  | 'absent'
  | 'exact-single'
  | 'mismatch'

/**
 * Sanitized catalog evidence only. An exact marker remains review-only evidence and cannot mint
 * install, mutation, execution, Receipt, or release authority.
 */
export interface SupabaseBackfillDatabaseCASLedgerInstallMarkerEvidenceV1 {
  readonly constraintName: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_CONSTRAINT
  readonly constraintComment: string | null
  readonly schemaMarkerPrefixCount: number
  readonly state: SupabaseBackfillDatabaseCASLedgerInstallMarkerStateV1
  readonly exactSingleMarkerOnConstraint: boolean
  readonly rawArbitraryCommentsReturned: false
}

interface VerifiedTableV1 {
  readonly tableName: string
  readonly tableOid: string
  readonly ownerOid: string
  readonly ownerName: string
  readonly relationKind: 'r'
  readonly persistence: 'p' | 'u' | 't'
  readonly isPartition: boolean
  readonly replicaIdentity: 'd' | 'n' | 'f' | 'i'
  readonly rlsEnabled: boolean
  readonly rlsForced: boolean
  readonly comment: string | null
  readonly nonOwnerPrivilegeCount: number
  readonly policyCount: number
}

export interface SupabaseBackfillDatabaseCASLedgerVerificationV1 {
  readonly format: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly reviewOnly: true
  readonly applyAvailable: false
  readonly databaseLedgerBound: false
  readonly sourceLedgerBound: false
  readonly releaseReady: false
  readonly installAuthorityCreated: false
  readonly mutationAuthorityCreated: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly reviewDigest: string
  readonly verificationDigest: string
  readonly authority: SupabaseBackfillLiveCatalogAuthorityV1
  readonly query: Readonly<{
    id: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_ID
    version: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_VERSION
    digest: string
    statementCount: 1
    catalogOnly: true
    managedDataRead: false
    accessMode: 'read-only'
    snapshotScope: 'single-statement'
  }>
  readonly observedAt: string
  readonly snapshotMarker: string
  readonly serverVersionNum: string
  readonly state: SupabaseBackfillDatabaseCASLedgerStateV1
  readonly verifiedInstalled: boolean
  readonly roles: Readonly<{
    currentOid: string
    currentName: string
    currentSuperuser: boolean
    currentBypassRls: boolean
    currentHasEffectivePgReadAllData: boolean
    sessionOid: string
    sessionName: string
    sessionSuperuser: boolean
    sessionBypassRls: boolean
    sessionHasEffectivePgReadAllData: boolean
  }>
  readonly settings: Readonly<{
    databasePrimary: boolean
    transactionReadOnly: boolean
    effectiveSearchPath: readonly string[]
  }>
  readonly catalog: Readonly<{
    schemaCount: number
    schemaOid: string | null
    schemaOwnerOid: string | null
    schemaOwnerName: string | null
    schemaComment: string | null
    ownerRoleMemberCount: number
    ownerDefaultNonOwnerPrivilegeCount: number
    schemaNonOwnerPrivilegeCount: number
    relationCount: number
    unexpectedIndexCount: number
    unexpectedTriggerCount: number
    unexpectedRuleCount: number
    unexpectedConstraintCount: number
    inheritanceRelationCount: number
    publicationExposureCount: number
    droppedColumnCount: number
    policyCount: number
    tables: readonly VerifiedTableV1[]
    columnCount: number
    constraintCount: number
    installationMarker: SupabaseBackfillDatabaseCASLedgerInstallMarkerEvidenceV1
    fingerprints: Readonly<{
      observedColumnDigest: string
      expectedColumnDigest: string
      observedConstraintDigest: string
      expectedConstraintDigest: string
    }>
    rawCheckDefinitionsReturned: false
  }>
  readonly checks: Readonly<{
    queryBindingsExact: boolean
    queryRoleMatchesReadOnlyEndpoint: boolean
    queryRoleIsNonSuperuser: boolean
    queryRoleBypassesRls: boolean
    queryRoleHasEffectivePgReadAllData: boolean
    queryRoleIsNotLedgerOwner: boolean
    currentAndSessionRoleMatch: boolean
    databaseIsPrimary: boolean
    searchPathIsBounded: boolean
    absentStateExact: boolean
    schemaExact: boolean
    tableShapeExact: boolean
    columnShapeExact: boolean
    constraintShapeExact: boolean
    commentsExact: boolean
    rowLevelSecurityExact: boolean
    aclExact: boolean
    zeroPolicies: boolean
    noUnexpectedRelations: boolean
    exactInstalledState: boolean
    allVerificationChecksPassed: boolean
  }>
  readonly blockers: readonly string[]
}

type MaybePromise<T> = T | Promise<T>

export interface VerifySupabaseBackfillDatabaseCASLedgerOptionsV1 {
  readonly review: SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1
  readonly readCurrentAuthority: () => MaybePromise<SupabaseBackfillLiveCatalogAuthorityV1>
  readonly transport: SupabaseBackfillDatabaseCASLedgerVerificationHostTransportV1
}

export type SupabaseBackfillDatabaseCASLedgerVerificationErrorCode =
  | 'supabase-backfill-database-cas-ledger-verification-input-invalid'
  | 'supabase-backfill-database-cas-ledger-verification-input-changed'
  | 'supabase-backfill-database-cas-ledger-verification-project-authority-mismatch'
  | 'supabase-backfill-database-cas-ledger-verification-response-invalid'
  | 'supabase-backfill-database-cas-ledger-verification-query-binding-mismatch'
  | 'supabase-backfill-database-cas-ledger-verification-transport-failed'
  | 'supabase-backfill-database-cas-ledger-verification-digest-failed'

export class SupabaseBackfillDatabaseCASLedgerVerificationError extends Error {
  constructor(readonly code: SupabaseBackfillDatabaseCASLedgerVerificationErrorCode) {
    super(`Supabase backfill database CAS ledger verification failed: ${code}.`)
    this.name = 'SupabaseBackfillDatabaseCASLedgerVerificationError'
  }
}

type UnknownRecord = Record<PropertyKey, unknown>

interface TrustedVerificationContextV1 {
  readonly review: SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1
  readonly verification: SupabaseBackfillDatabaseCASLedgerVerificationV1
  readonly installedVerificationEpoch: SupabaseBackfillDatabaseCASLedgerInstalledVerificationEpochV1
}

declare const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALLED_VERIFICATION_EPOCH_BRAND: unique symbol

/**
 * Opaque same-process freshness capability. Runtime acceptance depends on the exact object identity
 * retained by this module; cloned, serialized, or structurally forged values cannot satisfy it.
 */
export type SupabaseBackfillDatabaseCASLedgerInstalledVerificationEpochV1 = Readonly<{
  readonly [SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALLED_VERIFICATION_EPOCH_BRAND]: true
}>

const trustedVerifications = new WeakMap<object, TrustedVerificationContextV1>()
const installedVerificationEpochs = new WeakMap<
  SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1,
  SupabaseBackfillDatabaseCASLedgerInstalledVerificationEpochV1
>()
const consumedInstalledVerifications = new WeakSet<object>()
const OPTION_KEYS = ['review', 'readCurrentAuthority', 'transport'] as const
const RESPONSE_KEYS = [
  'reviewDigest',
  'ledgerShapeDigest',
  'sqlDigest',
  'projectRef',
  'accountId',
  'grantGeneration',
  'queryVersion',
  'queryDigest',
  'accessMode',
  'snapshotScope',
  'catalogOnly',
  'managedDataRead',
  'serverVersionNum',
  'snapshotMarker',
  'observedAt',
  'roles',
  'settings',
  'catalog'
] as const
const PROJECT_REF = /^[a-z]{20}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const OID = /^(?:0|[1-9][0-9]{0,9})$/u
const SNAPSHOT_MARKER = /^[0-9:,]{1,512}$/u
const INSTALL_MARKER =
  /^openpencil-install:v1:supabase-backfill-database-cas-ledger:[A-Za-z0-9_-]{43}$/u
const SUPPORTED_SERVER_VERSION = /^(?:15|16|17)[0-9]{4}$/u
const MAX_COUNT = 1_000_000
const READ_ONLY_QUERY_ROLE = 'supabase_read_only_user'
const BOUNDED_SEARCH_PATH = Object.freeze(['pg_catalog', 'public'] as const)

function freshInstalledVerificationEpoch(): SupabaseBackfillDatabaseCASLedgerInstalledVerificationEpochV1 {
  return Object.freeze({}) as SupabaseBackfillDatabaseCASLedgerInstalledVerificationEpochV1
}

function currentInstalledVerificationEpoch(
  review: SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1
): SupabaseBackfillDatabaseCASLedgerInstalledVerificationEpochV1 {
  const current = installedVerificationEpochs.get(review)
  if (current) return current
  const initial = freshInstalledVerificationEpoch()
  installedVerificationEpochs.set(review, initial)
  return initial
}

function fail(code: SupabaseBackfillDatabaseCASLedgerVerificationErrorCode): never {
  throw new SupabaseBackfillDatabaseCASLedgerVerificationError(code)
}

function ownData(
  value: object,
  key: PropertyKey,
  code: SupabaseBackfillDatabaseCASLedgerVerificationErrorCode
): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail(code)
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return fail(code)
  return descriptor.value
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  code: SupabaseBackfillDatabaseCASLedgerVerificationErrorCode
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

function exactArray(
  value: unknown,
  maximum: number,
  code: SupabaseBackfillDatabaseCASLedgerVerificationErrorCode
): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) return fail(code)
  let keys: readonly PropertyKey[]
  let lengthDescriptor: PropertyDescriptor | undefined
  try {
    keys = Reflect.ownKeys(value)
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  } catch {
    return fail(code)
  }
  if (
    keys.length !== value.length + 1 ||
    !keys.includes('length') ||
    lengthDescriptor?.enumerable !== false ||
    !Object.hasOwn(lengthDescriptor, 'value') ||
    lengthDescriptor.value !== value.length
  ) {
    return fail(code)
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!keys.includes(String(index))) return fail(code)
    ownData(value, String(index), code)
  }
  return value
}

function text(
  value: unknown,
  code: SupabaseBackfillDatabaseCASLedgerVerificationErrorCode,
  maximum = 8_192
): string {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) return fail(code)
  return value
}

function stableId(
  value: unknown,
  code: SupabaseBackfillDatabaseCASLedgerVerificationErrorCode
): string {
  const parsed = text(value, code, 128)
  if (!STABLE_ID.test(parsed)) return fail(code)
  return parsed
}

function oid(value: unknown, code: SupabaseBackfillDatabaseCASLedgerVerificationErrorCode): string {
  if (typeof value !== 'string' || !OID.test(value)) return fail(code)
  return value
}

function boolean(
  value: unknown,
  code: SupabaseBackfillDatabaseCASLedgerVerificationErrorCode
): boolean {
  if (typeof value !== 'boolean') return fail(code)
  return value
}

function integer(
  value: unknown,
  code: SupabaseBackfillDatabaseCASLedgerVerificationErrorCode
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_COUNT) {
    return fail(code)
  }
  return value as number
}

function nullableText(
  value: unknown,
  code: SupabaseBackfillDatabaseCASLedgerVerificationErrorCode
): string | null {
  return value === null ? null : text(value, code)
}

function installMarkerComment(
  value: unknown,
  code: SupabaseBackfillDatabaseCASLedgerVerificationErrorCode
): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !INSTALL_MARKER.test(value)) return fail(code)
  return value
}

function nullableOid(
  value: unknown,
  code: SupabaseBackfillDatabaseCASLedgerVerificationErrorCode
): string | null {
  return value === null ? null : oid(value, code)
}

function checkedAuthority(value: unknown): SupabaseBackfillLiveCatalogAuthorityV1 {
  const code = 'supabase-backfill-database-cas-ledger-verification-input-invalid' as const
  const source = exactRecord(value, ['projectRef', 'accountId', 'grantGeneration'], code)
  const projectRef = ownData(source, 'projectRef', code)
  if (typeof projectRef !== 'string' || !PROJECT_REF.test(projectRef)) return fail(code)
  return Object.freeze({
    projectRef,
    accountId: stableId(ownData(source, 'accountId', code), code),
    grantGeneration: stableId(ownData(source, 'grantGeneration', code), code)
  })
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

function optionsSnapshot(value: unknown): VerifySupabaseBackfillDatabaseCASLedgerOptionsV1 {
  const code = 'supabase-backfill-database-cas-ledger-verification-input-invalid' as const
  const source = exactRecord(value, OPTION_KEYS, code)
  const review = ownData(source, 'review', code)
  const readCurrentAuthority = ownData(source, 'readCurrentAuthority', code)
  const transport = ownData(source, 'transport', code)
  if (
    !trustedSupabaseBackfillDatabaseCASLedgerReviewContextV1(review) ||
    typeof readCurrentAuthority !== 'function' ||
    transport === null ||
    typeof transport !== 'object'
  ) {
    return fail(code)
  }
  return Object.freeze({
    review: review as SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1,
    readCurrentAuthority:
      readCurrentAuthority as VerifySupabaseBackfillDatabaseCASLedgerOptionsV1['readCurrentAuthority'],
    transport: transport as SupabaseBackfillDatabaseCASLedgerVerificationHostTransportV1
  })
}

function expectedAuthority(
  context: TrustedSupabaseBackfillDatabaseCASLedgerReviewContextV1
): SupabaseBackfillLiveCatalogAuthorityV1 {
  const authority = context.receiptReview.review.authority
  return Object.freeze({
    projectRef: authority.projectRef,
    accountId: authority.accountId,
    grantGeneration: authority.readGrantGeneration
  })
}

function requireCurrentReviewContext(
  review: SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1,
  expected: TrustedSupabaseBackfillDatabaseCASLedgerReviewContextV1
): void {
  if (trustedSupabaseBackfillDatabaseCASLedgerReviewContextV1(review) !== expected) {
    fail('supabase-backfill-database-cas-ledger-verification-input-changed')
  }
}

async function currentAuthority(
  options: VerifySupabaseBackfillDatabaseCASLedgerOptionsV1,
  expected: SupabaseBackfillLiveCatalogAuthorityV1
): Promise<SupabaseBackfillLiveCatalogAuthorityV1> {
  let current: SupabaseBackfillLiveCatalogAuthorityV1
  try {
    current = checkedAuthority(await options.readCurrentAuthority())
  } catch (cause) {
    if (cause instanceof SupabaseBackfillDatabaseCASLedgerVerificationError) throw cause
    return fail('supabase-backfill-database-cas-ledger-verification-input-invalid')
  }
  if (!sameAuthority(current, expected)) {
    return fail('supabase-backfill-database-cas-ledger-verification-input-changed')
  }
  return current
}

function requireProjectAuthority(
  value: unknown,
  expected: SupabaseBackfillLiveCatalogAuthorityV1
): void {
  const code =
    'supabase-backfill-database-cas-ledger-verification-project-authority-mismatch' as const
  const source = exactRecord(value, ['projectRef', 'organizationId', 'grantGeneration'], code)
  if (
    ownData(source, 'projectRef', code) !== expected.projectRef ||
    ownData(source, 'organizationId', code) !== expected.accountId ||
    ownData(source, 'grantGeneration', code) !== expected.grantGeneration
  ) {
    fail(code)
  }
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-backfill-database-cas-ledger-verification-digest-failed')
  }
}

async function verificationRequest(
  review: SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1,
  authority: SupabaseBackfillLiveCatalogAuthorityV1
): Promise<SupabaseBackfillDatabaseCASLedgerVerificationRequestV1> {
  const queryDigest = await digest(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_FIXED_QUERY)
  const parameters = Object.freeze({
    schemaName: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA,
    reviewDigest: review.reviewDigest,
    ledgerShapeDigest: review.review.bindings.ledgerShapeDigest,
    sqlDigest: review.review.bindings.sqlDigest,
    ...authority,
    queryVersion: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_VERSION,
    queryDigest
  })
  return Object.freeze({
    queryId: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_ID,
    queryVersion: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_VERSION,
    queryDigest,
    reviewDigest: review.reviewDigest,
    ledgerShapeDigest: review.review.bindings.ledgerShapeDigest,
    sqlDigest: review.review.bindings.sqlDigest,
    ...authority,
    statementCount: 1 as const,
    catalogOnly: true as const,
    managedDataRead: false as const,
    accessMode: 'read-only' as const,
    snapshotScope: 'single-statement' as const,
    parameters
  })
}

function parseRoles(value: unknown) {
  const code = 'supabase-backfill-database-cas-ledger-verification-response-invalid' as const
  const source = exactRecord(
    value,
    [
      'currentOid',
      'currentName',
      'currentSuperuser',
      'currentBypassRls',
      'currentHasEffectivePgReadAllData',
      'sessionOid',
      'sessionName',
      'sessionSuperuser',
      'sessionBypassRls',
      'sessionHasEffectivePgReadAllData'
    ],
    code
  )
  return Object.freeze({
    currentOid: oid(source.currentOid, code),
    currentName: stableId(source.currentName, code),
    currentSuperuser: boolean(source.currentSuperuser, code),
    currentBypassRls: boolean(source.currentBypassRls, code),
    currentHasEffectivePgReadAllData: boolean(source.currentHasEffectivePgReadAllData, code),
    sessionOid: oid(source.sessionOid, code),
    sessionName: stableId(source.sessionName, code),
    sessionSuperuser: boolean(source.sessionSuperuser, code),
    sessionBypassRls: boolean(source.sessionBypassRls, code),
    sessionHasEffectivePgReadAllData: boolean(source.sessionHasEffectivePgReadAllData, code)
  })
}

function parseSettings(value: unknown) {
  const code = 'supabase-backfill-database-cas-ledger-verification-response-invalid' as const
  const source = exactRecord(
    value,
    ['databasePrimary', 'transactionReadOnly', 'effectiveSearchPath'],
    code
  )
  const searchPath = exactArray(source.effectiveSearchPath, 16, code).map((entry) =>
    text(entry, code)
  )
  return Object.freeze({
    databasePrimary: boolean(source.databasePrimary, code),
    transactionReadOnly: boolean(source.transactionReadOnly, code),
    effectiveSearchPath: Object.freeze(searchPath)
  })
}

function parseTables(value: unknown): readonly VerifiedTableV1[] {
  const code = 'supabase-backfill-database-cas-ledger-verification-response-invalid' as const
  return Object.freeze(
    exactArray(value, 3, code).map((entry) => {
      const source = exactRecord(
        entry,
        [
          'tableName',
          'tableOid',
          'ownerOid',
          'ownerName',
          'relationKind',
          'persistence',
          'isPartition',
          'replicaIdentity',
          'rlsEnabled',
          'rlsForced',
          'comment',
          'nonOwnerPrivilegeCount',
          'policyCount'
        ],
        code
      )
      const relationKind = source.relationKind
      const persistence = source.persistence
      const replicaIdentity = source.replicaIdentity
      if (
        relationKind !== 'r' ||
        !['p', 'u', 't'].includes(String(persistence)) ||
        !['d', 'n', 'f', 'i'].includes(String(replicaIdentity))
      ) {
        return fail(code)
      }
      return Object.freeze({
        tableName: stableId(source.tableName, code),
        tableOid: oid(source.tableOid, code),
        ownerOid: oid(source.ownerOid, code),
        ownerName: stableId(source.ownerName, code),
        relationKind,
        persistence: persistence as VerifiedTableV1['persistence'],
        isPartition: boolean(source.isPartition, code),
        replicaIdentity: replicaIdentity as VerifiedTableV1['replicaIdentity'],
        rlsEnabled: boolean(source.rlsEnabled, code),
        rlsForced: boolean(source.rlsForced, code),
        comment: nullableText(source.comment, code),
        nonOwnerPrivilegeCount: integer(source.nonOwnerPrivilegeCount, code),
        policyCount: integer(source.policyCount, code)
      })
    })
  )
}

function parseColumns(value: unknown): readonly VerifiedColumnV1[] {
  const code = 'supabase-backfill-database-cas-ledger-verification-response-invalid' as const
  return Object.freeze(
    exactArray(value, 64, code).map((entry) => {
      const source = exactRecord(
        entry,
        [
          'tableName',
          'ordinal',
          'columnName',
          'typeSchema',
          'typeName',
          'notNull',
          'identityKind',
          'generatedKind',
          'typeModifier',
          'usesTypeDefaultCollation',
          'hasDefault',
          'nonOwnerColumnPrivilegeCount'
        ],
        code
      )
      const typeSchema = source.typeSchema
      const typeName = source.typeName
      const identityKind = source.identityKind
      const generatedKind = source.generatedKind
      const typeModifier = source.typeModifier
      const usesTypeDefaultCollation = source.usesTypeDefaultCollation
      const hasDefault = source.hasDefault
      const nonOwnerColumnPrivilegeCount = integer(source.nonOwnerColumnPrivilegeCount, code)
      if (
        typeSchema !== 'pg_catalog' ||
        !['text', 'int8', 'int4', 'timestamptz', 'bytea'].includes(String(typeName)) ||
        identityKind !== '' ||
        generatedKind !== '' ||
        !Number.isSafeInteger(typeModifier) ||
        (typeModifier as number) < -1 ||
        (typeModifier as number) > MAX_COUNT ||
        typeof usesTypeDefaultCollation !== 'boolean' ||
        typeof hasDefault !== 'boolean'
      ) {
        return fail(code)
      }
      return Object.freeze({
        tableName: stableId(source.tableName, code),
        ordinal: integer(source.ordinal, code),
        columnName: stableId(source.columnName, code),
        typeSchema,
        typeName: typeName as ExpectedColumnV1['typeName'],
        notNull: boolean(source.notNull, code),
        identityKind,
        generatedKind,
        typeModifier: typeModifier as number,
        usesTypeDefaultCollation,
        hasDefault,
        nonOwnerColumnPrivilegeCount
      })
    })
  )
}

function stringArray(value: unknown, maximum: number): readonly string[] {
  const code = 'supabase-backfill-database-cas-ledger-verification-response-invalid' as const
  return Object.freeze(exactArray(value, maximum, code).map((entry) => stableId(entry, code)))
}

function integerArray(value: unknown, maximum: number): readonly number[] {
  const code = 'supabase-backfill-database-cas-ledger-verification-response-invalid' as const
  return Object.freeze(exactArray(value, maximum, code).map((entry) => integer(entry, code)))
}

function parseIndexOpclasses(value: unknown): readonly VerifiedIndexOpclassV1[] {
  const code = 'supabase-backfill-database-cas-ledger-verification-response-invalid' as const
  return Object.freeze(
    exactArray(value, 8, code).map((entry) => {
      const source = exactRecord(entry, ['schemaName', 'opclassName'], code)
      return Object.freeze({
        schemaName: stableId(source.schemaName, code),
        opclassName: stableId(source.opclassName, code)
      })
    })
  )
}

function parseSupportingIndex(
  value: unknown,
  constraintType: ExpectedConstraintV1['constraintType']
): VerifiedSupportingIndexV1 | null {
  const code = 'supabase-backfill-database-cas-ledger-verification-response-invalid' as const
  if (value === null) {
    if (constraintType !== 'c') return fail(code)
    return null
  }
  if (constraintType === 'c') return fail(code)
  const source = exactRecord(
    value,
    [
      'indexSchemaName',
      'indexName',
      'tableSchemaName',
      'tableName',
      'accessMethodName',
      'keyAttributeCount',
      'totalAttributeCount',
      'keyFields',
      'includedFields',
      'keyOpclasses',
      'keyOptions',
      'keyCollationsMatchColumns',
      'primary',
      'valid',
      'ready',
      'live',
      'unique',
      'immediate',
      'hasPredicate',
      'hasExpressions',
      'nullsNotDistinct'
    ],
    code
  )
  const keyAttributeCount = integer(source.keyAttributeCount, code)
  const totalAttributeCount = integer(source.totalAttributeCount, code)
  const keyFields = stringArray(source.keyFields, 8)
  const includedFields = stringArray(source.includedFields, 8)
  const keyOpclasses = parseIndexOpclasses(source.keyOpclasses)
  const keyOptions = integerArray(source.keyOptions, 8)
  if (
    keyAttributeCount < 1 ||
    totalAttributeCount < keyAttributeCount ||
    totalAttributeCount > 8 ||
    keyFields.length !== keyAttributeCount ||
    includedFields.length !== totalAttributeCount - keyAttributeCount ||
    keyOpclasses.length !== keyAttributeCount ||
    keyOptions.length !== keyAttributeCount
  ) {
    return fail(code)
  }
  return Object.freeze({
    indexSchemaName: stableId(source.indexSchemaName, code),
    indexName: stableId(source.indexName, code),
    tableSchemaName: stableId(source.tableSchemaName, code),
    tableName: stableId(source.tableName, code),
    accessMethodName: stableId(source.accessMethodName, code),
    keyAttributeCount,
    totalAttributeCount,
    keyFields,
    includedFields,
    keyOpclasses,
    keyOptions,
    keyCollationsMatchColumns: boolean(source.keyCollationsMatchColumns, code),
    primary: boolean(source.primary, code),
    valid: boolean(source.valid, code),
    ready: boolean(source.ready, code),
    live: boolean(source.live, code),
    unique: boolean(source.unique, code),
    immediate: boolean(source.immediate, code),
    hasPredicate: boolean(source.hasPredicate, code),
    hasExpressions: boolean(source.hasExpressions, code),
    nullsNotDistinct: boolean(source.nullsNotDistinct, code)
  })
}

function parseOperatorIdentities(value: unknown): readonly VerifiedOperatorIdentityV1[] {
  const code = 'supabase-backfill-database-cas-ledger-verification-response-invalid' as const
  return Object.freeze(
    exactArray(value, 8, code).map((entry) => {
      const source = exactRecord(
        entry,
        [
          'schemaName',
          'operatorName',
          'leftTypeSchemaName',
          'leftTypeName',
          'rightTypeSchemaName',
          'rightTypeName'
        ],
        code
      )
      const operatorName = text(source.operatorName, code, 128)
      if (operatorName.length === 0) return fail(code)
      return Object.freeze({
        schemaName: stableId(source.schemaName, code),
        operatorName,
        leftTypeSchemaName: stableId(source.leftTypeSchemaName, code),
        leftTypeName: stableId(source.leftTypeName, code),
        rightTypeSchemaName: stableId(source.rightTypeSchemaName, code),
        rightTypeName: stableId(source.rightTypeName, code)
      })
    })
  )
}

function parseForeignKeyOperators(
  value: unknown,
  constraintType: ExpectedConstraintV1['constraintType'],
  fieldCount: number
): VerifiedForeignKeyOperatorsV1 | null {
  const code = 'supabase-backfill-database-cas-ledger-verification-response-invalid' as const
  if (value === null) {
    if (constraintType === 'f') return fail(code)
    return null
  }
  if (constraintType !== 'f') return fail(code)
  const source = exactRecord(value, ['primaryForeign', 'primaryPrimary', 'foreignForeign'], code)
  const primaryForeign = parseOperatorIdentities(source.primaryForeign)
  const primaryPrimary = parseOperatorIdentities(source.primaryPrimary)
  const foreignForeign = parseOperatorIdentities(source.foreignForeign)
  if (
    primaryForeign.length !== fieldCount ||
    primaryPrimary.length !== fieldCount ||
    foreignForeign.length !== fieldCount
  ) {
    return fail(code)
  }
  return Object.freeze({ primaryForeign, primaryPrimary, foreignForeign })
}

function parseConstraints(value: unknown): readonly VerifiedConstraintV1[] {
  const code = 'supabase-backfill-database-cas-ledger-verification-response-invalid' as const
  return Object.freeze(
    exactArray(value, 64, code).map((entry) => {
      const source = exactRecord(
        entry,
        [
          'tableName',
          'constraintName',
          'constraintType',
          'fields',
          'targetSchemaName',
          'targetTableName',
          'targetFields',
          'updateAction',
          'deleteAction',
          'matchType',
          'deferrable',
          'initiallyDeferred',
          'validated',
          'noInherit',
          'local',
          'inheritedCount',
          'hasParentConstraint',
          'constraintTriggerCount',
          'enabledConstraintTriggerCount',
          'supportingIndex',
          'foreignKeyOperators',
          'checkDefinition'
        ],
        code
      )
      const constraintType = source.constraintType
      const updateAction = source.updateAction
      const deleteAction = source.deleteAction
      const matchType = source.matchType
      if (
        !['p', 'u', 'f', 'c'].includes(String(constraintType)) ||
        ![' ', 'r'].includes(String(updateAction)) ||
        ![' ', 'r'].includes(String(deleteAction)) ||
        ![' ', 's', 'f'].includes(String(matchType))
      ) {
        return fail(code)
      }
      const parsedConstraintType = constraintType as ExpectedConstraintV1['constraintType']
      const fields = stringArray(source.fields, 8)
      return Object.freeze({
        tableName: stableId(source.tableName, code),
        constraintName: stableId(source.constraintName, code),
        constraintType: parsedConstraintType,
        fields,
        targetSchemaName:
          source.targetSchemaName === null ? null : stableId(source.targetSchemaName, code),
        targetTableName:
          source.targetTableName === null ? null : stableId(source.targetTableName, code),
        targetFields: stringArray(source.targetFields, 8),
        updateAction: updateAction as ExpectedConstraintV1['updateAction'],
        deleteAction: deleteAction as ExpectedConstraintV1['deleteAction'],
        matchType: matchType as ExpectedConstraintV1['matchType'],
        deferrable: boolean(source.deferrable, code),
        initiallyDeferred: boolean(source.initiallyDeferred, code),
        validated: boolean(source.validated, code),
        noInherit: boolean(source.noInherit, code),
        local: boolean(source.local, code),
        inheritedCount: integer(source.inheritedCount, code),
        hasParentConstraint: boolean(source.hasParentConstraint, code),
        constraintTriggerCount: integer(source.constraintTriggerCount, code),
        enabledConstraintTriggerCount: integer(source.enabledConstraintTriggerCount, code),
        supportingIndex: parseSupportingIndex(source.supportingIndex, parsedConstraintType),
        foreignKeyOperators: parseForeignKeyOperators(
          source.foreignKeyOperators,
          parsedConstraintType,
          fields.length
        ),
        checkDefinition: nullableText(source.checkDefinition, code)
      })
    })
  )
}

function parseCatalog(value: unknown) {
  const code = 'supabase-backfill-database-cas-ledger-verification-response-invalid' as const
  const source = exactRecord(
    value,
    [
      'schemaCount',
      'schemaOid',
      'schemaOwnerOid',
      'schemaOwnerName',
      'schemaComment',
      'installMarkerConstraintComment',
      'schemaInstallMarkerPrefixCount',
      'ownerRoleMemberCount',
      'ownerDefaultNonOwnerPrivilegeCount',
      'schemaNonOwnerPrivilegeCount',
      'relationCount',
      'unexpectedIndexCount',
      'unexpectedTriggerCount',
      'unexpectedRuleCount',
      'unexpectedConstraintCount',
      'inheritanceRelationCount',
      'publicationExposureCount',
      'droppedColumnCount',
      'policyCount',
      'tables',
      'columns',
      'constraints'
    ],
    code
  )
  const tables = parseTables(source.tables)
  const columns = parseColumns(source.columns)
  const constraints = parseConstraints(source.constraints)
  return Object.freeze({
    schemaCount: integer(source.schemaCount, code),
    schemaOid: nullableOid(source.schemaOid, code),
    schemaOwnerOid: nullableOid(source.schemaOwnerOid, code),
    schemaOwnerName:
      source.schemaOwnerName === null ? null : stableId(source.schemaOwnerName, code),
    schemaComment: nullableText(source.schemaComment, code),
    installMarkerConstraintComment: installMarkerComment(
      ownData(source, 'installMarkerConstraintComment', code),
      code
    ),
    schemaInstallMarkerPrefixCount: integer(
      ownData(source, 'schemaInstallMarkerPrefixCount', code),
      code
    ),
    ownerRoleMemberCount: integer(source.ownerRoleMemberCount, code),
    ownerDefaultNonOwnerPrivilegeCount: integer(source.ownerDefaultNonOwnerPrivilegeCount, code),
    schemaNonOwnerPrivilegeCount: integer(source.schemaNonOwnerPrivilegeCount, code),
    relationCount: integer(source.relationCount, code),
    unexpectedIndexCount: integer(source.unexpectedIndexCount, code),
    unexpectedTriggerCount: integer(source.unexpectedTriggerCount, code),
    unexpectedRuleCount: integer(source.unexpectedRuleCount, code),
    unexpectedConstraintCount: integer(source.unexpectedConstraintCount, code),
    inheritanceRelationCount: integer(source.inheritanceRelationCount, code),
    publicationExposureCount: integer(source.publicationExposureCount, code),
    droppedColumnCount: integer(source.droppedColumnCount, code),
    policyCount: integer(source.policyCount, code),
    tables,
    columns,
    constraints
  })
}

function canonicalTimestamp(value: unknown): string {
  const code = 'supabase-backfill-database-cas-ledger-verification-response-invalid' as const
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return fail(code)
  if (new Date(value).toISOString() !== value) return fail(code)
  return value
}

function responseBindings(
  source: UnknownRecord,
  request: SupabaseBackfillDatabaseCASLedgerVerificationRequestV1
): Readonly<{ snapshotMarker: string; serverVersionNum: string }> {
  const responseCode =
    'supabase-backfill-database-cas-ledger-verification-response-invalid' as const
  for (const [key, expected] of [
    ['reviewDigest', request.reviewDigest],
    ['ledgerShapeDigest', request.ledgerShapeDigest],
    ['sqlDigest', request.sqlDigest],
    ['projectRef', request.projectRef],
    ['accountId', request.accountId],
    ['grantGeneration', request.grantGeneration]
  ] as const) {
    if (source[key] !== expected) return fail(responseCode)
  }
  if (
    source.queryVersion !== request.queryVersion ||
    source.queryDigest !== request.queryDigest ||
    source.accessMode !== 'read-only' ||
    source.snapshotScope !== 'single-statement' ||
    source.catalogOnly !== true ||
    source.managedDataRead !== false
  ) {
    return fail('supabase-backfill-database-cas-ledger-verification-query-binding-mismatch')
  }
  if (typeof source.snapshotMarker !== 'string' || !SNAPSHOT_MARKER.test(source.snapshotMarker)) {
    return fail(responseCode)
  }
  if (
    typeof source.serverVersionNum !== 'string' ||
    !SUPPORTED_SERVER_VERSION.test(source.serverVersionNum)
  ) {
    return fail(responseCode)
  }
  return Object.freeze({
    snapshotMarker: source.snapshotMarker,
    serverVersionNum: source.serverVersionNum
  })
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index])
}

function expectedTableShape(
  table: VerifiedTableV1,
  schemaOwnerOid: string | null,
  schemaOwnerName: string | null
): boolean {
  return (
    Object.hasOwn(TABLE_COMMENTS, table.tableName) &&
    table.ownerOid === schemaOwnerOid &&
    table.ownerName === schemaOwnerName &&
    table.persistence === 'p' &&
    !table.isPartition &&
    table.replicaIdentity === 'd'
  )
}

function tableCommentsExact(tables: readonly VerifiedTableV1[]): boolean {
  return tables.every(
    (table) =>
      Object.hasOwn(TABLE_COMMENTS, table.tableName) &&
      table.comment === TABLE_COMMENTS[table.tableName as keyof typeof TABLE_COMMENTS]
  )
}

function installMarkerEvidence(
  observed: ReturnType<typeof parseCatalog>
): SupabaseBackfillDatabaseCASLedgerInstallMarkerEvidenceV1 {
  const marker = observed.installMarkerConstraintComment
  const count = observed.schemaInstallMarkerPrefixCount
  let state: SupabaseBackfillDatabaseCASLedgerInstallMarkerStateV1 = 'mismatch'
  if (marker === null && count === 0) state = 'absent'
  else if (marker !== null && count === 1) state = 'exact-single'
  return Object.freeze({
    constraintName: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_CONSTRAINT,
    constraintComment: marker,
    schemaMarkerPrefixCount: count,
    state,
    exactSingleMarkerOnConstraint: state === 'exact-single',
    rawArbitraryCommentsReturned: false as const
  })
}

async function inspectResponse(
  value: unknown,
  request: SupabaseBackfillDatabaseCASLedgerVerificationRequestV1
): Promise<SupabaseBackfillDatabaseCASLedgerVerificationV1> {
  const code = 'supabase-backfill-database-cas-ledger-verification-response-invalid' as const
  const source = exactRecord(value, RESPONSE_KEYS, code)
  const bindings = responseBindings(source, request)
  const roles = parseRoles(source.roles)
  const settings = parseSettings(source.settings)
  const observed = parseCatalog(source.catalog)
  const installationMarker = installMarkerEvidence(observed)
  const expectedTableNames = Object.freeze([EXECUTIONS, RECEIPTS, HEADS])
  const observedTableNames = observed.tables.map((table) => table.tableName)
  const absentStateExact =
    observed.schemaCount === 0 &&
    observed.schemaOid === null &&
    observed.schemaOwnerOid === null &&
    observed.schemaOwnerName === null &&
    observed.schemaComment === null &&
    observed.ownerRoleMemberCount === 0 &&
    observed.ownerDefaultNonOwnerPrivilegeCount === 0 &&
    observed.schemaNonOwnerPrivilegeCount === 0 &&
    observed.relationCount === 0 &&
    observed.unexpectedIndexCount === 0 &&
    observed.unexpectedTriggerCount === 0 &&
    observed.unexpectedRuleCount === 0 &&
    observed.unexpectedConstraintCount === 0 &&
    observed.inheritanceRelationCount === 0 &&
    observed.publicationExposureCount === 0 &&
    observed.droppedColumnCount === 0 &&
    observed.policyCount === 0 &&
    observed.tables.length === 0 &&
    observed.columns.length === 0 &&
    observed.constraints.length === 0 &&
    installationMarker.state === 'absent'
  const schemaExact =
    observed.schemaCount === 1 &&
    observed.schemaOid !== null &&
    observed.schemaOwnerOid !== null &&
    observed.schemaOwnerName !== null &&
    observed.schemaComment === SCHEMA_COMMENT
  const tableShapeExact =
    observed.tables.length === 3 &&
    sameStrings(observedTableNames, expectedTableNames) &&
    observed.tables.every((table) =>
      expectedTableShape(table, observed.schemaOwnerOid, observed.schemaOwnerName)
    )
  const [
    observedColumnDigest,
    expectedColumnDigest,
    observedConstraintDigest,
    expectedConstraintDigest
  ] = await Promise.all([
    digest(observed.columns),
    digest(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1),
    digest(observed.constraints),
    digest(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1)
  ])
  const columnShapeExact = observedColumnDigest === expectedColumnDigest
  const constraintShapeExact = observedConstraintDigest === expectedConstraintDigest
  const commentsExact = schemaExact && tableCommentsExact(observed.tables)
  const rowLevelSecurityExact =
    tableShapeExact && observed.tables.every((table) => table.rlsEnabled && !table.rlsForced)
  const aclExact =
    observed.ownerRoleMemberCount === 0 &&
    observed.ownerDefaultNonOwnerPrivilegeCount === 0 &&
    observed.schemaNonOwnerPrivilegeCount === 0 &&
    observed.tables.every((table) => table.nonOwnerPrivilegeCount === 0) &&
    observed.columns.every((column) => column.nonOwnerColumnPrivilegeCount === 0)
  const zeroPolicies =
    observed.policyCount === 0 && observed.tables.every((table) => table.policyCount === 0)
  const noUnexpectedRelations =
    observed.relationCount === 3 &&
    observed.unexpectedIndexCount === 0 &&
    observed.unexpectedTriggerCount === 0 &&
    observed.unexpectedRuleCount === 0 &&
    observed.unexpectedConstraintCount === 0 &&
    observed.inheritanceRelationCount === 0 &&
    observed.publicationExposureCount === 0 &&
    observed.droppedColumnCount === 0
  const currentAndSessionRoleMatch =
    roles.currentOid === roles.sessionOid &&
    roles.currentName === roles.sessionName &&
    roles.currentSuperuser === roles.sessionSuperuser &&
    roles.currentBypassRls === roles.sessionBypassRls &&
    roles.currentHasEffectivePgReadAllData === roles.sessionHasEffectivePgReadAllData
  const queryRoleMatchesReadOnlyEndpoint =
    roles.currentName === READ_ONLY_QUERY_ROLE && roles.sessionName === READ_ONLY_QUERY_ROLE
  const queryRoleIsNonSuperuser = !roles.currentSuperuser && !roles.sessionSuperuser
  const queryRoleBypassesRls = roles.currentBypassRls && roles.sessionBypassRls
  const queryRoleHasEffectivePgReadAllData =
    roles.currentHasEffectivePgReadAllData && roles.sessionHasEffectivePgReadAllData
  const ledgerOwners = [
    ...(observed.schemaOwnerOid === null || observed.schemaOwnerName === null
      ? []
      : [{ oid: observed.schemaOwnerOid, name: observed.schemaOwnerName }]),
    ...observed.tables.map((table) => ({ oid: table.ownerOid, name: table.ownerName }))
  ]
  const queryRoleIsNotLedgerOwner = ledgerOwners.every(
    (owner) =>
      roles.currentOid !== owner.oid &&
      roles.currentName !== owner.name &&
      roles.sessionOid !== owner.oid &&
      roles.sessionName !== owner.name
  )
  const searchPathIsBounded = sameStrings(settings.effectiveSearchPath, BOUNDED_SEARCH_PATH)
  const exactInstalledState = [
    schemaExact,
    tableShapeExact,
    columnShapeExact,
    constraintShapeExact,
    commentsExact,
    rowLevelSecurityExact,
    aclExact,
    zeroPolicies,
    noUnexpectedRelations
  ].every(Boolean)
  let state: SupabaseBackfillDatabaseCASLedgerStateV1 = 'mismatch'
  if (absentStateExact) state = 'absent'
  else if (exactInstalledState) state = 'installed'
  const partialChecks = Object.freeze({
    queryBindingsExact: true,
    queryRoleMatchesReadOnlyEndpoint,
    queryRoleIsNonSuperuser,
    queryRoleBypassesRls,
    queryRoleHasEffectivePgReadAllData,
    queryRoleIsNotLedgerOwner,
    currentAndSessionRoleMatch,
    databaseIsPrimary: settings.databasePrimary,
    searchPathIsBounded,
    absentStateExact,
    schemaExact,
    tableShapeExact,
    columnShapeExact,
    constraintShapeExact,
    commentsExact,
    rowLevelSecurityExact,
    aclExact,
    zeroPolicies,
    noUnexpectedRelations,
    exactInstalledState
  })
  const stateAcceptable = state === 'absent' ? absentStateExact : state === 'installed'
  const allVerificationChecksPassed =
    queryRoleMatchesReadOnlyEndpoint &&
    queryRoleIsNonSuperuser &&
    queryRoleBypassesRls &&
    queryRoleHasEffectivePgReadAllData &&
    queryRoleIsNotLedgerOwner &&
    currentAndSessionRoleMatch &&
    settings.databasePrimary &&
    searchPathIsBounded &&
    stateAcceptable
  const checks = Object.freeze({ ...partialChecks, allVerificationChecksPassed })
  const blockers: string[] = []
  if (state === 'absent') blockers.push('database-ledger-not-installed')
  if (state === 'mismatch') blockers.push('database-ledger-catalog-mismatch')
  if (state === 'installed' && installationMarker.state === 'absent') {
    blockers.push('database-ledger-install-marker-not-observed')
  }
  if (state === 'installed' && installationMarker.state === 'mismatch') {
    blockers.push('database-ledger-install-marker-ambiguous')
  }
  if (!queryRoleMatchesReadOnlyEndpoint) blockers.push('unexpected-read-only-query-role')
  if (!queryRoleIsNonSuperuser) blockers.push('privileged-query-role')
  if (!queryRoleBypassesRls) blockers.push('read-only-query-role-missing-bypassrls')
  if (!queryRoleHasEffectivePgReadAllData) {
    blockers.push('read-only-query-role-missing-effective-pg-read-all-data')
  }
  if (!queryRoleIsNotLedgerOwner) blockers.push('ledger-owner-query-role')
  if (!currentAndSessionRoleMatch) blockers.push('database-ledger-query-role-changed')
  if (!settings.databasePrimary) blockers.push('database-not-primary')
  if (!searchPathIsBounded) blockers.push('search-path-not-bounded')
  blockers.push(
    'database-ledger-install-authority-not-created',
    'source-migration-ledger-not-bound',
    'capture-receipt-not-persisted',
    'bounded-runner-unavailable'
  )
  const withoutDigest = Object.freeze({
    format: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    reviewOnly: true as const,
    applyAvailable: false as const,
    databaseLedgerBound: false as const,
    sourceLedgerBound: false as const,
    releaseReady: false as const,
    installAuthorityCreated: false as const,
    mutationAuthorityCreated: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
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
      managedDataRead: false as const,
      accessMode: 'read-only' as const,
      snapshotScope: 'single-statement' as const
    }),
    observedAt: canonicalTimestamp(source.observedAt),
    snapshotMarker: bindings.snapshotMarker,
    serverVersionNum: bindings.serverVersionNum,
    state,
    verifiedInstalled: state === 'installed' && allVerificationChecksPassed,
    roles,
    settings,
    catalog: Object.freeze({
      schemaCount: observed.schemaCount,
      schemaOid: observed.schemaOid,
      schemaOwnerOid: observed.schemaOwnerOid,
      schemaOwnerName: observed.schemaOwnerName,
      schemaComment: observed.schemaComment,
      ownerRoleMemberCount: observed.ownerRoleMemberCount,
      ownerDefaultNonOwnerPrivilegeCount: observed.ownerDefaultNonOwnerPrivilegeCount,
      schemaNonOwnerPrivilegeCount: observed.schemaNonOwnerPrivilegeCount,
      relationCount: observed.relationCount,
      unexpectedIndexCount: observed.unexpectedIndexCount,
      unexpectedTriggerCount: observed.unexpectedTriggerCount,
      unexpectedRuleCount: observed.unexpectedRuleCount,
      unexpectedConstraintCount: observed.unexpectedConstraintCount,
      inheritanceRelationCount: observed.inheritanceRelationCount,
      publicationExposureCount: observed.publicationExposureCount,
      droppedColumnCount: observed.droppedColumnCount,
      policyCount: observed.policyCount,
      tables: observed.tables,
      columnCount: observed.columns.length,
      constraintCount: observed.constraints.length,
      installationMarker,
      fingerprints: Object.freeze({
        observedColumnDigest,
        expectedColumnDigest,
        observedConstraintDigest,
        expectedConstraintDigest
      }),
      rawCheckDefinitionsReturned: false as const
    }),
    checks,
    blockers: Object.freeze([...new Set(blockers)])
  })
  return Object.freeze({ ...withoutDigest, verificationDigest: await digest(withoutDigest) })
}

/** Verify a genuine DDL review against one fixed, read-only database-catalog snapshot. */
export async function verifySupabaseBackfillDatabaseCASLedgerV1(
  input: VerifySupabaseBackfillDatabaseCASLedgerOptionsV1
): Promise<SupabaseBackfillDatabaseCASLedgerVerificationV1> {
  const options = optionsSnapshot(input)
  const context = trustedSupabaseBackfillDatabaseCASLedgerReviewContextV1(options.review)
  if (!context) return fail('supabase-backfill-database-cas-ledger-verification-input-invalid')
  const installedVerificationEpoch = currentInstalledVerificationEpoch(options.review)
  if (
    (await digest(options.review.review)) !== options.review.reviewDigest ||
    options.review.review.artifact.digest !== options.review.review.bindings.sqlDigest
  ) {
    return fail('supabase-backfill-database-cas-ledger-verification-input-changed')
  }
  const authority = expectedAuthority(context)
  requireCurrentReviewContext(options.review, context)
  await currentAuthority(options, authority)
  const request = await verificationRequest(options.review, authority)
  const transport = exactRecord(
    options.transport,
    ['getProjectAuthority', 'runReadOnlyDatabaseCASLedgerVerificationQuery'],
    'supabase-backfill-database-cas-ledger-verification-input-invalid'
  )
  const getProjectAuthority = ownData(
    transport,
    'getProjectAuthority',
    'supabase-backfill-database-cas-ledger-verification-input-invalid'
  )
  const runQuery = ownData(
    transport,
    'runReadOnlyDatabaseCASLedgerVerificationQuery',
    'supabase-backfill-database-cas-ledger-verification-input-invalid'
  )
  if (typeof getProjectAuthority !== 'function' || typeof runQuery !== 'function') {
    return fail('supabase-backfill-database-cas-ledger-verification-input-invalid')
  }
  let projectAuthority: unknown
  try {
    projectAuthority = await getProjectAuthority.call(options.transport, authority)
  } catch {
    return fail('supabase-backfill-database-cas-ledger-verification-transport-failed')
  }
  requireProjectAuthority(projectAuthority, authority)
  requireCurrentReviewContext(options.review, context)
  await currentAuthority(options, authority)
  let response: unknown
  try {
    response = await runQuery.call(options.transport, request)
  } catch {
    return fail('supabase-backfill-database-cas-ledger-verification-transport-failed')
  }
  requireCurrentReviewContext(options.review, context)
  await currentAuthority(options, authority)
  const verification = await inspectResponse(response, request)
  requireCurrentReviewContext(options.review, context)
  await currentAuthority(options, authority)
  trustedVerifications.set(
    verification,
    Object.freeze({ review: options.review, verification, installedVerificationEpoch })
  )
  return verification
}

/**
 * Invalidate every installed proof whose verification started before this call and return the only
 * epoch that a later installed proof may satisfy. Rotation creates no install or mutation authority.
 */
export function rotateSupabaseBackfillDatabaseCASLedgerInstalledVerificationEpochV1(
  review: SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1
): SupabaseBackfillDatabaseCASLedgerInstalledVerificationEpochV1 {
  if (!trustedSupabaseBackfillDatabaseCASLedgerReviewContextV1(review)) {
    return fail('supabase-backfill-database-cas-ledger-verification-input-invalid')
  }
  const epoch = freshInstalledVerificationEpoch()
  installedVerificationEpochs.set(review, epoch)
  return epoch
}

/** Identity-only proof lookup for a future installer/controller; this creates no authority. */
export function trustedSupabaseBackfillDatabaseCASLedgerVerificationV1(
  value: unknown,
  expectedReview: SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1
): SupabaseBackfillDatabaseCASLedgerVerificationV1 | null {
  if (value === null || typeof value !== 'object') return null
  const context = trustedVerifications.get(value)
  if (
    context?.review !== expectedReview ||
    !trustedSupabaseBackfillDatabaseCASLedgerReviewContextV1(context.review)
  ) {
    return null
  }
  return context.verification
}

/**
 * Exact, identity-only marker evidence for a future journal controller. This lookup is deliberately
 * non-consuming and cannot create install or mutation authority by itself.
 */
export function trustedSupabaseBackfillDatabaseCASLedgerInstallMarkerEvidenceV1(
  value: unknown,
  expectedReview: SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1,
  expectedMarker: string
): SupabaseBackfillDatabaseCASLedgerInstallMarkerEvidenceV1 | null {
  if (!INSTALL_MARKER.test(expectedMarker)) return null
  const verification = trustedSupabaseBackfillDatabaseCASLedgerVerificationV1(value, expectedReview)
  if (!verification?.verifiedInstalled || verification.state !== 'installed') return null
  const evidence = verification.catalog.installationMarker
  if (
    evidence.state !== 'exact-single' ||
    !evidence.exactSingleMarkerOnConstraint ||
    evidence.constraintComment !== expectedMarker ||
    evidence.schemaMarkerPrefixCount !== 1
  ) {
    return null
  }
  return evidence
}

/** Consume one exact post-dispatch installed proof for the expected operation marker. */
export function consumeTrustedSupabaseBackfillDatabaseCASLedgerInstalledVerificationV1(
  value: unknown,
  expectedReview: SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1,
  expectedMarker: string,
  expectedEpoch: SupabaseBackfillDatabaseCASLedgerInstalledVerificationEpochV1
): SupabaseBackfillDatabaseCASLedgerVerificationV1 | null {
  if (
    value === null ||
    typeof value !== 'object' ||
    !INSTALL_MARKER.test(expectedMarker) ||
    consumedInstalledVerifications.has(value)
  ) {
    return null
  }
  const context = trustedVerifications.get(value)
  const verification = context?.verification
  const evidence = verification?.catalog.installationMarker
  if (
    !context ||
    context.review !== expectedReview ||
    !trustedSupabaseBackfillDatabaseCASLedgerReviewContextV1(expectedReview) ||
    installedVerificationEpochs.get(expectedReview) !== expectedEpoch ||
    context.installedVerificationEpoch !== expectedEpoch ||
    verification?.state !== 'installed' ||
    !verification.verifiedInstalled ||
    !verification.checks.exactInstalledState ||
    !verification.checks.allVerificationChecksPassed ||
    evidence?.constraintName !== SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_CONSTRAINT ||
    evidence.constraintComment !== expectedMarker ||
    evidence.schemaMarkerPrefixCount !== 1 ||
    evidence.state !== 'exact-single' ||
    !evidence.exactSingleMarkerOnConstraint
  ) {
    return null
  }
  consumedInstalledVerifications.add(value)
  return verification
}
