/* oxlint-disable eslint(max-lines), eslint(complexity) -- The lexer and policy stay co-located as one auditable static boundary. */

import { digestCanonicalManifest, encodeBase64URL } from '@open-pencil/scene-graph'

export const SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_CERTIFICATE_FORMAT =
  'openpencil.supabase-backfill-read-query-indirect-execution-safety-certificate.v1' as const
export const SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_PROFILE =
  'postgres-read-query-static-conditional-v1' as const
export const SUPABASE_BACKFILL_READ_QUERY_SUPPORTED_POSTGRES_MAJOR_VERSIONS = Object.freeze([
  15, 16, 17
] as const)
export const SUPABASE_BACKFILL_READ_QUERY_MANAGED_RELATIONS = Object.freeze([
  'openpencil_release.backfill_executions_v1',
  'openpencil_release.backfill_heads_v1',
  'openpencil_release.backfill_receipts_v2'
] as const)
export const SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_LIMITS = Object.freeze({
  maximumSqlBytes: 512 * 1024,
  maximumParameterCount: 64,
  maximumResponseFieldCount: 128,
  maximumIdentifierLength: 128
})

const DIGEST = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u
const INPUT_KEYS = Object.freeze([
  'queryId',
  'queryVersion',
  'queryDigest',
  'sql',
  'sqlDigest',
  'parameterOrder',
  'responseFields',
  'ledgerShapeDigest',
  'expectedColumnInventoryDigest',
  'expectedConstraintInventoryDigest',
  'managedRelations'
] as const)

const PG_CATALOG_FUNCTIONS = new Set([
  'acldefault',
  'aclexplode',
  'array_lower',
  'bool_and',
  'chr',
  'convert_from',
  'convert_to',
  'count',
  'current_setting',
  'decode',
  'encode',
  'jsonb_agg',
  'jsonb_build_object',
  'jsonb_extract_path',
  'jsonb_extract_path_text',
  'max',
  'min',
  'obj_description',
  'octet_length',
  'pg_get_constraintdef',
  'pg_has_role',
  'pg_is_in_recovery',
  'replace',
  'rtrim',
  'sha256',
  'statement_timestamp',
  'to_char',
  'to_jsonb',
  'translate',
  'txid_current_snapshot',
  'unnest'
])

const PG_CATALOG_RELATIONS = new Set([
  'pg_am',
  'pg_attrdef',
  'pg_attribute',
  'pg_auth_members',
  'pg_class',
  'pg_constraint',
  'pg_default_acl',
  'pg_index',
  'pg_inherits',
  'pg_namespace',
  'pg_opclass',
  'pg_operator',
  'pg_policy',
  'pg_publication_tables',
  'pg_rewrite',
  'pg_roles',
  'pg_trigger',
  'pg_type'
])

const PG_CATALOG_CAST_TYPES = new Set([
  'boolean',
  'int2',
  'int4',
  'int8',
  'jsonb',
  'name',
  'text',
  'timestamptz'
])

const PARSER_CALL_FORMS = new Set([
  'ALL',
  'AND',
  'ANY',
  'AS',
  'COALESCE',
  'ELSE',
  'EXISTS',
  'GREATEST',
  'IN',
  'LEAST',
  'MATERIALIZED',
  'NOT',
  'NULLIF',
  'OR',
  'SELECT',
  'VALUES',
  'WHEN'
])

const STATIC_OPERATOR_TOKENS = Object.freeze([
  '*',
  '+',
  '-',
  '/',
  '::',
  '<',
  '<=',
  '<>',
  '=',
  '>',
  '>=',
  '->',
  '->>',
  '||',
  '~'
] as const)

const LITERAL_PRECEDING_KEYWORDS = new Set([
  'AND',
  'AS',
  'BY',
  'ELSE',
  'IN',
  'IS',
  'LIKE',
  'NOT',
  'ON',
  'OR',
  'SELECT',
  'THEN',
  'VALUES',
  'WHEN',
  'WHERE',
  'ZONE'
])

const FORBIDDEN_KEYWORDS = Object.freeze([
  'ALTER',
  'ANALYZE',
  'BEGIN',
  'CALL',
  'CLUSTER',
  'COMMENT',
  'COMMIT',
  'COPY',
  'CREATE',
  'DEALLOCATE',
  'DELETE',
  'DISCARD',
  'DO',
  'DROP',
  'EXECUTE',
  'GRANT',
  'INSERT',
  'INTO',
  'LISTEN',
  'LOCK',
  'MERGE',
  'NOTIFY',
  'OPERATOR',
  'PREPARE',
  'REFRESH',
  'REINDEX',
  'RELEASE',
  'RESET',
  'REVOKE',
  'ROLLBACK',
  'SAVEPOINT',
  'SECURITY',
  'SET',
  'START',
  'TABLE',
  'TRUNCATE',
  'UNLISTEN',
  'UPDATE',
  'VACUUM'
])

const ANALYSIS_PROFILE = Object.freeze({
  profile: SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_PROFILE,
  scannerRevision: 'postgres-read-query-static-conditional-scanner-2026-09-08.6' as const,
  supportedPostgresMajorVersions: SUPABASE_BACKFILL_READ_QUERY_SUPPORTED_POSTGRES_MAJOR_VERSIONS,
  limits: SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_LIMITS,
  pgCatalogFunctions: Object.freeze([...PG_CATALOG_FUNCTIONS].sort()),
  pgCatalogRelations: Object.freeze([...PG_CATALOG_RELATIONS].sort()),
  pgCatalogCastTypes: Object.freeze([...PG_CATALOG_CAST_TYPES].sort()),
  parserCallForms: Object.freeze([...PARSER_CALL_FORMS].sort()),
  staticOperatorTokens: STATIC_OPERATOR_TOKENS,
  typedLiteralPolicy: 'reject-all-direct-typed-literal-forms' as const,
  quotedStringBackslashPolicy: 'reject' as const,
  quotedIdentifierEscapePolicy: 'reject-doubled-quote-escapes' as const,
  cteScopePolicy: 'parenthesis-ancestry-and-declaration-order-bound' as const,
  callSyntaxPolicy: 'explicit-parenthesized-calls-only' as const,
  forbiddenKeywords: FORBIDDEN_KEYWORDS,
  managedRelations: SUPABASE_BACKFILL_READ_QUERY_MANAGED_RELATIONS
})

type ManagedRelation = (typeof SUPABASE_BACKFILL_READ_QUERY_MANAGED_RELATIONS)[number]

export interface CreateSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateOptionsV1 {
  readonly queryId: string
  readonly queryVersion: string
  readonly queryDigest: string
  readonly sql: string
  readonly sqlDigest: string
  readonly parameterOrder: readonly string[]
  readonly responseFields: readonly string[]
  readonly ledgerShapeDigest: string
  readonly expectedColumnInventoryDigest: string
  readonly expectedConstraintInventoryDigest: string
  readonly managedRelations: readonly ManagedRelation[]
}

export interface SupabaseBackfillReadQueryIndirectExecutionSafetyCertificateV1 {
  readonly format: typeof SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_CERTIFICATE_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environmentIntent: 'staging'
  readonly testingOnly: true
  readonly processLocalOnly: true
  readonly staticConditionalOnly: true
  readonly staticScanPassed: true
  readonly liveAuthenticated: false
  readonly profile: typeof SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_PROFILE
  readonly supportedPostgresMajorVersions: typeof SUPABASE_BACKFILL_READ_QUERY_SUPPORTED_POSTGRES_MAJOR_VERSIONS
  readonly subject: Readonly<{
    queryId: string
    queryVersion: string
    sqlByteLength: number
    parameterCount: number
    responseFieldCount: number
  }>
  readonly bindings: Readonly<{
    queryDigest: string
    sqlDigest: string
    queryContractDigest: string
    analysisProfileDigest: string
    ledgerShapeDigest: string
    expectedColumnInventoryDigest: string
    expectedConstraintInventoryDigest: string
  }>
  readonly checks: Readonly<{
    exactSingleStatement: true
    terminalStatementKind: 'select'
    prohibitedDirectStatementSyntaxAbsent: true
    dataModifyingCteSyntaxAbsent: true
    dynamicSqlSyntaxAbsent: true
    rowLockSyntaxAbsent: true
    positionalParameterSetExact: true
    explicitParenthesizedCallsRestrictedToPgCatalog: true
    parserSpecialCallsAllowlisted: true
    castNamesRestrictedToPgCatalog: true
    typedLiteralCastsAbsent: true
    operatorSyntaxRestrictedToStaticSubset: true
    relationsRestrictedToPgCatalogCtesAndManagedOnlyTables: true
    managedRelationsUseOnly: true
  }>
  readonly conditions: Readonly<{
    liveServerVersionAuthenticated: false
    liveCatalogAuthenticated: false
    builtInFunctionImplementationAuthenticated: false
    builtInAggregateImplementationAuthenticated: false
    compositeFieldNotationFunctionResolutionAuthenticated: false
    builtInOperatorResolutionAuthenticated: false
    castAndTypeIoAuthenticated: false
    plannerAndIndexSupportAuthenticated: false
    relationRewriteRlsFdwAndTableAmAuthenticated: false
    completePostgresGrammarParsed: false
    exactReviewedQueryContractMatchedByCertificateFactory: false
    transparentProxyInputExcluded: false
    externalReadOnlyBoundaryRequired: true
    externalStatementTimeoutRequired: true
    freshCatalogBindingRequired: true
  }>
  readonly indirectExecutionSafetyProven: false
  readonly requestDispatched: false
  readonly credentialAuthorityCreated: false
  readonly transportAuthorityCreated: false
  readonly databaseAuthorityCreated: false
  readonly mutationAuthorityCreated: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly releaseAuthorityCreated: false
  readonly releaseReady: false
}

export type SupabaseBackfillReadQueryIndirectExecutionSafetyRuntimeViewV1 = {
  readonly [Key in keyof Pick<
    SupabaseBackfillReadQueryIndirectExecutionSafetyCertificateV1,
    | 'profile'
    | 'liveAuthenticated'
    | 'staticConditionalOnly'
    | 'staticScanPassed'
    | 'indirectExecutionSafetyProven'
    | 'requestDispatched'
    | 'transportAuthorityCreated'
    | 'databaseAuthorityCreated'
    | 'mutationAuthorityCreated'
    | 'executionAuthorityCreated'
    | 'receiptAuthorityCreated'
    | 'releaseAuthorityCreated'
    | 'releaseReady'
  >]: unknown
}

export interface SupabaseBackfillReadQueryIndirectExecutionSafetyCertificateEnvelopeV1 {
  readonly certificate: SupabaseBackfillReadQueryIndirectExecutionSafetyCertificateV1
  readonly certificateDigest: string
}

export interface TrustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1 {
  readonly envelope: SupabaseBackfillReadQueryIndirectExecutionSafetyCertificateEnvelopeV1
  readonly queryId: string
  readonly queryVersion: string
  readonly sql: string
  readonly parameterOrder: readonly string[]
  readonly responseFields: readonly string[]
  readonly managedRelations: readonly ManagedRelation[]
}

export type SupabaseBackfillReadQueryIndirectExecutionSafetyCertificateErrorCode =
  | 'supabase-backfill-read-query-safety-input-invalid'
  | 'supabase-backfill-read-query-safety-digest-mismatch'
  | 'supabase-backfill-read-query-safety-sql-unsafe'
  | 'supabase-backfill-read-query-safety-digest-failed'

export class SupabaseBackfillReadQueryIndirectExecutionSafetyCertificateError extends Error {
  constructor(readonly code: SupabaseBackfillReadQueryIndirectExecutionSafetyCertificateErrorCode) {
    super(`Supabase backfill read-query static safety certificate failed: ${code}.`)
    this.name = 'SupabaseBackfillReadQueryIndirectExecutionSafetyCertificateError'
  }
}

interface UnknownRecord {
  [key: PropertyKey]: unknown
}

type InputSnapshotV1 = CreateSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateOptionsV1

const trustedCertificates = new WeakMap<
  object,
  TrustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1
>()

function fail(code: SupabaseBackfillReadQueryIndirectExecutionSafetyCertificateErrorCode): never {
  throw new SupabaseBackfillReadQueryIndirectExecutionSafetyCertificateError(code)
}

function ownData(value: object, key: PropertyKey): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail('supabase-backfill-read-query-safety-input-invalid')
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return fail('supabase-backfill-read-query-safety-input-invalid')
  }
  return descriptor.value
}

function exactRecord(value: unknown): UnknownRecord {
  if (value === null || typeof value !== 'object') {
    return fail('supabase-backfill-read-query-safety-input-invalid')
  }
  let isArray: boolean
  let prototype: object | null
  let keys: readonly PropertyKey[]
  try {
    isArray = Array.isArray(value)
    prototype = Object.getPrototypeOf(value)
    keys = Reflect.ownKeys(value)
  } catch {
    return fail('supabase-backfill-read-query-safety-input-invalid')
  }
  if (
    isArray ||
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length !== INPUT_KEYS.length ||
    keys.some((key) => typeof key !== 'string' || !INPUT_KEYS.includes(key as never))
  ) {
    return fail('supabase-backfill-read-query-safety-input-invalid')
  }
  return value as UnknownRecord
}

function exactStringArray(
  value: unknown,
  maximumLength: number,
  allowDot: boolean
): readonly string[] {
  if (value === null || typeof value !== 'object') {
    return fail('supabase-backfill-read-query-safety-input-invalid')
  }
  let isArray: boolean
  let prototype: object | null
  let keys: readonly PropertyKey[]
  let lengthDescriptor: PropertyDescriptor | undefined
  try {
    isArray = Array.isArray(value)
    prototype = Object.getPrototypeOf(value)
    keys = Reflect.ownKeys(value)
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  } catch {
    return fail('supabase-backfill-read-query-safety-input-invalid')
  }
  const length = lengthDescriptor?.value
  if (
    !isArray ||
    prototype !== Array.prototype ||
    !Object.hasOwn(lengthDescriptor ?? {}, 'value') ||
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length === 0 ||
    length > maximumLength ||
    keys.length !== length + 1 ||
    keys.at(-1) !== 'length' ||
    keys.slice(0, -1).some((key, index) => key !== String(index))
  ) {
    return fail('supabase-backfill-read-query-safety-input-invalid')
  }
  const result: string[] = []
  for (let index = 0; index < length; index += 1) {
    const item = ownData(value, String(index))
    if (
      typeof item !== 'string' ||
      item.length === 0 ||
      item.length >
        SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_LIMITS.maximumIdentifierLength ||
      !(allowDot ? /^[A-Za-z][A-Za-z0-9_.:-]*$/u : IDENTIFIER).test(item)
    ) {
      return fail('supabase-backfill-read-query-safety-input-invalid')
    }
    result.push(item)
  }
  if (new Set(result).size !== result.length) {
    return fail('supabase-backfill-read-query-safety-input-invalid')
  }
  return Object.freeze(result)
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    return fail('supabase-backfill-read-query-safety-input-invalid')
  }
  return value
}

function stableIdentifier(value: unknown): string {
  const result = text(value)
  if (!IDENTIFIER.test(result)) return fail('supabase-backfill-read-query-safety-input-invalid')
  return result
}

function digestValue(value: unknown): string {
  const result = text(value)
  if (!DIGEST.test(result)) return fail('supabase-backfill-read-query-safety-input-invalid')
  return result
}

function snapshotInput(value: unknown): InputSnapshotV1 {
  const source = exactRecord(value)
  const sql = text(ownData(source, 'sql'))
  if (
    sql.includes('\0') ||
    new TextEncoder().encode(sql).byteLength >
      SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_LIMITS.maximumSqlBytes
  ) {
    return fail('supabase-backfill-read-query-safety-input-invalid')
  }
  const managedRelations = exactStringArray(
    ownData(source, 'managedRelations'),
    SUPABASE_BACKFILL_READ_QUERY_MANAGED_RELATIONS.length,
    true
  )
  if (
    managedRelations.length !== SUPABASE_BACKFILL_READ_QUERY_MANAGED_RELATIONS.length ||
    !managedRelations.every(
      (relation, index) => relation === SUPABASE_BACKFILL_READ_QUERY_MANAGED_RELATIONS[index]
    )
  ) {
    return fail('supabase-backfill-read-query-safety-input-invalid')
  }
  return Object.freeze({
    queryId: stableIdentifier(ownData(source, 'queryId')),
    queryVersion: stableIdentifier(ownData(source, 'queryVersion')),
    queryDigest: digestValue(ownData(source, 'queryDigest')),
    sql,
    sqlDigest: digestValue(ownData(source, 'sqlDigest')),
    parameterOrder: exactStringArray(
      ownData(source, 'parameterOrder'),
      SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_LIMITS.maximumParameterCount,
      false
    ),
    responseFields: exactStringArray(
      ownData(source, 'responseFields'),
      SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_LIMITS.maximumResponseFieldCount,
      false
    ),
    ledgerShapeDigest: digestValue(ownData(source, 'ledgerShapeDigest')),
    expectedColumnInventoryDigest: digestValue(ownData(source, 'expectedColumnInventoryDigest')),
    expectedConstraintInventoryDigest: digestValue(
      ownData(source, 'expectedConstraintInventoryDigest')
    ),
    managedRelations: managedRelations as readonly ManagedRelation[]
  })
}

function isDollarTagStart(sql: string, index: number): string | null {
  if (sql[index] !== '$' || /[0-9]/u.test(sql[index + 1] ?? '')) return null
  const tail = sql.slice(index)
  const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u.exec(tail)
  return match?.[0] ?? null
}

/** Mask comments and literal bodies while retaining identifiers, parameters, and statement syntax. */
function maskNonCode(sql: string, preserveLiteralOpeners = false): string {
  const chars = sql.split('')
  const masked = sql.split('')
  let index = 0
  while (index < chars.length) {
    if (chars[index] === '-' && chars[index + 1] === '-') {
      masked[index] = ' '
      masked[index + 1] = ' '
      index += 2
      while (index < chars.length && chars[index] !== '\n') {
        masked[index] = ' '
        index += 1
      }
      continue
    }
    if (chars[index] === '/' && chars[index + 1] === '*') {
      let depth = 1
      masked[index] = ' '
      masked[index + 1] = ' '
      index += 2
      while (index < chars.length && depth > 0) {
        if (chars[index] === '/' && chars[index + 1] === '*') {
          depth += 1
          masked[index] = ' '
          masked[index + 1] = ' '
          index += 2
        } else if (chars[index] === '*' && chars[index + 1] === '/') {
          depth -= 1
          masked[index] = ' '
          masked[index + 1] = ' '
          index += 2
        } else {
          if (chars[index] !== '\n') masked[index] = ' '
          index += 1
        }
      }
      if (depth !== 0) return fail('supabase-backfill-read-query-safety-sql-unsafe')
      continue
    }
    if (chars[index] === "'") {
      masked[index] = preserveLiteralOpeners ? "'" : ' '
      index += 1
      let closed = false
      while (index < chars.length) {
        masked[index] = chars[index] === '\n' ? '\n' : ' '
        if (chars[index] === '\\') {
          return fail('supabase-backfill-read-query-safety-sql-unsafe')
        }
        if (chars[index] === "'" && chars[index + 1] === "'") {
          masked[index + 1] = ' '
          index += 2
          continue
        }
        if (chars[index] === "'") {
          index += 1
          closed = true
          break
        }
        index += 1
      }
      if (!closed) return fail('supabase-backfill-read-query-safety-sql-unsafe')
      continue
    }
    const tag = isDollarTagStart(sql, index)
    if (tag !== null) {
      const end = sql.indexOf(tag, index + tag.length)
      if (end === -1) return fail('supabase-backfill-read-query-safety-sql-unsafe')
      const finish = end + tag.length
      for (let offset = index; offset < finish; offset += 1) {
        if (chars[offset] !== '\n') masked[offset] = ' '
      }
      if (preserveLiteralOpeners) masked[index] = '$'
      index = finish
      continue
    }
    if (chars[index] === '"') {
      index += 1
      let closed = false
      while (index < chars.length) {
        if (chars[index] === '"' && chars[index + 1] === '"') {
          return fail('supabase-backfill-read-query-safety-sql-unsafe')
        }
        if (chars[index] === '"') {
          index += 1
          closed = true
          break
        }
        index += 1
      }
      if (!closed) return fail('supabase-backfill-read-query-safety-sql-unsafe')
      continue
    }
    index += 1
  }
  return masked.join('')
}

function maskQuotedIdentifiers(sql: string): string {
  const chars = sql.split('')
  const masked = sql.split('')
  let index = 0
  while (index < chars.length) {
    if (chars[index] !== '"') {
      index += 1
      continue
    }
    masked[index] = ' '
    index += 1
    while (index < chars.length) {
      masked[index] = chars[index] === '\n' ? '\n' : ' '
      if (chars[index] === '"' && chars[index + 1] === '"') {
        masked[index + 1] = ' '
        index += 2
        continue
      }
      if (chars[index] === '"') {
        index += 1
        break
      }
      index += 1
    }
  }
  return masked.join('')
}

interface ParenthesisStructureV1 {
  readonly scopeAt: Int32Array
  readonly matchingClose: Int32Array
  readonly parentScopes: readonly number[]
}

interface CteDeclarationV1 {
  readonly name: string
  readonly nameIndex: number
  readonly scopeId: number
  readonly visibleFrom: number
}

interface SqlTokenV1 {
  readonly value: string
  readonly index: number
  readonly end: number
}

interface ParsedCteItemV1 {
  readonly name: string
  readonly nameIndex: number
  readonly bodyClose: number
}

function parenthesisStructure(masked: string): ParenthesisStructureV1 {
  const syntax = maskQuotedIdentifiers(masked)
  const scopeAt = new Int32Array(syntax.length)
  const matchingClose = new Int32Array(syntax.length)
  matchingClose.fill(-1)
  const parentScopes: number[] = [-1]
  const scopeOpenIndexes: number[] = [-1]
  let currentScope = 0
  for (let index = 0; index < syntax.length; index += 1) {
    scopeAt[index] = currentScope
    if (syntax[index] === '(') {
      const childScope = parentScopes.length
      parentScopes.push(currentScope)
      scopeOpenIndexes.push(index)
      currentScope = childScope
    } else if (syntax[index] === ')') {
      if (currentScope === 0) return fail('supabase-backfill-read-query-safety-sql-unsafe')
      matchingClose[scopeOpenIndexes[currentScope] ?? -1] = index
      currentScope = parentScopes[currentScope] ?? -1
    }
  }
  if (currentScope !== 0) return fail('supabase-backfill-read-query-safety-sql-unsafe')
  return Object.freeze({
    scopeAt,
    matchingClose,
    parentScopes: Object.freeze(parentScopes)
  })
}

function skipWhitespace(value: string, start: number): number {
  let index = start
  while (index < value.length && /\s/u.test(value[index] ?? '')) index += 1
  return index
}

function wordAt(value: string, start: number): SqlTokenV1 | null {
  const index = skipWhitespace(value, start)
  const match = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(value.slice(index))
  if (!match) return null
  const word = match[0] ?? ''
  return Object.freeze({ value: word, index, end: index + word.length })
}

function quotedIdentifierAt(value: string, start: number): SqlTokenV1 | null {
  const index = skipWhitespace(value, start)
  if (value[index] !== '"') return null
  const close = value.indexOf('"', index + 1)
  if (close === -1) return fail('supabase-backfill-read-query-safety-sql-unsafe')
  return Object.freeze({ value: value.slice(index + 1, close), index, end: close + 1 })
}

function closeParenthesisAt(structure: ParenthesisStructureV1, openIndex: number): number {
  const close = structure.matchingClose[openIndex] ?? -1
  if (close < 0) return fail('supabase-backfill-read-query-safety-sql-unsafe')
  return close
}

function parseCteItem(
  masked: string,
  start: number,
  scopeId: number,
  structure: ParenthesisStructureV1
): ParsedCteItemV1 | null {
  const name = quotedIdentifierAt(masked, start)
  if (!name || structure.scopeAt[name.index] !== scopeId) return null
  let cursor = skipWhitespace(masked, name.end)
  if (masked[cursor] === '(') {
    if (structure.scopeAt[cursor] !== scopeId) return null
    cursor = skipWhitespace(masked, closeParenthesisAt(structure, cursor) + 1)
  }
  const asToken = wordAt(masked, cursor)
  if (asToken?.value.toUpperCase() !== 'AS') return null
  cursor = skipWhitespace(masked, asToken.end)
  const modifier = wordAt(masked, cursor)
  if (modifier?.value.toUpperCase() === 'NOT') {
    const materialized = wordAt(masked, modifier.end)
    if (materialized?.value.toUpperCase() !== 'MATERIALIZED') return null
    cursor = skipWhitespace(masked, materialized.end)
  } else if (modifier?.value.toUpperCase() === 'MATERIALIZED') {
    cursor = skipWhitespace(masked, modifier.end)
  }
  if (masked[cursor] !== '(' || structure.scopeAt[cursor] !== scopeId) return null
  return Object.freeze({
    name: name.value,
    nameIndex: name.index,
    bodyClose: closeParenthesisAt(structure, cursor)
  })
}

function cteDeclarations(
  masked: string,
  structure: ParenthesisStructureV1
): readonly CteDeclarationV1[] {
  const declarations: CteDeclarationV1[] = []
  const syntax = maskQuotedIdentifiers(masked)
  for (const withMatch of syntax.matchAll(/\bWITH\b/giu)) {
    const withIndex = withMatch.index
    const scopeId = structure.scopeAt[withIndex] ?? 0
    let cursor = withIndex + (withMatch[0]?.length ?? 0)
    const recursiveToken = wordAt(masked, cursor)
    const recursive = recursiveToken?.value.toUpperCase() === 'RECURSIVE'
    if (recursive) cursor = recursiveToken.end
    const group: ParsedCteItemV1[] = []
    for (;;) {
      const item = parseCteItem(masked, cursor, scopeId, structure)
      if (!item) {
        if (group.length === 0 && quotedIdentifierAt(masked, cursor)) {
          return fail('supabase-backfill-read-query-safety-sql-unsafe')
        }
        break
      }
      group.push(item)
      cursor = skipWhitespace(masked, item.bodyClose + 1)
      if (masked[cursor] !== ',') break
      cursor += 1
    }
    for (const item of group) {
      declarations.push(
        Object.freeze({
          name: item.name,
          nameIndex: item.nameIndex,
          scopeId,
          visibleFrom: recursive ? withIndex : item.bodyClose + 1
        })
      )
    }
  }
  return Object.freeze(declarations)
}

function isScopeAncestor(
  ancestorScopeId: number,
  referenceScopeId: number,
  parentScopes: readonly number[]
): boolean {
  let current = referenceScopeId
  while (current >= 0) {
    if (current === ancestorScopeId) return true
    current = parentScopes[current] ?? -1
  }
  return false
}

function isCteVisible(
  name: string,
  referenceIndex: number,
  structure: ParenthesisStructureV1,
  declarations: readonly CteDeclarationV1[]
): boolean {
  const referenceScopeId = structure.scopeAt[referenceIndex] ?? 0
  return declarations.some(
    (declaration) =>
      declaration.name === name &&
      referenceIndex >= declaration.visibleFrom &&
      isScopeAncestor(declaration.scopeId, referenceScopeId, structure.parentScopes)
  )
}

function verifyStatementBoundary(masked: string): void {
  const syntax = maskQuotedIdentifiers(masked)
  const semicolons = [...syntax.matchAll(/;/gu)]
  if (semicolons.length !== 1) return fail('supabase-backfill-read-query-safety-sql-unsafe')
  const semicolonIndex = semicolons[0]?.index ?? -1
  if (semicolonIndex < 0 || syntax.slice(semicolonIndex + 1).trim().length !== 0) {
    return fail('supabase-backfill-read-query-safety-sql-unsafe')
  }
  const statement = syntax.slice(0, semicolonIndex).trim()
  if (!/^(?:WITH\b|SELECT\b)/iu.test(statement)) {
    return fail('supabase-backfill-read-query-safety-sql-unsafe')
  }
  let depth = 0
  const topLevelCommands: string[] = []
  const wordPattern = /[A-Za-z_][A-Za-z0-9_]*/uy
  for (let index = 0; index < statement.length; ) {
    const character = statement[index] ?? ''
    if (character === '(') {
      depth += 1
      index += 1
      continue
    }
    if (character === ')') {
      if (depth === 0) return fail('supabase-backfill-read-query-safety-sql-unsafe')
      depth -= 1
      index += 1
      continue
    }
    wordPattern.lastIndex = index
    const word = wordPattern.exec(statement)?.[0]
    if (word) {
      const upper = word.toUpperCase()
      if (
        depth === 0 &&
        ['SELECT', 'TABLE', 'VALUES', 'INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(upper)
      ) {
        topLevelCommands.push(upper)
      }
      index += word.length
      continue
    }
    index += 1
  }
  if (depth !== 0 || topLevelCommands.at(-1) !== 'SELECT') {
    return fail('supabase-backfill-read-query-safety-sql-unsafe')
  }
}

function verifyForbiddenSyntax(masked: string): void {
  const upper = maskQuotedIdentifiers(masked).toUpperCase()
  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, 'u').test(upper)) {
      return fail('supabase-backfill-read-query-safety-sql-unsafe')
    }
  }
  if (
    /\bFOR\s+(?:UPDATE|NO\s+KEY\s+UPDATE|SHARE|KEY\s+SHARE)\b/iu.test(masked) ||
    /\bON\s+CONFLICT\b/iu.test(masked) ||
    /\bSET\s+TRANSACTION\b/iu.test(masked)
  ) {
    return fail('supabase-backfill-read-query-safety-sql-unsafe')
  }
  if (/[#@?^&`]/u.test(maskQuotedIdentifiers(masked))) {
    return fail('supabase-backfill-read-query-safety-sql-unsafe')
  }
}

function verifyOperatorAndTokenSyntax(masked: string): void {
  const syntax = maskQuotedIdentifiers(masked)
  const allowedOperators = new Set<string>(STATIC_OPERATOR_TOKENS)
  const wordOrNumberPattern = /(?:[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?)/uy
  const parameterPattern = /\$\d+/uy
  const operatorPattern = /[-+*/<>=~!@#%^&|`?]+/uy
  for (let index = 0; index < syntax.length; ) {
    const character = syntax[index] ?? ''
    if (/\s/u.test(character)) {
      index += 1
      continue
    }
    wordOrNumberPattern.lastIndex = index
    const wordOrNumber = wordOrNumberPattern.exec(syntax)?.[0]
    if (wordOrNumber) {
      index += wordOrNumber.length
      continue
    }
    if (character === '$') {
      parameterPattern.lastIndex = index
      const parameter = parameterPattern.exec(syntax)?.[0]
      if (!parameter) return fail('supabase-backfill-read-query-safety-sql-unsafe')
      index += parameter.length
      continue
    }
    if ('(),.;[]'.includes(character)) {
      index += 1
      continue
    }
    if (character === ':') {
      if (syntax.slice(index, index + 2) !== '::') {
        return fail('supabase-backfill-read-query-safety-sql-unsafe')
      }
      index += 2
      continue
    }
    if (/[-+*/<>=~!@#%^&|`?]/u.test(character)) {
      operatorPattern.lastIndex = index
      const operator = operatorPattern.exec(syntax)?.[0] ?? ''
      if (!allowedOperators.has(operator)) {
        return fail('supabase-backfill-read-query-safety-sql-unsafe')
      }
      index += operator.length
      continue
    }
    return fail('supabase-backfill-read-query-safety-sql-unsafe')
  }
}

function verifyParameters(masked: string, expectedCount: number): void {
  const positions = new Set<number>()
  for (const match of maskQuotedIdentifiers(masked).matchAll(/\$(\d+)/gu)) {
    const position = Number(match[1])
    if (!Number.isSafeInteger(position) || position < 1) {
      return fail('supabase-backfill-read-query-safety-sql-unsafe')
    }
    positions.add(position)
  }
  if (
    positions.size !== expectedCount ||
    [...positions].some((position) => position > expectedCount) ||
    Array.from({ length: expectedCount }, (_, index) => index + 1).some(
      (position) => !positions.has(position)
    )
  ) {
    return fail('supabase-backfill-read-query-safety-sql-unsafe')
  }
}

function verifyCalls(masked: string, ctes: readonly CteDeclarationV1[]): void {
  const qualifiedCall =
    /(?<!["A-Za-z0-9_])("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s*\.\s*("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s*\(/gu
  for (const match of masked.matchAll(qualifiedCall)) {
    const schemaToken = match[1] ?? ''
    const functionToken = match[2] ?? ''
    const functionName = functionToken.startsWith('"') ? functionToken.slice(1, -1) : functionToken
    if (
      schemaToken !== '"pg_catalog"' ||
      functionToken !== `"${functionName}"` ||
      !PG_CATALOG_FUNCTIONS.has(functionName)
    ) {
      return fail('supabase-backfill-read-query-safety-sql-unsafe')
    }
  }
  const columnListAliases = new Set(
    [...masked.matchAll(/\bAS\s+"([^"]+)"\s*\([^)]*\)/giu)].map((match) => match[1] ?? '')
  )
  for (const match of masked.matchAll(/(?<!\.)"([^"]+)"\s*\(/gu)) {
    const name = match[1] ?? ''
    const index = match.index
    const before = masked.slice(Math.max(0, index - 16), index)
    if (/\.\s*$/u.test(before)) continue
    const tail = masked.slice(index)
    const cteColumnDeclaration =
      /^"[^"]+"\s*\([^)]*\)\s+AS\s+(?:NOT\s+MATERIALIZED\s+|MATERIALIZED\s+)?\(/iu.test(tail)
    const outputColumnDeclaration = columnListAliases.has(name) && /\bAS\s*$/iu.test(before)
    const declaredHere = ctes.some(
      (declaration) => declaration.name === name && declaration.nameIndex === index
    )
    if (!(declaredHere && cteColumnDeclaration) && !outputColumnDeclaration) {
      return fail('supabase-backfill-read-query-safety-sql-unsafe')
    }
  }
  const bare = maskQuotedIdentifiers(masked)
  for (const match of bare.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/gu)) {
    const name = match[1] ?? ''
    if (!PARSER_CALL_FORMS.has(name)) {
      return fail('supabase-backfill-read-query-safety-sql-unsafe')
    }
  }
  if (/"[^"]+"\s*\.\s*"(?:coalesce|greatest|least|nullif)"\s*\(/iu.test(masked)) {
    return fail('supabase-backfill-read-query-safety-sql-unsafe')
  }
}

function verifyCasts(masked: string): void {
  for (const match of masked.matchAll(/::\s*"([^"]+)"\."([^"]+)"/gu)) {
    if (match[1] !== 'pg_catalog' || !PG_CATALOG_CAST_TYPES.has(match[2] ?? '')) {
      return fail('supabase-backfill-read-query-safety-sql-unsafe')
    }
  }
  const withoutQualified = masked.replace(/::\s*"[^"]+"\."[^"]+"(?:\s*\[\s*\])?/gu, '')
  if (/::\s*(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)/u.test(withoutQualified)) {
    return fail('supabase-backfill-read-query-safety-sql-unsafe')
  }
}

function verifyTypedLiterals(sql: string): void {
  const literalMarkers = maskNonCode(sql, true)
  const literalMarker = String.raw`(?:'|\$(?!\d))`
  if (
    new RegExp(
      String.raw`(?:"[^"]+"|\b[A-Za-z_][A-Za-z0-9_]*)\s*\.\s*(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s*${literalMarker}`,
      'u'
    ).test(literalMarkers) ||
    new RegExp(String.raw`"[^"]+"\s*${literalMarker}`, 'u').test(literalMarkers)
  ) {
    return fail('supabase-backfill-read-query-safety-sql-unsafe')
  }
  const barePrefixPattern = new RegExp(
    String.raw`\b([A-Za-z_][A-Za-z0-9_]*)\s*${literalMarker}`,
    'gu'
  )
  for (const match of literalMarkers.matchAll(barePrefixPattern)) {
    const precedingWord = match[1] ?? ''
    const upper = precedingWord.toUpperCase()
    if (!LITERAL_PRECEDING_KEYWORDS.has(upper) && !['B', 'E', 'X'].includes(upper)) {
      return fail('supabase-backfill-read-query-safety-sql-unsafe')
    }
    if (['B', 'E', 'X'].includes(upper)) {
      let index = match.index
      while (index > 0 && /\s/u.test(literalMarkers[index - 1] ?? '')) index -= 1
      if (/[A-Za-z0-9_".]/u.test(literalMarkers[index - 1] ?? '')) {
        return fail('supabase-backfill-read-query-safety-sql-unsafe')
      }
    }
  }
}

function verifyRelationSource(
  masked: string,
  start: number,
  structure: ParenthesisStructureV1,
  ctes: readonly CteDeclarationV1[],
  expectedManaged: ReadonlySet<string>,
  observedManaged: Set<string>
): void {
  const match = /^\s*(?:(LATERAL)\b\s+)?(?:(ONLY)\b\s*)?"([^"]+)"(?:\s*\.\s*"([^"]+)")?/iu.exec(
    masked.slice(start)
  )
  if (!match) return fail('supabase-backfill-read-query-safety-sql-unsafe')
  const sourceRemainder = masked.slice(start + (match[0]?.length ?? 0))
  if (/^\s*[.*]/u.test(sourceRemainder)) {
    return fail('supabase-backfill-read-query-safety-sql-unsafe')
  }
  const lateral = Boolean(match[1])
  const only = Boolean(match[2])
  const first = match[3] ?? ''
  const second = match[4] || null
  if (second === null) {
    if (!isCteVisible(first, start, structure, ctes) || only || lateral) {
      return fail('supabase-backfill-read-query-safety-sql-unsafe')
    }
    return
  }
  if (first === 'pg_catalog') {
    const isFunction = PG_CATALOG_FUNCTIONS.has(second)
    if (
      only ||
      (!PG_CATALOG_RELATIONS.has(second) && !isFunction) ||
      (isFunction && !/^\s*\(/u.test(sourceRemainder)) ||
      (lateral && (!isFunction || !/^\s*\(/u.test(sourceRemainder))) ||
      (!isFunction && /^\s*\(/u.test(sourceRemainder))
    ) {
      return fail('supabase-backfill-read-query-safety-sql-unsafe')
    }
    return
  }
  const relation = `${first}.${second}`
  if (lateral || !only || !expectedManaged.has(relation)) {
    return fail('supabase-backfill-read-query-safety-sql-unsafe')
  }
  observedManaged.add(relation)
}

function verifyRelations(
  masked: string,
  structure: ParenthesisStructureV1,
  ctes: readonly CteDeclarationV1[]
): void {
  const expectedManaged = new Set(SUPABASE_BACKFILL_READ_QUERY_MANAGED_RELATIONS)
  const observedManaged = new Set<string>()
  const fromScopes = new Map<number, boolean>()
  const previousWords = new Map<number, string>()
  const fromEndingKeywords = new Set([
    'EXCEPT',
    'FETCH',
    'FOR',
    'GROUP',
    'HAVING',
    'INTERSECT',
    'LIMIT',
    'OFFSET',
    'ORDER',
    'RETURNING',
    'UNION',
    'WHERE',
    'WINDOW'
  ])
  let depth = 0
  const wordPattern = /[A-Za-z_][A-Za-z0-9_]*/uy
  for (let index = 0; index < masked.length; ) {
    const character = masked[index] ?? ''
    if (character === '"') {
      index += 1
      while (index < masked.length) {
        if (masked[index] === '"' && masked[index + 1] === '"') {
          index += 2
          continue
        }
        if (masked[index] === '"') {
          index += 1
          break
        }
        index += 1
      }
      continue
    }
    if (character === '(') {
      depth += 1
      fromScopes.delete(depth)
      previousWords.delete(depth)
      index += 1
      continue
    }
    if (character === ')') {
      fromScopes.delete(depth)
      previousWords.delete(depth)
      depth = Math.max(0, depth - 1)
      index += 1
      continue
    }
    if (character === ',' && fromScopes.get(depth) === true) {
      verifyRelationSource(masked, index + 1, structure, ctes, expectedManaged, observedManaged)
      index += 1
      continue
    }
    wordPattern.lastIndex = index
    const word = wordPattern.exec(masked)?.[0]
    if (!word) {
      index += 1
      continue
    }
    const upper = word.toUpperCase()
    const previous = previousWords.get(depth)
    if ((upper === 'FROM' && previous !== 'DISTINCT') || upper === 'JOIN') {
      verifyRelationSource(
        masked,
        index + word.length,
        structure,
        ctes,
        expectedManaged,
        observedManaged
      )
      fromScopes.set(depth, true)
    } else if (fromEndingKeywords.has(upper)) {
      fromScopes.set(depth, false)
    } else if (upper === 'SELECT') {
      if (previous === 'UNION' || previous === 'INTERSECT' || previous === 'EXCEPT') {
        fromScopes.set(depth, false)
      }
    }
    previousWords.set(depth, upper)
    index += word.length
  }
  if (
    observedManaged.size !== expectedManaged.size ||
    [...expectedManaged].some((relation) => !observedManaged.has(relation))
  ) {
    return fail('supabase-backfill-read-query-safety-sql-unsafe')
  }
}

async function digestRawText(value: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(value)
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)))
  } catch {
    return fail('supabase-backfill-read-query-safety-digest-failed')
  }
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-backfill-read-query-safety-digest-failed')
  }
}

export async function createSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateV1(
  input: CreateSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateOptionsV1
): Promise<SupabaseBackfillReadQueryIndirectExecutionSafetyCertificateEnvelopeV1> {
  const source = snapshotInput(input)
  const masked = maskNonCode(source.sql)
  verifyStatementBoundary(masked)
  verifyForbiddenSyntax(masked)
  verifyOperatorAndTokenSyntax(masked)
  verifyParameters(masked, source.parameterOrder.length)
  const structure = parenthesisStructure(masked)
  const ctes = cteDeclarations(masked, structure)
  verifyCalls(masked, ctes)
  verifyCasts(masked)
  verifyTypedLiterals(source.sql)
  verifyRelations(masked, structure, ctes)

  const queryContract = Object.freeze({
    format: 'openpencil.supabase-backfill-read-query-contract.v1' as const,
    version: 1 as const,
    queryId: source.queryId,
    queryVersion: source.queryVersion,
    parameterOrder: source.parameterOrder,
    responseFields: source.responseFields
  })
  const [sqlDigest, queryContractDigest, analysisProfileDigest] = await Promise.all([
    digestRawText(source.sql),
    digest(queryContract),
    digest(ANALYSIS_PROFILE)
  ])
  if (sqlDigest !== source.sqlDigest) {
    return fail('supabase-backfill-read-query-safety-digest-mismatch')
  }
  const certificate = Object.freeze({
    format: SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_CERTIFICATE_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environmentIntent: 'staging' as const,
    testingOnly: true as const,
    processLocalOnly: true as const,
    staticConditionalOnly: true as const,
    staticScanPassed: true as const,
    liveAuthenticated: false as const,
    profile: SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_PROFILE,
    supportedPostgresMajorVersions: SUPABASE_BACKFILL_READ_QUERY_SUPPORTED_POSTGRES_MAJOR_VERSIONS,
    subject: Object.freeze({
      queryId: source.queryId,
      queryVersion: source.queryVersion,
      sqlByteLength: new TextEncoder().encode(source.sql).byteLength,
      parameterCount: source.parameterOrder.length,
      responseFieldCount: source.responseFields.length
    }),
    bindings: Object.freeze({
      queryDigest: source.queryDigest,
      sqlDigest,
      queryContractDigest,
      analysisProfileDigest,
      ledgerShapeDigest: source.ledgerShapeDigest,
      expectedColumnInventoryDigest: source.expectedColumnInventoryDigest,
      expectedConstraintInventoryDigest: source.expectedConstraintInventoryDigest
    }),
    checks: Object.freeze({
      exactSingleStatement: true as const,
      terminalStatementKind: 'select' as const,
      prohibitedDirectStatementSyntaxAbsent: true as const,
      dataModifyingCteSyntaxAbsent: true as const,
      dynamicSqlSyntaxAbsent: true as const,
      rowLockSyntaxAbsent: true as const,
      positionalParameterSetExact: true as const,
      explicitParenthesizedCallsRestrictedToPgCatalog: true as const,
      parserSpecialCallsAllowlisted: true as const,
      castNamesRestrictedToPgCatalog: true as const,
      typedLiteralCastsAbsent: true as const,
      operatorSyntaxRestrictedToStaticSubset: true as const,
      relationsRestrictedToPgCatalogCtesAndManagedOnlyTables: true as const,
      managedRelationsUseOnly: true as const
    }),
    conditions: Object.freeze({
      liveServerVersionAuthenticated: false as const,
      liveCatalogAuthenticated: false as const,
      builtInFunctionImplementationAuthenticated: false as const,
      builtInAggregateImplementationAuthenticated: false as const,
      compositeFieldNotationFunctionResolutionAuthenticated: false as const,
      builtInOperatorResolutionAuthenticated: false as const,
      castAndTypeIoAuthenticated: false as const,
      plannerAndIndexSupportAuthenticated: false as const,
      relationRewriteRlsFdwAndTableAmAuthenticated: false as const,
      completePostgresGrammarParsed: false as const,
      exactReviewedQueryContractMatchedByCertificateFactory: false as const,
      transparentProxyInputExcluded: false as const,
      externalReadOnlyBoundaryRequired: true as const,
      externalStatementTimeoutRequired: true as const,
      freshCatalogBindingRequired: true as const
    }),
    indirectExecutionSafetyProven: false as const,
    requestDispatched: false as const,
    credentialAuthorityCreated: false as const,
    transportAuthorityCreated: false as const,
    databaseAuthorityCreated: false as const,
    mutationAuthorityCreated: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    releaseAuthorityCreated: false as const,
    releaseReady: false as const
  }) satisfies SupabaseBackfillReadQueryIndirectExecutionSafetyCertificateV1
  const envelope = Object.freeze({
    certificate,
    certificateDigest: await digest(certificate)
  })
  trustedCertificates.set(
    envelope,
    Object.freeze({
      envelope,
      queryId: source.queryId,
      queryVersion: source.queryVersion,
      sql: source.sql,
      parameterOrder: source.parameterOrder,
      responseFields: source.responseFields,
      managedRelations: source.managedRelations
    })
  )
  return envelope
}

/** Identity-only lookup. A serialized or cloned certificate never recovers process-local provenance. */
export function trustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1(
  value: unknown
): TrustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1 | null {
  if (value === null || typeof value !== 'object') return null
  const context = trustedCertificates.get(value)
  return context?.envelope === value ? context : null
}
