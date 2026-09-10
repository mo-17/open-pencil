import { describe, expect, test } from 'bun:test'

import { digestCanonicalManifest, encodeBase64URL } from '@open-pencil/scene-graph'

import { SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA } from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/review'
import {
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/verifier'
import {
  createSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateV1,
  SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_LIMITS,
  SUPABASE_BACKFILL_READ_QUERY_MANAGED_RELATIONS,
  trustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1,
  type CreateSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateOptionsV1,
  type SupabaseBackfillReadQueryIndirectExecutionSafetyCertificateErrorCode
} from '@/app/plugins/host/deployment/supabase/backfill/read-query-indirect-execution-safety'
import {
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_FIXED_QUERY,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_ID,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_VERSION,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RESPONSE_FIELDS,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL
} from '@/app/plugins/host/deployment/supabase/backfill/receipt/v2/chain/page/review'
import { SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER } from '@/app/plugins/host/deployment/supabase/backfill/receipt/zero/cas/review'
import {
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_FIXED_QUERY,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL
} from '@/app/plugins/host/deployment/supabase/backfill/receipt/zero/reconciliation/review'

async function digestRawText(value: string): Promise<string> {
  return encodeBase64URL(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  )
}

async function shapeDigests(): Promise<
  Readonly<{
    ledgerShapeDigest: string
    expectedColumnInventoryDigest: string
    expectedConstraintInventoryDigest: string
  }>
> {
  return Object.freeze({
    ledgerShapeDigest: await digestCanonicalManifest(
      Object.freeze({
        schema: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA,
        relations: SUPABASE_BACKFILL_READ_QUERY_MANAGED_RELATIONS
      })
    ),
    expectedColumnInventoryDigest: await digestCanonicalManifest(
      SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1
    ),
    expectedConstraintInventoryDigest: await digestCanonicalManifest(
      SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1
    )
  })
}

async function reconciliationInput(): Promise<CreateSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateOptionsV1> {
  return {
    queryId: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID,
    queryVersion: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION,
    queryDigest: await digestCanonicalManifest(
      SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_FIXED_QUERY
    ),
    sql: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL,
    sqlDigest: await digestRawText(SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL),
    parameterOrder: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
    responseFields: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS,
    ...(await shapeDigests()),
    managedRelations: SUPABASE_BACKFILL_READ_QUERY_MANAGED_RELATIONS
  }
}

async function pageInput(): Promise<CreateSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateOptionsV1> {
  return {
    queryId: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_ID,
    queryVersion: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_VERSION,
    queryDigest: await digestCanonicalManifest(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_FIXED_QUERY),
    sql: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL,
    sqlDigest: await digestRawText(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL),
    parameterOrder: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER,
    responseFields: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RESPONSE_FIELDS,
    ...(await shapeDigests()),
    managedRelations: SUPABASE_BACKFILL_READ_QUERY_MANAGED_RELATIONS
  }
}

async function safetyError(
  promise: Promise<unknown>,
  code: SupabaseBackfillReadQueryIndirectExecutionSafetyCertificateErrorCode
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code })
}

async function withSql(
  source: CreateSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateOptionsV1,
  sql: string
): Promise<CreateSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateOptionsV1> {
  return { ...source, sql, sqlDigest: await digestRawText(sql) }
}

describe('Supabase backfill read-query indirect execution safety certificate', () => {
  test('statically binds both exact read queries without minting live or release authority', async () => {
    const reconciliation = await reconciliationInput()
    const page = await pageInput()
    const [first, second, pageCertificate] = await Promise.all([
      createSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateV1(reconciliation),
      createSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateV1(reconciliation),
      createSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateV1(page)
    ])

    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    expect(pageCertificate.certificateDigest).not.toBe(first.certificateDigest)
    expect(first.certificate).toMatchObject({
      format: 'openpencil.supabase-backfill-read-query-indirect-execution-safety-certificate.v1',
      version: 1,
      providerId: 'supabase',
      environmentIntent: 'staging',
      testingOnly: true,
      processLocalOnly: true,
      staticConditionalOnly: true,
      staticScanPassed: true,
      liveAuthenticated: false,
      profile: 'postgres-read-query-static-conditional-v1',
      supportedPostgresMajorVersions: [15, 16, 17],
      subject: {
        queryId: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID,
        queryVersion: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION,
        parameterCount: 28,
        responseFieldCount: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS.length
      },
      checks: {
        exactSingleStatement: true,
        terminalStatementKind: 'select',
        prohibitedDirectStatementSyntaxAbsent: true,
        dataModifyingCteSyntaxAbsent: true,
        dynamicSqlSyntaxAbsent: true,
        rowLockSyntaxAbsent: true,
        positionalParameterSetExact: true,
        explicitParenthesizedCallsRestrictedToPgCatalog: true,
        parserSpecialCallsAllowlisted: true,
        castNamesRestrictedToPgCatalog: true,
        typedLiteralCastsAbsent: true,
        operatorSyntaxRestrictedToStaticSubset: true,
        relationsRestrictedToPgCatalogCtesAndManagedOnlyTables: true,
        managedRelationsUseOnly: true
      },
      conditions: {
        liveServerVersionAuthenticated: false,
        liveCatalogAuthenticated: false,
        builtInFunctionImplementationAuthenticated: false,
        builtInAggregateImplementationAuthenticated: false,
        compositeFieldNotationFunctionResolutionAuthenticated: false,
        builtInOperatorResolutionAuthenticated: false,
        castAndTypeIoAuthenticated: false,
        plannerAndIndexSupportAuthenticated: false,
        relationRewriteRlsFdwAndTableAmAuthenticated: false,
        completePostgresGrammarParsed: false,
        exactReviewedQueryContractMatchedByCertificateFactory: false,
        transparentProxyInputExcluded: false,
        externalReadOnlyBoundaryRequired: true,
        externalStatementTimeoutRequired: true,
        freshCatalogBindingRequired: true
      },
      indirectExecutionSafetyProven: false,
      requestDispatched: false,
      credentialAuthorityCreated: false,
      transportAuthorityCreated: false,
      databaseAuthorityCreated: false,
      mutationAuthorityCreated: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      releaseAuthorityCreated: false,
      releaseReady: false
    })
    expect(Object.hasOwn(first.certificate.checks, 'ordinaryCallsRestrictedToPgCatalog')).toBe(
      false
    )
    expect(first.certificate.bindings.sqlDigest).toBe(reconciliation.sqlDigest)
    expect(first.certificate.bindings.queryDigest).toBe(reconciliation.queryDigest)
    expect(first.certificate.bindings.ledgerShapeDigest).toBe(reconciliation.ledgerShapeDigest)
    expect(first.certificate.subject.sqlByteLength).toBe(
      new TextEncoder().encode(reconciliation.sql).byteLength
    )

    const context =
      trustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1(first)
    expect(context?.envelope).toBe(first)
    expect(context?.sql).toBe(reconciliation.sql)
    expect(context?.parameterOrder).not.toBe(reconciliation.parameterOrder)
    expect(context?.responseFields).not.toBe(reconciliation.responseFields)
    expect(
      trustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1({
        ...first
      })
    ).toBeNull()
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.certificate)).toBe(true)
    expect(Object.isFrozen(first.certificate.bindings)).toBe(true)
    expect(Object.isFrozen(first.certificate.checks)).toBe(true)
    expect(Object.isFrozen(first.certificate.conditions)).toBe(true)
    expect(Object.isFrozen(context?.parameterOrder)).toBe(true)
    expect(JSON.stringify(first)).not.toContain(reconciliation.sql)
  })

  test('rejects direct writes, multiple statements, row locks, dynamic execution, and unsafe names', async () => {
    const source = await pageInput()
    const unsafe = [
      ['multiple statements', source.sql.replace(/;\s*$/u, '; SELECT 1;')],
      [
        'data-modifying CTE',
        source.sql.replace(
          'WITH',
          'WITH "write" AS (DELETE FROM "openpencil_release"."backfill_heads_v1") ,'
        )
      ],
      ['non-pg_catalog function', source.sql.replace('"pg_catalog"."count"', '"public"."count"')],
      ['non-pg_catalog cast', source.sql.replace('"pg_catalog"."text"', '"public"."text"')],
      ['qualified parser special', source.sql.replace('COALESCE(', '"pg_catalog"."coalesce"(')],
      [
        'managed relation without ONLY',
        source.sql.replace('FROM ONLY "openpencil_release"', 'FROM "openpencil_release"')
      ],
      [
        'unknown managed relation',
        source.sql.replace(
          'FROM ONLY "openpencil_release"."backfill_heads_v1"',
          'FROM ONLY "openpencil_release"."unknown_heads_v1"'
        )
      ],
      ['row lock', source.sql.replace(/;\s*$/u, ' FOR UPDATE;')],
      ['dynamic execution', source.sql.replace(/;\s*$/u, ' EXECUTE evil;')],
      ['out-of-contract parameter', source.sql.replace('$33::', '$34::')],
      ['quoted fake parameter', source.sql.replace('$33::', '"$33"::')],
      [
        'comma-qualified relation',
        source.sql.replace('FROM "reconciliation"', 'FROM "reconciliation", "public"."evil"')
      ],
      [
        'comma-unquoted relation',
        source.sql.replace('FROM "reconciliation"', 'FROM "reconciliation", public.evil')
      ],
      [
        'whitespace-qualified relation',
        source.sql.replace(
          'FROM ONLY "openpencil_release"."backfill_heads_v1"',
          'FROM "public" . "evil"'
        )
      ],
      [
        'CTE invoked as function',
        source.sql.replace('"page_input"."page_input_valid"', '"page_input"($1)')
      ],
      [
        'whitespace-qualified function',
        source.sql.replace('"pg_catalog"."count"(', '"public" . "count"(')
      ],
      [
        'doubled-quote escaped function schema bypass',
        source.sql.replace('"pg_catalog"."count"(', '"evil""pg_catalog"."count"(')
      ],
      [
        'doubled-quote escaped managed relation bypass',
        source.sql.replace(
          'FROM ONLY "openpencil_release"."backfill_heads_v1"',
          'FROM ONLY "openpencil_release"."backfill_heads_v1""shadow"'
        )
      ],
      [
        'doubled-quote escaped cast type bypass',
        source.sql.replace('::"pg_catalog"."text"', '::"pg_catalog"."text""shadow"')
      ],
      ['mixed-qualified function', source.sql.replace('"pg_catalog"."count"(', 'public."evil"(')],
      ['unicode-qualified function', source.sql.replace('"pg_catalog"."count"(', 'public.恶意(')],
      [
        'custom operator',
        source.sql.replace('"pg_catalog"."count"(*) = 1', '"pg_catalog"."count"(*) #=# 1')
      ],
      [
        'schema-qualified OPERATOR syntax',
        source.sql.replace(
          '"pg_catalog"."count"(*) = 1',
          '"pg_catalog"."count"(*) OPERATOR("public".=) 1'
        )
      ],
      [
        'managed relation inheritance star',
        source.sql.replace(
          'FROM ONLY "openpencil_release"."backfill_heads_v1"',
          'FROM ONLY "openpencil_release"."backfill_heads_v1" *'
        )
      ],
      ...['===', '!!', '~~', '|||', '**'].map(
        (operator) =>
          [
            `non-subset operator ${operator}`,
            source.sql.replace(
              '"pg_catalog"."count"(*) = 1',
              `"pg_catalog"."count"(*) ${operator} 1`
            )
          ] as const
      ),
      [
        'schema-qualified typed literal',
        source.sql.replace(
          'SELECT\n',
          'SELECT\n  "public"."evil" \'payload\' AS "typed_literal",\n'
        )
      ],
      [
        'unqualified typed literal',
        source.sql.replace('SELECT\n', 'SELECT\n  evil \'payload\' AS "typed_literal",\n')
      ],
      [
        'mixed-qualified E typed literal',
        source.sql.replace('SELECT\n', 'SELECT\n  public."evil" E\'payload\' AS "typed_literal",\n')
      ],
      [
        'quoted-schema mixed typed literal',
        source.sql.replace('SELECT\n', 'SELECT\n  "public".evil \'payload\' AS "typed_literal",\n')
      ],
      [
        'partially consumed relation source',
        source.sql
          .replace(
            'WITH RECURSIVE\n',
            'WITH RECURSIVE\n"public" AS MATERIALIZED (SELECT 1 AS "value"),\n'
          )
          .replace('FROM "reconciliation"', 'FROM "public".evil')
      ],
      [
        'nested CTE scope confusion',
        source.sql
          .replace(
            'SELECT\n',
            'SELECT\n  (WITH "evil" AS MATERIALIZED (SELECT 1) SELECT 1) AS "nested",\n'
          )
          .replace('FROM "reconciliation"', 'FROM "evil"')
      ],
      [
        'sibling nested CTE scope confusion',
        source.sql.replace(
          'SELECT\n',
          `SELECT
  (WITH "sibling_scope" AS MATERIALIZED (SELECT 1 AS "value")
    SELECT "value" FROM "sibling_scope") AS "first_sibling",
  (SELECT "value" FROM "sibling_scope") AS "second_sibling",
`
        )
      ],
      [
        'nested TABLE relation',
        source.sql.replace(
          'SELECT\n',
          'SELECT\n  (WITH "evil" AS MATERIALIZED (TABLE "public"."evil") SELECT 1) AS "nested",\n'
        )
      ],
      [
        'terminal TABLE',
        `${source.sql.slice(0, source.sql.lastIndexOf('\nSELECT\n'))}\nTABLE "reconciliation";`
      ],
      [
        'terminal VALUES',
        `${source.sql.slice(0, source.sql.lastIndexOf('\nSELECT\n'))}\nVALUES (1);`
      ]
    ] as const
    for (const [label, sql] of unsafe) {
      if (sql === source.sql) throw new TypeError(`Unsafe SQL mutation was a no-op: ${label}`)
      const result = await createSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateV1(
        await withSql(source, sql)
      ).then(
        () => new Error(`unsafe query accepted: ${label}`),
        (error: unknown) => error
      )
      expect(result).toMatchObject({
        code: 'supabase-backfill-read-query-safety-sql-unsafe'
      })
    }
  })

  test('rejects malformed lexical boundaries and a mismatched raw SQL digest', async () => {
    const source = await reconciliationInput()
    for (const suffix of ["\n'", '\n/*', '\n$dangling$']) {
      const sql = source.sql.replace(/;\s*$/u, suffix)
      await safetyError(
        createSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateV1(
          await withSql(source, sql)
        ),
        'supabase-backfill-read-query-safety-sql-unsafe'
      )
    }
    await safetyError(
      createSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateV1({
        ...source,
        sqlDigest: 'A'.repeat(43)
      }),
      'supabase-backfill-read-query-safety-digest-mismatch'
    )
  })

  test('ignores prohibited words and parameter-like text inside comments and literals', async () => {
    const source = await reconciliationInput()
    const sql = `-- INSERT UPDATE $99
WITH
"a" AS MATERIALIZED (
  SELECT $1::"pg_catalog"."text" AS "value", 'DELETE; $98'::"pg_catalog"."text" AS "literal"
  FROM ONLY "openpencil_release"."backfill_executions_v1"
  LIMIT 0
),
"b" AS MATERIALIZED (
  SELECT $tag$CALL evil(); $97$tag$::"pg_catalog"."text" AS "literal"
  FROM ONLY "openpencil_release"."backfill_heads_v1"
  LIMIT 0
),
"c" AS MATERIALIZED (
  /* outer COPY /* nested CREATE */ DROP */
  SELECT 'LOCK'::"pg_catalog"."text" AS "literal"
  FROM ONLY "openpencil_release"."backfill_receipts_v2"
  LIMIT 0
)
SELECT "a"."value" FROM "a" CROSS JOIN "b" CROSS JOIN "c";
`
    const input = await withSql(
      {
        ...source,
        queryId: 'lexer-boundary',
        queryVersion: 'lexer-boundary-v1',
        queryDigest: await digestCanonicalManifest({ lexer: 1 }),
        parameterOrder: ['value'],
        responseFields: ['value']
      },
      sql
    )
    await expect(
      createSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateV1(input)
    ).resolves.toMatchObject({ certificate: { staticScanPassed: true } })
  })

  test('snapshots dense arrays before hashing and rejects array or object shape attacks', async () => {
    const source = await reconciliationInput()
    const parameterOrder = [...source.parameterOrder]
    const responseFields = [...source.responseFields]
    const promise = createSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateV1({
      ...source,
      parameterOrder,
      responseFields
    })
    parameterOrder[0] = 'changed'
    responseFields[0] = 'changed'
    const certificate = await promise
    const context =
      trustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1(certificate)
    expect(context?.parameterOrder[0]).toBe(source.parameterOrder[0])
    expect(context?.responseFields[0]).toBe(source.responseFields[0])

    const sparse = [...source.parameterOrder]
    delete sparse[1]
    const invalidInputs: unknown[] = [
      null,
      [],
      { ...source, extra: true },
      Object.assign(Object.create({}), source),
      { ...source, parameterOrder: sparse },
      { ...source, responseFields: [...source.responseFields, source.responseFields[0] ?? 'x'] },
      { ...source, managedRelations: [...source.managedRelations].reverse() }
    ]
    for (const input of invalidInputs) {
      await safetyError(
        createSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateV1(input as never),
        'supabase-backfill-read-query-safety-input-invalid'
      )
    }

    let getterCalls = 0
    const accessor = { ...source } as Record<PropertyKey, unknown>
    Object.defineProperty(accessor, 'sql', {
      enumerable: true,
      get() {
        getterCalls += 1
        return source.sql
      }
    })
    await safetyError(
      createSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateV1(accessor as never),
      'supabase-backfill-read-query-safety-input-invalid'
    )
    expect(getterCalls).toBe(0)

    const revoked = Proxy.revocable(source, {})
    revoked.revoke()
    await safetyError(
      createSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateV1(revoked.proxy),
      'supabase-backfill-read-query-safety-input-invalid'
    )
  })

  test('rejects NUL, duplicate contracts, and SQL beyond the static review bound', async () => {
    const source = await reconciliationInput()
    const oversized = `SELECT $1 FROM ONLY "openpencil_release"."backfill_executions_v1";${' '.repeat(
      SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_LIMITS.maximumSqlBytes
    )}`
    for (const input of [
      { ...source, sql: `${source.sql}\0` },
      {
        ...source,
        parameterOrder: [...source.parameterOrder, source.parameterOrder[0] ?? 'duplicate']
      },
      {
        ...source,
        responseFields: [...source.responseFields, source.responseFields[0] ?? 'duplicate']
      },
      { ...source, queryDigest: `${source.queryDigest.slice(0, -1)}B` },
      { ...source, sql: oversized }
    ]) {
      await safetyError(
        createSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateV1(input),
        'supabase-backfill-read-query-safety-input-invalid'
      )
    }
  })
})
